//has leaderboard issues
import { Devvit, useState, useForm } from '@devvit/public-api';
import { animals, getAnimalData } from './animaldata';

Devvit.configure({
  http: true,
  redis: true,
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

async function setupAnimals(context: Devvit.Context) {
  const animalData = getAnimalData();
  const redisData: Record<string, string> = {};
  
  Object.entries(animalData).forEach(([key, value]) => {
    redisData[key] = JSON.stringify(value);
  });
  
  // Store in Redis
  await context.redis.hSet('animals', redisData);
  
  console.log("Animal data stored in Redis!");
}

async function getRandomAnimal(context: Devvit.Context) {
   // List of animal names
  const animalKeys = await context.redis.hKeys('animals');
  if (!animalKeys.length) {
    await setupAnimals(context);
  }
  const animals = await context.redis.hKeys('animals');
  if (animals.length === 0){
    console.log("No animals found!");
    return {animal: "an anumal", descrip:"set cant be made"};
  } 
  // Pick a random animal
  const randomAnimal = animals[Math.floor(Math.random() * animals.length)];
  console.log(`Selected Animal: ${randomAnimal}`);
  const animalData = await context.redis.hGet('animals', randomAnimal);
  //console.log(animalData);
  //console.log(JSON.parse(animalData));
  if (!animalData) {
    console.log("Animal data is undefined");
    return {animal: 'errrrr', descrip: 'error'};
  }
  const { image, description } = JSON.parse(animalData);
  console.log(`Selected Animal: ${randomAnimal}`);
  console.log(`Image URL: ${image}`);
  console.log(`Description: ${description}`);

  return {animal: randomAnimal, descrip: description};
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
// const getLeaderboard = async (context: Devvit.Context): Promise<LeaderboardEntry[]> => {
//   try {
//     const leaderboardData = await context.redis.zRange('leaderboard', 0, 5, {
//       reverse: true,
//       by: 'rank',
//       withScores: true
//     });

//     // Transform the data into our LeaderboardEntry format
//     const results: LeaderboardEntry[] = [];
//     for (let i = 0; i < leaderboardData.length; i += 2) {
//       const member = leaderboardData[i];
//       const score = parseFloat(leaderboardData[i + 1]);
//       if (member && !isNaN(score)) {
//         results.push({ member, score });
//       }
//     }
    
//     return results;
//   } catch (error) {
//     console.error('Error fetching leaderboard:', error);
//     return [];
//   }
// };
// const channel = useChannel({
//   name: 'leaderboard_updates',
//   onMessage: (newEntryData) => {
//     const newEntry = newEntryData as LeaderboardEntry;
//     if (!newEntry || typeof newEntry !== 'object' || !('member' in newEntry) || !('score' in newEntry)) {
//       console.error('Invalid leaderboard entry format:', newEntryData);
//       return;
//     }
    
//     setLeaderboard(currentLeaderboard => {
//       // Check if the member already exists
//       const existingIndex = currentLeaderboard.findIndex(entry => entry.member === newEntry.member);
      
//       // If member exists and new score is higher, update score; otherwise add new entry
//       const updatedLeaderboard = existingIndex >= 0 && currentLeaderboard[existingIndex].score < newEntry.score
//         ? currentLeaderboard.map((entry, i) => i === existingIndex ? newEntry : entry)
//         : existingIndex >= 0
//           ? currentLeaderboard // Don't update if new score is lower
//           : [...currentLeaderboard, newEntry];
      
//       // Sort by score (highest first) and take top 5
//       return updatedLeaderboard
//         .sort((a, b) => b.score - a.score)
//         .slice(0, 5);
//     });
//   },
// });

// channel.subscribe();


//post
Devvit.addCustomPostType({
  name: 'Devvit - Ask Gemini',
  render: (context) => {
    const [responseText, setResponseText] = useState('');
    const [currentPage, setCurrentPage] = useState<'home' | 'play' | 'res'>('home');
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
    const [secretEntity, setSecretEntity] = useState<string>('');
    const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
    const [win, setWin] = useState<boolean>(false);
    const [questionCount, setQuestionCount] = useState<number>(0);
    const [page, setPage] = useState(0);
    const pairsPerPage = 5; 
    const [result, setRessult] = useState<boolean>(false);
    type LeaderboardEntry = { member: string; score: number };
    const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
    const [showLeaderboard, setShowLeaderboard] = useState(false);
    //const [descrip, setDescrip] = useState<string>(''); 
    const pairedHistory = [];
    for (let i = 0; i < chatHistory.length; i += 2) {
      pairedHistory.push([chatHistory[i], chatHistory[i + 1] || { role: 'assistant', content: '...' }]);
    }

    const totalPages = Math.max(1, Math.ceil(pairedHistory.length / pairsPerPage));
    const currentPairs = pairedHistory.slice(page * pairsPerPage, (page + 1) * pairsPerPage);

    // const fetchLeaderboard = async () => {
    //   try {
    //     const leaderboardData = await getLeaderboard(context);
    //     if (leaderboardData && Array.isArray(leaderboardData)) {
    //       // Transform the data to match LeaderboardEntry type if necessary
    //       const formattedData = leaderboardData.map(entry => {
    //         if (typeof entry === 'string') {
    //           // Handle string format if that's what Redis returns
    //           const [member, score] = entry.split(':');
    //           return { member, score: parseInt(score, 10) };
    //         }
    //         // Handle object format
    //         return entry as LeaderboardEntry;
    //       });
    //       setLeaderboard(formattedData);
    //     } else {
    //       console.error('Invalid leaderboard data format:', leaderboardData);
    //       setLeaderboard([]);
    //     }
    //   } catch (error) {
    //     console.error('Error fetching leaderboard:', error);
    //     setLeaderboard([]);
    //   }
    // };
    
    // // Add a useEffect to fetch leaderboard when page changes to 'res'
    // useEffect(() => {
    //   if (currentPage === 'res') {
    //     fetchLeaderboard();
    //   }
    // }, [currentPage]);

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
          setWin
          setCurrentPage('res');
          return;
        }
        const response = await fetchGeminiResponse(context, secretEntity, updatedHistory);
        console.log('Gemini Response:', response);
        // if (response.trim().toLowerCase() === 'yes') { 
        //   console.log('User has won!');
        //   setResponseText('You have won!');
        
        //   const gameScore = 100 - questionCount * 10; // Example scoring system
        //   const username = (await context.reddit.getCurrentUsername()) || `Player_${Date.now()}`;
        
        //   // Store score in Redis leaderboard
        //   await context.redis.zAdd('leaderboard', { member: username, score: gameScore });
        
        //   // Send real-time update
        //   context.realtime.send('leaderboard_updates', { member: username, score: gameScore });
        //   // stays as is
        //   await context.redis.zAdd('leaderboard', { member: username, score: gameScore });
        //   // new code
        //   context.realtime.send('leaderboard_updates', { member: username, score: gameScore });
        //   setCurrentPage('res'); 
        //   return;
        // }
        
        if (response.trim().toLowerCase() === 'you have won!') {
          console.log('User has won!');
          setResponseText('You have won!');
          setWin(true);
          setCurrentPage('res');
          return;
        }
        setChatHistory([...updatedHistory, { role: 'assistant' as const, content: response }]);
        setResponseText(response);
        setQuestionCount(newCount);
      }
    );
    if (currentPage === 'res') {
      return (
        <blocks height="tall">
          <vstack alignment="center middle" height="100%" gap="large" backgroundColor="white" padding="medium">
            <text size="xlarge" weight="bold">Congratulations! 🎉</text>
            
            <image
              url="https://hips.hearstapps.com/hmg-prod/images/balloon-flower-royalty-free-image-1703107813.jpg"
              imageWidth={300}
              imageHeight={300}
            />
            
            <text size="large">You've completed the game!</text>
            
            <hstack gap="medium">
              <button appearance="primary" onPress={() => setCurrentPage('home')}>
                Play Again
              </button>
              <button 
                appearance="secondary" 
                onPress={() => setShowLeaderboard(!showLeaderboard)}
              >
                {showLeaderboard ? "Hide Leaderboard" : "View Leaderboard"}
              </button>
            </hstack>
    
            {/* {showLeaderboard && (
              <vstack gap="small" padding="medium" backgroundColor="rgba(0,0,0,0.05)" borderRadius="medium" width="100%">
                <text size="large" weight="bold">🏆 Leaderboard 🏆</text>
                {leaderboard && leaderboard.length > 0 ? (
                  leaderboard.map((entry, index) => (
                    <hstack key={index} gap="medium" alignment="center middle">
                      <text weight="bold">{`${index + 1}.`}</text>
                      <text>{entry.member}</text>
                      <text weight="bold">{`${entry.score} pts`}</text>
                    </hstack>
                  ))
                ) : (
                  <text>No scores on the leaderboard yet. Be the first!</text>
                )}
              </vstack>
            )} */}
          </vstack>
        </blocks>
      );
    }

    if (currentPage === 'home') {
      const categories = ['Sports Persons', 'Celebrities', 'Animals'];

      return (
        <blocks height='tall'>
          <vstack alignment="center middle" height="100%" gap="large" backgroundColor='lightblue'>
            <text size="large" weight="bold" color='black'>
              Welcome to REVERSE AKINATOR! 
            </text>
            <text color='black'>Select a category:</text>
            <hstack gap="medium" padding="medium">
              {categories.map((category) => (
                <button
                  key={category}
                  appearance={selectedCategory === category ? 'primary' : 'secondary'}
                  onPress={async () => {
                    setSelectedCategory(category);
                    if (category === 'Animals') {
                      const {animal, descrip} = await getRandomAnimal(context);
                      //setDescrip(descrip);
                      setSecretEntity(animal); // Set the random animal as character
                    } else {
                      setSecretEntity('a human');
                    }
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
              >
                Play as {selectedCategory} 
              </button>
            )}
          </vstack>
        </blocks>
      );
    }

    return (
      <blocks height="tall">
        <vstack alignment="center middle" height="100%" gap="medium" backgroundColor="white">
            <button appearance="secondary" onPress={() => setCurrentPage('home')}>
              🔙 Back
            </button>

            <text size="large" weight="bold" color="black">
              Guess the Secret Entity!
            </text>

            <button onPress={() => context.ui.showForm(askform)}>
              Make a guess
            </button>

            <text wrap color="black" weight="bold">
              AI Response: {responseText}
            </text>
            <text>Questions Asked: {questionCount}/10</text>


            <vstack height="100%">
              <text size="medium" weight="bold" color="black">
                Chat History:
              </text>

              {currentPairs.map((pair, index) => (
                <vstack key={index.toString()}>
                  <text wrap color="blue">You: {pair[0].content}</text>
                  <text wrap color="green">AI: {pair[1].content}</text>
                  <spacer size="small" /> {/* Adds vertical spacing between pairs */}
                </vstack>
              ))}

              <spacer /> {/* Pushes buttons to bottom */}

              <hstack>
                <button onPress={() => setPage(page - 1)} disabled={page === 0}>
                  ⬅️ Previous
                </button>
                <text>{`Page ${page + 1} of ${totalPages}`}</text>
                <button onPress={() => setPage(page + 1)} disabled={page >= totalPages - 1}>
                  Next ➡️
                </button>
              </hstack>
            </vstack>

            <button appearance="secondary" onPress={() => setCurrentPage('home')}>
              Restart Game 🔄
            </button>
          </vstack>
      </blocks>
    );
  },
});

export default Devvit;
