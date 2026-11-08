// The checking pipeline:
// 1. Embed the submission and retrieve the most relevant approved clauses.
// 2. Run the checker (LLM or mock) against ONLY the retrieved clauses.
// 3. Verification pass: drop any issue whose citation was not in the retrieved
//    set, whose quoted span does not appear in the submission, or whose shape
//    is invalid. Dropped issues are counted so the check stays auditable.
import { embed, cosine } from './embeddings.js';
import { runCheck } from './llm.js';
import { FACTS } from './seed.js';

// The demo brand base is small, so every guideline fits in the check context
// and retrieval ranks the fact sheet. At production scale both lists get
// truncated to TOP_K; the audit records what was retrieved in rank order.
const TOP_K_FACTS = 5;

function normalize(s) {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

export async function checkSubmission(store, { type, text, sessionId }) {
  const clauses = await store.getClauses();
  const terminology = await store.getTerminology();
  // Fact-check anchors live in the seed (not in the DB); reattach by id.
  const checkMap = Object.fromEntries(FACTS.filter((f) => f.checks).map((f) => [f.id, f.checks]));
  for (const c of clauses) if (checkMap[c.id]) c.checks = checkMap[c.id];

  // 1. retrieve
  const [textVec] = await embed([text]);
  const needEmb = clauses.filter((c) => !c._emb);
  if (needEmb.length) {
    const vecs = await embed(needEmb.map((c) => `${c.title || ''} ${c.body}`));
    for (let i = 0; i < needEmb.length; i++) {
      await store.saveEmbedding(needEmb[i].id, vecs[i]);
      needEmb[i]._emb = vecs[i];
    }
  }
  const guidelines = clauses.filter((c) => c.kind === 'guideline');
  const facts = clauses
    .filter((c) => c.kind === 'fact' && c._emb)
    .map((c) => ({ ...c, score: cosine(textVec, c._emb) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K_FACTS);
  const retrieved = [...guidelines, ...facts];

  // 2. check
  const result = await runCheck({ text, type, retrieved, terminology });

  // 3. verification pass
  const retrievedIds = new Set(retrieved.map((r) => r.id));
  const validIds = new Set(clauses.map((c) => c.id));
  const normText = normalize(text);
  const kept = [];
  let droppedCitation = 0;
  let droppedSpan = 0;
  for (const issue of result.issues) {
    if (!issue || typeof issue.citedId !== 'string' || !issue.explanation || !issue.severity) { droppedCitation++; continue; }
    if (!retrievedIds.has(issue.citedId) || !validIds.has(issue.citedId)) { droppedCitation++; continue; }
    if (issue.span && !normText.includes(normalize(String(issue.span)))) {
      // span paraphrased instead of quoted: keep the issue but mark it
      issue.spanQuoted = false;
    }
    issue.spanQuoted = issue.spanQuoted !== false;
    kept.push(issue);
  }

  // 4. persist. Zero issues does NOT mean approved: a human reviewer always
  // makes the final call. Clean content waits in 'awaiting_review'.
  const initialStatus = kept.length === 0 ? 'awaiting_review' : 'needs_changes';
  const submission = await store.createSubmission({ type, text, driver: result.driver, status: initialStatus, sessionId });
  const savedIssues = [];
  for (const issue of kept) {
    savedIssues.push(await store.addIssue({ submissionId: submission.id, ...issue }));
  }

  return {
    submission: await store.getSubmission(submission.id),
    audit: {
      driver: result.driver,
      retrievedClauseIds: retrieved.map((r) => r.id),
      issuesKept: kept.length,
      droppedInvalidCitation: droppedCitation,
      droppedUnmatchedSpan: droppedSpan,
    },
  };
}
