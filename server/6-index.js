import express from 'express';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as seed from './seed.js';
import { createStore } from './store.js';
import { initEmbeddings } from './embeddings.js';
import { checkSubmission } from './pipeline.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '64kb' }));

const store = createStore(seed);
const MAX_TEXT = 20000;
const CHECKS_PER_SESSION_PER_HOUR = 30;
const rateLog = new Map(); // sid -> [timestamps]

// Demo session isolation: every visitor gets their own namespace so no one
// sees another visitor's submissions. Cookie only; no login, no real data.
app.use((req, res, next) => {
  const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]));
  if (!cookies.affiant_sid || !/^[a-f0-9]{32}$/.test(cookies.affiant_sid)) {
    cookies.affiant_sid = crypto.randomBytes(16).toString('hex');
    res.setHeader('Set-Cookie', `affiant_sid=${cookies.affiant_sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
  }
  req.sessionId = cookies.affiant_sid;
  next();
});

app.get('/api/demo', async (_req, res) => {
  res.json({
    company: seed.DEMO_COMPANY,
    contentTypes: seed.CONTENT_TYPES,
    samples: seed.SAMPLES,
    storage: store.kind,
    llm: process.env.GROQ_API_KEY ? 'groq' : 'mock',
    disclaimer: 'Demo mode: one-tap roles, seeded sample data only. No real authentication or company data. Your submissions are visible only in this browser and you can reset them anytime.',
  });
});

app.post('/api/demo/reset', async (req, res) => {
  await store.resetSession(req.sessionId);
  res.json({ ok: true });
});

app.get('/api/brandbase', async (_req, res) => {
  const clauses = (await store.getClauses()).map(({ _emb, checks, ...c }) => c);
  res.json({ clauses, terminology: await store.getTerminology() });
});

app.post('/api/submissions', async (req, res) => {
  const { type, text } = req.body || {};
  if (!type || !text || typeof text !== 'string' || text.trim().length < 10) {
    return res.status(400).json({ error: 'type and text (min 10 chars) are required' });
  }
  if (text.length > MAX_TEXT) return res.status(413).json({ error: `text is limited to ${MAX_TEXT} characters in the demo` });
  const now = Date.now();
  const log = (rateLog.get(req.sessionId) || []).filter((t) => now - t < 3600_000);
  if (log.length >= CHECKS_PER_SESSION_PER_HOUR) return res.status(429).json({ error: 'demo rate limit reached (30 checks/hour). Try again later or reset the demo.' });
  log.push(now);
  rateLog.set(req.sessionId, log);
  try {
    const out = await checkSubmission(store, { type, text: text.trim(), sessionId: req.sessionId });
    res.json(out);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'check failed: ' + e.message });
  }
});

app.get('/api/submissions', async (req, res) => res.json({ submissions: await store.listSubmissions(req.sessionId) }));

app.get('/api/submissions/:id', async (req, res) => {
  const s = await store.getSubmission(req.params.id, req.sessionId);
  if (!s) return res.status(404).json({ error: 'not found' });
  res.json(s);
});

app.post('/api/issues/:id/decision', async (req, res) => {
  const { action, reason, decidedBy } = req.body || {};
  if (!['accept', 'edit', 'dismiss'].includes(action)) return res.status(400).json({ error: 'action must be accept, edit or dismiss' });
  if (!reason || !String(reason).trim()) return res.status(400).json({ error: 'a reason is required for every decision' });
  const issue = await store.getIssue(req.params.id);
  if (!issue) return res.status(404).json({ error: 'issue not found' });
  const owner = await store.getSubmission(issue.submissionId, req.sessionId);
  if (!owner) return res.status(404).json({ error: 'issue not found' });
  const out = await store.decideIssue(req.params.id, { action, reason: String(reason).trim(), decidedBy: decidedBy || 'writer' });
  if (!out) return res.status(404).json({ error: 'issue not found' });
  await store.resolveIfNoOpenIssues(out.decision.submissionId);
  res.json(out);
});

app.post('/api/submissions/:id/review', async (req, res) => {
  const { action, comment, decidedBy } = req.body || {};
  if (!['approve', 'sendback'].includes(action)) return res.status(400).json({ error: 'action must be approve or sendback' });
  if (action === 'sendback' && (!comment || !String(comment).trim())) return res.status(400).json({ error: 'send-back needs a comment' });
  const sub = await store.getSubmission(req.params.id, req.sessionId);
  if (!sub) return res.status(404).json({ error: 'not found' });
  if (action === 'approve' && sub.issues.some((i) => i.status === 'open')) {
    return res.status(409).json({ error: 'cannot approve while issues are still open' });
  }
  const out = await store.reviewSubmission(req.params.id, { action, comment: comment ? String(comment).trim() : '', decidedBy: decidedBy || 'reviewer' });
  res.json(out);
});

app.get('/api/insights', async (req, res) => res.json(await store.insights(req.sessionId)));

// Serve the built frontend in production
const dist = path.join(__dirname, '..', 'web', 'dist');
app.use(express.static(dist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(dist, 'index.html'), (err) => { if (err) next(); });
});

const PORT = process.env.PORT || 4173;

async function main() {
  console.log('Loading local embedding model (first run downloads ~25 MB)...');
  await initEmbeddings();
  console.log('Embedding model ready.');
  await store.init();
  app.listen(PORT, () => console.log(`Affiant listening on http://localhost:${PORT} (store=${store.kind})`));
}

main().catch((e) => { console.error(e); process.exit(1); });
