// Session-start notice: one line naming the proposals not yet shown.
import { existsSync, readdirSync } from 'node:fs';
import { stateDir, statePath, readJson, writeJson } from './paths.js';
import { loadConfig } from './config.js';
import { listProposals } from './ledger.js';
import { projectEnabled, repoOf } from './project.js';

function linkFor(proposal, output) {
  return output === 'report' ? statePath('reports', `${proposal.batch}.md`) : proposal.pr;
}

function freshReviews(repo, reviewed) {
  const dir = statePath('batches');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => /^\d+$/.test(n)).flatMap((n) => {
    const status = readJson(`batches/${n}/status.json`, {});
    if (!['completed', 'failed', 'incomplete'].includes(status.status) || !status.attempt) return [];
    const key = JSON.stringify([repo, n, status.attempt, status.status]);
    if (reviewed.includes(key)) return [];
    const batch = readJson(`batches/${n}/batch.json`, { sessions: [] });
    if (!batch.sessions.some((s) => repoOf(s.cwd, s.repo) === repo)) return [];
    return [{ key, batch: Number(n), status: status.status }];
  });
}

// notice.json remembers which open proposals were already shown with their link.
// In PR mode a proposal without a PR stays new, so a later notice can name its PR.
export function noticeLine(cwd = process.cwd()) {
  if (process.env.AGENTIC_RETRO_RUN === '1' || !projectEnabled(cwd) || !existsSync(stateDir())) return '';
  const repo = repoOf(cwd);

  const { output } = loadConfig();
  const { noticed = [], reviewed = [] } = readJson('notice.json', {});
  const reviews = freshReviews(repo, reviewed);
  const open = listProposals('open');
  const fresh = open.filter((p) => !noticed.includes(p.id)).filter((p) => repoOf(p.repo) === repo ||
    readJson(`batches/${p.batch}/batch.json`, { sessions: [] }).sessions.some((s) => repoOf(s.cwd, s.repo) === repo));
  if (!fresh.length && !reviews.length) return '';

  const shown = open.filter((p) => noticed.includes(p.id) || (fresh.includes(p) && linkFor(p, output)));
  writeJson('notice.json', { noticed: shown.map((p) => p.id), reviewed: [...reviewed, ...reviews.map((r) => r.key)] });
  const links = [...new Set(fresh.map((p) => linkFor(p, output)).filter(Boolean))];
  const parts = [];
  const failed = reviews.filter((r) => r.status === 'failed').length;
  const incomplete = reviews.filter((r) => r.status === 'incomplete').length;
  if (failed || incomplete) parts.push(`ATTENTION: ${failed} failed, ${incomplete} incomplete reviews (inspect batch status and run.log)`);
  const completed = reviews.filter((r) => r.status === 'completed');
  if (completed.length) {
    const proposals = listProposals().filter((p) => completed.some((r) => r.batch === p.batch));
    parts.push(`${completed.length} completed review${completed.length === 1 ? '' : 's'}${proposals.length ? '' : ', no proposals'}`);
  }
  if (fresh.length) {
    const count = `${fresh.length} new proposal${fresh.length === 1 ? '' : 's'}`;
    parts.push(links.length ? `${count}: ${links.join(', ')}` : `${count} – ask your agent to review them`);
  }
  return `agentic-retro: ${parts.join('; ')}`;
}

// A session-start hook must never break the session, so any failure prints nothing.
export function notice({ json, cwd }) {
  let line = '';
  try { line = noticeLine(cwd); } catch {}
  if (!line) return;
  console.log(json ? JSON.stringify({ systemMessage: line }) : line);
}
