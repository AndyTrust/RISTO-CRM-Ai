const express = require('express');
const router = express.Router();
const db = require('../database');
const Anthropic = require('@anthropic-ai/sdk');

const AVAILABLE_MODELS = [
  { id: 'claude-opus-4-6',          name: 'Claude Opus 4.6',   description: 'Il più potente — ideale per analisi complesse' },
  { id: 'claude-sonnet-4-6',        name: 'Claude Sonnet 4.6', description: 'Bilanciato velocità/qualità — uso quotidiano' },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', description: 'Velocissimo — domande rapide e semplici' },
];

const NOW_SQL = `datetime('now')`;

// GET modelli disponibili
router.get('/models', (req, res) => res.json(AVAILABLE_MODELS));

// GET sessioni
router.get('/sessions', (req, res) => {
  const sessions = db.prepare('SELECT * FROM chat_sessions ORDER BY updated_at DESC LIMIT 50').all();
  res.json(sessions);
});

// POST nuova sessione
router.post('/sessions', (req, res) => {
  const { title, model } = req.body;
  const result = db.prepare('INSERT INTO chat_sessions (title, model) VALUES (?,?)')
    .run(title || 'Nuova conversazione', model || 'claude-sonnet-4-6');
  res.json({ id: result.lastInsertRowid });
});

// PATCH rinomina sessione
router.patch('/sessions/:id', (req, res) => {
  const { title, model } = req.body;
  const updates = [];
  const params = [];
  if (title) { updates.push('title = ?'); params.push(title); }
  if (model) { updates.push('model = ?'); params.push(model); }
  updates.push(`updated_at = ${NOW_SQL}`);
  params.push(req.params.id);
  db.prepare(`UPDATE chat_sessions SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ success: true });
});

// DELETE sessione
router.delete('/sessions/:id', (req, res) => {
  db.prepare('DELETE FROM chat_sessions WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// GET messaggi di una sessione
router.get('/sessions/:id/messages', (req, res) => {
  const msgs = db.prepare('SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC').all(req.params.id);
  res.json(msgs);
});

// POST invia messaggio con STREAMING
router.post('/sessions/:id/message', async (req, res) => {
  const session_id = req.params.id;
  const { content, include_db_context } = req.body;

  const session = db.prepare('SELECT * FROM chat_sessions WHERE id = ?').get(session_id);
  if (!session) return res.status(404).json({ error: 'Sessione non trovata' });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(400).json({ error: 'ANTHROPIC_API_KEY non configurata. Vai in Impostazioni per configurarla.' });
  }

  // Salva messaggio utente
  db.prepare('INSERT INTO chat_messages (session_id, role, content) VALUES (?,?,?)')
    .run(session_id, 'user', content);

  // Aggiorna titolo sessione se è il primo messaggio
  const msgCount = db.prepare('SELECT COUNT(*) as c FROM chat_messages WHERE session_id = ?').get(session_id);
  if (msgCount.c <= 2) {
    const title = content.length > 50 ? content.substring(0, 50) + '...' : content;
    db.prepare(`UPDATE chat_sessions SET title = ?, updated_at = ${NOW_SQL} WHERE id = ?`).run(title, session_id);
  }

  // Recupera storia messaggi
  const history = db.prepare('SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC').all(session_id);

  // Costruisce system prompt con contesto DB
  let systemPrompt = `Sei l'assistente AI del CRM gestionale di **140 Grammi**, ristorante con due locali: Mameli (MA) e Predda Niedda (PN).

Hai accesso diretto ai dati del database CRM e puoi aiutare con:
- Analisi KPI e performance camerieri (quantum, coperto medio, up-sell)
- Report venduto per operatore, categoria, prodotto
- Andamento chiusure cassa giornaliere e mensili
- Gestione dipendenti e piani individuali
- Analisi costi fornitori e spese generali

**Capacità speciali:**
- Quando crei grafici o visualizzazioni, usa il formato JSON: \`\`\`artifact:chart\n{tipo, dati, config}\`\`\`
- Per documenti/report: \`\`\`artifact:document\n{contenuto markdown}\`\`\`
- Per codice/script: \`\`\`artifact:code:javascript\n{codice}\`\`\`

Rispondi sempre in italiano, in modo conciso e professionale.`;

  if (include_db_context) {
    try {
      const empCount = db.prepare('SELECT COUNT(*) as c FROM employees WHERE active = 1').get();
      const chiusureStats = db.prepare(`
        SELECT location, COUNT(*) as giorni, ROUND(SUM(totale_venduto_ipratico),2) as totale,
               ROUND(AVG(coperto_medio),2) as avg_coperto, MAX(data) as ultima
        FROM chiusure_data GROUP BY location
      `).all();
      const topOperatori = db.prepare(`
        SELECT operatore, location, ROUND(SUM(importo),2) as tot_importo
        FROM venduto_data GROUP BY operatore, location ORDER BY tot_importo DESC LIMIT 10
      `).all();

      systemPrompt += `\n\n**CONTESTO DATABASE ATTUALE:**
Dipendenti attivi: ${empCount.c}
Chiusure cassa: ${JSON.stringify(chiusureStats, null, 2)}
Top operatori per venduto: ${JSON.stringify(topOperatori, null, 2)}`;
    } catch (e) {
      // Continua senza context se errore
    }
  }

  // Setup streaming
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const messages = history.slice(0, -1).map(m => ({ role: m.role, content: m.content }));
    messages.push({ role: 'user', content });

    let fullResponse = '';

    const stream = client.messages.stream({
      model: session.model || 'claude-sonnet-4-6',
      max_tokens: 4096,
      system: systemPrompt,
      messages,
    });

    stream.on('text', (text) => {
      fullResponse += text;
      res.write(`data: ${JSON.stringify({ type: 'text', text })}\n\n`);
    });

    stream.on('message', () => {
      let artifactType = null;
      let artifactContent = null;
      const artifactMatch = fullResponse.match(/```artifact:(\w+(?::\w+)?)\n([\s\S]*?)```/);
      if (artifactMatch) {
        artifactType = artifactMatch[1];
        artifactContent = artifactMatch[2];
      }
      db.prepare('INSERT INTO chat_messages (session_id, role, content, artifact_type, artifact_content) VALUES (?,?,?,?,?)')
        .run(session_id, 'assistant', fullResponse, artifactType, artifactContent);
      db.prepare(`UPDATE chat_sessions SET updated_at = ${NOW_SQL} WHERE id = ?`).run(session_id);
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    });

    stream.on('error', (error) => {
      res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
      res.end();
    });

  } catch (error) {
    res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
    res.end();
  }
});

module.exports = router;
