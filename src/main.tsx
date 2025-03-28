import { Devvit, useState, useForm, useChannel} from '@devvit/public-api';


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
    case 'Actors':
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
// Add a new function to get daily challenge-specific leaderboard
// async function getDailyChallengeLeaderboard(context: Devvit.Context, postId: string, limit = 5): Promise<LeaderboardEntry[]> {
//   try {
//     // Use a separate leaderboard key for each post/challenge
//     const dailyLeaderboardKey = `leaderboard:daily:${postId}`;
    
//     // Get the top scores for this specific challenge
//     const leaderboardData = await context.redis.zRange(dailyLeaderboardKey, 0, limit - 1, {
//       reverse: true,
//       by: 'rank',
//       withScores: true
//     });
    
//     return leaderboardData.map(entry => ({
//       member: entry.member,
//       score: entry.score
//     }));
//   } catch (error) {
//     console.error('Error fetching daily challenge leaderboard:', error);
//     return [];
//   }
// }
// ...existing code...
async function getDailyChallengeLeaderboard(context: Devvit.Context, postId: string, limit = 5): Promise<LeaderboardEntry[]> {
  try {
    // Use a separate leaderboard key for each post/challenge
    const dailyLeaderboardKey = `leaderboard:daily:${postId}`;
    
    // Get the top scores for this specific challenge
    const leaderboardData = await context.redis.zRange(dailyLeaderboardKey, 0, limit - 1, {
      reverse: true,
      by: 'rank',
      withScores: true
    });
    
    return leaderboardData.map(entry => ({
      member: entry.member,
      score: entry.score
    }));
  } catch (error) {
    console.error('Error fetching daily challenge leaderboard:', error);
    return [];
  }
}
// ...existing code...
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
async function hasUserPlayedDailyChallenge(context: Devvit.Context, username: string, postId: string): Promise<boolean> {
  try {
    // Check if the user has a score in the daily challenge leaderboard
    const dailyLeaderboardKey = `leaderboard:daily:${postId}`;

    const score = await context.redis.zScore(dailyLeaderboardKey, username);
    console.log(`User ${username} score for post ${postId}:`, score);
    // If score exists, user has already played
    return score !== null && score !== undefined;;
  } catch (error) {
    console.error('Error checking if user has played daily challenge:', error);
    return false; // Default to false if there's an error
  }
}
Devvit.addSchedulerJob({
  name: 'daily_challenge',
  onRun: async (_, context) => {
    const subredditName = await context.reddit.getCurrentSubredditName();
    const dailySeed = Math.floor((Math.random() * 3)+1);
    console.log(`Generated daily seed: ${dailySeed}`);
      
      // Map seed to category
      let category;
      switch (dailySeed) {
        case 1:
          category = 'Animals';
          break;
        case 2:
          category = 'Celebrities';
          break;
        case 3:
          category = 'Sports Persons';
          break;
        default:
          category = 'Animals'; // Fallback
      }
      console.log(`Selected category for daily challenge: ${category}`);
      
      // Get a random entity from the selected category
      await setupCategoryData(context, category); // Ensure data is loaded
      const { entity, description, url } = await getRandomEntity(context, category);
      console.log(`Selected entity for daily challenge: ${entity}`);
      
      const today = new Date().toISOString().split('T')[0];
      
      // Create the post with preview
      const post = await context.reddit.submitPost({
        subredditName: subredditName,
        title: `Daily Challenge - ${today} - Category: ${category}`,
        preview: (
          <vstack>
            <text>Loading daily challenge...</text>
            <text>Category: {category}</text>
          </vstack>
        )
      });
      
      // Store the challenge data in Redis
      await context.redis.set(`post:${post.id}:seed`, dailySeed.toString());
      await context.redis.set(`post:${post.id}:category`, category);
      await context.redis.set(`post:${post.id}:entity`, entity);
      await context.redis.set(`post:${post.id}:imageurl`, url);
      
      console.log(`Created daily challenge post: ${post.id}`);
      console.log(`Entity: ${entity}, Image URL: ${url}`);
      
      return {
        seed: dailySeed,
        category,
        entity,
        imageUrl: url
      };
  },
});
//     if (dailySeed)
//     const today = new Date().toISOString().split('T')[0];

    
//     // Create the post with preview
//     const post = await context.reddit.submitPost({
//       subredditName: subredditName, // Use the variable you defined above
//       title: `Daily Challenge - ${today}`,
//       preview: (
//         <vstack>
//           <text>Loading challenge...</text>
//         </vstack>
//       )
//     });
    
//     // Don't forget to store the seed in Redis
//     await context.redis.set(`post:${post.id}:seed`, dailySeed.toString());
// },
// });


// 2. Trigger to set up the scheduler
Devvit.addTrigger({
  events: ['AppInstall', 'AppUpgrade'],
  onEvent: async (_, context) => {
    try {
      // Check if we already have a job scheduled
      const existingJobId = await context.redis.get('daily_challenge_job_id');
      
      // If there's an existing job, cancel it to avoid duplicates
      if (existingJobId) {
        await context.scheduler.cancelJob(existingJobId);
      }
      
      // Schedule a new job to run at midnight UTC every day
      const jobId = await context.scheduler.runJob({
        cron: '37 12 * * *', // Midnight UTC every day
        name: 'daily_challenge',

      });
      
      // Store the job ID in Redis
      await context.redis.set('daily_challenge_job_id', jobId);
    } catch (e) {
      console.error('Failed to schedule daily challenge:', e);
    }
  },
});

