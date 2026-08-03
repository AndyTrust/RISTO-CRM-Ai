/**
 * Vercel Serverless Function — /api/assistant
 * Proxy per Claude API. Usato dal PageAssistant in produzione (Vercel).
 *
 * SICUREZZA (fix 2026-08-03, issue #1):
 * L'endpoint era pubblico: chiunque conoscesse l'URL poteva far girare la
 * ANTHROPIC_API_KEY del progetto con un semplice curl (il CORS del browser non
 * protegge da chiamate server-to-server). Ora serve un JWT Supabase valido:
 * il token viene verificato contro /auth/v1/user prima di inoltrare a Anthropic.
 * Aggiunta anche la validazione del body, che prima era assente del tutto.
 */

const SUPABASE_URL =
  process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

// Modelli ammessi: evita che un chiamante autenticato punti a modelli arbitrari
// (o inesistenti) gonfiando i costi.
const ALLOWED_MODELS = new Set([
  'claude-sonnet-4-6',
  'claude-opus-4-1',
  'claude-haiku-4-5',
]);
const DEFAULT_MODEL = 'claude-sonnet-4-6';

const MAX_MESSAGES = 60;
const MAX_BODY_CHARS = 400000; // ben oltre l'uso reale del PageAssistant

/**
 * Verifica il JWT Supabase passato in `Authorization: Bearer <token>`.
 * @returns {Promise<{ok: true, user: object} | {ok: false, status: number, error: string}>}
 */
async function verifySupabaseAuth(req) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return {
      ok: false,
      status: 500,
      error: 'SUPABASE_URL / SUPABASE_ANON_KEY non configurate nelle env Vercel',
    };
  }

  const header = req.headers?.authorization || req.headers?.Authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) {
    return { ok: false, status: 401, error: 'Autenticazione richiesta' };
  }

  try {
    const r = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!r.ok) {
      return { ok: false, status: 401, error: 'Sessione non valida o scaduta' };
    }
    const user = await r.json();
    if (!user?.id) {
      return { ok: false, status: 401, error: 'Sessione non valida' };
    }
    return { ok: true, user };
  } catch (e) {
    // Errore di rete verso Supabase: NON lasciar passare la richiesta.
    return { ok: false, status: 503, error: 'Verifica sessione non disponibile' };
  }
}

/**
 * Validazione del body (prima assente: si inoltrava `req.body` grezzo a Anthropic).
 * @returns {{ok: true, value: object} | {ok: false, error: string}}
 */
function validateBody(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Body mancante o non valido' };
  }

  const { messages, system, tools, model } = body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return { ok: false, error: '`messages` deve essere un array non vuoto' };
  }
  if (messages.length > MAX_MESSAGES) {
    return { ok: false, error: `Troppi messaggi (max ${MAX_MESSAGES})` };
  }
  for (const m of messages) {
    if (!m || typeof m !== 'object') {
      return { ok: false, error: 'Messaggio non valido' };
    }
    if (m.role !== 'user' && m.role !== 'assistant') {
      return { ok: false, error: `Ruolo non ammesso: ${m.role}` };
    }
    if (typeof m.content !== 'string' && !Array.isArray(m.content)) {
      return { ok: false, error: '`content` deve essere stringa o array' };
    }
  }

  if (system != null && typeof system !== 'string') {
    return { ok: false, error: '`system` deve essere una stringa' };
  }
  if (tools != null && !Array.isArray(tools)) {
    return { ok: false, error: '`tools` deve essere un array' };
  }
  if (model != null && (typeof model !== 'string' || !ALLOWED_MODELS.has(model))) {
    return { ok: false, error: `Modello non ammesso: ${model}` };
  }

  if (JSON.stringify(messages).length > MAX_BODY_CHARS) {
    return { ok: false, error: 'Payload troppo grande' };
  }

  return { ok: true, value: { messages, system, tools, model } };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY non configurata nelle env Vercel' });
  }

  // 1. Autenticazione — prima di qualunque altra cosa.
  const auth = await verifySupabaseAuth(req);
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }

  // 2. Validazione input.
  const parsed = validateBody(req.body);
  if (!parsed.ok) {
    return res.status(400).json({ error: parsed.error });
  }
  const { messages, system, tools, model } = parsed.value;

  try {
    const appName = process.env.VITE_APP_NAME || 'Risto CRM';
    const body = {
      model: model || DEFAULT_MODEL,
      max_tokens: 4096,
      system: system || `Sei un assistente AI del CRM gestionale ${appName}. Rispondi in italiano.`,
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

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: errText });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (error) {
    console.error('Assistant API error:', error);
    return res.status(500).json({ error: error.message });
  }
}
