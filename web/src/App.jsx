import React, { useEffect, useState } from 'react';
import { api } from './api.js';

const SEV_STYLE = {
  high: 'bg-red-100 text-red-800 border-red-300',
  medium: 'bg-amber-100 text-amber-800 border-amber-300',
  low: 'bg-sky-100 text-sky-800 border-sky-300',
};

export const STATUS_STYLE = {
  needs_changes: 'bg-amber-100 text-amber-800',
  awaiting_review: 'bg-blue-100 text-blue-800',
  approved: 'bg-green-100 text-green-800',
  sent_back: 'bg-red-100 text-red-800',
};

export const DRIVER_LABEL = {
  mock: 'Rules-only check (deterministic) - not the full AI check',
  'mock-fallback': 'Degraded: rules-only fallback, LLM unavailable - not the full AI check',
  groq: 'Full AI check (Groq)',
};

export function StatusBadge({ status }) {
  return <span className={`text-xs px-2 py-0.5 rounded ${STATUS_STYLE[status] || 'bg-slate-200'}`}>{status.replace('_', ' ')}</span>;
}

function Banner({ demo }) {
  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-900">
      <strong>Demo mode.</strong> One-tap writer/reviewer roles, seeded sample data only. No real login or company data. Your submissions stay in this browser only. {demo ? `Storage: ${demo.storage}. Checker: ${demo.llm === 'groq' ? 'full AI (Groq)' : 'rules-only (no LLM key configured)'}.` : ''}
    </div>
  );
}