Devvit.addMenuItem({
  label: 'clear',
  location: 'post',
  forUserType: 'moderator',
  onPress: async (_, context) => {
    const jobId = (await context.redis.get('jobId')) || '0';
    await context.scheduler.cancelJob(jobId);
  },
});
//post
Devvit.addCustomPostType({
  name: 'Devvit - Ask Gemini',
  render: (context) => {
    const [responseText, setResponseText] = useState('');
    const [currentPage, setCurrentPage] = useState<'home' | 'play' | 'win' | 'instructions' | 'loose' | 'res'>('home');
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
    const [dc, setDc] = useState<string>('false');
    const [cdc, setCdc] = useState<string>('false');
    const [redirected, setRedirected] = useState(false);
    const [seed] = useState(async () => {
    const postSeed = await context.redis.get(`post:${context.postId}:seed`);
      return Number(postSeed || 1);
    });
    const pairedHistory = [];
    for (let i = 0; i < chatHistory.length; i += 2) {
      pairedHistory.push([chatHistory[i], chatHistory[i + 1] || { role: 'assistant', content: '...' }]);
    }
    const totalPages = Math.max(1, Math.ceil(pairedHistory.length / pairsPerPage));
    const currentPairs = pairedHistory.slice(page * pairsPerPage, (page + 1) * pairsPerPage);

    // Create channel for leaderboard updates - we'll use this for real-time updates
    // but not rely on it for core functionality
    // const channel = useChannel({
    //   name: 'leaderboard_updates',
    //   onMessage: (newLeaderboardEntry) => {
    //     console.log('Received leaderboard update:', newLeaderboardEntry);
    //     // When we receive a message, refresh the leaderboard from Redis
    //     refreshLeaderboard();
    //   },
    //   onSubscribed: () => {
    //     console.log('Channel connected successfully');
    //     // Load initial leaderboard data when channel connects
    //     refreshLeaderboard();
    //   }
    // });
    // ...existing code...
const channel = useChannel({
  name: 'leaderboard_updates',
  onMessage: (message) => {
    console.log('Received leaderboard update:', message);
    
    // Only handle daily challenge updates for the current post
    if (message.type === 'daily_update' && message.postId === context.postId) {
      getDailyChallengeLeaderboard(context, context.postId).then(data => {
        setDailyLeaderboard(data);
      });
    }
  },
  onSubscribed: () => {
    console.log('Channel connected successfully');
    // Load initial daily leaderboard data when channel connects
    getDailyChallengeLeaderboard(context, context.postId).then(data => {
      if (data.length > 0) {
        setDailyLeaderboard(data);
      }
    });
  }
});
// ...existing code...
    
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
    // const handleGameEnd = async (finalScore: number) => {
    //   try {
    //     const username = await context.reddit.getCurrentUsername();
    //     console.log(`Game ended for ${username} with score: ${finalScore}`);
        
    //     // Update Redis directly (don't rely on channel)
    //     await updateLeaderboard(context, username, finalScore);
        
    //     // Try to broadcast the update if channel is available
    //     try {
    //       await channel.send({ member: username, score: finalScore });
    //       console.log('Sent channel update');
    //     } catch (error) {
    //       console.log('Could not send channel update, will rely on Redis');
    //     }
        
    //     // Navigate to results page
    //     setCurrentPage('res');
        
    //     // Refresh leaderboard data directly
    //     await refreshLeaderboard();
    //   } catch (error) {
    //     console.error('Error in handleGameEnd:', error);
    //   }
    // };
    const [dailyLeaderboard, setDailyLeaderboard] = useState<LeaderboardEntry[]>([]);
const [showDailyLeaderboard, setShowDailyLeaderboard] = useState(false);
    const refreshLeaderboards = async () => {
      try {
        // Get global leaderboard
        const globalData = await getLeaderboard(context);
        if (globalData.length > 0) {
          setLeaderboard(globalData);
        }
        
        // Get daily challenge leaderboard if applicable
        if (dc === 'true') {
          const dailyData = await getDailyChallengeLeaderboard(context, context.postId);
          if (dailyData.length > 0) {
            setDailyLeaderboard(dailyData);
          }
        }
      } catch (error) {
        console.error('Error refreshing leaderboards:', error);
      }
    };
    // const handleGameEnd = async (finalScore: number) => {
    //   try {
    //     const username = await context.reddit.getCurrentUsername();
    //     console.log(`Game ended for ${username} with score: ${finalScore}`);
        
    //     // Update the global leaderboard
    //     await updateLeaderboard(context, username, finalScore);
        
    //     // If this was a daily challenge, also update the challenge-specific leaderboard
    //     if (dc === 'true') {
    //       const postId = context.postId;
    //       const dailyLeaderboardKey = `leaderboard:daily:${postId}`;
          
    //       // Add score to the daily challenge leaderboard
    //       await context.redis.zAdd(dailyLeaderboardKey, { score: finalScore, member: username });
    //       console.log(`Updated daily challenge leaderboard for post ${postId}`);
    //     }
        
    //     // Try to broadcast the update if channel is available
    //     try {
    //       await channel.send({ member: username, score: finalScore });
    //       console.log('Sent channel update');
    //     } catch (error) {
    //       console.log('Could not send channel update, will rely on Redis');
    //     }
        
    //     // Navigate to results page
    //     setCurrentPage('res');
        
    //     // Refresh leaderboards
    //     await refreshLeaderboards();
    //   } catch (error) {
    //     console.error('Error in handleGameEnd:', error);
    //   }
    // };
    // ...existing code...
const handleGameEnd = async (finalScore: number) => {
  try {
    const username = await context.reddit.getCurrentUsername();
    console.log(`Game ended for ${username} with score: ${finalScore}`);
    
    // Only update the challenge-specific leaderboard, not the global one
    if (dc === 'true') {
      const postId = context.postId;
      const dailyLeaderboardKey = `leaderboard:daily:${postId}`;
      
      // Add score to the daily challenge leaderboard
      await context.redis.zAdd(dailyLeaderboardKey, { score: finalScore, member: username });
      console.log(`Updated daily challenge leaderboard for post ${postId}`);
      
      // Try to broadcast the update if channel is available
      try {
        await channel.send({ 
          type: 'daily_update',
          postId: postId,
          member: username, 
          score: finalScore 
        });
        console.log('Sent daily challenge update');
      } catch (error) {
        console.log('Could not send channel update, will rely on Redis');
      }
    }
    
    // Navigate to results page
    setCurrentPage('res');
    setRedirected(false);
    
    // Refresh only the daily leaderboard
    const dailyData = await getDailyChallengeLeaderboard(context, context.postId);
    if (dailyData.length > 0) {
      setDailyLeaderboard(dailyData);
    }
  } catch (error) {
    console.error('Error in handleGameEnd:', error);
  }
};
// ...existing code...
    

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
          setCdc('false');
          setWin(false);
          return; // Return early as handleGameEnd will set page
        }
        
        const response = await fetchGeminiResponse(context, secretEntity, updatedHistory);
        console.log('Gemini Response:', response);
        
        if (response.trim().toLowerCase() === 'you have won!') {
          if(dc && cdc){
            const winScore = 100-10*questionCount;
            setScore(winScore);
            console.log('User has won!');
            const username = await context.reddit.getCurrentUsername();
          console.log('Current User:', username);
            await handleGameEnd(winScore);
            setResponseText('You have won!');
          }
          setCdc('false');
          setCurrentPage('win');
          return;
        }
        
        setChatHistory([...updatedHistory, { role: 'assistant' as const, content: response }]);
        setResponseText(response);
        setQuestionCount(newCount);
      }
    );
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
              url="yellow_pattern.jpg"
              description="Game Background"
              resizeMode="cover"
            />

            {/* Foreground Content */}
            <hstack alignment="center middle" width="100%" height="100%">
              <vstack
                alignment="center middle"
                gap="medium" // ✅ Reduced from large to medium
                padding="medium" // ✅ Reduced from large to medium
                width="60%"
                maxWidth={600}
                maxHeight="100%" // ✅ Added to prevent overflow
              >
                {/* Box for Win Message */}
                <vstack
                  alignment="center middle"
                  backgroundColor="rgba(255, 255, 255, 0.9)"
                  padding="medium" // ✅ Reduced from large to medium
                  cornerRadius="large"
                  borderColor="black"
                  borderWidth="2px"
                  shadow="medium"
                  width="100%"
                  maxWidth={500}
                >
                  <text size="large" wrap weight="bold" color="black" alignment="center middle">
                     OH NOO! You got me this time!! 
                  </text>
                  <text size="medium" weight="bold" color="black" alignment="center middle">
                    It was indeed {secretEntity}!
                  </text>
                </vstack>

                {/* Image Box with Border */}
                <vstack
                  alignment="center middle"
                  backgroundColor="rgba(255, 255, 255, 0.9)"
                  padding="small" // ✅ Reduced from medium to small
                  cornerRadius="large"
                  borderColor="black"
                  borderWidth="3px"
                  shadow="medium"
                  width={250} // ✅ Reduced from 280 to 250
                  height={250} // ✅ Reduced from 280 to 250
                >
                  <image
                    url={imageurl}
                    imageWidth={240}
                    imageHeight={240}
                    resizeMode='cover'
                    //cornerRadius="full"
                  />
                </vstack>

                {/* Score Box */}
                <vstack
                  backgroundColor="rgba(255, 255, 255, 0.9)"
                  padding="small" // ✅ Reduced from medium to small
                  cornerRadius="medium"
                  borderColor="black"
                  borderWidth="2px"
                  shadow="medium"
                  width="100%"
                  maxWidth={350}
                >
                  <text size="medium" color="black" alignment="center middle">
                    You answered in {questionCount}/10 questions! {score}
                  </text>
                </vstack>

                {/* Button Row */}
                <hstack alignment="start bottom" width="100%" padding="small">
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
              url="yellow_pattern.jpg"
              description="Game Background"
              resizeMode="cover"
            />

            {/* Foreground Content */}
            <hstack alignment="center middle" width="100%" height="100%">
              <vstack
                alignment="center middle"
                gap="medium" // ✅ Reduced from large to medium
                padding="medium" // ✅ Reduced from large to medium
                width="60%"
                maxWidth={600}
                maxHeight="100%" // ✅ Added to prevent overflow
              >
                {/* Box for Win Message */}
                <vstack
                  alignment="center middle"
                  backgroundColor="rgba(255, 255, 255, 0.9)"
                  padding="medium" // ✅ Reduced from large to medium
                  cornerRadius="large"
                  borderColor="black"
                  borderWidth="2px"
                  shadow="medium"
                  width="100%"
                  maxWidth={500}
                >
                  <text size="large" wrap weight="bold" color="black" alignment="center middle">
                     HAHAA I got you this time!! 
                  </text>
                  <text size="medium" weight="bold" color="black" alignment="center middle">
                    The secret entity was {secretEntity}!
                  </text>
                </vstack>

                {/* Image Box with Border */}
                <vstack
                  alignment="center middle"
                  backgroundColor="rgba(255, 255, 255, 0.9)"
                  padding="small" // ✅ Reduced from medium to small
                  cornerRadius="large"
                  borderColor="black"
                  borderWidth="3px"
                  shadow="medium"
                  width={250} // ✅ Reduced from 280 to 250
                  height={250} // ✅ Reduced from 280 to 250
                >
                  <image
                    url={imageurl}
                    imageWidth={240}
                    imageHeight={240}
                    resizeMode='cover'
                    //cornerRadius="full"
                  />
                </vstack>

                {/* Score Box */}
                <vstack
                  backgroundColor="rgba(255, 255, 255, 0.9)"
                  padding="small" // ✅ Reduced from medium to small
                  cornerRadius="medium"
                  borderColor="black"
                  borderWidth="2px"
                  shadow="medium"
                  width="100%"
                  maxWidth={350}
                >
                  <text size="medium" color="black" alignment="center middle">
                    You took {questionCount} tries! {score}
                  </text>
                </vstack>

                {/* Button Row */}
                <hstack alignment="start bottom" width="100%" padding="small">
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
    // Update the results page to show both leaderboards
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
          
