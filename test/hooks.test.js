import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir, run, readState } from './helpers/cli.js';

// Claude Code and Codex share one hooks/hooks.json, so the SessionEnd hook passes no
// --harness. `enqueue` infers the harness from the hook JSON on stdin instead.

const HOOKS = join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks');

function hookEnqueue(home, payload, env = {}) {
  return run(home, ['enqueue'], { input: JSON.stringify(payload), env });
}

function endPayload(sessionId, transcriptPath, cwd) {
  return { cwd, hook_event_name: 'SessionEnd', reason: 'other', session_id: sessionId, transcript_path: transcriptPath };
}

function queued(home) {
  return readState(home, 'queue.json') ?? [];
}

const inferCases = [
  ['claude', '/home/u/.claude/projects/-home-u-app/c1.jsonl'],
  ['codex', '/home/u/.codex/sessions/2026/10/10/rollout-2026-10-10T17-20-44-c1.jsonl'],
  ['codex', '/elsewhere/rollout-2026-10-10T17-20-44-c1.jsonl'],
  ['pi', '/home/u/.pi/agent/sessions/app/c1.jsonl'],
];

for (const [harness, transcript] of inferCases) {
  test(`enqueue without --harness infers ${harness} from ${transcript}`, () => {
    const home = tempDir();
    const { code, stderr } = hookEnqueue(home, endPayload('c1', transcript, tempDir()));
    assert.equal(code, 0, stderr);
    const [entry] = queued(home);
    assert.equal(entry.harness, harness);
    assert.equal(entry.transcript, transcript);
  });
}

test('a null transcript_path is found under $CODEX_HOME/sessions and recorded as codex', () => {
  const home = tempDir();
  const codexHome = tempDir('agentic-retro-codex-');
  const day = join(codexHome, 'sessions', '2026', '10', '10');
  mkdirSync(day, { recursive: true });
  const rollout = join(day, 'rollout-2026-10-10T17-20-44-abc-123.jsonl');
  writeFileSync(rollout, '{}\n');
  writeFileSync(join(day, 'rollout-2026-10-10T09-00-00-other.jsonl'), '{}\n');

  const { code, stderr } = hookEnqueue(home, endPayload('abc-123', null, tempDir()), { CODEX_HOME: codexHome });
  assert.equal(code, 0, stderr);
  const [entry] = queued(home);
  assert.equal(entry.sessionId, 'abc-123');
  assert.equal(entry.harness, 'codex');
  assert.equal(entry.transcript, rollout);
});

test('a null transcript_path with no matching rollout still queues the session', () => {
  const home = tempDir();
  const codexHome = tempDir('agentic-retro-codex-');
  const { code, stderr } = hookEnqueue(home, endPayload('lost-1', null, tempDir()), { CODEX_HOME: codexHome });
  assert.equal(code, 0, stderr);
  const [entry] = queued(home);
  assert.equal(entry.sessionId, 'lost-1');
  assert.equal(entry.transcript, null);
});

test('hooks.json SessionEnd runs enqueue with no --harness and SessionStart runs notice --json', () => {
  const { hooks } = JSON.parse(readFileSync(join(HOOKS, 'hooks.json'), 'utf8'));
  const command = (event) => hooks[event][0].hooks[0].command;

  const end = command('SessionEnd');
  assert.match(end, /run\.sh"? enqueue\b/);
  assert.doesNotMatch(end, /--harness/);

  assert.match(command('SessionStart'), /run\.sh"? notice --json\b/);
});

test('install-pi writes the Pi extension and is idempotent', () => {
  const home = tempDir();
  const piHome = tempDir('agentic-retro-pi-');
  const file = join(piHome, 'agent', 'extensions', 'agentic-retro.ts');

  const first = run(home, ['install-pi'], { env: { PI_HOME: piHome } });
  assert.equal(first.code, 0, first.stderr);
  assert.ok(existsSync(file), 'extension file exists');
  const content = readFileSync(file, 'utf8');

  for (const needle of ['session_shutdown', 'session_start', 'AGENTIC_RETRO_RUN', 'agentic-retro', 'enqueue', 'notice']) {
    assert.ok(content.includes(needle), `extension mentions ${needle}`);
  }

  const second = run(home, ['install-pi'], { env: { PI_HOME: piHome } });
  assert.equal(second.code, 0, second.stderr);
  assert.equal(readFileSync(file, 'utf8'), content);
});

test('run.sh exits 0 and prints the install hint when the CLI is not on PATH', () => {
  const result = spawnSync('/bin/bash', [join(HOOKS, 'run.sh'), 'enqueue'], {
    input: JSON.stringify(endPayload('s1', '/t/s1.jsonl', '/tmp')),
    encoding: 'utf8',
    env: { PATH: '/usr/bin:/bin', HOME: tempDir() },
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /npm install -g agentic-retro/);
});
