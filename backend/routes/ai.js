/**
 * ai.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Proactive AI engine for the Power BI-grade Dashboard Builder (Node-native).
 *
 * OPEN router (no auth) mounted at /api/ai. Every endpoint degrades gracefully
 * with NO Groq key: profiling and anomaly detection are pure statistics, and
 * chart/dashboard generation falls back to the rule-based SQL generator.
 *
 *   POST /api/ai/profile-schema     { database_id }              → per-column profiles
 *   POST /api/ai/suggest-charts     { database_id }              → ranked chart specs
 *   POST /api/ai/explain-data       { columns, rows }            → anomalies + narrative
 *
 * NL-to-visual reuses POST /api/queries/ask (no new endpoint here).
 * ─────────────────────────────────────────────────────────────────────────────
 */

const express = require('express');
const router = express.Router();
const owns = require('../ownership');

const aiEngine = require('./ai-engine');
const queriesRouter = require('./queries');

// ── Design-surface constants (mirror frontend types.ts) ───────────────────────
const PALETTE = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899'];

// ── Simple in-memory profile cache (5 min TTL) ────────────────────────────────
const _profileCache = new Map(); // database_id -> { at, data }
const PROFILE_TTL = 5 * 60 * 1000;

function resolveKey(apiKey) {
  return apiKey && apiKey.trim() && !apiKey.startsWith('YOUR_') ? apiKey.trim() : process.env.GROQ_API_KEY;
}

function getSchemaMeta(dbId, db) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT table_name, column_name, data_type, nullable, primary_key, foreign_key, foreign_to_table, foreign_to_column
       FROM schema_metadata WHERE database_id = ? ORDER BY table_name, id`,
      [dbId],
      (err, rows) => (err ? reject(err) : resolve(rows || []))
    );
  });
}

// ── Semantic-type inference ───────────────────────────────────────────────────

function inferSemanticType(col, values, numericValues) {
  const name = (col.column_name || '').toLowerCase();
  const dtype = (col.data_type || '').toLowerCase();

  if (col.primary_key === 1) return 'id';
  if (col.foreign_key === 1) return 'id';
  if (name === 'id' || /_id$/.test(name)) return 'id';

  const temporalName = /(date|time|timestamp|year|month|day|_at$|_on$)/.test(name);
  const temporalType = /(date|time)/.test(dtype);
  const looksIsoDate =
    values.length > 0 &&
    values.slice(0, 12).every((v) => typeof v === 'string' && /^\d{4}-\d{2}(-\d{2})?/.test(v));
  if (temporalName || temporalType || looksIsoDate) return 'temporal';

  const isNumericType = /(int|real|float|double|decimal|numeric|money)/.test(dtype);
  const looksNumeric = numericValues.length > 0 && numericValues.length >= values.length * 0.8;
  if (isNumericType || looksNumeric) return 'numeric';

  const distinct = new Set(values.map((v) => String(v)));
  if (distinct.size > 0 && distinct.size <= 50) return 'categorical';
  return 'text';
}

async function profileDatabase(dbId, db) {
  const cached = _profileCache.get(String(dbId));
  if (cached && Date.now() - cached.at < PROFILE_TTL) return cached.data;

  const meta = await getSchemaMeta(dbId, db);
  const byTable = {};
  meta.forEach((r) => {
    if (!byTable[r.table_name]) byTable[r.table_name] = [];
    byTable[r.table_name].push(r);
  });

  const tables = [];
  for (const [tableName, cols] of Object.entries(byTable)) {
    let sample = [];
    try {
      const { rows } = await queriesRouter.executeQuery(dbId, `SELECT * FROM "${tableName}" LIMIT 200`, db);
      sample = rows || [];
    } catch (e) {
      // empty / unreadable table — profile from schema only
    }

    const columns = cols.map((col) => {
      const name = col.column_name;
      const values = sample.map((r) => r[name]).filter((v) => v !== null && v !== undefined);
      const numericValues = values.filter((v) => typeof v === 'number' && !isNaN(v));
      const distinct = new Set(values.map((v) => String(v)));
      const semanticType = inferSemanticType(col, values, numericValues);
      let min = null;
      let max = null;
      if (numericValues.length) {
        min = Math.min(...numericValues);
        max = Math.max(...numericValues);
      }
      return {
        column: name,
        dataType: col.data_type,
        semanticType,
        cardinality: distinct.size,
        nullable: col.nullable === 1,
        isPrimary: col.primary_key === 1,
        isForeign: col.foreign_key === 1,
        foreignTable: col.foreign_to_table || null,
        foreignColumn: col.foreign_to_column || null,
        min,
        max,
        sampleValues: Array.from(distinct).slice(0, 8),
      };
    });

    tables.push({ table: tableName, sampledRows: sample.length, columns });
  }

  const data = { database_id: Number(dbId), tables };
  _profileCache.set(String(dbId), { at: Date.now(), data });
  return data;
}

// ── POST /profile-schema ──────────────────────────────────────────────────────
router.post('/profile-schema', owns('database', r => r.body.database_id), async (req, res) => {
  const { database_id } = req.body;
  const db = req.app.get('db');
  if (!database_id) return res.status(400).json({ error: 'database_id is required.' });
  try {
    const data = await profileDatabase(database_id, db);
    if (!data.tables.length) {
      return res.status(404).json({ error: 'No schema metadata found. Sync the database schema first.' });
    }
    res.json(data);
  } catch (err) {
    console.error('[AI/profile-schema] failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Chart-spec suggestion (heuristic-first) ───────────────────────────────────

function q(id) {
  return `"${String(id).replace(/"/g, '')}"`;
}