//           {/* Show buttons for different leaderboards */}
//           {dc === 'true' ? (
//             <hstack gap="small">
//               <button 
//                 appearance={showLeaderboard && !showDailyLeaderboard ? "primary" : "secondary"}
//                 onPress={() => {
//                   setShowLeaderboard(true);
//                   setShowDailyLeaderboard(false);
//                   refreshLeaderboards();
//                 }}
//               >
//                 Global Leaderboard
//               </button>
              
//               <button 
//                 appearance={showDailyLeaderboard ? "primary" : "secondary"}
//                 onPress={() => {
//                   setShowDailyLeaderboard(true);
//                   setShowLeaderboard(false);
//                   refreshLeaderboards();
//                 }}
//               >
//                 Today's Challenge
//               </button>
              
//               {(showLeaderboard || showDailyLeaderboard) && (
//                 <button 
//                   appearance="secondary"
//                   onPress={() => {
//                     setShowLeaderboard(false);
//                     setShowDailyLeaderboard(false);
//                   }}
//                 >
//                   Hide
//                 </button>
//               )}
//             </hstack>
//           ) : (
//             <button 
//               appearance="secondary" 
//               onPress={() => {
//                 setShowLeaderboard(!showLeaderboard);
//                 if (!showLeaderboard) {
//                   refreshLeaderboards();
//                 }
//               }}
//             >
//               {showLeaderboard ? "Hide Leaderboard" : "View Leaderboard"}
//             </button>
//           )}
//         </hstack>

