import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULTS } from '../cli/lib/config.js';
import { buildCommand } from '../cli/lib/runner.js';
import { tempDir } from './helpers/cli.js';

// The batch agent edits the repos its sessions ran in, the user's editable paths, and the state folder.
// Each harness must be granted those folders up front, because a headless run cannot ask.
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SESSIONS = [
  { harness: 'claude', sessionId: 's1', transcript: '/t/s1.jsonl', cwd: '/work/alpha/src', repo: '/work/alpha', endedAt: '2026-10-01T10:00:00.000Z' },
  { harness: 'claude', sessionId: 's2', transcript: '/t/s2.jsonl', cwd: '/work/beta', repo: '/work/beta', endedAt: '2026-10-01T11:00:00.000Z' },
  { harness: 'claude', sessionId: 's3', transcript: '/t/s3.jsonl', cwd: '/work/alpha', repo: '/work/alpha', endedAt: '2026-10-01T12:00:00.000Z' },
];
const EDITABLE = ['~/agent-notes', '/opt/shared-skills'];

// The batch manifest sits in the batch folder, as startBatch writes it; the sessions are also passed directly.
function build(runner) {
  const home = tempDir();
  process.env.AGENTIC_RETRO_HOME = home;
  const dir = join(home, 'batches', '7');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'batch.json'), JSON.stringify({ sessions: SESSIONS }));
  const config = { ...DEFAULTS, editable: EDITABLE, runner: { ...DEFAULTS.runner, ...runner } };
  return { home, cmd: buildCommand(config, dir, 7, SESSIONS) };
}

// Every value given to --add-dir, whether the flag repeats or takes several values at once.
function addDirs(args) {
  const dirs = [];
  args.forEach((arg, i) => {
    if (arg !== '--add-dir') return;
    for (let j = i + 1; j < args.length && !args[j].startsWith('-'); j++) dirs.push(args[j]);
  });
  return dirs;
}

const count = (list, item) => list.filter((x) => x === item).length;
const after = (args, flag) => args[args.indexOf(flag) + 1];
const EXPECTED = ['/work/alpha', '/work/beta', join(homedir(), 'agent-notes'), '/opt/shared-skills'];

for (const permissions of ['auto', 'scoped']) {
  test(`codex ${permissions}: adds the state folder, each repo once, and each editable path`, () => {
    const { home, cmd } = build({ harness: 'codex', permissions });
    const dirs = addDirs(cmd.args);
    assert.ok(dirs.includes(home), `state folder in ${dirs}`);
    for (const dir of EXPECTED) assert.equal(count(dirs, dir), 1, `${dir} once in ${dirs}`);
    assert.ok(!dirs.includes('~/agent-notes'), 'editable paths have ~ expanded');
  });

  test(`codex ${permissions}: turns on network access for the workspace-write sandbox`, () => {
    const { cmd } = build({ harness: 'codex', permissions });
    const settings = cmd.args.filter((arg, i) => cmd.args[i - 1] === '-c');
    assert.ok(settings.includes('sandbox_workspace_write.network_access=true'), `${cmd.args}`);
  });
}

test('claude: adds each repo once and each editable path', () => {
  const { cmd } = build({ harness: 'claude', permissions: 'auto' });
  const dirs = addDirs(cmd.args);
  for (const dir of EXPECTED) assert.equal(count(dirs, dir), 1, `${dir} once in ${dirs}`);
  assert.ok(!dirs.includes('~/agent-notes'), 'editable paths have ~ expanded');
});

test('pi: loads the run skill shipped inside the package', () => {
  const { cmd } = build({ harness: 'pi' });
  const skill = after(cmd.args, '--skill');
  assert.ok(cmd.args.includes('--skill'), `${cmd.args}`);
  assert.equal(skill, join(PACKAGE_ROOT, 'skills', 'run'));
  assert.ok(existsSync(join(skill, 'SKILL.md')), 'the run skill folder exists');
});

test('package.json ships the skills folder', () => {
  const { files } = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  assert.ok(files.some((f) => f.replace(/\/$/, '') === 'skills'), `files: ${files}`);
});
