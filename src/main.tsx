// Learn more at developers.reddit.com/docs
//import { Devvit, useState } from '@devvit/public-api';

Devvit.configure({
  redditAPI: true,
  http: true,
  redis: true,
});

// Add a menu item to the subreddit menu for instantiating the new experience post
import { Devvit, useState, useForm } from '@devvit/public-api';
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI("##");
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });


Devvit.addCustomPostType({
  name: 'TemplateName',
  render: (context) => {
    const [name, setName] = useState('unknown');

    const myForm = useForm(
      {
        fields: [
          {
            type: 'string',
            name: 'name',
            label: 'Name',
          },
        ],
      },
      async (values) => {
        // onSubmit handler
        const dummy = "tryy";
        const prompt = "reply with a hi jai";
        const result = await model.generateContentStream(prompt);
        let chunkText = '';
        for await (const chunk of result.stream) {
          chunkText = chunk.text();
          process.stdout.write(chunkText);
        }
        setName(chunkText ?? '');
      }
    );
    return (
      <vstack gap="medium" height="100%" alignment="middle center">
        <text>Hello0000001 {name}!</text>
        <button
          onPress={() => {
            context.ui.showForm(myForm);
          }}
        >
          Enter query
        </button>
      </vstack>
    );
  },
});

export default Devvit;

// Devvit.addMenuItem({
//   label: 'Add my post',
//   location: 'subreddit',
//   forUserType: 'moderator',
//   onPress: async (_event, context) => {
//     const { reddit, ui } = context;
//     ui.showToast("Submitting your post - upon completion you'll navigate there.");

//     const subreddit = await reddit.getCurrentSubreddit();
//     const post = await reddit.submitPost({
//       title: 'My devvit post',
//       subredditName: subreddit.name,
//       // The preview appears while the post loads
//       preview: (
//         <vstack height="100%" width="100%" alignment="middle center">
//           <text size="large">Loading ...</text>
//         </vstack>
//       ),
//     });
//     ui.navigateTo(post);
//   },
// });

// // Add a post type definition
// Devvit.addCustomPostType({
//   name: 'Experience Post',
//   height: 'regular',
//   render: (_context) => {
//     const [counter, setCounter] = useState(0);

//     return (
//       <vstack height="100%" width="100%" gap="medium" alignment="center middle">
//         <image
//           url="logo.png"
//           description="logo"
//           imageHeight={256}
//           imageWidth={256}
//           height="48px"
//           width="48px"
//         />
//         <text size="large">{`Click counter: ${counter}`}</text>
//         <button appearance="primary" onPress={() => setCounter((counter) => counter + 1)}>
//           Click me!
//         </button>
//       </vstack>
//     );
//   },
// });

// export default Devvit;