//         {/* Global Leaderboard Display */}
//         {showLeaderboard && !showDailyLeaderboard && (
//           <vstack gap="small" padding="medium" backgroundColor="rgba(0,0,0,0.05)" borderRadius="medium" width="100%">
//             <text size="large" weight="bold">🏆 Global Leaderboard 🏆</text>
//             {leaderboard && leaderboard.length > 0 ? (
//               leaderboard.map((entry, index) => (
//                 <hstack key={index} gap="medium" alignment="center middle">
//                   <text weight="bold">{`${index + 1}.`}</text>
//                   <text>{entry.member}</text>
//                   <text weight="bold">{`${entry.score} pts`}</text>
//                 </hstack>
//               ))
//             ) : (
//               <text>No scores on the global leaderboard yet. Be the first!</text>
//             )}
//           </vstack>
//         )}
        
//         {/* Daily Challenge Leaderboard Display */}
//         {showDailyLeaderboard && (
//           <vstack gap="small" padding="medium" backgroundColor="rgba(0,120,215,0.1)" borderRadius="medium" width="100%">
//             <text size="large" weight="bold">🏆 Today's Challenge Leaderboard 🏆</text>
//             {dailyLeaderboard && dailyLeaderboard.length > 0 ? (
//               dailyLeaderboard.map((entry, index) => (
//                 <hstack key={index} gap="medium" alignment="center middle">
//                   <text weight="bold">{`${index + 1}.`}</text>
//                   <text>{entry.member}</text>
//                   <text weight="bold">{`${entry.score} pts`}</text>
//                 </hstack>
//               ))
//             ) : (
//               <text>No scores for today's challenge yet. Be the first!</text>
//             )}
//           </vstack>
//         )}
//       </vstack>
//     </blocks>
//   );
// }
// ...existing code...
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
          
//           {/* Simplified to only show daily challenge leaderboard */}
//           <button 
//             appearance="secondary" 
//             onPress={() => {
//               setShowDailyLeaderboard(!showDailyLeaderboard);
//               if (!showDailyLeaderboard) {
//                 // Get the daily challenge leaderboard when button is clicked
//                 getDailyChallengeLeaderboard(context, context.postId).then(data => {
//                   setDailyLeaderboard(data);
//                 });
//               }
//             }}
//           >
//             {showDailyLeaderboard ? "Hide Leaderboard" : "View Challenge Leaderboard"}
//           </button>
//         </hstack>
        
//         {/* Display only the daily challenge leaderboard */}
//         {showDailyLeaderboard && (
//           <vstack gap="small" padding="medium" backgroundColor="rgba(0,120,215,0.1)" borderRadius="medium" width="100%">
//             <text size="large" weight="bold">🏆 Today's Challenge Leaderboard 🏆</text>
//             {dailyLeaderboard && dailyLeaderboard.length > 0 ? (
//               dailyLeaderboard.map((entry, index) => (
//                 <hstack key={index} gap="medium" alignment="center middle">
//                   <text weight="bold">{`${index + 1}.`}</text>
//                   <text>{entry.member}</text>
//                   <text weight="bold">{`${entry.score} pts`}</text>
//                 </hstack>
//               ))
//             ) : (
//               <text>No scores for today's challenge yet. Be the first!</text>
//             )}
//           </vstack>
//         )}
//       </vstack>
//     </blocks>
//   );
// }
// if (currentPage === 'res') {
//   return (
//     <blocks height="tall">
//       <vstack alignment="center middle" height="100%" gap="large" backgroundColor="white" padding="medium">
//         {/* Notification message for users who've already played */}
//         {/* { redirected && <text size="medium" color="purple">
//           You've already played today's challenge! Come back tomorrow for a new one.
//         </text>} */}
        
//         {/* <text size="xlarge" weight="bold">Congratulations! 🎉</text>
        
//         <text size="large">You've completed the game!</text> */}
        
//         {/* Only show Play Again button */}
//         <zstack width="100%" height="100%">

//             {/* Background Image Layer */}
//             <image
//               imageHeight={1024}
//               imageWidth={1500}
//               height="100%"
//               width="100%"
//               url="yellow_pattern.jpg"
//               description="Game Background"
//               resizeMode="cover"
//             />
//         <button appearance="primary" onPress={() => setCurrentPage('home')}>
//           Play Again
//         </button>
        
