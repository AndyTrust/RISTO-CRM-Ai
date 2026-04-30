/**
 * analytics.js — CRM 140 Grammi
 * Business Intelligence engine: stagionalità, previsioni, target smart
 *
 * Metodologia:
 *  • Quantum stimato = coperti_operatore × coperto_medio_locale_mese  (proxy per venduto/coperti)
 *  • Target +10% calcolato sulla media ultimi 2 mesi completi
 *  • Corretto per stagionalità tramite indice YoY dalle chiusure 2025
 *  • Forecast 3 mesi: regressione lineare + fattore stagionale
 */

const express = require('express');
const router = express.Router();
const db = require('../database');

// ── Helper: regressione lineare semplice ────────────────────────────────────
function linearRegression(points) {
  const n = points.length;
  if (n < 2) return { slope: 0, intercept: points[0]?.y || 0, r2: 0 };
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const sumXY = points.reduce((s, p) => s + p.x * p.y, 0);
  const sumX2 = points.reduce((s, p) => s + p.x * p.x, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  const yMean = sumY / n;
  const ssTot = points.reduce((s, p) => s + (p.y - yMean) ** 2, 0);
  const ssRes = points.reduce((s, p) => s + (p.y - (slope * p.x + intercept)) ** 2, 0);
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  return { slope, intercept, r2 };
}

// ── Helper: genera lista mesi tra due date ──────────────────────────────────
function monthsBetween(from, to) {
  const months = [];
  const d = new Date(from + '-01');
  const end = new Date(to + '-01');
  while (d <= end) {
    months.push(d.toISOString().slice(0, 7));
    d.setMonth(d.getMonth() + 1);
  }
  return months;
}

// ── GET /analytics/overview ─────────────────────────────────────────────────
// Panoramica mensile MA + PN con confronto YoY
router.get('/overview', (req, res) => {
  try {
    const monthly = db.prepare(`
      SELECT strftime('%Y-%m', data) as mese,
             location,
             SUM(totale_venduto_ipratico) as tot_venduto,
             SUM(coperti) as tot_coperti,
             AVG(coperto_medio) as avg_coperto_medio,
             AVG(scontrino_medio) as avg_scontrino_medio,
             COUNT(*) as giorni_apertura
      FROM chiusure_data
      GROUP BY mese, location
      ORDER BY mese ASC, location
    `).all();

    // Totale bilocale per mese
    const totByMese = {};
    monthly.forEach(r => {
      if (!totByMese[r.mese]) totByMese[r.mese] = { mese: r.mese, tot_venduto: 0, tot_coperti: 0, giorni: 0 };
      totByMese[r.mese].tot_venduto += r.tot_venduto;
      totByMese[r.mese].tot_coperti += r.tot_coperti;
    });

    // YoY: confronta 2026 con 2025
    const yoy = [];
    const mesi2026 = Object.keys(totByMese).filter(m => m.startsWith('2026')).sort();
    mesi2026.forEach(m26 => {
      const m25 = '2025-' + m26.slice(5);
      const d26 = totByMese[m26];
      const d25 = totByMese[m25];
      if (d25 && d26) {
        yoy.push({
          mese: m26,
          mese_label: new Date(m26 + '-15').toLocaleDateString('it-IT', { month: 'short', year: '2-digit' }),
          venduto_2026: Math.round(d26.tot_venduto),
          venduto_2025: Math.round(d25.tot_venduto),
          coperti_2026: d26.tot_coperti,
          coperti_2025: d25.tot_coperti,
          delta_venduto_pct: d25.tot_venduto > 0
            ? Math.round(((d26.tot_venduto - d25.tot_venduto) / d25.tot_venduto) * 1000) / 10
            : null,
          delta_coperti_pct: d25.tot_coperti > 0
            ? Math.round(((d26.tot_coperti - d25.tot_coperti) / d25.tot_coperti) * 1000) / 10
            : null,
        });
      }
    });

    // KPI sintetici ultimi 2 mesi (gen+feb 2026) vs anno fa
    const kpiBox = {};
    ['MAMELI', 'PREDDA_NIEDDA'].forEach(loc => {
      const loc2m = monthly.filter(r => r.location === loc && ['2026-01','2026-02'].includes(r.mese));
      const loc2m25 = monthly.filter(r => r.location === loc && ['2025-01','2025-02'].includes(r.mese));
      kpiBox[loc] = {
        venduto_2m_2026: Math.round(loc2m.reduce((s, r) => s + r.tot_venduto, 0)),
        venduto_2m_2025: Math.round(loc2m25.reduce((s, r) => s + r.tot_venduto, 0)),
        coperti_2m_2026: loc2m.reduce((s, r) => s + r.tot_coperti, 0),
        coperti_2m_2025: loc2m25.reduce((s, r) => s + r.tot_coperti, 0),
        cm_avg_2026: loc2m.length > 0 ? Math.round(loc2m.reduce((s, r) => s + r.avg_coperto_medio, 0) / loc2m.length * 100) / 100 : 0,
        cm_avg_2025: loc2m25.length > 0 ? Math.round(loc2m25.reduce((s, r) => s + r.avg_coperto_medio, 0) / loc2m25.length * 100) / 100 : 0,
      };
    });

    res.json({ monthly, yoy, kpiBox, totByMese: Object.values(totByMese).sort((a, b) => a.mese.localeCompare(b.mese)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /analytics/seasonality ──────────────────────────────────────────────
// Indici stagionali basati sui dati 2025 (anno completo)
router.get('/seasonality', (req, res) => {
  try {
    const monthly = db.prepare(`
      SELECT strftime('%Y-%m', data) as mese,
             strftime('%m', data) as mese_num,
             location,
             SUM(totale_venduto_ipratico) as tot_venduto,
             SUM(coperti) as tot_coperti,
             AVG(coperto_medio) as avg_cm,
             COUNT(*) as giorni
      FROM chiusure_data
      WHERE strftime('%Y', data) = '2025'
      GROUP BY mese, location
      ORDER BY mese
    `).all();

    const byLoc = {};
    ['MAMELI', 'PREDDA_NIEDDA'].forEach(loc => {
      const rows = monthly.filter(r => r.location === loc);
      if (rows.length === 0) { byLoc[loc] = []; return; }

      const avgVenduto = rows.reduce((s, r) => s + r.tot_venduto, 0) / rows.length;
      const avgCoperti = rows.reduce((s, r) => s + r.tot_coperti, 0) / rows.length;
      const avgCM = rows.reduce((s, r) => s + r.avg_cm, 0) / rows.length;

      byLoc[loc] = rows.map(r => ({
        mese: r.mese,
        mese_num: parseInt(r.mese_num),
        mese_label: new Date(r.mese + '-15').toLocaleDateString('it-IT', { month: 'long' }),
        tot_venduto: Math.round(r.tot_venduto),
        tot_coperti: r.tot_coperti,
        avg_cm: Math.round(r.avg_cm * 100) / 100,
        giorni: r.giorni,
        indice_venduto: Math.round((r.tot_venduto / avgVenduto) * 100) / 100,
        indice_coperti: Math.round((r.tot_coperti / avgCoperti) * 100) / 100,
        indice_cm: Math.round((r.avg_cm / avgCM) * 100) / 100,
      }));
    });

    // Media bilocale per mese
    const nomi_mesi = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                       'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
    const combined = nomi_mesi.map((nome, idx) => {
      const mn = String(idx + 1).padStart(2, '0');
      const ma = (byLoc['MAMELI'] || []).find(r => r.mese_num === idx + 1);
      const pn = (byLoc['PREDDA_NIEDDA'] || []).find(r => r.mese_num === idx + 1);
      return {
        mese_num: idx + 1,
        mese_label: nome,
        indice_venduto_ma: ma?.indice_venduto ?? null,
        indice_venduto_pn: pn?.indice_venduto ?? null,
        indice_combined: (ma && pn)
          ? Math.round(((ma.indice_venduto + pn.indice_venduto) / 2) * 100) / 100
          : (ma?.indice_venduto ?? pn?.indice_venduto ?? null),
        venduto_ma: ma?.tot_venduto ?? null,
        venduto_pn: pn?.tot_venduto ?? null,
        cm_ma: ma?.avg_cm ?? null,
        cm_pn: pn?.avg_cm ?? null,
      };
    });

    res.json({ byLocation: byLoc, combined });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /analytics/forecast ─────────────────────────────────────────────────
// Previsioni prossimi 3 mesi con regressione + stagionalità
router.get('/forecast', (req, res) => {
  try {
    const result = {};

    ['MAMELI', 'PREDDA_NIEDDA'].forEach(loc => {
      // Dati mensili storici
      const monthly = db.prepare(`
        SELECT strftime('%Y-%m', data) as mese,
               SUM(totale_venduto_ipratico) as tot_venduto,
               SUM(coperti) as tot_coperti,
               AVG(coperto_medio) as avg_cm,
               COUNT(*) as giorni
        FROM chiusure_data
        WHERE location = ?
        GROUP BY mese
        ORDER BY mese
      `).all(loc);

      if (monthly.length < 3) { result[loc] = []; return; }

      // Indici stagionali 2025
      const stagionale = {};
      const rows2025 = monthly.filter(r => r.mese.startsWith('2025'));
      if (rows2025.length >= 6) {
        const avg25 = rows2025.reduce((s, r) => s + r.tot_venduto, 0) / rows2025.length;
        rows2025.forEach(r => {
          stagionale[r.mese.slice(5)] = r.tot_venduto / avg25; // key: "01", "02"...
        });
      }

      // Regressione lineare sul venduto degli ultimi 12 mesi
      const last12 = monthly.slice(-12);
      const points = last12.map((r, i) => ({ x: i + 1, y: r.tot_venduto }));
      const reg = linearRegression(points);

      // Forecast 3 mesi
      const lastMese = monthly[monthly.length - 1].mese;
      const forecasts = [];
      for (let i = 1; i <= 3; i++) {
        const d = new Date(lastMese + '-01');
        d.setMonth(d.getMonth() + i);
        const meseStr = d.toISOString().slice(0, 7);
        const meseNum = String(d.getMonth() + 1).padStart(2, '0');
        const xVal = last12.length + i;
        const trend = reg.slope * xVal + reg.intercept;

        // Applica coefficiente stagionale (se disponibile)
        const coeff = stagionale[meseNum] || 1.0;
        const avgTrend = last12.reduce((s, r) => s + r.tot_venduto, 0) / last12.length;
        // Forecast = media_ultimi12 × coeff_stagionale × (1 + slope_normalizzata)
        const slopeNorm = avgTrend > 0 ? (reg.slope / avgTrend) : 0;
        const forecast = avgTrend * coeff * (1 + slopeNorm * i);

        // Confidence interval ±10% (semplificato)
        forecasts.push({
          mese: meseStr,
          mese_label: d.toLocaleDateString('it-IT', { month: 'short', year: '2-digit' }),
          forecast_venduto: Math.round(Math.max(forecast, 0)),
          forecast_min: Math.round(Math.max(forecast * 0.90, 0)),
          forecast_max: Math.round(forecast * 1.10),
          coeff_stagionale: Math.round(coeff * 100) / 100,
          tendenza: reg.slope > 0 ? 'crescita' : 'calo',
          r2: Math.round(reg.r2 * 100) / 100,
          // Coperti stimati basati su CM attuale
          forecast_coperti: Math.round(forecast / (monthly[monthly.length - 1].avg_cm || 25)),
        });
      }

      result[loc] = {
        storico: monthly.slice(-6).map(r => ({
          mese: r.mese,
          mese_label: new Date(r.mese + '-15').toLocaleDateString('it-IT', { month: 'short', year: '2-digit' }),
          tot_venduto: Math.round(r.tot_venduto),
          tot_coperti: r.tot_coperti,
          avg_cm: Math.round(r.avg_cm * 100) / 100,
          giorni: r.giorni,
        })),
        forecasts,
        regressione: { slope: Math.round(reg.slope), intercept: Math.round(reg.intercept), r2: Math.round(reg.r2 * 100) / 100 },
      };
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /analytics/operator-targets ─────────────────────────────────────────
// Calcola target smart per ogni operatore basati su:
// - Media coperti ultimi 2 mesi
// - Coperto medio locale (proxy venduto)
// - +10% crescita (aggiustato per stagionalità)
router.get('/operator-targets', (req, res) => {
  try {
    const { location } = req.query;

    // Operatori con coperti per mese (da venduto_data)
    // Usiamo 'Costo servizio' come proxy per coperti
    const locs = location ? [location] : ['MAMELI', 'PREDDA_NIEDDA'];
    const risultati = [];

    locs.forEach(loc => {
      // Coperto medio mensile dal locale (da chiusure)
      const cmMensile = db.prepare(`
        SELECT strftime('%Y-%m', data) as mese,
               AVG(coperto_medio) as avg_cm,
               SUM(coperti) as tot_coperti,
               COUNT(*) as giorni
        FROM chiusure_data
        WHERE location = ?
        GROUP BY mese
        ORDER BY mese
      `).all(loc);

      const cmByMese = {};
      cmMensile.forEach(r => { cmByMese[r.mese] = r; });

      // Coperti per operatore (aggrego per mese ISO dal campo data_inizio)
      // data_inizio può essere "01/01/2026" o "2026-01-01" - standardizziamo
      const copertiOp = db.prepare(`
        SELECT operatore,
               CASE
                 WHEN data_inizio LIKE '____-__-__' THEN substr(data_inizio, 1, 7)
                 WHEN data_inizio LIKE '__/__/____' THEN substr(data_inizio, 7, 4) || '-' || substr(data_inizio, 4, 2)
                 ELSE data_inizio
               END as mese,
               SUM(quantita) as coperti
        FROM venduto_data
        WHERE location = ? AND categoria = 'Costo servizio'
        GROUP BY operatore, mese
        ORDER BY operatore, mese
      `).all(loc);

      // Up-sell per operatore per mese
      const upsellOp = db.prepare(`
        SELECT operatore,
               CASE
                 WHEN data_inizio LIKE '____-__-__' THEN substr(data_inizio, 1, 7)
                 WHEN data_inizio LIKE '__/__/____' THEN substr(data_inizio, 7, 4) || '-' || substr(data_inizio, 4, 2)
                 ELSE data_inizio
               END as mese,
               SUM(aggiunta_qty) as tot_aggiunte,
               SUM(aggiunta_importo) as tot_importo_upsell
        FROM varianti_data
        WHERE location = ?
        GROUP BY operatore, mese
        ORDER BY operatore, mese
      `).all(loc);

      const upsellMap = {};
      upsellOp.forEach(u => {
        const key = u.operatore + '|' + u.mese;
        upsellMap[key] = { tot_aggiunte: u.tot_aggiunte, tot_importo_upsell: u.tot_importo_upsell };
      });

      // Raggruppa per operatore
      const byOp = {};
      const skipOps = new Set(['PIENISSIMO', 'TECNICO', 'EXTRA', 'ANDREA SALA']);
      copertiOp.forEach(r => {
        const opUp = r.operatore.toUpperCase();
        if (skipOps.has(opUp)) return;
        if (!byOp[r.operatore]) byOp[r.operatore] = { operatore: r.operatore, location: loc, mesi: {} };
        const cm = cmByMese[r.mese]?.avg_cm || 0;
        const us = upsellMap[r.operatore + '|' + r.mese] || { tot_aggiunte: 0, tot_importo_upsell: 0 };
        byOp[r.operatore].mesi[r.mese] = {
          coperti: r.coperti,
          cm_locale: Math.round(cm * 100) / 100,
          venduto_stimato: Math.round(r.coperti * cm),
          upsell_aggiunte: us.tot_aggiunte,
          upsell_importo: us.tot_importo_upsell,
          quantum_stimato: Math.round(cm * 100) / 100, // proxy: CM del locale
        };
      });

      // Calcola target smart per ogni operatore
      Object.values(byOp).forEach(op => {
        const mesiOrdinati = Object.keys(op.mesi).sort();

        // Ultimi 2 mesi completi (escludiamo il mese parziale corrente se necessario)
        const ultimi2 = mesiOrdinati.slice(-2);
        const media2m_coperti = ultimi2.length > 0
          ? Math.round(ultimi2.reduce((s, m) => s + (op.mesi[m].coperti || 0), 0) / ultimi2.length)
          : 0;
        const media2m_venduto = ultimi2.length > 0
          ? Math.round(ultimi2.reduce((s, m) => s + (op.mesi[m].venduto_stimato || 0), 0) / ultimi2.length)
          : 0;
        const media2m_cm = ultimi2.length > 0
          ? Math.round(ultimi2.reduce((s, m) => s + (op.mesi[m].cm_locale || 0), 0) / ultimi2.length * 100) / 100
          : 0;

        // Indice stagionale del mese prossimo (basato su 2025)
        const oggi = new Date();
        const meseProssimo = new Date(oggi);
        meseProssimo.setMonth(meseProssimo.getMonth() + 1);
        const mpStr = meseProssimo.toISOString().slice(0, 7);
        const mpNum = String(meseProssimo.getMonth() + 1).padStart(2, '0');

        // Cerca mese equivalente 2025 nelle chiusure
        const mese2025 = `2025-${mpNum}`;
        const chiusure2025 = cmByMese[mese2025];
        const chiusure2025Precedente = cmByMese[`2025-${String(oggi.getMonth() + 1).padStart(2, '0')}`];

        // Indice stagionale = CM_stesso_mese_2025 / CM_media_2025
        const cm2025vals = Object.entries(cmByMese)
          .filter(([m]) => m.startsWith('2025'))
          .map(([, v]) => v.avg_cm);
        const media_cm_2025 = cm2025vals.length > 0 ? cm2025vals.reduce((s, v) => s + v, 0) / cm2025vals.length : media2m_cm;
        const coeff_stagionale = chiusure2025 && media_cm_2025 > 0
          ? chiusure2025.avg_cm / media_cm_2025
          : 1.0;

        // Growth target: +10% aggiustato per stagionalità
        const base_crescita = 1.10;
        const target_fattore = base_crescita * coeff_stagionale;

        // Target coperti mensile
        const coperti_target = Math.round(media2m_coperti * target_fattore);
        const venduto_target = Math.round(media2m_venduto * target_fattore);

        // Quantum target (CM locale del mese prossimo stimato)
        const cm_target = chiusure2025
          ? Math.round(chiusure2025.avg_cm * base_crescita * 100) / 100
          : Math.round(media2m_cm * base_crescita * 100) / 100;

        // Calcola quota mercato (coperti op / tot coperti locale)
        const totCopertiLoc2m = ultimi2.reduce((s, m) => s + (cmByMese[m]?.tot_coperti || 0), 0);
        const quotaMercato = totCopertiLoc2m > 0
          ? Math.round((media2m_coperti * ultimi2.length / totCopertiLoc2m) * 10000) / 100
          : null;

        // Performance score (0-100) basato su quantum vs media locale
        const scoreQm = media2m_cm > 0 && media_cm_2025 > 0
          ? Math.min(100, Math.round((media2m_cm / media_cm_2025) * 50 + 50))
          : 50;

        // Up-sell rate: aggiunte / coperti
        const tot_upsell = Object.values(op.mesi).reduce((s, m) => s + m.upsell_aggiunte, 0);
        const tot_coperti_all = Object.values(op.mesi).reduce((s, m) => s + m.coperti, 0);
        const upsell_rate = tot_coperti_all > 0 ? Math.round((tot_upsell / tot_coperti_all) * 100) / 100 : 0;

        risultati.push({
          operatore: op.operatore,
          location: op.location,
          mesi: op.mesi,
          storico: {
            ultimi2_mesi: ultimi2,
            media2m_coperti,
            media2m_venduto,
            media2m_cm,
          },
          target: {
            periodo: mpStr,
            coperti_target,
            venduto_target,
            cm_target,
            growth_base_pct: 10,
            coeff_stagionale: Math.round(coeff_stagionale * 100) / 100,
            target_fattore_pct: Math.round((target_fattore - 1) * 100),
          },
          performance: {
            quota_mercato_pct: quotaMercato,
            upsell_rate,
            score: scoreQm,
            trend: mesiOrdinati.length >= 2
              ? (op.mesi[mesiOrdinati[mesiOrdinati.length - 1]].coperti >
                 op.mesi[mesiOrdinati[mesiOrdinati.length - 2]].coperti ? 'up' : 'down')
              : 'stable',
          },
        });
      });
    });

    // Ordina per location poi per coperti decrescenti
    risultati.sort((a, b) => {
      if (a.location !== b.location) return a.location.localeCompare(b.location);
      return b.storico.media2m_coperti - a.storico.media2m_coperti;
    });

    res.json(risultati);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /analytics/heatmap ──────────────────────────────────────────────────
// Mappa di calore venduto per giorno della settimana × ora (approssimata da giorno)
router.get('/heatmap', (req, res) => {
  try {
    const { location } = req.query;
    let where = '1=1';
    const params = [];
    if (location) { where += ' AND location = ?'; params.push(location); }

    const daily = db.prepare(`
      SELECT data, location, coperti, totale_venduto_ipratico, coperto_medio,
             strftime('%w', data) as dow,  -- 0=domenica, 6=sabato
             strftime('%m', data) as mese_num
      FROM chiusure_data
      WHERE ${where}
      ORDER BY data
    `).all(...params);

    // Aggregazione per giorno della settimana
    const dowNames = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
    const byDow = Array.from({ length: 7 }, (_, i) => ({
      dow: i,
      label: dowNames[i],
      count: 0, tot_coperti: 0, tot_venduto: 0, avg_cm: 0,
    }));

    daily.forEach(r => {
      const d = byDow[parseInt(r.dow)];
      d.count++;
      d.tot_coperti += r.coperti;
      d.tot_venduto += r.totale_venduto_ipratico;
      d.avg_cm += r.coperto_medio;
    });

    byDow.forEach(d => {
      if (d.count > 0) {
        d.avg_coperti = Math.round(d.tot_coperti / d.count);
        d.avg_venduto = Math.round(d.tot_venduto / d.count);
        d.avg_cm = Math.round((d.avg_cm / d.count) * 100) / 100;
      }
    });

    // Top 5 giorni migliori in assoluto
    const top5 = daily
      .sort((a, b) => b.totale_venduto_ipratico - a.totale_venduto_ipratico)
      .slice(0, 5)
      .map(r => ({
        data: r.data,
        location: r.location,
        venduto: Math.round(r.totale_venduto_ipratico),
        coperti: r.coperti,
        cm: Math.round(r.coperto_medio * 100) / 100,
      }));

    res.json({ byDow, top5, totalDays: daily.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /analytics/kpi-summary ──────────────────────────────────────────────
// Riepilogo KPI per riunione di coordinamento
router.get('/kpi-summary', (req, res) => {
  try {
    const { month } = req.query;
    const targetMonth = month || new Date().toISOString().slice(0, 7);
    const prevMonth = new Date(targetMonth + '-01');
    prevMonth.setMonth(prevMonth.getMonth() - 1);
    const prevMonthStr = prevMonth.toISOString().slice(0, 7);
    const samePrev = '2025-' + targetMonth.slice(5);

    const getMonth = (m, loc) => db.prepare(`
      SELECT SUM(totale_venduto_ipratico) as venduto,
             SUM(coperti) as coperti,
             AVG(coperto_medio) as cm,
             COUNT(*) as giorni
      FROM chiusure_data
      WHERE location = ? AND strftime('%Y-%m', data) = ?
    `).get(loc, m);

    const summary = {};
    ['MAMELI', 'PREDDA_NIEDDA'].forEach(loc => {
      const curr = getMonth(targetMonth, loc) || {};
      const prev = getMonth(prevMonthStr, loc) || {};
      const yoy  = getMonth(samePrev, loc) || {};

      summary[loc] = {
        corrente: {
          mese: targetMonth,
          venduto: Math.round(curr.venduto || 0),
          coperti: curr.coperti || 0,
          cm: Math.round((curr.cm || 0) * 100) / 100,
          giorni: curr.giorni || 0,
        },
        vs_mese_prec: prev.venduto ? {
          delta_venduto_pct: Math.round(((curr.venduto - prev.venduto) / prev.venduto) * 1000) / 10,
          delta_coperti_pct: Math.round(((curr.coperti - prev.coperti) / prev.coperti) * 1000) / 10,
          delta_cm: Math.round(((curr.cm || 0) - (prev.cm || 0)) * 100) / 100,
        } : null,
        vs_anno_fa: yoy.venduto ? {
          delta_venduto_pct: Math.round(((curr.venduto - yoy.venduto) / yoy.venduto) * 1000) / 10,
          delta_coperti_pct: Math.round(((curr.coperti - yoy.coperti) / yoy.coperti) * 1000) / 10,
          delta_cm: Math.round(((curr.cm || 0) - (yoy.cm || 0)) * 100) / 100,
        } : null,
      };
    });

    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
