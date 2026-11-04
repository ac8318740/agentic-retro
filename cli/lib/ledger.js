// The ledger: every proposal a batch agent makes, and what became of it.
import { readJson, writeJson } from './paths.js';

export const CATEGORIES = ['clarity', 'agent-setup', 'repo-for-agents'];
const RISKS = ['low', 'high'];
const MARKABLE = ['accepted', 'rejected'];

export function loadLedger() {
  return readJson('ledger.json', { nextId: 1, batchCount: 0, proposals: [] });
}

export function saveLedger(ledger) {
  writeJson('ledger.json', ledger);
}

export function setStatus(proposal, status, decision) {
  if (proposal.status === status && JSON.stringify(proposal.decision) === JSON.stringify(decision)) return;
  proposal.status = status;
  proposal.statusAt = new Date().toISOString();
  if (decision) proposal.decision = decision;
  else delete proposal.decision;
}

// Legacy settled entries have no provenance; preserve them as explicit decisions.
export function isManual(proposal) {
  return proposal.decision?.source === 'manual' ||
    (!proposal.decision && MARKABLE.includes(proposal.status));
}

export function propose({ repo, category, risk, title, pr, commit }) {
  if (!repo || !title) throw new Error('propose needs --repo and --title');
  if (!CATEGORIES.includes(category)) throw new Error(`unknown category: ${category}`);
  if (risk && category !== 'agent-setup') throw new Error('only agent-setup proposals carry a risk');
  if (risk && !RISKS.includes(risk)) throw new Error(`risk must be low or high: ${risk}`);

  const ledger = loadLedger();
  const id = `P${ledger.nextId++}`;
  ledger.proposals.push({
    id, batch: ledger.batchCount, repo, category, risk: risk ?? null, title, status: 'open',
    createdAt: new Date().toISOString(), statusAt: null, pr: pr ?? null, commit: commit ?? null,
  });
  saveLedger(ledger);
  return id;
}

function findProposal(ledger, id) {
  if (typeof id !== 'string' || !/^P[1-9]\d*$/.test(id)) throw new Error(`invalid proposal id: ${id}`);
  const proposal = ledger.proposals.find((p) => p.id === id);
  if (!proposal) throw new Error(`no proposal ${id}`);
  return proposal;
}

export function mark(id, status) {
  if (!MARKABLE.includes(status)) throw new Error(`status must be accepted or rejected: ${status}`);
  const ledger = loadLedger();
  setStatus(findProposal(ledger, id), status, { source: 'manual' });
  saveLedger(ledger);
}

// The batch agent supplies its interpretation, not an independent human verdict.
export function resolve(id, status, { reason, evidence }) {
  if (!['accepted', 'rejected', 'neutral'].includes(status)) throw new Error('status must be accepted, rejected, or neutral');
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 4000 || /[\x00-\x1f\x7f]/.test(reason)) {
    throw new Error('reason must be nonempty text (at most 4000 characters, no control characters)');
  }
  if (!Array.isArray(evidence) || !evidence.length || evidence.length > 20) throw new Error('provide 1 to 20 --evidence URLs');
  for (const value of evidence) {
    let url;
    try { url = new URL(value); } catch { throw new Error('evidence must be an HTTPS source URL'); }
    if (typeof value !== 'string' || value.length > 2048 || /[\s\x00-\x1f\x7f]/.test(value) || !value.startsWith('https://') || url.protocol !== 'https:' || url.username || url.password) {
      throw new Error('evidence must be an HTTPS source URL without credentials or whitespace');
    }
  }
  const ledger = loadLedger();
  const proposal = findProposal(ledger, id);
  if (isManual(proposal)) throw new Error(`manual decision for ${id} cannot be overridden by inference`);
  setStatus(proposal, status, { source: 'inferred', reason: reason.trim(), evidence: [...new Set(evidence)].sort() });
  saveLedger(ledger);
}

// The run skill links a proposal to its PR and commit once they exist.
export function link(id, { pr, commit }) {
  const ledger = loadLedger();
  const proposal = findProposal(ledger, id);
  if (pr) proposal.pr = pr;
  if (commit) proposal.commit = commit;
  saveLedger(ledger);
}

// Each batch run takes the next number; proposals retain their batch as provenance.
export function nextBatch() {
  const ledger = loadLedger();
  ledger.batchCount += 1;
  saveLedger(ledger);
  return ledger.batchCount;
}

// status may be a comma list, e.g. "rejected,expired".
export function listProposals(status) {
  const { proposals } = loadLedger();
  if (!status) return proposals;
  const wanted = status.split(',');
  return proposals.filter((p) => wanted.includes(p.status));
}

export function formatProposal(p) {
  const risk = p.risk ? ` (${p.risk} risk)` : '';
  return `${p.id}  ${p.status}  ${p.category}${risk}  ${p.title}  [${p.repo}]`;
}
