// Builds the command that starts the batch agent in each harness.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stateDir } from './paths.js';

const ENV = { AGENTIC_RETRO_RUN: '1' };
const SCOPED_TOOLS = 'Bash(git:*),Bash(gh:*),Bash(agentic-retro:*)';
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PANE_ID = '<pane_id>';

const prompt = (n) => `Use the agentic-retro run skill on batch ${n} in this folder.`;
// opus is a Claude model name, not a codex/pi one, so for those harnesses treat it like
// "default" (no flag) rather than passing it through unrecognized. Claude keeps it as-is.
const modelFlag = (flag, model, isClaude = false) =>
  (model === 'default' || (!isClaude && model === 'opus') ? [] : [flag, model]);
const expandHome = (path) => (path === '~' || path.startsWith('~/') ? join(homedir(), path.slice(1)) : path);

const claudePermissions = {
  auto: ['--permission-mode', 'auto'],
  scoped: ['--permission-mode', 'acceptEdits', '--allowedTools', SCOPED_TOOLS],
  bypass: ['--permission-mode', 'bypassPermissions'],
};

const codexPermissions = {
  auto: ['-s', 'workspace-write', '--approve-for-me'],
  scoped: ['-s', 'workspace-write'],
  bypass: ['--dangerously-bypass-approvals-and-sandbox'],
};

// The batch agent edits the sessions' repos and the user's editable paths.
// A headless run cannot ask for access, so each folder is granted up front.
function sessionsOf(batchDir) {
  const manifest = join(batchDir, 'batch.json');
  return existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')).sessions : [];
}

function workDirs(config, sessions) {
  const editable = (config.editable ?? []).map((path) => {
    path = expandHome(path);
    try {
      return statSync(path).isFile() ? dirname(path) : path;
    } catch {
      return path;
    }
  });
  const paths = [...sessions.flatMap((s) => [s.repo, s.cwd]), ...editable];
  return [...new Set(paths.filter(Boolean))];
}

const addDirs = (dirs) => dirs.flatMap((dir) => ['--add-dir', dir]);

// The prompt sits right after -p: --allowedTools and --add-dir take variadic lists that would swallow a later prompt.
function claudeArgs({ model, permissions }, n, dirs) {
  return ['-p', prompt(n), ...modelFlag('--model', model, true), ...claudePermissions[permissions], ...addDirs(dirs)];
}

// Codex's sandbox blocks the network by default, and the run skill needs gh.
function codexArgs({ model, permissions }, n, dirs, batchDir) {
  const network = permissions === 'bypass' ? [] : ['-c', 'sandbox_workspace_write.network_access=true'];
  return ['exec', '-c', 'shell_environment_policy.inherit=all', ...network, ...modelFlag('-m', model),
    ...codexPermissions[permissions], ...addDirs([stateDir(), ...dirs]), '--skip-git-repo-check', '-C', batchDir, prompt(n)];
}

// Pi never asks before a tool call, so every permissions mode runs the same way.
// Pi has no plugin install, so it loads the run skill from this package.
function piArgs({ model }, n) {
  return ['-p', ...modelFlag('--model', model), '--skill', join(PACKAGE_ROOT, 'skills', 'run'), prompt(n)];
}

const shellQuote = (arg) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`);

// herdr types the command into a new pane's shell, so it gets one quoted string (see #11).
function herdrSteps(runner, dir, n, dirs) {
  const line = ['claude', ...claudeArgs(runner, n, dirs)].map(shellQuote).join(' ');
  return [
    { file: 'herdr', args: ['workspace', 'create', '--cwd', dir, '--env', 'AGENTIC_RETRO_RUN=1', '--no-focus'], env: ENV, cwd: dir },
    { file: 'herdr', args: ['pane', 'run', PANE_ID, line], env: ENV, cwd: dir },
  ];
}

const harnesses = {
  claude: (runner, n, dirs) => ({ file: 'claude', args: claudeArgs(runner, n, dirs) }),
  codex: (runner, n, dirs, batchDir) => ({ file: 'codex', args: codexArgs(runner, n, dirs, batchDir) }),
  pi: (runner, n) => ({ file: 'pi', args: piArgs(runner, n) }),
};

// Returns { file, args, env, cwd }, or for herdr a list of such steps.
export function buildCommand(config, batchDir, n, sessions = sessionsOf(batchDir)) {
  const runner = { permissions: 'auto', ...config.runner };
  const dirs = workDirs(config, sessions);
  if (runner.harness === 'herdr') return herdrSteps(runner, batchDir, n, dirs);
  const build = harnesses[runner.harness];
  if (!build) throw new Error(`unknown runner.harness: ${runner.harness}`);
  return { ...build(runner, n, dirs, batchDir), env: ENV, cwd: batchDir };
}
