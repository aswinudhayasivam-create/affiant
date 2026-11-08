// LLM interface. Two drivers:
//  - mock: deterministic rule-based checker used in local dev and as fallback.
//  - groq: calls the Groq chat API (free tier) when GROQ_API_KEY is set.
// Both return the same shape: { issues: [{citedId, span, explanation, suggestion, severity}] }

const SUPERLATIVES = ['#1', 'best', 'leading', 'most trusted', 'revolutionary', 'game-changing', 'world-class'];
const ABSOLUTES = ['guaranteed', 'risk-free', 'never fails'];
const ENV_WORDS = ['eco-friendly', 'green'];

function findSpan(text, phrase) {
  const i = text.toLowerCase().indexOf(phrase.toLowerCase());
  if (i < 0) return null;
  return text.slice(Math.max(0, i - 20), Math.min(text.length, i + phrase.length + 20));
}

function mockCheck({ text, retrieved, terminology }) {
  const issues = [];
  const lower = text.toLowerCase();
  const has = (id) => retrieved.some((r) => r.id === id);

  // Terminology: word-boundary match, case-insensitive, but never flag an
  // occurrence that already uses the exact approved casing, and never flag
  // the same span twice via overlapping avoid-entries.
  for (const t of terminology) {
    const flagged = [];
    for (const bad of t.avoid) {
      const re = new RegExp(`\\b${bad.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      let m;
      while ((m = re.exec(text)) !== null) {
        const found = m[0];
        if (found === t.preferred) continue;
        if (flagged.some(([s, e]) => m.index < e && s < m.index + found.length)) continue;
        flagged.push([m.index, m.index + found.length]);
        issues.push({
          citedId: 'G4',
          span: findSpan(text, found) || found,
          explanation: `"${found}" is not the approved wording. Approved form: "${t.preferred}".`,
          suggestion: `Replace with "${t.preferred}".`,
          severity: 'medium',
        });
      }
    }
  }
  for (const w of SUPERLATIVES) {
    if (lower.includes(w) && has('G2')) {
      issues.push({
        citedId: 'G2',
        span: findSpan(text, w) || w,
        explanation: `Unverifiable superlative "${w}". Approved guidelines require a sourced fact for claims like this.`,
        suggestion: 'Remove the claim or replace it with a statement from the approved facts.',
        severity: 'high',
      });
    }
  }
  for (const w of ABSOLUTES) {
    if (lower.includes(w) && has('G5')) {
      issues.push({
        citedId: 'G5',
        span: findSpan(text, w) || w,
        explanation: `Absolute promise "${w}". Guidelines prohibit guarantees the company cannot always keep.`,
        suggestion: 'Describe what the product does today instead of promising outcomes.',
        severity: 'high',
      });
    }
  }
  for (const w of ENV_WORDS) {
    if (lower.includes(w) && has('G8')) {
      issues.push({
        citedId: 'G8',
        span: findSpan(text, w) || w,
        explanation: `Environmental claim "${w}" must come from an approved fact with a source.`,
        suggestion: 'Use the approved fact, e.g. "The cans are made from 70% recycled aluminium."',
        severity: 'medium',
      });
    }
  }
  if (/health/i.test(text) && has('G3')) {
    issues.push({
      citedId: 'G3',
      span: findSpan(text, 'health') || 'health',
      explanation: 'The text references health. Health statements must match approved wording exactly.',
      suggestion: 'Remove the health reference or use an approved fact verbatim.',
      severity: 'high',
    });
  }
  issues.push(...numericIssues(text, retrieved));
  return { issues, driver: 'mock' };
}

function numericIssues(text, retrieved) {
  const issues = [];
  // Unsupported-assertion check: numeric claims that contradict an approved
  // fact (each fact carries explicit keyword/value anchors in the seed).
  const sentences = text.split(/(?<=[.!?])\s+/);
  for (const fact of retrieved.filter((r) => r.kind === 'fact' && Array.isArray(r.checks))) {
    for (const chk of fact.checks) {
      const kw = new RegExp(`\\b${chk.keyword}\\b`, 'i');
      for (const s of sentences) {
        if (!kw.test(s)) continue;
        const nums = s.match(/\d+(?:\.\d+)?/g) || [];
        if (nums.length && !nums.includes(chk.value)) {
          issues.push({
            citedId: fact.id,
            span: s.trim().slice(0, 120),
            explanation: `This states a different figure than the approved fact: "${fact.body}"`,
            suggestion: `Use the approved figure from the fact sheet (source: ${fact.source || 'approved facts'}).`,
            severity: 'high',
          });
          break;
        }
      }
    }
  }
  return issues;
}

async function groqCheck({ text, retrieved, terminology }) {
  const clausesBlock = retrieved
    .map((r) => `[${r.id}] (${r.kind}) ${r.title ? r.title + ': ' : ''}${r.body}${r.source ? ' (source: ' + r.source + ')' : ''}`)
    .join('\n');
  const termsBlock = terminology.map((t) => `Prefer "${t.preferred}", avoid: ${t.avoid.join(', ')}`).join('\n');

  const system = `You are Affiant, a brand-compliance checker. You receive approved brand clauses and a draft.
Rules:
- List ONLY issues where the draft conflicts with, or is unsupported by, a numbered clause you were given.
- Every issue MUST cite the exact clause id in citedId (for example "G2" or "F4").
- quote the shortest offending span from the draft, verbatim, in span.
- If nothing conflicts, return an empty issues array.
Respond with strict JSON: {"issues":[{"citedId":"..","span":"..","explanation":"..","suggestion":"..","severity":"high|medium|low"}]}`;

  const user = `APPROVED CLAUSES:\n${clausesBlock}\n\nTERMINOLOGY:\n${termsBlock}\n\nDRAFT:\n${text}`;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Groq API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const parsed = JSON.parse(data.choices[0].message.content);
  const llmIssues = Array.isArray(parsed.issues) ? parsed.issues : [];
  // Deterministic numeric cross-check runs on top of the model: the model can miss a wrong figure.
  const have = new Set(llmIssues.map((x) => `${x.citedId}|${x.span}`));
  const extra = numericIssues(text, retrieved).filter((x) => !have.has(`${x.citedId}|${x.span}`));
  return { issues: [...llmIssues, ...extra], driver: 'groq' };
}

export async function runCheck(args) {
  if (process.env.GROQ_API_KEY) {
    try {
      return await groqCheck(args);
    } catch (e) {
      console.error('Groq check failed, falling back to mock:', e.message);
      return { ...(await mockCheck(args)), driver: 'mock-fallback' };
    }
  }
  return mockCheck(args);
}
