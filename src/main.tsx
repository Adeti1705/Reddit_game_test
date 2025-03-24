import { Devvit, useState, useForm } from '@devvit/public-api';

Devvit.configure({
  http: true,
});

//  Google API key in Devvit’s settings
Devvit.addSettings([
  {
    name: 'googleApiKey',
    label: 'Google API Key',
    type: 'string',
    isSecret: true,
    scope: 'app',
  },
]);

async function fetchGeminiResponse(context: Devvit.Context, q:string): Promise<string> {
  try {
    const apiKey = await context.settings.get('googleApiKey');
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents: [
            {role: 'user', parts: [{ text: q }],},
          ],
        }),
      }
    );

    const data = await res.json(); 

    console.log('Gemini API Response:', data); 

    // Check if the response contains valid content
    if (data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      return data.candidates[0].content.parts[0].text;
    }

    return 'No valid response from Gemini.';
  } catch (err) {
    console.error('Error fetching Gemini response:', err);
    return `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

Devvit.addCustomPostType({
  name: 'Devvit - Ask Gemini',
  render: (context) => {
    const [responseText, setResponseText] = useState('');

    const askform=useForm(
      {
        fields: [{ type: 'string', name: 'query', label: 'Enter Query' }],
      },
      async (values) => {
        const response = await fetchGeminiResponse(context, values.query || "invalid query");
        setResponseText(response);
      }
    )

    // async function onPress() {
    //   const response = await fetchGeminiResponse(context, 'how are you?');
    //   setResponseText(response);
    // }

    return (
      <blocks height="tall">
        <vstack alignment="center middle" height="100%" gap="large">
          <button appearance="primary" onPress={() => context.ui.showForm(askform)}>
            Hi there! Ask me anything.
          </button>
          <text wrap>{responseText}</text>
        </vstack>
      </blocks>
    );
  },
});

export default Devvit;
