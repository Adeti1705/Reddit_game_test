// import './createPost.js';

// import { Devvit, useState, useWebView } from '@devvit/public-api';

// import type { DevvitMessage, WebViewMessage } from './message.js';

// Devvit.configure({
//   redditAPI: true,
//   redis: true,
// });

// // Add a custom post type to Devvit
// Devvit.addCustomPostType({
//   name: 'Web View Example',
//   height: 'tall',
//   render: (context) => { 
//     // Load username with `useAsync` hook
//     const [username] = useState(async () => {
//       return (await context.reddit.getCurrentUsername()) ?? 'anon';
//     });

//     // Load latest counter from redis with `useAsync` hook
//     const [counter, setCounter] = useState(async () => {
//       const redisCount = await context.redis.get(`counter_${context.postId}`);
//       return Number(redisCount ?? 0);
//     });

//     const webView = useWebView<WebViewMessage, DevvitMessage>({
//       // URL of your web view content
//       url: 'page.html',

//       // Handle messages sent from the web view
//       async onMessage(message, webView) {
//         switch (message.type) {
//           case 'webViewReady':
//             webView.postMessage({
//               type: 'initialData',
//               data: {
//                 username: username,
//                 currentCounter: counter,
//               },
//             });
//             break;
//           case 'setCounter':
//             await context.redis.set(
//               `counter_${context.postId}`,
//               message.data.newCounter.toString()
//             );
//             setCounter(message.data.newCounter);

//             webView.postMessage({
//               type: 'updateCounter',
//               data: {
//                 currentCounter: message.data.newCounter,
//               },
//             });
//             break;
//           default:
//             throw new Error(`Unknown message type: ${message satisfies never}`);
//         }
//       },
//       onUnmount() {
//         context.ui.showToast('Web view closed!');
//       },
//     });

//     // Render the custom post type
//     return (
//       <vstack grow padding="small">
//         <vstack grow alignment="middle center">
//           <text size="xlarge" weight="bold">
//             Example App HAHAHHAHAH thyjveijrgtbhgnj
//           </text>
//           <spacer />
//           <vstack alignment="start middle">
//             <hstack>
//               <text size="medium">Username:</text>
//               <text size="medium" weight="bold">
//                 {' '}
//                 {username ?? ''}
//               </text>
//             </hstack>
//             <hstack>
//               <text size="medium">Current counter:</text>
//               <text size="medium" weight="bold">
//                 {' '}
//                 {counter ?? ''}
//               </text>
//             </hstack>
//           </vstack>
//           <spacer />
//           <button onPress={() => webView.mount()}>Launch App</button>
//         </vstack>
//       </vstack>
//     );
//   },
// });

// export default Devvit;
import './createPost.js';

import { Devvit, useState, useWebView } from '@devvit/public-api';

import type { DevvitMessage, WebViewMessage } from './message.js';

Devvit.configure({
  redditAPI: true,
  redis: true,
});

const SECRET_WORD = 'elephant';

Devvit.addCustomPostType({
  name: 'Word Guess Game',
  height: 'tall',
  render: (context) => {
    const [userGuess, setUserGuess] = useState('');
    const [result, setResult] = useState('');

    const webView = useWebView<WebViewMessage, DevvitMessage>({
      url: 'page.html',
      async onMessage(message, webView) {
        switch (message.type) {
          case 'webViewReady':
            webView.postMessage({
              type: 'initialData',
              data: { result: result },
            });
            break;
          case 'guessWord':
            const guess = message.data.guess.toLowerCase();
            const response = guess === SECRET_WORD ? 'YESSSS' : 'NO';
            setUserGuess(guess);
            setResult(response);
            webView.postMessage({
              type: 'updateResult',
              data: { result: response },
            });
            break;
          default:
            throw new Error(`Unknown message type: ${message satisfies never}`);
        }
      },
      onUnmount() {
        context.ui.showToast('Game closed!');
      },
    });

    return (
      <vstack grow padding="small">
        <vstack grow alignment="middle center">
          <text size="xlarge" weight="bold">Guess the Secret Word</text>
          <spacer />
          <vstack alignment="start middle">
            <hstack>
              <text size="medium">Your Guess:</text>
              <text size="medium" weight="bold"> {userGuess}</text>
            </hstack>
            <hstack>
              <text size="medium">Result:</text>
              <text size="medium" weight="bold"> {result}</text>
            </hstack>
          </vstack>
          <spacer />
          <button onPress={() => webView.mount()}>Start Game</button>
        </vstack>
      </vstack>
    );
  },
});

export default Devvit;