// Sync: settle open proposals from their PRs, then expire the stale ones.
import { execFileSync } from 'node:child_process';
import { loadConfig } from './config.js';
import { loadLedger, saveLedger, setStatus } from './ledger.js';

// A failed lookup (network, deleted repo) leaves the proposal open for the next sync.
function viewPr(pr) {
  const gh = process.env.AGENTIC_RETRO_GH || 'gh';
  try {
    const output = execFileSync(gh, ['pr', 'view', pr, '--json', 'state,commits'], { encoding: 'utf8' });
    return JSON.parse(output);
  } catch (error) {
    console.error(`agentic-retro: could not check ${pr}: ${error.message.split('\n')[0]}`);
    return { state: 'OPEN', commits: [] };
  }
}

// Each proposal is its own commit with its ID in the headline, e.g. "P12: shorten the map skill".
function commitSurvived(view, id) {
  const pattern = new RegExp(`\\b${id}\\b`);
  return view.commits.some((c) => pattern.test(c.messageHeadline));
}

function outcome(view, id) {
  if (view.state === 'MERGED') return commitSurvived(view, id) ? 'accepted' : 'rejected';
  if (view.state === 'CLOSED') return 'rejected';
  return 'open';
}

export function syncOutcomes() {
  const ledger = loadLedger();
  const { expireAfterBatches } = loadConfig();
  const open = () => ledger.proposals.filter((p) => p.status === 'open');

  const views = new Map();
  for (const p of open().filter((p) => p.pr)) {
    if (!views.has(p.pr)) views.set(p.pr, viewPr(p.pr));
    const status = outcome(views.get(p.pr), p.id);
    if (status !== 'open') setStatus(p, status);
  }

  for (const p of open().filter((p) => !p.pr)) {
    if (ledger.batchCount - p.batch >= expireAfterBatches) setStatus(p, 'expired');
  }
  saveLedger(ledger);
}
