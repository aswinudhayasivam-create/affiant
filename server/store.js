// Storage layer. Two drivers selected by DATABASE_URL:
//  - memory: in-process store for local development (data resets on restart).
//  - pg: Neon Postgres for the deployed demo (embeddings stored as float8[]).
import pg from 'pg';

function memoryStore(seed) {
  const state = {
    clauses: [...seed.GUIDELINES, ...seed.FACTS.map((f) => ({ ...f })), ],
    terminology: [...seed.TERMINOLOGY],
    submissions: [],
    issues: [],
    decisions: [],
    seq: 1,
  };
  return {
    kind: 'memory',
    async init() {},
    async getClauses() { return state.clauses; },
    async getTerminology() { return state.terminology; },
    async saveEmbedding(ownerId, vec) {
      const c = state.clauses.find((x) => x.id === ownerId);
      if (c) c._emb = vec;
    },
    async createSubmission(s) {
      const row = { id: `S${state.seq++}`, status: s.status || 'needs_changes', createdAt: new Date().toISOString(), driver: s.driver, type: s.type, text: s.text, sessionId: s.sessionId, parentId: s.parentId || null };
      state.submissions.unshift(row);
      return row;
    },
    async addIssue(issue) {
      const row = { id: `I${state.seq++}`, status: 'open', ...issue };
      state.issues.push(row);
      return row;
    },
    async listSubmissions(sessionId) {
      return state.submissions.filter((s) => s.sessionId === sessionId).map((s) => ({
        ...s,
        supersededBy: (state.submissions.find((x) => x.parentId === s.id) || {}).id || null,
        openIssues: state.issues.filter((i) => i.submissionId === s.id && i.status === 'open').length,
      }));
    },
    async getSubmission(id, sessionId) {
      const s = state.submissions.find((x) => x.id === id && (!sessionId || x.sessionId === sessionId));
      if (!s) return null;
      return {
        ...s,
        supersededBy: (state.submissions.find((x) => x.parentId === id) || {}).id || null,
        issues: state.issues.filter((i) => i.submissionId === id),
        decisions: state.decisions.filter((d) => d.submissionId === id),
      };
    },
    async decideIssue(issueId, { action, reason, decidedBy }) {
      const i = state.issues.find((x) => x.id === issueId);
      if (!i) return null;
      i.status = action;
      const d = { id: `D${state.seq++}`, submissionId: i.submissionId, issueId, action, reason, decidedBy, createdAt: new Date().toISOString() };
      state.decisions.push(d);
      return { issue: i, decision: d };
    },
    async getIssue(issueId) {
      const i = state.issues.find((x) => x.id === issueId);
      return i ? { id: i.id, submissionId: i.submissionId, status: i.status } : null;
    },
    async reviewSubmission(id, { action, comment, decidedBy }) {
      const s = state.submissions.find((x) => x.id === id);
      if (!s) return null;
      s.status = action === 'approve' ? 'approved' : 'sent_back';
      const d = { id: `D${state.seq++}`, submissionId: id, action, reason: comment, decidedBy, createdAt: new Date().toISOString() };
      state.decisions.push(d);
      return { submission: s, decision: d };
    },
    async markSuperseded(id, childId, decidedBy) {
      const s = state.submissions.find((x) => x.id === id);
      if (!s) return null;
      s.status = 'superseded';
      const d = { id: `D${state.seq++}`, submissionId: id, action: 'revise', reason: `Revised as ${childId}`, decidedBy, createdAt: new Date().toISOString() };
      state.decisions.push(d);
      return d;
    },
    async resolveIfNoOpenIssues(id) {
      const s = state.submissions.find((x) => x.id === id);
      if (!s) return;
      const open = state.issues.filter((i) => i.submissionId === id && i.status === 'open').length;
      if (open === 0 && s.status === 'needs_changes') s.status = 'awaiting_review';
    },
    async resetSession(sessionId) {
      const ids = new Set(state.submissions.filter((s) => s.sessionId === sessionId).map((s) => s.id));
      state.submissions = state.submissions.filter((s) => !ids.has(s.id));
      state.issues = state.issues.filter((i) => !ids.has(i.submissionId));
      state.decisions = state.decisions.filter((d) => !ids.has(d.submissionId));
    },
    async insights(sessionId) {
      const subs = state.submissions.filter((s) => !sessionId || s.sessionId === sessionId);
      const ids = new Set(subs.map((s) => s.id));
      const issues = state.issues.filter((i) => ids.has(i.submissionId));
      const byClause = {};
      for (const i of issues) byClause[i.citedId] = (byClause[i.citedId] || 0) + 1;
      return {
        totalSubmissions: subs.length,
        totalIssues: issues.length,
        openIssues: issues.filter((i) => i.status === 'open').length,
        byClause,
      };
    },
  };
}