//         {/* Always display the daily challenge leaderboard without requiring button click */}
//         <vstack gap="small" padding="medium" backgroundColor="rgba(0,120,215,0.1)" borderRadius="medium" width="100%">
//           <text size="large" weight="bold">🏆 LEADERBOARD 🏆</text>
//           {dailyLeaderboard && dailyLeaderboard.length > 0 ? (
//             dailyLeaderboard.map((entry, index) => (
//               <hstack key={index} gap="medium" alignment="center middle">
//                 <text weight="bold">{`${index + 1}.`}</text>
//                 <text>{entry.member}</text>
//                 <text weight="bold">{`${entry.score} pts`}</text>
//               </hstack>
//             ))
//           ) : (
//             <text>No scores for today's challenge yet. Be the first!</text>
//           )}
//         </vstack>
//         </zstack>
//       </vstack>
//   </blocks>
//   );
// }
if (currentPage === 'res') {
  return (
    <blocks height="tall">
      <zstack width="100%" height="100%">
        {/* Background Image Layer */}
        <image
          imageHeight={1024}
          imageWidth={1500}
          height="100%"
          width="100%"
          url="yellow_pattern.jpg"
          description="Game Background"
          resizeMode="cover"
        />
        
        {/* Content Container */}
        <vstack alignment="center middle" height="100%" padding="medium" gap="large">
          {/* Notification message for users who've already played */}
          {/* {redirected && (
            <text size="medium" color="white" weight="bold">
              You've already played today's challenge! Come back tomorrow for a new one.
            </text>
          )} */}
          
          {/* Always display the daily challenge leaderboard without requiring button click */}
          <vstack 
            gap="medium" 
            padding="large" 
            backgroundColor="rgba(255, 255, 255, 0.9)" 
            borderRadius="medium" 
            width="80%"
            maxWidth={600}
            borderColor="black"
            borderWidth="2px"
            shadow="medium"
          >
            <text size="xlarge" weight="bold" color="black" alignment="center">🏆 LEADERBOARD 🏆</text>
            
            {dailyLeaderboard && dailyLeaderboard.length > 0 ? (
              dailyLeaderboard.map((entry, index) => (
                <hstack key={index} gap="medium" alignment="center middle" padding="small">
                  <text weight="bold" color="black">{`${index + 1}.`}</text>
                  <text color="black">{entry.member}</text>
                  <text weight="bold" color="black">{`${entry.score} pts`}</text>
                </hstack>
              ))
            ) : (
              <text color="black">No scores for today's challenge yet. Be the first!</text>
            )}
            
            {/* Play Again button at the end of content */}
            <button 
              appearance="primary" 
              onPress={() => {
                setCurrentPage('home');
              }}
              width="60%"
            >
              Play Again
            </button>
          </vstack>
        </vstack>
      </zstack>
    </blocks>
  );
}
// if (currentPage === 'home') {
//   const categories = ['Sports Persons', 'Celebrities', 'Animals'];

//   return (
//     <blocks height="tall">
      
//       {/* Top bar for the help icon */}
//       <hstack width="100%" padding="medium" backgroundColor="lightblue">
//         <hstack alignment="end top" width="100%">
//           <icon name="help" color="black" onPress={() => setCurrentPage('instructions')} />
//         </hstack>
//       </hstack>

//       {/* Main content */}
//       <hstack alignment="center middle" height="100%" backgroundColor="lightblue">
        
//         {/* Left side with controls */}
//         <vstack alignment="center middle" width="50%" gap="medium" padding="medium">
//           <image
//             imageWidth={250}
//             imageHeight={100}
//             url="text-1743099872566.png"
//             description="AI-kinator"
//             resizeMode="fit"
//           />
// <button
//   appearance="primary"
//   onPress={async () => {
//     try {
//       // Get current username
//       const username = await context.reddit.getCurrentUsername();
//       const postId = context.postId;
      
//       // Check if user has already played this daily challenge
//       const alreadyPlayed = await hasUserPlayedDailyChallenge(context, username, postId);
      
//       if (alreadyPlayed) {
//         // User has already played - go directly to leaderboard
//         console.log(`User ${username} already played daily challenge ${postId}`);
//         setCurrentPage('res');
//         setShowDailyLeaderboard(true);
//         setRedirected(true);
        
//         // Load leaderboard data
//         const dailyData = await getDailyChallengeLeaderboard(context, postId);
//         if (dailyData.length > 0) {
//           setDailyLeaderboard(dailyData);
//         }
//         return;
//       }
      
//       // If they haven't played yet, continue with normal flow
//       // Get the daily challenge data from Redis
//       const dailyCategory = await context.redis.get(`post:${postId}:category`) || 'Animals';
//       const dailyEntity = await context.redis.get(`post:${postId}:entity`);
//       const dailyImageUrl = await context.redis.get(`post:${postId}:imageurl`);
      
//       console.log(`Loading daily challenge: Category=${dailyCategory}, Entity=${dailyEntity}`);
      
//       if (dailyEntity) {
//         setSelectedCategory(dailyCategory);
//         setSecretEntity(dailyEntity);
//         setImageurl(dailyImageUrl || '');
        
//         // Reset game state
//         setChatHistory([]);
//         setDc('true');
//         setCdc('true');
//         setQuestionCount(0);
//         setCurrentPage('play');
//       } else {
//         // Fallback to random animal if no daily challenge is set
//         setSelectedCategory('Animals');
//         console.log('No daily challenge found, loading animal entity...');
//         const result = await getRandomEntity(context, 'Animals');
//         setSecretEntity(result.entity);
//         setImageurl(result.url || '');
//         setChatHistory([]);
//         setQuestionCount(0);
        
//         setCurrentPage('play');
//       }
//     } catch (error) {
//       console.error('Error loading daily challenge:', error);
//       // Fallback to a random entity if there's an error
//       const result = await getRandomEntity(context, 'Animals');
//       setSecretEntity(result.entity);
//       setImageurl(result.url || '');
//       setChatHistory([]);
//       setQuestionCount(0);
//       setCurrentPage('play');
//     }
//   }} 
// >
//   Play Today's Challenge
// </button>

//           <text color="black">Or</text>
//           <text color="black">Select a category:</text>

//           <hstack gap="medium" padding="medium">
//             {categories.map((category) => (
//               <button
//                 key={category}
//                 appearance={selectedCategory === category ? "primary" : "secondary"}
//                 onPress={async () => {
//                   setSelectedCategory(category);
//                   const { entity, description, url } = await getRandomEntity(context, category);
//                   setSecretEntity(entity);
//                   setImageurl(url);
//                   console.log(`Selected ${category}: ${secretEntity}`);
//                   console.log(`Description: ${imageurl}`);
//                 }}
//               >
//                 {category}
//               </button>
//             ))}
//           </hstack>

//           {selectedCategory && (
//             <button
//               appearance="primary"
//               onPress={() => {
//                 setChatHistory([]);
//                 setCurrentPage("play");
//                 setQuestionCount(0);
//               }}
//               grow
//             >
//               Play
//             </button>
//           )}
//         </vstack>

//         {/* Right side with main image */}
//         <vstack alignment="center middle" width="50%" height="100%">
//           <image
//             url="homebk.png"
//             imageHeight={1024}
//                 imageWidth={1500}
//                 height="100%"
//                 width="100%" // Avoids cropping
//             description="Main game image"
//           />
//         </vstack>

//       </hstack>

//     </blocks>
//   );
// }
// if (currentPage === 'home') {
//   const categories = ['Sports Persons', 'Celebrities', 'Animals'];

