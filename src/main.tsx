mport { Devvit, useState, useForm, useChannel} from '@devvit/public-api';


import { animals, getdata } from './Animals_ds';
import { celebrities, getdata as getCelebritiesData } from './Celebrities';
import { sports, getdata as getSportsData } from './Sports_Persons';


Devvit.configure({
  http: true,
  redis: true,
  realtime: true,
  redditAPI: true,
});

// Store Google API key in Devvit's settings
Devvit.addSettings([
  {
    name: 'googleApiKey',
    label: 'Google API Key',
    type: 'string',
    isSecret: true,
    scope: 'app',
  },
]);
type LeaderboardEntry = { member: string; score: number };

// Replace the existing setupAnimals and getRandomAnimal functions with these more general functions

// Setup data for a specific category in Redis
async function setupCategoryData(context: Devvit.Context, category: string) {
  let data: Record<string, any> = {};
  
  // Get data based on category
  switch (category.toLowerCase()) {
    case 'animals':
      data = getdata(); // from Animals.ts
      break;
    case 'celebrities':
      data = getCelebritiesData(); // from Celebrities.ts
      break;
    case 'sports persons':
      data = getSportsData(); // from Sports.ts
      break;
    default:
      console.log(`Unknown category: ${category}`);
      return;
  }
  
  // Convert data to JSON strings for Redis
  const redisData: Record<string, string> = {};
  Object.entries(data).forEach(([key, value]) => {
    redisData[key] = JSON.stringify(value);
  });
  
  // Store in Redis under the category name (lowercase)
  await context.redis.hSet(category.toLowerCase(), redisData);
  console.log(`${category} data stored in Redis!`);
}

// Get a random entity from a specific category
async function getRandomEntity(context: Devvit.Context, category: string) {
  const categoryKey = category.toLowerCase();
  
  // Check if data exists for this category
  const entityKeys = await context.redis.hKeys(categoryKey);
  if (!entityKeys.length) {
    // If not, set it up
    await setupCategoryData(context, category);
    // And get the keys again
    const keys = await context.redis.hKeys(categoryKey);
    if (keys.length === 0) {
      console.log(`No ${category} found!`);
      return { entity: `a ${category} entity`, description: "Data couldn't be loaded" };
    }
  }
  
  // Get all keys for the category
  const entities = await context.redis.hKeys(categoryKey);
  
  // Pick a random entity
  const randomEntity = entities[Math.floor(Math.random() * entities.length)];
  console.log(`Selected ${category}: ${randomEntity}`);
  
  // Get entity data
  const entityData = await context.redis.hGet(categoryKey, randomEntity);
  if (!entityData) {
    console.log(`${category} data is undefined`);
    return { entity: randomEntity, description: "No description available" };
  }
  
  // Parse the data
  const parsedata= JSON.parse(entityData);
  console.log(parsedata);
  console.log('url', parsedata.image);
  //const { image, description } = JSON.parse(entityData);
  //console.log('url', image);
  const decription = parsedata.description;
  const image = parsedata.image;
  //console.log('description', description);
  
  return { entity: randomEntity, description: decription, url: image };
}


