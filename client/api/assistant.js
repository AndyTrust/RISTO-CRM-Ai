/**
 * Vercel Serverless Function — /api/assistant
 * Proxy per Claude API. Usato dal PageAssistant in produzione (Vercel).
 * In sviluppo, Vite proxy → Express server/routes/assistant.js
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY non configurata nelle env Vercel' });
  }

  const { messages, system, tools, model } = req.body;

  try {
    const body = {
      model: model || 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: system || 'Sei un assistente AI del CRM gestionale 140 Grammi. Rispondi in italiano.',
      messages,
    };

    if (tools && Array.isArray(tools) && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = { type: 'auto' };
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    res.status(response.status).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