//   return (
//     <blocks height="tall">
//       <vstack width="100%" height="100%">
//         {/* Top bar for the help icon */}
//         <hstack width="100%" padding="small" backgroundColor="lightblue">
//           <hstack alignment="end top" width="100%">
//             <icon name="help" color="black" onPress={() => setCurrentPage('instructions')} />
//           </hstack>
//         </hstack>

//         {/* Main content with left and right sections */}
//         <hstack alignment="center top" width="100%" grow backgroundColor="lightblue">
//         <spacer size="large" />
//         <spacer size="large" />
//           {/* Left side with controls */}
//           <vstack alignment="center top" width="50%" gap="medium" padding="medium">
//             <image
//               imageWidth={350}
//               imageHeight={150}
//               url="text-1743099872566.png"
//               description="AI-kinator"
//               resizeMode="fit"
//             />

// <button
// appearance="primary"
// onPress={async () => {
//   try {
//     // Get current username
//     const username = await context.reddit.getCurrentUsername();
//     const postId = context.postId;
    
//     // Check if user has already played this daily challenge
//     const alreadyPlayed = await hasUserPlayedDailyChallenge(context, username, postId);
    
//     if (alreadyPlayed) {
//       // User has already played - go directly to leaderboard
//       console.log(`User ${username} already played daily challenge ${postId}`);
//       setCurrentPage('res');
//       setShowDailyLeaderboard(true);
//       setRedirected(true);
      
//       // Load leaderboard data
//       const dailyData = await getDailyChallengeLeaderboard(context, postId);
//       if (dailyData.length > 0) {
//         setDailyLeaderboard(dailyData);
//       }
//       return;
//     }
    
//     // If they haven't played yet, continue with normal flow
//     // Get the daily challenge data from Redis
//     const dailyCategory = await context.redis.get(`post:${postId}:category`) || 'Animals';
//     const dailyEntity = await context.redis.get(`post:${postId}:entity`);
//     const dailyImageUrl = await context.redis.get(`post:${postId}:imageurl`);
    
//     console.log(`Loading daily challenge: Category=${dailyCategory}, Entity=${dailyEntity}`);
    
//     if (dailyEntity) {
//       setSelectedCategory(dailyCategory);
//       setSecretEntity(dailyEntity);
//       setImageurl(dailyImageUrl || '');
      
//       // Reset game state
//       setChatHistory([]);
//       setDc('true');
//       setCdc('true');
//       setQuestionCount(0);
//       setCurrentPage('play');
//     } else {
//       // Fallback to random animal if no daily challenge is set
//       setSelectedCategory('Animals');
//       console.log('No daily challenge found, loading animal entity...');
//       const result = await getRandomEntity(context, 'Animals');
//       setSecretEntity(result.entity);
//       setImageurl(result.url || '');
//       setChatHistory([]);
//       setQuestionCount(0);
      
//       setCurrentPage('play');
//     }
//   } catch (error) {
//     console.error('Error loading daily challenge:', error);
//     // Fallback to a random entity if there's an error
//     const result = await getRandomEntity(context, 'Animals');
//     setSecretEntity(result.entity);
//     setImageurl(result.url || '');
//     setChatHistory([]);
//     setQuestionCount(0);
//     setCurrentPage('play');
//   }
// }} 
// >
// Play Today's Challenge
// </button>
//             <text color="black">Or</text>
//             <text color="black">Pick a category:</text>

//             <vstack gap="medium" width="100%">
//               <hstack gap="medium" padding="medium" width="100%" alignment="center middle">
//                 {categories.map((category) => (
//                   <button
//                     key={category}
//                     appearance={selectedCategory === category ? "primary" : "secondary"}
//                     onPress={async () => {
//                       setSelectedCategory(category);
//                       const { entity, description, url } = await getRandomEntity(context, category);
//                       setSecretEntity(entity);
//                       setImageurl(url);
//                       console.log(`Selected ${category}: ${secretEntity}`);
// //                   console.log(`Description: ${imageurl}`);
//                     }}
//                   >
//                     {category}
//                   </button>
//                 ))}
//               </hstack>
//             </vstack>

//             {(selectedCategory || showDailyLeaderboard) && (
//               <button
//                 appearance="primary"
//                 onPress={() => {
//                   setChatHistory([]);
//                   setCurrentPage("play");
//                   setQuestionCount(0);
//                 }}
//                 width="80%"
//               >
//                 Play
//               </button>
//             )}
//           </vstack>

//           {/* Right side with main image */}
//           <vstack alignment="center middle" width="50%" height="100%">
//             <image
//               url="homebk.png"
//               imageHeight={300}
//               imageWidth={300}
//               width="90%"
//               height="90%"
//               resizeMode="fit"
//               description="Main game image"
//             />
//           </vstack>
//         </hstack>
//       </vstack>
//     </blocks>
//   );
// }
// if (currentPage === 'home') {
//   const categories = ['Sports Persons', 'Celebrities', 'Animals'];
//   const [isChallengePrepared, setIsChallengePrepared] = useState(false);

//   return (
//     <blocks height="tall">
//       <vstack width="100%" height="100%">
//         {/* Top bar for the help icon */}
//         <hstack width="100%" padding="small" backgroundColor="lightblue">
//           <hstack alignment="end top" width="100%">
//             <icon name="help" color="black" onPress={() => setCurrentPage('instructions')} />
//           </hstack>
//         </hstack>

//         {/* Main content with left and right sections */}
//         <hstack alignment="center top" width="100%" grow backgroundColor="lightblue">
//         <spacer size="large" />
//         <spacer size="large" />
//           {/* Left side with controls */}
//           <vstack alignment="center top" width="50%" gap="medium" padding="medium">
//             <image
//               imageWidth={350}
//               imageHeight={150}
//               url="text-1743099872566.png"
//               description="AI-kinator"
//               resizeMode="fit"
//             />

//             <button
//               appearance={isChallengePrepared ? "primary" : "secondary"}
//               onPress={async () => {
//                 try {
//                   // Get current username
//                   const username = await context.reddit.getCurrentUsername();
//                   const postId = context.postId;
                  
//                   // Check if user has already played this daily challenge
//                   const alreadyPlayed = await hasUserPlayedDailyChallenge(context, username, postId);
                  
