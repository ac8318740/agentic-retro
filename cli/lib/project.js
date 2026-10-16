// Repository identity and opt-in live in Git's shared metadata, not in a checkout.
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const options = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] };
const KEY = 'agentic-retro.enabled';

function commonDir(cwd) {
  const path = execFileSync('git', ['-C', cwd, 'rev-parse', '--git-common-dir'], options).replace(/\n$/, '');
  return resolve(cwd, path);
}

export function repoOf(cwd, fallback = cwd) {
  try {
    // Git lists the shared identity first: the main checkout or its separate metadata directory.
    const worktrees = execFileSync('git', ['--git-dir', commonDir(cwd), 'worktree', 'list', '--porcelain', '-z'], options);
    const main = worktrees.split('\0').find((field) => field.startsWith('worktree '));
    return main ? main.slice('worktree '.length) : fallback;
  } catch {
    return fallback;
  }
}

export function projectEnabled(cwd) {
  if (!cwd) return false;
  try {
    // Read only the shared config: global and per-worktree overrides cannot enable a project.
    return execFileSync('git', ['config', '--file', join(commonDir(cwd), 'config'), '--bool', '--get', KEY], options).trim() === 'true';
  } catch {
    return false;
  }
}

export function project(action, cwd = process.cwd()) {
  if (!['enable', 'disable', 'status'].includes(action)) throw new Error('usage: agentic-retro project enable|disable|status [--cwd <dir>]');
  if (action !== 'status') {
    let dir;
    try { dir = commonDir(cwd); } catch { throw new Error('project enable/disable needs a Git repository'); }
    execFileSync('git', ['config', '--file', join(dir, 'config'), KEY, String(action === 'enable')], options);
  }
  console.log(projectEnabled(cwd) ? 'enabled' : 'disabled');
}