function buildSuggestionsFromProfile(profile,dbType) {
  const specs = [];

  profile.tables.forEach((t) => {
    const cols = t.columns;
    const metrics = cols.filter(
      (c) => c.semanticType === 'numeric' && !c.isPrimary && !c.isForeign
    );
    const temporal = cols.find((c) => c.semanticType === 'temporal');
    const categoricals = cols
      .filter((c) => c.semanticType === 'categorical')
      .sort((a, b) => a.cardinality - b.cardinality);

    if (!metrics.length) return;
    const metric = metrics[0];

    // 1. Temporal trend (line)
    if (temporal) {
      specs.push({
        title: `${metric.column} over time`,
        reason: `${t.table} has a time column (${temporal.column}) and a metric (${metric.column}) — a trend line reveals momentum.`,
        chartType: 'line',
        sql: `SELECT ${require('../remote-source').period(dbType,q(temporal.column),true)} AS period, SUM(${q(metric.column)}) AS ${q('total_' + metric.column)}
FROM ${q(t.table)}
GROUP BY period ORDER BY period ASC`,
        fields: { xAxis: 'period', values: [{ field: 'total_' + metric.column, agg: 'SUM' }] },
        score: 95,
      });
    }

    // 2. Low-cardinality category breakdown (donut)
    const lowCard = categoricals.find((c) => c.cardinality > 1 && c.cardinality <= 8);
    if (lowCard) {
      specs.push({
        title: `${metric.column} by ${lowCard.column}`,
        reason: `${lowCard.column} has few distinct values — a donut shows each slice's share of ${metric.column}.`,
        chartType: 'donut',
        sql: `SELECT ${q(lowCard.column)} AS ${q(lowCard.column)}, SUM(${q(metric.column)}) AS ${q('total_' + metric.column)}
FROM ${q(t.table)}
GROUP BY ${q(lowCard.column)} ORDER BY 2 DESC LIMIT 8`,
        fields: { xAxis: lowCard.column, values: [{ field: 'total_' + metric.column, agg: 'SUM' }] },
        score: 80,
      });
    }

    // 3. Higher-cardinality category → Top-N bar
    const midCard = categoricals.find((c) => c.cardinality > 8);
    if (midCard) {
      specs.push({
        title: `Top 10 ${midCard.column} by ${metric.column}`,
        reason: `${midCard.column} has many values — a ranked bar chart surfaces the top contributors to ${metric.column}.`,
        chartType: 'bar',
        sql: `SELECT ${q(midCard.column)} AS ${q(midCard.column)}, SUM(${q(metric.column)}) AS ${q('total_' + metric.column)}
FROM ${q(t.table)}
GROUP BY ${q(midCard.column)} ORDER BY 2 DESC LIMIT 10`,
        fields: { xAxis: midCard.column, values: [{ field: 'total_' + metric.column, agg: 'SUM' }] },
        score: 78,
      });
    }

    // 4. Two metrics → scatter (correlation)
    if (metrics.length >= 2) {
      specs.push({
        title: `${metrics[0].column} vs ${metrics[1].column}`,
        reason: `${t.table} has two independent metrics — a scatter plot exposes correlation and outliers.`,
        chartType: 'scatter',
        sql: `SELECT ${q(metrics[0].column)} AS ${q(metrics[0].column)}, ${q(metrics[1].column)} AS ${q(metrics[1].column)}
FROM ${q(t.table)} LIMIT 200`,
        fields: { xAxis: metrics[0].column, values: [{ field: metrics[1].column, agg: 'NONE' }] },
        score: 65,
      });
    }

    // 5. KPI card for the headline metric
    specs.push({
      title: `Total ${metric.column}`,
      reason: `A KPI card keeps the headline ${metric.column} for ${t.table} always in view.`,
      chartType: 'kpi',
      sql: `SELECT SUM(${q(metric.column)}) AS ${q('total_' + metric.column)} FROM ${q(t.table)}`,
      fields: { values: [{ field: 'total_' + metric.column, agg: 'SUM' }] },
      score: 60,
    });
  });

  return specs.sort((a, b) => b.score - a.score);
}