//                   if (alreadyPlayed) {
//                     // User has already played - go directly to leaderboard
//                     console.log(`User ${username} already played daily challenge ${postId}`);
//                     setCurrentPage('res');
//                     setShowDailyLeaderboard(true);
//                     setRedirected(true);
                    
//                     // Load leaderboard data
//                     const dailyData = await getDailyChallengeLeaderboard(context, postId);
//                     if (dailyData.length > 0) {
//                       setDailyLeaderboard(dailyData);
//                     }
//                     return;
//                   }
                  
//                   // If they haven't played yet, prepare the challenge data
//                   // Get the daily challenge data from Redis
//                   const dailyCategory = await context.redis.get(`post:${postId}:category`) || 'Animals';
//                   const dailyEntity = await context.redis.get(`post:${postId}:entity`);
//                   const dailyImageUrl = await context.redis.get(`post:${postId}:imageurl`);
                  
//                   console.log(`Loading daily challenge: Category=${dailyCategory}, Entity=${dailyEntity}`);
                  
//                   if (dailyEntity) {
//                     setSelectedCategory(dailyCategory);
//                     setSecretEntity(dailyEntity);
//                     setImageurl(dailyImageUrl || '');
                    
//                     // Mark as prepared but don't navigate yet
//                     setDc('true');
//                     setCdc('true');
//                     setIsChallengePrepared(true);
//                   } else {
//                     // Fallback to random animal if no daily challenge is set
//                     setSelectedCategory('Animals');
//                     console.log('No daily challenge found, loading animal entity...');
//                     const result = await getRandomEntity(context, 'Animals');
//                     setSecretEntity(result.entity);
//                     setImageurl(result.url || '');
//                     setIsChallengePrepared(true);
//                   }
//                 } catch (error) {
//                   console.error('Error loading daily challenge:', error);
//                   // Fallback to a random entity if there's an error
//                   const result = await getRandomEntity(context, 'Animals');
//                   setSecretEntity(result.entity);
//                   setImageurl(result.url || '');
//                   setIsChallengePrepared(true);
//                 }
//               }} 
//             >
//               Today's Challenge
//             </button>

//             <text color="black">Or</text>
//             <text color="black">Pick a category:</text>

//             <vstack gap="medium" width="100%">
//               <hstack gap="medium" padding="medium" width="100%" alignment="center middle">
//                 {categories.map((category) => (
//                   <button
//                     key={category}
//                     appearance={selectedCategory === category ? "primary" : "secondary"}
//                     onPress={async () => {
//                       setSelectedCategory(category);
//                       // Reset daily challenge flag when category is selected
//                       setDc('false');
//                       setCdc('false');
//                       setIsChallengePrepared(false);
                      
//                       const { entity, description, url } = await getRandomEntity(context, category);
//                       setSecretEntity(entity);
//                       setImageurl(url);
//                       console.log(`Selected ${category}: ${secretEntity}`);
//                     }}
//                   >
//                     {category}
//                   </button>
//                 ))}
//               </hstack>
//             </vstack>

//             {/* Show Play button if either category is selected OR challenge is prepared */}
//             {(selectedCategory || isChallengePrepared) && (
//               <button
//                 appearance="primary"
//                 onPress={() => {
//                   setChatHistory([]);
//                   setCurrentPage("play");
//                   setQuestionCount(0);
//                 }}
//                 width="80%"
//               >
//                 Play
//               </button>
//             )}
//           </vstack>

