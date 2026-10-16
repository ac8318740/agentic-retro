// Session-start notice: one line naming the proposals not yet shown.
import { existsSync } from 'node:fs';
import { stateDir, statePath, readJson, writeJson } from './paths.js';
import { loadConfig } from './config.js';
import { listProposals } from './ledger.js';
import { projectEnabled, repoOf } from './project.js';

function linkFor(proposal, output) {
  return output === 'report' ? statePath('reports', `${proposal.batch}.md`) : proposal.pr;
}

// notice.json remembers which open proposals were already shown with their link.
// In PR mode a proposal without a PR stays new, so a later notice can name its PR.
export function noticeLine(cwd = process.cwd()) {
  if (process.env.AGENTIC_RETRO_RUN === '1' || !projectEnabled(cwd) || !existsSync(stateDir())) return '';
  const repo = repoOf(cwd);

  const { output } = loadConfig();
  const { noticed = [] } = readJson('notice.json', {});
  const open = listProposals('open');
  const fresh = open.filter((p) => !noticed.includes(p.id)).filter((p) => repoOf(p.repo) === repo ||
    readJson(`batches/${p.batch}/batch.json`, { sessions: [] }).sessions.some((s) => repoOf(s.cwd, s.repo) === repo));
  if (!fresh.length) return '';

  const shown = open.filter((p) => noticed.includes(p.id) || (fresh.includes(p) && linkFor(p, output)));
  writeJson('notice.json', { noticed: shown.map((p) => p.id) });
  const links = [...new Set(fresh.map((p) => linkFor(p, output)).filter(Boolean))];
  const count = `${fresh.length} new proposal${fresh.length === 1 ? '' : 's'}`;
  if (!links.length) return `agentic-retro: ${count} – ask your agent to review them`;
  return `agentic-retro: ${count}: ${links.join(', ')}`;
}

// A session-start hook must never break the session, so any failure prints nothing.
export function notice({ json, cwd }) {
  let line = '';
  try { line = noticeLine(cwd); } catch {}
  if (!line) return;
  console.log(json ? JSON.stringify({ systemMessage: line }) : line);
}
