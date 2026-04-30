require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/modules',    require('./routes/modules'));
app.use('/api/employees',  require('./routes/employees'));
app.use('/api/kpi',        require('./routes/kpi'));
app.use('/api/venduto',    require('./routes/venduto'));
app.use('/api/chiusure',   require('./routes/chiusure'));
app.use('/api/chat',       require('./routes/chat'));
app.use('/api/data',       require('./routes/data'));
app.use('/api/fornitori',  require('./routes/fornitori'));
app.use('/api/analytics',  require('./routes/analytics'));
app.use('/api/buste-paga', require('./routes/buste-paga'));
app.use('/api/statistiche', require('./routes/statistiche'));
app.use('/api/turni',      require('./routes/turni'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

app.listen(PORT, async () => {
  console.log(`\n🚀 CRM 140 Grammi — Server avviato su http://localhost:${PORT}`);
  console.log(`📂 CRM_DATA_PATH: ${process.env.CRM_DATA_PATH || '(non impostato)'}`);
  console.log(`🤖 Claude AI: ${process.env.ANTHROPIC_API_KEY ? '✅ API Key configurata' : '⚠️  API Key mancante (.env)'}\n`);

  // Sync automatico CSV → DB all'avvio (chiusure + venduto + dipendenti)
  try {
    console.log('📂 Sync automatico dati CSV in corso...');
    const http = require('http');
    const req = http.request({ hostname: 'localhost', port: PORT, path: '/api/data/sync', method: 'POST',
      headers: { 'Content-Type': 'application/json' } }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        try {
          const r = JSON.parse(body);
          if (r.success) {
            console.log(`✅ Sync completato — ${r.newEmployees || 0} nuovi dipendenti rilevati`);
            r.results?.forEach(x => {
              if (x.skipped) console.log(`   ⚠️  ${x.reason}`);
              else if (x.synced !== undefined) console.log(`   ✅ Chiusure ${x.location}: ${x.synced} righe`);
              else console.log(`   ✅ Venduto ${x.location}: ${x.vendutoCount} voci, ${x.variantiCount} varianti`);
            });
          }
        } catch(_) {}
        console.log('');
      });
    });
    req.on('error', () => {}); // silenzioso se sync fallisce
    req.end();
  } catch(_) {}
});