// ── POST /suggest-charts ──────────────────────────────────────────────────────
router.post('/suggest-charts', owns('database', r => r.body.database_id), async (req, res) => {
  const { database_id, api_key } = req.body;
  const db = req.app.get('db');
  if (!database_id) return res.status(400).json({ error: 'database_id is required.' });

  try {
    const profile = await profileDatabase(database_id, db);
    if (!profile.tables.length) {
      return res.status(404).json({ error: 'No schema metadata found. Sync the database schema first.' });
    }

    const connection = await queriesRouter.getDbConnectionParams(database_id,db);
    let suggestions = buildSuggestionsFromProfile(profile,connection.db_type).slice(0, 12);

    // Optional LLM enrichment of the human-readable reasons (never fatal).
    const groq = aiEngine.getGroqClient(resolveKey(api_key));
    if (groq && suggestions.length) {
      try {
        const brief = suggestions
          .map((s, i) => `${i + 1}. ${s.title} [${s.chartType}]`)
          .join('\n');
        const prompt = `You are a BI advisor. For each proposed chart, write ONE punchy sentence (max 18 words) explaining why it is worth pinning to a dashboard. Respond as a JSON array of strings in the same order, nothing else.\n\n${brief}`;
        const resp = await groq.chat.completions.create({
          model: process.env.GROQ_FAST_MODEL || 'openai/gpt-oss-20b',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.4,
          max_tokens: 512,
        });
        const raw = resp.choices[0]?.message?.content?.trim() || '';
        const match = raw.match(/\[[\s\S]*\]/);
        if (match) {
          const reasons = JSON.parse(match[0]);
          if (Array.isArray(reasons)) {
            suggestions = suggestions.map((s, i) =>
              typeof reasons[i] === 'string' && reasons[i].length > 8 ? { ...s, reason: reasons[i] } : s
            );
          }
        }
      } catch (e) {
        console.warn('[AI/suggest-charts] LLM enrichment skipped:', e.message);
      }
    }

    res.json({ database_id: Number(database_id), suggestions, ai_powered: !!groq });
  } catch (err) {
    console.error('[AI/suggest-charts] failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Statistical anomaly detection (pure Node) ─────────────────────────────────

function mean(a) {
  return a.reduce((x, y) => x + y, 0) / a.length;
}
function stddev(a, m) {
  if (a.length < 2) return 0;
  const v = a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1);
  return Math.sqrt(v);
}
function quantile(sorted, p) {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
function fmt(n) {
  if (typeof n !== 'number' || !isFinite(n)) return String(n);
  return Math.abs(n) >= 1000 ? Number(n.toFixed(0)).toLocaleString() : Number(n.toFixed(2)).toLocaleString();
}

function detectAnomalies(columns, rows) {
  const anomalies = [];
  if (!rows || !rows.length) return anomalies;

  const numericCols = columns.filter((c) => rows.some((r) => typeof r[c] === 'number'));
  const categoricalCols = columns.filter(
    (c) => !numericCols.includes(c) && typeof rows[0][c] === 'string'
  );
  const temporalCol = columns.find((c) => /date|month|period|year|time/i.test(c));

  // Per-numeric-column: z-score + IQR outliers.
  numericCols.forEach((col) => {
    const vals = rows.map((r) => r[col]).filter((v) => typeof v === 'number' && isFinite(v));
    if (vals.length < 4) return;
    const m = mean(vals);
    const sd = stddev(vals, m);
    if (sd > 0) {
      rows.forEach((r) => {
        const v = r[col];
        if (typeof v !== 'number') return;
        const z = (v - m) / sd;
        if (Math.abs(z) > 3) {
          anomalies.push({
            severity: Math.abs(z) > 4 ? 'high' : 'medium',
            metric: col,
            message: `${col} value ${fmt(v)} is a statistical outlier (${z > 0 ? '+' : ''}${z.toFixed(1)}σ from the mean ${fmt(m)}).`,
          });
        }
      });
    }
    // IQR
    const sorted = [...vals].sort((a, b) => a - b);
    const q1 = quantile(sorted, 0.25);
    const q3 = quantile(sorted, 0.75);
    const iqr = q3 - q1;
    if (iqr > 0) {
      const lo = q1 - 1.5 * iqr;
      const hi = q3 + 1.5 * iqr;
      const outliers = vals.filter((v) => v < lo || v > hi);
      if (outliers.length && outliers.length <= Math.max(2, vals.length * 0.1)) {
        anomalies.push({
          severity: 'low',
          metric: col,
          message: `${col} has ${outliers.length} value(s) outside the expected IQR range [${fmt(lo)}, ${fmt(hi)}].`,
        });
      }
    }
  });

  // Temporal series: period-over-period delta + trend-break vs rolling mean.
  if (temporalCol && numericCols.length) {
    const metric = numericCols.find((c) => c !== temporalCol) || numericCols[0];
    const series = rows
      .map((r) => ({ t: r[temporalCol], v: r[metric] }))
      .filter((p) => typeof p.v === 'number')
      .sort((a, b) => String(a.t).localeCompare(String(b.t)));
    for (let i = 1; i < series.length; i++) {
      const prev = series[i - 1].v;
      const cur = series[i].v;
      if (prev !== 0) {
        const pct = ((cur - prev) / Math.abs(prev)) * 100;
        if (Math.abs(pct) >= 40) {
          anomalies.push({
            severity: Math.abs(pct) >= 80 ? 'high' : 'medium',
            metric,
            message: `${metric} ${pct > 0 ? 'jumped' : 'dropped'} ${Math.abs(pct).toFixed(0)}% from ${series[i - 1].t} to ${series[i].t} (${fmt(prev)} → ${fmt(cur)}).`,
          });
        }
      }
    }
  }

  // Category dominance: any single category > 50% of a metric's total.
  if (categoricalCols.length && numericCols.length) {
    const cat = categoricalCols[0];
    const metric = numericCols[0];
    const totals = {};
    let grand = 0;
    rows.forEach((r) => {
      const k = r[cat];
      const v = typeof r[metric] === 'number' ? r[metric] : 0;
      totals[k] = (totals[k] || 0) + v;
      grand += v;
    });
    if (grand > 0) {
      Object.entries(totals).forEach(([k, v]) => {
        const share = (v / grand) * 100;
        if (share > 50) {
          anomalies.push({
            severity: 'medium',
            metric,
            message: `"${k}" accounts for ${share.toFixed(0)}% of total ${metric} — a heavy concentration risk.`,
          });
        }
      });
    }
  }

  // Rank by severity, cap the list.
  const order = { high: 0, medium: 1, low: 2 };
  return anomalies.sort((a, b) => order[a.severity] - order[b.severity]).slice(0, 12);
}

// ── POST /explain-data ────────────────────────────────────────────────────────
router.post('/explain-data', async (req, res) => {
  const { columns, rows, question, api_key } = req.body;
  if (!Array.isArray(columns) || !Array.isArray(rows)) {
    return res.status(400).json({ error: 'columns[] and rows[] are required.' });
  }

  try {
    const anomalies = detectAnomalies(columns, rows);

    // Narrative: LLM when a key is present, else a templated summary.
    let narrative;
    const groq = aiEngine.getGroqClient(resolveKey(api_key));
    if (groq && rows.length) {
      const insights = await aiEngine.generateInsights(
        question || 'Explain this dataset',
        columns,
        rows,
        resolveKey(api_key)
      );
      narrative = Array.isArray(insights) ? insights.join('\n') : String(insights);
    } else {
      const lead = `**${rows.length} rows** across **${columns.length} columns**.`;
      const anomalyText = anomalies.length
        ? anomalies.slice(0, 4).map((a) => `- ${a.message}`).join('\n')
        : '- No statistical anomalies detected — the data looks stable.';
      narrative = `${lead}\n\n${anomalyText}`;
    }

    res.json({ anomalies, narrative, ai_powered: !!groq });
  } catch (err) {
    console.error('[AI/explain-data] failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
