// Sync observable PR state; closure and missing proposal IDs are not rejection.
import { execFileSync } from 'node:child_process';
import { loadLedger, saveLedger, setStatus, isManual } from './ledger.js';

function viewPr(pr) {
  const gh = process.env.AGENTIC_RETRO_GH || 'gh';
  try {
    const output = execFileSync(gh, ['pr', 'view', pr, '--json', 'state,commits'], { encoding: 'utf8' });
    const view = JSON.parse(output);
    if (!['OPEN', 'CLOSED', 'MERGED'].includes(view?.state) || !Array.isArray(view.commits)) throw new Error('invalid PR response');
    return view;
  } catch (error) {
    console.error(`agentic-retro: could not check ${pr}: ${error.message.split('\n')[0]}`);
    return null;
  }
}

function commitSurvived(view, id) {
  if (!/^P[1-9]\d*$/.test(id)) return false;
  const pattern = new RegExp(`\\b${id}\\b`);
  return view.commits.some((c) => typeof c?.messageHeadline === 'string' && pattern.test(c.messageHeadline));
}

export function syncOutcomes() {
  const ledger = loadLedger();
  const views = new Map();
  for (const p of ledger.proposals) {
    if (isManual(p)) continue;
    if (!p.pr) {
      if (p.status === 'expired') setStatus(p, 'open');
      continue;
    }
    if (!views.has(p.pr)) views.set(p.pr, viewPr(p.pr));
    const view = views.get(p.pr);
    if (!view) {
      if (p.status === 'expired') setStatus(p, 'open');
      continue;
    }
    if (view.state === 'OPEN') {
      // Reopening invalidates closure inference, but never a manual decision.
      if (p.status !== 'open') setStatus(p, 'open');
    } else if (p.decision?.source === 'inferred') {
      // Proposal-specific evidence outranks a surviving commit headline.
      continue;
    } else if (view.state === 'MERGED' && commitSurvived(view, p.id)) {
      if (p.status !== 'accepted') setStatus(p, 'accepted', {
        source: 'sync', reason: 'Proposal ID survives in the merged PR commits.', evidence: [p.pr],
      });
    } else {
      setStatus(p, 'neutral', {
        source: 'sync',
        reason: view.state === 'CLOSED' ? 'PR closed; proposal intent awaits inference.' : 'Merged PR lacks proposal ID; intent awaits inference.',
        evidence: [p.pr],
      });
    }
  }
  saveLedger(ledger);
}