function pgStore(seed) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const schema = `
    CREATE TABLE IF NOT EXISTS clauses (id text primary key, kind text, title text, body text, source text, emb double precision[]);
    CREATE TABLE IF NOT EXISTS terminology (id text primary key, preferred text, avoid text[]);
    CREATE TABLE IF NOT EXISTS submissions (id serial primary key, session_id text, type text, text text, status text, driver text, created_at timestamptz default now(), parent_id int);
    ALTER TABLE submissions ADD COLUMN IF NOT EXISTS parent_id int;
    CREATE TABLE IF NOT EXISTS issues (id serial primary key, submission_id int references submissions(id), cited_id text, span text, explanation text, suggestion text, severity text, status text default 'open', created_at timestamptz default now());
    CREATE TABLE IF NOT EXISTS decisions (id serial primary key, submission_id int, issue_id int, action text, reason text, decided_by text, created_at timestamptz default now());
  `;
  return {
    kind: 'pg',
    async init() {
      await pool.query(schema);
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM clauses');
      if (rows[0].n === 0) {
        for (const c of [...seed.GUIDELINES, ...seed.FACTS]) {
          await pool.query('INSERT INTO clauses (id, kind, title, body, source) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING', [c.id, c.kind, c.title || null, c.body, c.source || null]);
        }
        for (const t of seed.TERMINOLOGY) {
          await pool.query('INSERT INTO terminology (id, preferred, avoid) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING', [t.id, t.preferred, t.avoid]);
        }
      }
    },
    async getClauses() {
      const { rows } = await pool.query('SELECT id, kind, title, body, source, emb AS _emb FROM clauses');
      return rows;
    },
    async getTerminology() {
      const { rows } = await pool.query('SELECT id, preferred, avoid FROM terminology');
      return rows;
    },
    async saveEmbedding(ownerId, vec) {
      await pool.query('UPDATE clauses SET emb=$2 WHERE id=$1', [ownerId, vec]);
    },
    async createSubmission(s) {
      const { rows } = await pool.query('INSERT INTO submissions (session_id, type, text, status, driver, parent_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, type, text, status, driver, created_at AS "createdAt"', [s.sessionId, s.type, s.text, s.status || 'needs_changes', s.driver, s.parentId ? Number(String(s.parentId).replace(/^S/, '')) : null]);
      return { id: `S${rows[0].id}`, type: rows[0].type, text: rows[0].text, status: rows[0].status, driver: rows[0].driver, createdAt: rows[0].createdAt, sessionId: s.sessionId, parentId: s.parentId || null };
    },
    async addIssue(issue) {
      const pk = Number(String(issue.submissionId).replace(/^S/, ''));
      const { rows } = await pool.query('INSERT INTO issues (submission_id, cited_id, span, explanation, suggestion, severity) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [pk, issue.citedId, issue.span, issue.explanation, issue.suggestion, issue.severity]);
      return { id: `I${rows[0].id}`, status: 'open', ...issue };
    },
    async listSubmissions(sessionId) {
      const { rows } = await pool.query(`SELECT s.id, s.type, s.status, s.driver, s.created_at AS "createdAt", left(s.text, 120) AS text, s.parent_id AS "parentId",
        (SELECT c.id FROM submissions c WHERE c.parent_id=s.id ORDER BY c.id DESC LIMIT 1) AS "supersededBy",
        (SELECT count(*)::int FROM issues i WHERE i.submission_id=s.id AND i.status='open') AS "openIssues"
        FROM submissions s WHERE s.session_id=$1 ORDER BY s.id DESC`, [sessionId]);
      return rows.map((r) => ({ ...r, id: `S${r.id}`, parentId: r.parentId ? `S${r.parentId}` : null, supersededBy: r.supersededBy ? `S${r.supersededBy}` : null }));
    },
    async getSubmission(id, sessionId) {
      const pk = Number(String(id).replace(/^S/, ''));
      const { rows } = await pool.query('SELECT id, type, text, status, driver, created_at AS "createdAt", parent_id AS "parentId", (SELECT c.id FROM submissions c WHERE c.parent_id=submissions.id ORDER BY c.id DESC LIMIT 1) AS "supersededBy" FROM submissions WHERE id=$1 AND ($2::text IS NULL OR session_id=$2)', [pk, sessionId || null]);
      if (!rows.length) return null;
      const issues = (await pool.query('SELECT id, cited_id AS "citedId", span, explanation, suggestion, severity, status FROM issues WHERE submission_id=$1 ORDER BY id', [pk])).rows.map((r) => ({ ...r, id: `I${r.id}`, submissionId: id }));
      const decisions = (await pool.query('SELECT id, issue_id AS "issueId", action, reason, decided_by AS "decidedBy", created_at AS "createdAt" FROM decisions WHERE submission_id=$1 ORDER BY id', [pk])).rows.map((r) => ({ ...r, id: `D${r.id}`, issueId: r.issueId ? `I${r.issueId}` : null, submissionId: id }));
      return { ...rows[0], id, parentId: rows[0].parentId ? `S${rows[0].parentId}` : null, supersededBy: rows[0].supersededBy ? `S${rows[0].supersededBy}` : null, issues, decisions };
    },
    async decideIssue(issueId, { action, reason, decidedBy }) {
      const ipk = Number(String(issueId).replace(/^I/, ''));
      const { rows } = await pool.query('UPDATE issues SET status=$2 WHERE id=$1 RETURNING id, submission_id', [ipk, action]);
      if (!rows.length) return null;
      const { rows: dr } = await pool.query('INSERT INTO decisions (submission_id, issue_id, action, reason, decided_by) VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at AS "createdAt"', [rows[0].submission_id, ipk, action, reason, decidedBy]);
      return { issue: { id: issueId, status: action }, decision: { id: `D${dr[0].id}`, submissionId: `S${rows[0].submission_id}`, issueId, action, reason, decidedBy, createdAt: dr[0].createdAt } };
    },
    async getIssue(issueId) {
      const ipk2 = Number(String(issueId).replace(/^I/, ''));
      const { rows: ir } = await pool.query('SELECT id, submission_id, status FROM issues WHERE id=$1', [ipk2]);
      if (!ir.length) return null;
      return { id: issueId, submissionId: `S${ir[0].submission_id}`, status: ir[0].status };
    },
    async reviewSubmission(id, { action, comment, decidedBy }) {
      const pk = Number(String(id).replace(/^S/, ''));
      const status = action === 'approve' ? 'approved' : 'sent_back';
      const { rows } = await pool.query('UPDATE submissions SET status=$2 WHERE id=$1 RETURNING id', [pk, status]);
      if (!rows.length) return null;
      const { rows: dr } = await pool.query('INSERT INTO decisions (submission_id, issue_id, action, reason, decided_by) VALUES ($1,NULL,$2,$3,$4) RETURNING id, created_at AS "createdAt"', [pk, action, comment, decidedBy]);
      return { submission: { id, status }, decision: { id: `D${dr[0].id}`, submissionId: id, action, reason: comment, decidedBy, createdAt: dr[0].createdAt } };
    },
    async insights(sessionId) {
      const scope = sessionId ? 'WHERE session_id=$1' : '';
      const args = sessionId ? [sessionId] : [];
      const sub = (await pool.query(`SELECT count(*)::int AS n FROM submissions ${scope}`, args)).rows[0].n;
      const iss = (await pool.query(`SELECT count(*)::int AS n FROM issues i JOIN submissions s ON s.id=i.submission_id ${sessionId ? 'WHERE s.session_id=$1' : ''}`, args)).rows[0].n;
      const open = (await pool.query(`SELECT count(*)::int AS n FROM issues i JOIN submissions s ON s.id=i.submission_id WHERE i.status='open' ${sessionId ? 'AND s.session_id=$1' : ''}`, args)).rows[0].n;
      const byClause = {};
      for (const r of (await pool.query(`SELECT i.cited_id, count(*)::int AS n FROM issues i JOIN submissions s ON s.id=i.submission_id ${sessionId ? 'WHERE s.session_id=$1' : ''} GROUP BY i.cited_id`, args)).rows) byClause[r.cited_id] = r.n;
      return { totalSubmissions: sub, totalIssues: iss, openIssues: open, byClause };
    },
    async markSuperseded(id, childId, decidedBy) {
      const pk = Number(String(id).replace(/^S/, ''));
      const { rows } = await pool.query("UPDATE submissions SET status='superseded' WHERE id=$1 RETURNING id", [pk]);
      if (!rows.length) return null;
      const { rows: dr } = await pool.query('INSERT INTO decisions (submission_id, issue_id, action, reason, decided_by) VALUES ($1,NULL,$2,$3,$4) RETURNING id', [pk, 'revise', `Revised as ${childId}`, decidedBy]);
      return { id: `D${dr[0].id}` };
    },
    async resolveIfNoOpenIssues(id) {
      const pk = Number(String(id).replace(/^S/, ''));
      await pool.query(`UPDATE submissions SET status='awaiting_review' WHERE id=$1 AND status='needs_changes'
        AND NOT EXISTS (SELECT 1 FROM issues WHERE submission_id=$1 AND status='open')`, [pk]);
    },
    async resetSession(sessionId) {
      const { rows } = await pool.query('SELECT id FROM submissions WHERE session_id=$1', [sessionId]);
      const ids = rows.map((r) => r.id);
      if (!ids.length) return;
      await pool.query('DELETE FROM decisions WHERE submission_id = ANY($1)', [ids]);
      await pool.query('DELETE FROM issues WHERE submission_id = ANY($1)', [ids]);
      await pool.query('DELETE FROM submissions WHERE id = ANY($1)', [ids]);
    },
  };
}

export function createStore(seed) {
  return process.env.DATABASE_URL ? pgStore(seed) : memoryStore(seed);
}
