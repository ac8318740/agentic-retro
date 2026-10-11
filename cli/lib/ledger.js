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

export function setStatus(proposal, status) {
  proposal.status = status;
  proposal.statusAt = new Date().toISOString();
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
  const proposal = ledger.proposals.find((p) => p.id === id);
  if (!proposal) throw new Error(`no proposal ${id}`);
  return proposal;
}

export function mark(id, status) {
  if (!MARKABLE.includes(status)) throw new Error(`status must be accepted or rejected: ${status}`);
  const ledger = loadLedger();
  setStatus(findProposal(ledger, id), status);
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

// Each batch run takes the next number; proposals remember it so they can expire.
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