function IssueCard({ issue, role, onDecide }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const statusBadge = {
    open: 'bg-slate-200 text-slate-700',
    accept: 'bg-green-100 text-green-800',
    edit: 'bg-blue-100 text-blue-800',
    dismiss: 'bg-slate-100 text-slate-500',
  }[issue.status] || 'bg-slate-200';
  return (
    <div className={`border rounded-lg p-4 ${SEV_STYLE[issue.severity] || 'bg-white'}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="font-mono font-bold">[{issue.citedId}]</span>
        <span className="uppercase text-xs font-semibold">{issue.severity}</span>
        <span className={`ml-auto text-xs px-2 py-0.5 rounded ${statusBadge}`}>{issue.status}</span>
      </div>
      {issue.span && (
        <p className="text-sm italic mb-1">
          Draft says: "{issue.span}"{issue.spanQuoted === false && <span className="not-italic text-xs"> (paraphrased by checker)</span>}
        </p>
      )}
      <p className="text-sm mb-1">{issue.explanation}</p>
      <p className="text-sm"><span className="font-medium">Suggestion:</span> {issue.suggestion}</p>
      {issue.status === 'open' && role === 'writer' && (
        <div className="mt-3 flex flex-col gap-2">
          <input
            className="border rounded px-2 py-1 text-sm bg-white"
            placeholder="Reason (required for every decision)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="flex gap-2">
            {['accept', 'edit', 'dismiss'].map((a) => (
              <button
                key={a}
                disabled={busy || !reason.trim()}
                className="px-3 py-1 text-sm rounded bg-white border hover:bg-slate-100 disabled:opacity-40"
                onClick={async () => { setBusy(true); await onDecide(issue.id, a, reason); setBusy(false); }}
              >
                {a}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SubmissionDetail({ id, role, onBack, onChanged, onOpen }) {
  const [sub, setSub] = useState(null);
  const [revision, setRevision] = useState(null);
  const [revBusy, setRevBusy] = useState(false);
  const [comment, setComment] = useState('');
  const [err, setErr] = useState('');
  const load = async () => setSub(await api(`/api/submissions/${id}`));
  useEffect(() => { load(); }, [id]);
  if (!sub) return <p className="p-4">Loading...</p>;

  const decide = async (issueId, action, reason) => {
    setErr('');
    try { await api(`/api/issues/${issueId}/decision`, { method: 'POST', body: { action, reason, decidedBy: role } }); await load(); onChanged(); }
    catch (e) { setErr(e.message); }
  };
  const review = async (action) => {
    setErr('');
    try { await api(`/api/submissions/${id}/review`, { method: 'POST', body: { action, comment, decidedBy: role } }); await load(); onChanged(); }
    catch (e) { setErr(e.message); }
  };
  const openIssues = sub.issues.filter((i) => i.status === 'open').length;
  const recheck = async () => {
    setErr(''); setRevBusy(true);
    try { const out = await api('/api/submissions', { method: 'POST', body: { type: sub.type, text: revision } }); onChanged(); onOpen && onOpen(out.submission.id); }
    catch (e) { setErr(e.message); }
    setRevBusy(false);
  };

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <button className="text-sm text-blue-700 mb-3" onClick={onBack}>&larr; Back to list</button>
      <div className="bg-white border rounded-lg p-4 mb-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="font-mono text-sm">{sub.id}</span>
          <span className="text-sm text-slate-500">{sub.type}</span>
          <span className="ml-auto"><StatusBadge status={sub.status} /></span>
        </div>
        <p className="whitespace-pre-wrap text-sm bg-slate-50 border rounded p-3">{sub.text}</p>
        <p className={`text-xs mt-2 ${sub.driver === 'groq' ? 'text-slate-500' : 'text-amber-700 font-medium'}`}>{DRIVER_LABEL[sub.driver] || sub.driver}. {openIssues} open issue(s).{sub.status === 'awaiting_review' ? ' Waiting for a human reviewer - clean content is never auto-approved.' : ''}</p>
      </div>

      <h2 className="font-semibold mb-2">Issues ({sub.issues.length})</h2>
      <div className="flex flex-col gap-3 mb-4">
        {sub.issues.length === 0 && <p className="text-sm text-slate-500">No issues. This content matched the approved clauses.</p>}
        {sub.issues.map((i) => <IssueCard key={i.id} issue={i} role={role} onDecide={decide} />)}
      </div>

      {err && <p className="text-sm text-red-700 mb-2">{err}</p>}

      {role === 'writer' && onOpen && sub.status !== 'approved' && (
        <div className="bg-white border rounded-lg p-4 mb-4">
          <h3 className="font-semibold mb-1">Revise and re-check</h3>
          <p className="text-xs text-slate-500 mb-2">Accepting or editing a finding records your decision only. To fix the content, edit the text below and run a new check. The new check is a separate submission.</p>
          {revision === null
            ? <button className="px-3 py-1 text-sm rounded border bg-white" onClick={() => setRevision(sub.text)}>Start a revision</button>
            : (<>
                <textarea className="border rounded px-2 py-1 text-sm w-full h-32 mb-2" value={revision} onChange={(e) => setRevision(e.target.value)} />
                <button disabled={revBusy || revision.trim().length < 10} className="px-3 py-1 text-sm rounded bg-blue-700 text-white disabled:opacity-40" onClick={recheck}>{revBusy ? 'Checking...' : 'Re-check revised text'}</button>
              </>)}
        </div>
      )}

      {role === 'reviewer' && (
        <div className="bg-white border rounded-lg p-4">
          <h3 className="font-semibold mb-2">Reviewer decision</h3>
          <input className="border rounded px-2 py-1 text-sm w-full mb-2" placeholder="Comment (required when sending back)" value={comment} onChange={(e) => setComment(e.target.value)} />
          <div className="flex gap-2">
            <button disabled={openIssues > 0} title={openIssues > 0 ? 'All issues must be resolved first' : ''} className="px-3 py-1 text-sm rounded bg-green-600 text-white disabled:opacity-40" onClick={() => review('approve')}>Approve</button>
            <button disabled={!comment.trim()} className="px-3 py-1 text-sm rounded bg-red-600 text-white disabled:opacity-40" onClick={() => review('sendback')}>Send back</button>
          </div>
          {openIssues > 0 && <p className="text-xs text-slate-500 mt-1">Approval is blocked until every issue is accepted, edited or dismissed by the writer.</p>}
        </div>
      )}

      {sub.decisions.length > 0 && (
        <>
          <h2 className="font-semibold mt-4 mb-2">Decision trail</h2>
          <ul className="text-sm text-slate-600 flex flex-col gap-1">
            {sub.decisions.map((d) => (
              <li key={d.id} className="border-l-2 border-slate-300 pl-2">
                <span className="font-medium">{d.decidedBy}</span> {d.action}{d.issueId ? ` on ${d.issueId}` : ''}: {d.reason}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function WriterView({ demo, role, onChanged }) {
  const [type, setType] = useState(demo.contentTypes[0]);
  const [text, setText] = useState('');
  const [subs, setSubs] = useState([]);
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const load = async () => setSubs((await api('/api/submissions')).submissions);
  useEffect(() => { load(); }, []);

  const submit = async () => {
    setBusy(true); setErr('');
    try { const out = await api('/api/submissions', { method: 'POST', body: { type, text } }); setText(''); await load(); setDetail(out.submission.id); }
    catch (e) { setErr(e.message); }
    setBusy(false);
  };

  if (detail) return <SubmissionDetail key={detail} id={detail} role={role} onBack={() => { setDetail(null); load(); }} onChanged={onChanged} onOpen={setDetail} />;

  return (
    <div className="p-4 max-w-3xl mx-auto">
      <div className="bg-white border rounded-lg p-4 mb-4">
        <h2 className="font-semibold mb-2">New submission</h2>
        <div className="flex gap-2 mb-2 flex-wrap">
          <select className="border rounded px-2 py-1 text-sm" value={type} onChange={(e) => setType(e.target.value)}>
            {demo.contentTypes.map((t) => <option key={t}>{t}</option>)}
          </select>
          {demo.samples.map((s) => (
            <button key={s.label} className="text-xs px-2 py-1 border rounded bg-slate-50 hover:bg-slate-100" onClick={() => { setText(s.text); setType(s.type); }}>{s.label}</button>
          ))}
        </div>
        <textarea className="w-full border rounded p-2 text-sm" rows={6} placeholder="Paste the content to check..." value={text} onChange={(e) => setText(e.target.value)} />
        {err && <p className="text-sm text-red-700 mt-1">{err}</p>}
        <button disabled={busy || text.trim().length < 10} className="mt-2 px-4 py-2 rounded bg-blue-700 text-white text-sm disabled:opacity-40" onClick={submit}>
          {busy ? 'Checking...' : 'Run pre-publish check'}
        </button>
        <p className="text-xs text-slate-500 mt-1">The check embeds your text locally, retrieves the relevant approved clauses, flags conflicts with citations, and checks that every cited clause exists and the quoted text appears in your draft. Whether a clause truly applies is a call for the human reviewer.</p>
      </div>
      <h2 className="font-semibold mb-2">Submissions</h2>
      <SubmissionList subs={subs} onOpen={setDetail} />
    </div>
  );
}

function SubmissionList({ subs, onOpen }) {
  if (!subs.length) return <p className="text-sm text-slate-500">Nothing submitted yet.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {subs.map((s) => (
        <li key={s.id}>
          <button className="w-full text-left bg-white border rounded-lg p-3 hover:border-blue-400" onClick={() => onOpen(s.id)}>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm">{s.id}</span>
              <span className="text-xs text-slate-500">{s.type}</span>
              <span className="ml-auto"><StatusBadge status={s.status} /></span>
            </div>
            <p className="text-sm text-slate-600 truncate mt-1">{s.text}</p>
            {s.openIssues > 0 && <p className="text-xs text-amber-700 mt-1">{s.openIssues} open issue(s)</p>}
          </button>
        </li>
      ))}
    </ul>
  );
}

function ReviewerView({ role, onChanged }) {
  const [subs, setSubs] = useState([]);
  const [detail, setDetail] = useState(null);
  const load = async () => setSubs((await api('/api/submissions')).submissions);
  useEffect(() => { load(); }, []);
  if (detail) return <SubmissionDetail key={detail} id={detail} role={role} onBack={() => { setDetail(null); load(); }} onChanged={onChanged} onOpen={setDetail} />;
  return (
    <div className="p-4 max-w-3xl mx-auto">
      <h2 className="font-semibold mb-2">Review queue</h2>
      <SubmissionList subs={subs} onOpen={setDetail} />
    </div>
  );
}

function InsightsView() {
  const [data, setData] = useState(null);
  useEffect(() => { api('/api/insights').then(setData); }, []);
  if (!data) return <p className="p-4">Loading...</p>;
  return (
    <div className="p-4 max-w-3xl mx-auto">
      <h2 className="font-semibold mb-2">Insights (lite)</h2>
      <div className="grid grid-cols-3 gap-3 mb-4">
        {[['Submissions', data.totalSubmissions], ['Issues found', data.totalIssues], ['Open now', data.openIssues]].map(([k, v]) => (
          <div key={k} className="bg-white border rounded-lg p-4 text-center">
            <div className="text-2xl font-bold">{v}</div>
            <div className="text-xs text-slate-500">{k}</div>
          </div>
        ))}
      </div>
      <h3 className="font-semibold mb-2">Most-cited clauses</h3>
      {Object.keys(data.byClause).length === 0 && <p className="text-sm text-slate-500">No citations yet.</p>}
      <ul className="flex flex-col gap-1">
        {Object.entries(data.byClause).sort((a, b) => b[1] - a[1]).map(([id, n]) => (
          <li key={id} className="bg-white border rounded p-2 text-sm flex"><span className="font-mono">[{id}]</span><span className="ml-auto">{n} issue(s)</span></li>
        ))}
      </ul>
    </div>
  );
}

function BrandBaseView() {
  const [data, setData] = useState(null);
  useEffect(() => { api('/api/brandbase').then(setData); }, []);
  if (!data) return <p className="p-4">Loading...</p>;
  return (
    <div className="p-4 max-w-3xl mx-auto">
      <h2 className="font-semibold mb-2">Approved brand base</h2>
      <p className="text-sm text-slate-500 mb-3">Every issue must cite one of these clauses. Nothing is enforced without a source a reviewer can open.</p>
      <div className="flex flex-col gap-2 mb-4">
        {data.clauses.map((c) => (
          <div key={c.id} className="bg-white border rounded-lg p-3">
            <div className="flex gap-2 items-baseline"><span className="font-mono font-bold">[{c.id}]</span>{c.title && <span className="font-medium">{c.title}</span>}<span className="text-xs text-slate-400 ml-auto">{c.kind}</span></div>
            <p className="text-sm mt-1">{c.body}</p>
            {c.source && <p className="text-xs text-slate-500 mt-1">Source: {c.source}</p>}
          </div>
        ))}
      </div>
      <h3 className="font-semibold mb-2">Terminology</h3>
      <ul className="flex flex-col gap-1">
        {data.terminology.map((t) => (
          <li key={t.id} className="bg-white border rounded p-2 text-sm">Use <strong>{t.preferred}</strong>; avoid: {t.avoid.join(', ')}</li>
        ))}
      </ul>
    </div>
  );
}

export default function App() {
  const [demo, setDemo] = useState(null);
  const [role, setRole] = useState('writer');
  const [tab, setTab] = useState('work');
  useEffect(() => { api('/api/demo').then(setDemo); }, []);
  if (!demo) return <p className="p-4">Loading...</p>;

  return (
    <div className="min-h-screen">
      <Banner demo={demo} />
      <header className="bg-white border-b px-4 py-3 flex items-center gap-3 flex-wrap">
        <h1 className="text-lg font-bold">Affiant</h1>
        <span className="text-sm text-slate-500">{demo.company.name}</span>
        <nav className="ml-auto flex gap-2 items-center text-sm flex-wrap">
          <span className="text-xs text-slate-500">Role:</span>
          {['writer', 'reviewer'].map((r) => (
            <button key={r} className={`px-2 py-1 rounded border ${role === r ? 'bg-blue-700 text-white border-blue-700' : 'bg-white'}`} onClick={() => { setRole(r); setTab('work'); }}>{r}</button>
          ))}
          <button className={`px-2 py-1 rounded border ${tab === 'insights' ? 'bg-blue-700 text-white border-blue-700' : 'bg-white'}`} onClick={() => setTab('insights')}>Insights</button>
          <button className={`px-2 py-1 rounded border ${tab === 'brandbase' ? 'bg-blue-700 text-white border-blue-700' : 'bg-white'}`} onClick={() => setTab('brandbase')}>Brand base</button>
          <button className="px-2 py-1 rounded border bg-white text-red-700" title="Delete this browser\'s demo submissions" onClick={async () => { await api('/api/demo/reset', { method: 'POST' }); window.location.reload(); }}>Reset demo</button>
        </nav>
      </header>
      {tab === 'work' && role === 'writer' && <WriterView demo={demo} role={role} onChanged={() => {}} />}
      {tab === 'work' && role === 'reviewer' && <ReviewerView role={role} onChanged={() => {}} />}
      {tab === 'insights' && <InsightsView />}
      {tab === 'brandbase' && <BrandBaseView />}
      <footer className="text-center text-xs text-slate-400 py-6">Built by Team NorthLight for CodeTitans Round 2. Built with AI assistance (Instinct), disclosed in the submission.</footer>
    </div>
  );
}
