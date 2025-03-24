import { Devvit, useState, useForm } from '@devvit/public-api';

Devvit.configure({
  http: true,
});

// Store Google API key in Devvit’s settings
Devvit.addSettings([
  {
    name: 'googleApiKey',
    label: 'Google API Key',
    type: 'string',
    isSecret: true,
    scope: 'app',
  },
]);

// Function to fetch response from Gemini
async function fetchGeminiResponse(context: Devvit.Context, q: string): Promise<string> {
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
          contents: [{ role: 'user', parts: [{ text: q }] }],
        }),
      }
    );

    const data = await res.json();
    console.log('Gemini API Response:', data);

    if (data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      return data.candidates[0].content.parts[0].text;
    }

    return 'No valid response from Gemini.';
  } catch (err) {
    console.error('Error fetching Gemini response:', err);
    return `Error: ${err instanceof Error ? err.message : 'Unknown error'}`;
  }
}

// Main Component (Handles Page Switching)
Devvit.addCustomPostType({
  name: 'Devvit - Ask Gemini',
  render: (context) => {
    const [responseText, setResponseText] = useState('');
    const [currentPage, setCurrentPage] = useState<'home' | 'play'>('home'); // Track current page
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null); // Track selected category

    const askform = useForm(
      {
        fields: [{ type: 'string', name: 'query', label: 'Enter Query' }],
      },
      async (values) => {
        const query = values.query || 'invalid query';
        const response = await fetchGeminiResponse(context, query);
        setResponseText(response);
      }
    );

    // Home Page (Category Selection)
    if (currentPage === 'home') {
      const categories = ['Sports Persons', 'Celebrities', 'Animals'];

      return (
        <blocks height='tall' >
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
                  onPress={() => setSelectedCategory(category)}
          
                >
                  {category}
                </button>
              ))}
            </hstack>

            {selectedCategory && (
              <button appearance="primary" onPress={() => setCurrentPage('play')}>
                Play as {selectedCategory} 🎲
              </button>
            )}
          </vstack>
        </blocks>
      );
    }

    // Play Page (Chat with Gemini)
    return (
      <blocks height="tall">
        <vstack alignment="center middle" height="100%" gap="large">
          <text size="large" weight="bold">
            Chat as {selectedCategory} 🗣️
          </text>

          <button appearance="primary" onPress={() => context.ui.showForm(askform)}>
            Ask Gemini Anything! 💡
          </button>

          <text wrap>{responseText}</text>

          <button appearance="secondary" onPress={() => setCurrentPage('home')}>
            ⬅ Back to Categories
          </button>
        </vstack>
      </blocks>
    );
  },
});

export default Devvit;