//           {/* Right side with main image */}
//           <vstack alignment="center middle" width="50%" height="100%">
//             <image
//               url="homebk.png"
//               imageHeight={300}
//               imageWidth={300}
//               width="90%"
//               height="90%"
//               resizeMode="fit"
//               description="Main game image"
//             />
//           </vstack>
//         </hstack>
//       </vstack>
//     </blocks>
//   );
// }
if (currentPage === 'home') {
  const categories = ['Sports Persons', 'Actors', 'Animals'];
  const [isChallengePrepared, setIsChallengePrepared] = useState(false);

  return (
    <blocks height="tall">
      <vstack width="100%" height="100%">
        {/* Top bar for the help icon */}
        <hstack width="100%" padding="small" backgroundColor="lightblue">
          <hstack alignment="end top" width="100%">
            <icon name="help" color="black" onPress={() => setCurrentPage('instructions')} />
          </hstack>
        </hstack>

        {/* Main content with left and right sections - use percentages for responsive layout */}
        <hstack alignment="center top" width="100%" grow backgroundColor="lightblue">
          {/* Left side with controls - keeps 50% width on any screen */}
          <vstack alignment="center top" width="60%" gap="medium" padding="small">
            <image
            imageWidth={900}  // Required attribute - add an appropriate pixel value
            imageHeight={150}
              // Use percentage width instead of fixed size
              width="70%"

              // Let the height adjust automatically to maintain aspect ratio
              resizeMode="fit"
              url="text-1743099872566.png"
              description="AI-kinator"
            />

            <button
              width="70%"
              appearance={isChallengePrepared ? "primary" : "secondary"}
              onPress={async () => {
                                try {
                                  // Get current username
                                  const username = await context.reddit.getCurrentUsername();
                                  const postId = context.postId;
                                  
                                  // Check if user has already played this daily challenge
                                  const alreadyPlayed = await hasUserPlayedDailyChallenge(context, username, postId);
                                  
                                  if (alreadyPlayed) {
                                    // User has already played - go directly to leaderboard
                                    console.log(`User ${username} already played daily challenge ${postId}`);
                                    setCurrentPage('res');
                                    setShowDailyLeaderboard(true);
                                    setRedirected(true);
                                    
                                    // Load leaderboard data
                                    const dailyData = await getDailyChallengeLeaderboard(context, postId);
                                    if (dailyData.length > 0) {
                                      setDailyLeaderboard(dailyData);
                                    }
                                    return;
                                  }
                                  
                                  // If they haven't played yet, prepare the challenge data
                                  // Get the daily challenge data from Redis
                                  const dailyCategory = await context.redis.get(`post:${postId}:category`) || 'Animals';
                                  const dailyEntity = await context.redis.get(`post:${postId}:entity`);
                                  const dailyImageUrl = await context.redis.get(`post:${postId}:imageurl`);
                                  
                                  console.log(`Loading daily challenge: Category=${dailyCategory}, Entity=${dailyEntity}`);
                                  
                                  if (dailyEntity) {
                                    setSelectedCategory(dailyCategory);
                                    setSecretEntity(dailyEntity);
                                    setImageurl(dailyImageUrl || '');
                                    
                                    // Mark as prepared but don't navigate yet
                                    setDc('true');
                                    setCdc('true');
                                    setIsChallengePrepared(true);
                                  } else {
                                    // Fallback to random animal if no daily challenge is set
                                    setSelectedCategory('Animals');
                                    console.log('No daily challenge found, loading animal entity...');
                                    const result = await getRandomEntity(context, 'Animals');
                                    setSecretEntity(result.entity);
                                    setImageurl(result.url || '');
                                    setIsChallengePrepared(true);
                                  }
                                } catch (error) {
                                  console.error('Error loading daily challenge:', error);
                                  // Fallback to a random entity if there's an error
                                  const result = await getRandomEntity(context, 'Animals');
                                  setSecretEntity(result.entity);
                                  setImageurl(result.url || '');
                                  setIsChallengePrepared(true);
                                }
                              }} 
            >
              Today's Challenge
            </button>

            <text color="black">Or</text>
            <text color="black">Pick a category:</text>

            {/* Make category buttons layout more responsive */}
            <vstack gap="medium" width="100%">
              <hstack 
                gap="medium" 
                padding="medium" 
                width="100%" 
                alignment="center middle"
                wrap // This allows buttons to wrap on smaller screens
              >
                {categories.map((category) => (
                  <button
                    key={category}
                    appearance={selectedCategory === category ? "primary" : "secondary"}
                    onPress={async () => {
                                          
                                            setSelectedCategory(category);
                                            // Reset daily challenge flag when category is selected
                                            setDc('false');
                                            setCdc('false');
                                            setIsChallengePrepared(false);
                                            
                                            const { entity, description, url } = await getRandomEntity(context, category);
                                            setSecretEntity(entity);
                                            setImageurl(url);
                                            console.log(`Selected ${category}: ${secretEntity}`);
                                          }}
                  >
                    {category}
                  </button>
                ))}
              </hstack>
            </vstack>

            {/* Play button */}
            {(selectedCategory || isChallengePrepared) && (
              <button
                appearance="primary"
                onPress={() => {
                  setChatHistory([]);
                  setCurrentPage("play");
                  setQuestionCount(0);
                }}
                width="80%" // Percentage-based width
              >
                Play
              </button>
            )}
          </vstack>

          {/* Right side with main image */}
          <vstack alignment="center middle" width="40%" height="100%">
  <image
    url="homebk.png"
    imageWidth={410}  // Required attribute - add an appropriate pixel value
    imageHeight={620} // Required attribute - add an appropriate pixel value
    width="100%"
    height="100%"
    resizeMode="scale-down"
    description="Main game image"
  />
</vstack>
        </hstack>
      </vstack>
    </blocks>
  );
}

return (
  <blocks height="tall">
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
      <vstack padding="medium" height="100%" width="100%" gap="medium" alignment="center">

        {/* Header Section - Centered Progress Bar */}
        <vstack gap="small" width="80%" alignment="center">
          <text color="black">Guesses Remaining: {10 - questionCount}/10</text>
          <hstack width="100%" height="20px" backgroundColor="#E0E0E0" cornerRadius="small">
            <hstack
              width={`${((10 - questionCount) / 10) * 100}%`}
              height="100%"
              backgroundColor={questionCount > 7 ? "red" : questionCount > 4 ? "yellow" : "green"}
              cornerRadius="small"
            />
          </hstack>
        </vstack>

        {/* Main Content Area */}
        <hstack height="100%" width="100%" gap="small" alignment="center middle">

          {/* Genie Image - Aligned Left and Scaled */}
          <vstack height="100%" width="30%" alignment="center middle">
            <image imageWidth={250} imageHeight={1000} url="image.png" resizeMode="scale-down" />
          </vstack>

          {/* Game UI Section */}
          <vstack height="100%" width="70%" gap="small" alignment="center">

            {/* Chat History with Brown Border */}
            <vstack
              backgroundColor="#bf5324"
              height="75%"
              width="85%"
              cornerRadius="medium"
              padding="small" // Adds space between border and inner chat box
              alignment="center"
            >
              {/* Inner Chat Box */}
              <vstack
                backgroundColor="beige"
                height="100%"
                width="100%"
                gap="small"
                cornerRadius="medium"
                padding="medium"
                alignment="start"
              >
                <text alignment="center" size="medium" weight="bold" color="black">
                  📝What You've Asked So Far
                </text>
                {/* Display messages with newest first */}
                {currentPairs.map((pair, index) => (
                  <vstack key={index.toString()}>
                    <text wrap color="blue">You: {pair[0].content}</text>
                    <text wrap color="green">AI: {pair[1].content}</text>
                    <spacer size="small" />
                  </vstack>
                ))}
              </vstack>
            </vstack>

            {/* Button for Making a Guess */}
            <button onPress={() => context.ui.showForm(askform)} width="30%" appearance="primary" textColor="black">
              Guess...
            </button>

            {/* AI Response Display
            <text wrap color="white" weight="bold">
              AI Response: {responseText}
            </text> */}

            {/* Navigation Buttons */}
            <hstack alignment="center middle" width="100%" gap="small">
              <button onPress={() => setPage(page - 1)} disabled={page === 0}>
                ⬅️ Newer
              </button>
              <button onPress={() => setPage(page + 1)} disabled={page >= totalPages - 1}>
                Older ➡️
              </button>

            </hstack>
            <vstack height="100%" width="100%" gap="small" alignment="center" grow>
  {/* Other game UI elements here */}

  {/* Give Up button - Positioned at Bottom Right */}
  <hstack width="85%" alignment="end bottom" padding="small">
    <button
      width="20%" 
      onPress={() => {
        setWin(false);
        setCurrentPage('loose');
      }}
      appearance="destructive"
    >
      Give Up
    </button>
  </hstack>
</vstack>

          </vstack>
        </hstack>
      </vstack>
    </zstack>
  </blocks>
);
      },
    });
    
 export default Devvit;