// gemini msg declaration
type ChatMessage = { role: 'user' | 'assistant'; content: string };
async function fetchGeminiResponse(
  context: Devvit.Context,
  secretEntity: string,
  chatHistory: ChatMessage[]
): Promise<string> {
  try {
    const apiKey = await context.settings.get('googleApiKey');

    // Ensure there's at least one user query
    if (chatHistory.length === 0) {
      return 'No queries yet!';
    }

    // Extract the latest user query
    const latestQuery = chatHistory[chatHistory.length - 1].content;

    // Prepare the instruction prompt
    const instruction = {
      role: 'user',
      content: `You are the AI host of Reverse Akinator.
        The user is guessing a secret entity, and you can only reply with "yes" or "no" or "You have won!".
        The secret entity is: "${secretEntity}" (keep this hidden).
        If the user correctly guesses the entity, then reply with "You have won!".
        The user's question: "${latestQuery}"`
    };

    // Send only the instruction and latest user query to Gemini
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: instruction.content }]
            }
          ]
        }),
      }
    );
    const data = await res.json();
    console.log('Gemini API Response:', data);
    const ans=data?.candidates?.[0]?.content?.parts?.[0]?.text;
    
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No valid response from Gemini.';
  } catch (err) {
    console.error('Error fetching Gemini response:', err);
    return `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

// Get the latest leaderboard from Redis using proper method
async function getLeaderboard(context: Devvit.Context, limit = 5): Promise<LeaderboardEntry[]> {
  try {
    // Use zRevRangeWithScores to get highest scores first with their scores
    const leaderboardData = await context.redis.zRange('leaderboard', 0, 5, {
      reverse: true,
      by: 'rank',
      withScores: true
    });
    
    return leaderboardData.map(entry => ({
      member: entry.member,
      score: entry.score
    }));
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    return [];
  }
}

// Update score in Redis - simpler implementation that doesn't rely on channel being connected
async function updateLeaderboard(context: Devvit.Context, username: string, score: number) {
  try {
    // Update the score in Redis
    await context.redis.zAdd('leaderboard', { score, member: username });
    console.log(`Updated score for ${username}: ${score}`);
    return true;
  } catch (err) {
    console.error('Error updating leaderboard in Redis:', err);
    return false;
  }
}

//post
Devvit.addCustomPostType({
  name: 'Devvit - Ask Gemini',
  render: (context) => {
    const [responseText, setResponseText] = useState('');
    const [currentPage, setCurrentPage] = useState<'home' | 'play' | 'win' | 'instructions' | 'loose'>('home');
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
    const [secretEntity, setSecretEntity] = useState<string>('');
    const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
    const [win, setWin] = useState<boolean>(false);
    const [questionCount, setQuestionCount] = useState<number>(0);
    const [page, setPage] = useState(0);
    const [score, setScore] = useState(0);
    const pairsPerPage = 5; 
    const [result, setRessult] = useState<boolean>(false);
    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
    const [showLeaderboard, setShowLeaderboard] = useState(false);
    const [showHelp, setShowHelp] = useState(false);
    const [imageurl, setImageurl] = useState<string>('');
    const pairedHistory = [];
    for (let i = 0; i < chatHistory.length; i += 2) {
      pairedHistory.push([chatHistory[i], chatHistory[i + 1] || { role: 'assistant', content: '...' }]);
    }
    const totalPages = Math.max(1, Math.ceil(pairedHistory.length / pairsPerPage));
    const currentPairs = pairedHistory.slice(page * pairsPerPage, (page + 1) * pairsPerPage);

    // Create channel for leaderboard updates - we'll use this for real-time updates
    // but not rely on it for core functionality
    const channel = useChannel({
      name: 'leaderboard_updates',
      onMessage: (newLeaderboardEntry) => {
        console.log('Received leaderboard update:', newLeaderboardEntry);
        // When we receive a message, refresh the leaderboard from Redis
        refreshLeaderboard();
      },
      onSubscribed: () => {
        console.log('Channel connected successfully');
        // Load initial leaderboard data when channel connects
        refreshLeaderboard();
      }
    });
    
    // Function to refresh leaderboard data from Redis
    const refreshLeaderboard = async () => {
      try {
        const data = await getLeaderboard(context);
        if (data.length > 0) {
          setLeaderboard(data);
        }
      } catch (error) {
        console.error('Error refreshing leaderboard:', error);
      }
    };
    
    // Handle game end and update score
    const handleGameEnd = async (finalScore: number) => {
      try {
        const username = await context.reddit.getCurrentUsername();
        console.log(`Game ended for ${username} with score: ${finalScore}`);
        
        // Update Redis directly (don't rely on channel)
        await updateLeaderboard(context, username, finalScore);
        
        // Try to broadcast the update if channel is available
        try {
          await channel.send({ member: username, score: finalScore });
          console.log('Sent channel update');
        } catch (error) {
          console.log('Could not send channel update, will rely on Redis');
        }
        
        // Navigate to results page
        //setCurrentPage('res');
        
        // Refresh leaderboard data directly
        await refreshLeaderboard();
      } catch (error) {
        console.error('Error in handleGameEnd:', error);
      }
    };
    

    const askform = useForm(
      {
        fields: [{ type: 'string', name: 'query', label: 'Ask your next question!!' }],
      },
      async (values) => {
        const query = (values.query || '').trim();
        if (!query) {
          return;
        }
        const updatedHistory = [...chatHistory, { role: 'user' as const, content: query }];
        const newCount = questionCount + 1; // Increment question count

        // Check if the user has reached 10 questions
        if (newCount >= 10) {
          setResponseText("Game over! You've used all 10 questions and didn't guess correctly.");

          await handleGameEnd(score);
          setCurrentPage('loose');
          setWin(false);
          return; // Return early as handleGameEnd will set page
        }
        
        const response = await fetchGeminiResponse(context, secretEntity, updatedHistory);
        console.log('Gemini Response:', response);
        
        if (response.trim().toLowerCase() === 'you have won!') {
          const winScore = 100-10*questionCount;
          setScore(winScore);
          console.log('User has won!');
          setResponseText('You have won!');
          setCurrentPage('win');
          return;
          setWin(true);
          
          // Get current username and update score
          const username = await context.reddit.getCurrentUsername();
          console.log('Current User:', username);
          await handleGameEnd(winScore);
          return;
        }
        
        setChatHistory([...updatedHistory, { role: 'assistant' as const, content: response }]);
        setResponseText(response);
        setQuestionCount(newCount);
      }
    );

    
    // When page changes to results, refresh leaderboard
    // if (currentPage === 'win') {
    //   // Immediately initiate a leaderboard refresh
    //   //refreshLeaderboard();
    // }
    // if (currentPage === 'win') {
    //   return (
    //     <blocks height="tall">
    //       <zstack width="100%" height="100%">
    //       {/* Background Image Layer */}
    //       <image
    //         imageHeight={1024}
    //         imageWidth={1500}
    //         height="100%"
    //         width="100%"
    //         url="bk_result.png"
    //         description="Game Background"
    //         resizeMode="cover"
    //       />
    //       <vstack 
    //         alignment="center middle" 
    //         height="100%" 
    //         gap="large" 
    //         padding="large"
    //         cornerRadius="large" // Rounded edges for a softer look
    //       >
    //         {/* Win Message */}
    //         <text size="xlarge" wrap weight="bold" color="black">OH NOO You got me this time!! </text>
            
    //         {/* Secret Entity Reveal */}
    //         <text size="large" weight="bold" color="black">It was indeed {secretEntity}!</text>
            
    //         {/* Image of the Entity */}
    //         <image
    //           url={imageurl}
    //           //description={secretEntity}
    //           imageWidth={250} // Slightly reduced for better balance
    //           imageHeight={250} 
    //           cornerRadius="full" // Makes it rounded for a polished look
    //         />
    //         {/* Score Information */}
    //         <text size="medium" color="black">
    //           You answered in {questionCount}/10 questions! {score}
    //         </text>
    
    //         {/* Button Row */}
    //         <hstack alignment="space-between" width="100%" padding="small">
    
    //           {/* Back to Home Button - Bottom Right */}
    //           <button appearance="primary" onPress={() => setCurrentPage('home')}>
    //             Another round?
    //           </button>
    //         </hstack>
    //       </vstack>
    //       </zstack>
    //     </blocks>
    //   );
    // }
    // if (currentPage === 'win') {
    //   return (
    //     <blocks height="tall">
    //       <zstack width="100%" height="100%">
            
    //         {/* Background Image Layer */}
    //         <image
    //           imageHeight={1024}
    //           imageWidth={1500}
    //           height="100%"
    //           width="100%"
    //           url="bk_result.png"
    //           description="Game Background"
    //           resizeMode="cover"
    //         />
            
    //         {/* Foreground Content */}
    //         <vstack 
    //           alignment="center middle" 
    //           height="100%" 
    //           gap="large" 
    //           padding="large"
    //         >
    //           {/* Box for Text Content */}
    //           <vstack 
    //             alignment="center middle"
    //             backgroundColor="rgba(255, 255, 255, 0.85)" // Solid white with slight transparency
    //             padding="large"
    //             cornerRadius="large"
    //             borderColor="black"
    //             borderWidth="2px"
    //             shadow="medium"
    //             width="100%" 
    //           >
    //             {/* Win Message */}
    //             <text size="xlarge" wrap weight="bold" color="black" alignment='middle center'>🎉 OH NOO! You got me this time!! 🎉</text>
    
    //             <text size="large" weight="bold" color="black" alignment='middle center'>It was indeed {secretEntity}!</text>
    //           </vstack>
    
    //           {/* Image of the Entity */}
    //           <image
    //             url={imageurl}
    //             imageWidth={250} 
    //             imageHeight={250} 
    //             cornerRadius="full"
    //           />
    
    //           {/* Box for Score Info */}
    //           <vstack 
    //             backgroundColor="rgba(0, 0, 0, 0.8)" // Dark background for contrast
    //             padding="medium"
    //             cornerRadius="medium"
    //             borderColor="white"
    //             borderWidth="2px"
    //             shadow="medium"
    //           >
    //             <text size="medium" color="white" alignment='middle center'>
    //               You answered in {questionCount}/10 questions! {score}
    //             </text>
    //           </vstack>
    
    //           {/* Button Row */}
    //           <hstack alignment="center middle" width="100%" padding="small">
    //             {/* Another Round Button */}
    //             <button appearance="primary" onPress={() => setCurrentPage('home')}>
    //               Another round?
    //             </button>
    //           </hstack>
    
    //         </vstack>
    //       </zstack>
    //     </blocks>
    //   );
    // }
    if (currentPage === 'win') {
      return (
        <blocks height="tall">
          <zstack width="100%" height="100%">
            
            {/* Background Image Layer */}
            <image
              imageHeight={1024}
              imageWidth={1500}
              height="100%"
              width="100%"
              url="bk_result.png"
              description="Game Background"
              resizeMode="cover"
            />
            
            {/* Foreground Content */}
            <hstack alignment="center middle" width="100%" height="100%">
              <vstack 
                alignment="center middle" 
                gap="large" 
                padding="large"
                width="80%" // ✅ Restricts width
                maxWidth={500} // ✅ Prevents content from going out of bounds
              >
                {/* Box for Text Content */}
                <vstack 
                  alignment="center middle"
                  backgroundColor="rgba(255, 255, 255, 0.9)" 
                  padding="large"
                  cornerRadius="large"
                  borderColor="black"
                  borderWidth="2px"
                  shadow="medium"
                  width="100%" // ✅ Makes sure it doesn’t stretch too wide
                  maxWidth={400} // ✅ Controls the text box width
                >
                  {/* Win Message */}
                  <text size="xlarge" wrap weight="bold" color="black" alignment="center middle">
                    🎉 OH NOO! You got me this time!! 🎉
                  </text>
      
                  <text size="large" weight="bold" color="black" alignment="center middle">
                    It was indeed {secretEntity}!
                  </text>
                </vstack>
      
                {/* Image of the Entity */}
                <image
                  url={imageurl}
                  imageWidth={250} 
                  imageHeight={250} 
                  cornerRadius="full"
                />
      
                {/* Box for Score Info */}
                <vstack 
                  backgroundColor="rgba(0, 0, 0, 0.8)" 
                  padding="medium"
                  cornerRadius="medium"
                  borderColor="white"
                  borderWidth="2px"
                  shadow="medium"
                  width="100%" // ✅ Ensures it takes proper width
                  maxWidth={300} // ✅ Prevents over-stretching
                >
                  <text size="medium" color="white" alignment="center middle">
                    You answered in {questionCount}/10 questions! {score}
                  </text>
                </vstack>
      
                {/* Button Row */}
                <hstack alignment="center middle" width="100%" padding="small">
                  {/* Another Round Button */}
                  <button appearance="primary" onPress={() => setCurrentPage('home')}>
                    Another round?
                  </button>
                </hstack>
      
              </vstack>
            </hstack>
          </zstack>
        </blocks>
      );
    }
    
    
    if (currentPage === 'loose') {
      return (
        <blocks height="tall">
          <zstack width="100%" height="100%">
          {/* Background Image Layer */}
          <image
            imageHeight={1024}
            imageWidth={1500}
            height="100%"
            width="100%"
            url="bk_result.png"
            description="Game Background"
            resizeMode="cover"
          />
          <vstack 
            alignment="center middle" 
            height="100%" 
            gap="large" 
            backgroundColor="#B3E5FC" // Light blue background
            padding="large"
            cornerRadius="large" // Rounded edges for a softer look
          >
            {/* Win Message */}
            <text size="xlarge" wrap weight="bold" color="black"> HAHA you coudn't guess it!! </text>
            
            {/* Secret Entity Reveal */}
            <text size="large" weight="bold" color="black">Secret entity was {secretEntity}!</text>
            
            {/* Image of the Entity */}
            <image
              url={imageurl}
              //description={secretEntity}
              imageWidth={250} // Slightly reduced for better balance
              imageHeight={250} 
              cornerRadius="full" // Makes it rounded for a polished look
            />
            {/* Score Information */}
            
            {/* Button Row */}
            <hstack alignment="space-between" width="100%" padding="small">
    
              {/* Back to Home Button - Bottom Right */}
              <button appearance="primary" onPress={() => setCurrentPage('home')}>
                Another round?
              </button>
            </hstack>
          </vstack>
          </zstack>
        </blocks>
      );
    }
    if (currentPage === 'instructions') {
      return (
        <blocks height="tall">
          <vstack 
            alignment="center middle" 
            height="100%" 
            gap="medium" 
            backgroundColor="#F4E1C1" // Sand color
            border='thick'
            borderColor="red"
            cornerRadius="medium" 
            padding="large"
          
          >
            <text size="large" weight="bold" color="black">🎩 Think you're smarter than a mind-reading genie? Prove it! 🧞‍♂️</text>
          
            {/* Game Rules */}
            <vstack alignment="center middle" gap="small" padding="small">
              <text size="medium" weight="bold" color="black">🔍 Game Rules:</text>
              <text size="small" wrap color="black">
               The AI is hiding a secret entity. Your job? Guess it within 10 YES/NO questions!
              </text>
              <text size="small" wrap color="black">
                No tricky loopholes! Only ask YES/NO questions. (No “What’s their name?” 🙃)
              </text>
            </vstack>
    
            {/* Scoring */}
            <vstack alignment="center middle" gap="small" padding="small">
              <text size="medium" weight="bold" color="black">🏆 Score More, Climb Higher!</text>
              <text size="small" wrap color="black">
                Fewer guesses = higher score! Play daily challenge & dominate the leaderboard.
              </text>
            </vstack>
    
            {/* Category Selection */}
            <vstack alignment="center middle" gap="small" padding="small">
              <text size="medium" weight="bold" color="black">🎯 Choose a Category (Optional):</text>
              <text size="small" wrap color="black">
                If you pick Sports Legends, the AI could be thinking of _Usain Bolt_. Pick wisely!
              </text>
            </vstack>
    
            {/* Final Message */}
            <vstack alignment="center middle" gap="small">
              <text size="medium" weight="bold" color="black">👀 Are You Ready?</text>
              <text size="small" wrap color="black">
                Outsmart the AI & become the ultimate AI-Kinator Master!
              </text>
            </vstack>
    
            {/* Back Button */}
            <button appearance="primary" onPress={() => setCurrentPage('home')} width="auto">
              Back to Home
            </button>
          </vstack>
        </blocks>
      );
    }

    // if (currentPage === 'res') {
    //   return (
    //     <blocks height="tall">
    //       <vstack alignment="center middle" height="100%" gap="large" backgroundColor="white" padding="medium">
    //         <text size="xlarge" weight="bold">Congratulations! 🎉</text>
            
    //         <text size="large">You've completed the game!</text>
            
    //         <hstack gap="medium">
    //           <button appearance="primary" onPress={() => setCurrentPage('home')}>
    //             Play Again
    //           </button>
    //           <button 
    //             appearance="secondary" 
    //             onPress={() => {
    //               setShowLeaderboard(!showLeaderboard);
    //               if (!showLeaderboard) {
    //                 // Refresh leaderboard when showing
    //                 refreshLeaderboard();
    //               }
    //             }}
    //           >
    //             {showLeaderboard ? "Hide Leaderboard" : "View Leaderboard"}
    //           </button>
    //         </hstack>
    
    //         {showLeaderboard && (
    //           <vstack gap="small" padding="medium" backgroundColor="rgba(0,0,0,0.05)" borderRadius="medium" width="100%">
    //             <text size="large" weight="bold">🏆 Leaderboard 🏆</text>
    //             {leaderboard && leaderboard.length > 0 ? (
    //               leaderboard.map((entry, index) => (
    //                 <hstack key={index} gap="medium" alignment="center middle">
    //                   <text weight="bold">{`${index + 1}.`}</text>
    //                   <text>{entry.member}</text>
    //                   <text weight="bold">{`${entry.score} pts`}</text>
    //                 </hstack>
    //               ))
    //             ) : (
    //               <text>No scores on the leaderboard yet. Be the first!</text>
    //             )}
    //           </vstack>
    //         )}
    //       </vstack>
    //     </blocks>
    //   );
    // }

    if (currentPage === 'home') {
      const categories = ['Sports Persons', 'Celebrities', 'Animals'];

      return (
        <blocks height='tall'>
          <hstack alignment="center middle" height="100%" backgroundColor='lightblue'>
            {/* Left side with controls */}
            <vstack alignment="center middle" width="50%" gap="medium" padding="medium">
              <image
                imageWidth={250}
                imageHeight={100}
                url="text-1743099872566.png"
                description="AI-kinator"
                resizeMode="fit"
              />


              <button

                onPress={async () => {
                  setSecretEntity('a human');
                }}
              >
                Play Today's Challenge
              </button>
              <text color='black'>Or</text>

              <text color='black'>Select a category:</text>
              <hstack gap="medium" padding="medium">
              {categories.map((category) => (
                <button
                  key={category}
                  appearance={selectedCategory === category ? 'primary' : 'secondary'}
                  onPress={async () => {
                    setSelectedCategory(category);
                    const { entity, description, url } = await getRandomEntity(context, category);
                    setSecretEntity(entity);
                    setImageurl(url);
                    console.log(`Selected ${category}: ${secretEntity}`);
                    console.log(`Description: ${imageurl}`);
                  }}
                >
                  {category}
                </button>
              ))}
            </hstack>
              {selectedCategory && (
                <button
                  appearance="primary"
                  onPress={() => {
                    setChatHistory([]);
                    setCurrentPage('play');
                    setQuestionCount(0);
                  }}
                  grow
                >
                  Play
                </button>
              )}
            </vstack>

            {/* Right side with main image */}
            <vstack alignment="center middle" width="50%" height="100%">
              <image
                url="homebk.png"
                imageWidth={400}
                imageHeight={400}
                resizeMode="fit"
                description="Main game image"
              />
            </vstack>
          </hstack>
        </blocks>
      );
    }

    return (
          <blocks height="regular"> {/* Changed from "regular" to "tall" for more vertical space */}
            <zstack width="100%" height="100%">
              {/* Background Image Layer */}
              <image
                imageHeight={1024}
                imageWidth={1500}
                height="100%"
                width="100%"
                url="output-onlinepngtools.png"
                description="Game Background"
                resizeMode="cover"
              />
    
              {/* Foreground Content */}
              <vstack padding="small" height="100%" gap="small"> {/* Changed from hstack to vstack for better vertical layout */}
                {/* Header Section */}
                <hstack alignment="start" width="100%">
                  <button appearance="secondary" onPress={() => setCurrentPage('home')}>
                    🔙
                  </button>
                  <spacer size="medium" />
                  {/* <text size="large" weight="bold" color="white">
                    Guess the Secret Entity!
                  </text> */}
                  <spacer size="large" />
                  <spacer size="medium" />
                  <vstack gap="small">
                    <text color="black">Guesses Remaining: {10 - questionCount}/10</text>
    
                    {/* Health/Progress Bar */}
                    <hstack width="100%" height="20px" backgroundColor="#E0E0E0" cornerRadius="small">
                      <hstack
                        width={`${((10 - questionCount) / 10) * 100}%`}
                        height="100%"
                        backgroundColor={questionCount > 7 ? "red" : questionCount > 4 ? "yellow" : "green"}
                        cornerRadius="small"
                      />
                    </hstack>
                  </vstack>
                </hstack>
    
                {/* Main Content Area */}
                <hstack height="85%" gap="medium">
                  {/* Genie Image on the Left */}
                  <vstack alignment="middle center" height="100%" width="25%">
                    <image
                      imageWidth={200}
                      imageHeight={1000}
                      url="image.png"
                      resizeMode="fit" /* Added to ensure image fits properly */
                    />
                  </vstack>
    
                  {/* Spacer to push content more to the right */}
                  <spacer size="small" />
                  {/* Spacer to push content more to the right */}
                  <spacer size="small" />
                  {/* Spacer to push content more to the right */}
                  <spacer size="small" />
    
                  {/* Game UI on the Right */}
                  <vstack alignment="center" height="100%" width="75%" gap="small">
    
    
                    {/* Chat History Section */}
                    <vstack backgroundColor="beige" height="75%" width="100%" gap="small" cornerRadius="medium" >
                      <text alignment="center" size="medium" weight="bold" color="black">
                        Chat History:
                      </text>
    
                      {currentPairs.map((pair, index) => (
                        <vstack key={index.toString()}>
                          <text wrap color="blue">You: {pair[0].content}</text>
                          <text wrap color="green">AI: {pair[1].content}</text>
                          <spacer size="small" />
                        </vstack>
                      ))}
                    </vstack>
    
                    <button onPress={() => context.ui.showForm(askform)}>
                      Make a guess
                    </button>
    
                    <text wrap color="white" weight="bold">
                      AI Response: {responseText}
                    </text>
    
                    {/* Fixed Button Navigation */}
                    <hstack alignment="center middle" width="100%">
                      <button onPress={() => setPage(page - 1)} disabled={page === 0}>
                        ⬅️ Newer
                      </button>
                      {/* <text color="black">{`Page ${page + 1} of ${totalPages}`}</text> Changed text color to black */}
                      <button onPress={() => setPage(page + 1)} disabled={page >= totalPages - 1}>
                        Older ➡️
                      </button>
                    </hstack>
    
                    <button appearance="secondary" onPress={() => setCurrentPage('home')}>
                      Restart Game 🔄
                    </button>
                  </vstack>
                </hstack>
              </vstack>
            </zstack>
          </blocks>
        );
    
      },
    });
    
    export default Devvit;
