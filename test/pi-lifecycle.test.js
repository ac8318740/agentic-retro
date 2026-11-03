import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir, run, readState, enabledRepo } from './helpers/cli.js';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'cli', 'agentic-retro.js');
const cleanEnv = { AC_TEAMS_ACCESS: '', AC_TEAMS_MEMBER: '', AC_TEAMS_SOCKET: '', AC_TEAMS_TOKEN: '', PI_SUBAGENT_CHILD: '', PI_SUBAGENTS_HERDR_BRIDGE: '', AGENTIC_RETRO_ATTEMPT: '' };

function fixture(source) {
  const home = tempDir();
  const cwd = enabledRepo();
  writeFileSync(join(home, 'config.json'), JSON.stringify({ batch: { size: 1 }, runner: { harness: 'pi', model: 'default' } }));
  const launcher = join(home, 'fake-agent.cjs');
  writeFileSync(launcher, `#!/usr/bin/env node\n${source}\n`);
  chmodSync(launcher, 0o755);
  const env = { ...cleanEnv, AGENTIC_RETRO_DRY_RUN: '', AGENTIC_RETRO_LAUNCHER: launcher, TEST_RETRO_CLI: CLI };
  const call = (args, extra = {}) => run(home, args, { env: { ...env, ...extra } });
  const enqueue = (extra = {}) => call(['enqueue', '--harness', 'claude', '--session', 'original', '--transcript', '/missing-test-transcript.jsonl', '--cwd', cwd], extra);
  return { home, cwd, launcher, env, call, enqueue };
}

async function status(f, terminal = true) {
  let last;
  for (const end = Date.now() + 5000; Date.now() < end;) {
    const result = f.call(['batch', 'status', '1', '--json']);
    if (result.code === 0) {
      try { last = JSON.parse(result.stdout); } catch {}
      if (last && (!terminal || ['failed', 'incomplete', 'completed'].includes(last.status))) return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  assert.fail(`no ${terminal ? 'terminal' : 'readable'} batch status: ${JSON.stringify(last)}`);
}

const finish = `const { spawnSync } = require('node:child_process');
const result = spawnSync(process.execPath, [process.env.TEST_RETRO_CLI, 'batch', 'finish', '1', '--summary', 'No findings in synthetic fixture.'], { env: process.env, encoding: 'utf8' });
if (result.status !== 0) { console.error(result.stderr); process.exit(93); }`;

test('Pi detached ENOENT is failed and leaves a retryable manifest and queue', async () => {
  const f = fixture('process.exit(0);');
  f.enqueue({ AGENTIC_RETRO_LAUNCHER: join(f.home, 'not-installed') });
  const result = await status(f);
  assert.equal(result.status, 'failed');
  assert.match(result.error ?? '', /ENOENT|not-installed|spawn/i);
  assert.ok(existsSync(join(f.home, 'batches', '1', 'batch.json')));
  assert.deepEqual(readState(f.home, 'queue.json').map((s) => s.sessionId), ['original']);
});

test('Pi /bin/false actually launches and records nonzero exit, not manifest failure', async () => {
  const f = fixture('');
  f.enqueue({ AGENTIC_RETRO_LAUNCHER: '/bin/false' });
  const result = await status(f);
  assert.equal(result.status, 'failed');
  assert.equal(result.exitCode, 1);
  assert.ok(existsSync(join(f.home, 'batches', '1', 'batch.json')));
});

test('Pi exit zero without explicit finish is incomplete, never completed', async () => {
  const f = fixture("console.log('workflow completed'); process.exit(0);");
  assert.equal(f.enqueue().code, 0);
  const result = await status(f);
  assert.equal(result.status, 'incomplete');
  assert.equal(result.exitCode, 0);
});

test('Pi explicit finish only completes after the launched process exits zero', async () => {
  const f = fixture(`${finish}\nsetTimeout(() => { require('node:fs').writeFileSync('settled', 'yes'); }, 300);`);
  assert.equal(f.enqueue().code, 0);
  const result = await status(f);
  assert.equal(result.status, 'completed');
  assert.equal(result.exitCode, 0);
  assert.ok(existsSync(join(f.home, 'batches', '1', 'settled')), 'child asynchronous work settled before completion');
});

test('Pi explicit finish followed by nonzero exit is failed', async () => {
  const f = fixture(`${finish}\nprocess.exit(7);`);
  f.enqueue();
  const result = await status(f);
  assert.equal(result.status, 'failed');
  assert.equal(result.exitCode, 7);
});

test('Pi finish rejects missing/stale attempts and empty summaries', async () => {
  const f = fixture(`const { spawnSync } = require('node:child_process');
for (const [attempt, summary] of [['', 'not authorized'], ['stale-attempt', 'not authorized'], [process.env.AGENTIC_RETRO_ATTEMPT, '']]) {
  const result = spawnSync(process.execPath, [process.env.TEST_RETRO_CLI, 'batch', 'finish', '1', '--summary', summary], { env: { ...process.env, AGENTIC_RETRO_ATTEMPT: attempt }, encoding: 'utf8' });
  if (result.status === 0) process.exit(94);
}
`);
  f.enqueue();
  const result = await status(f);
  assert.equal(result.status, 'incomplete');
  assert.equal(result.exitCode, 0, 'all unauthorized finish calls were rejected');
});

test('Pi retry uses the preserved manifest and batch ID, removes only its queued sessions', async () => {
  const f = fixture('process.exit(0);');
  f.enqueue({ AGENTIC_RETRO_LAUNCHER: join(f.home, 'not-installed') });
  const first = await status(f);
  const path = join(f.home, 'batches', '1', 'batch.json');
  const before = readFileSync(path, 'utf8');
  const original = readState(f.home, 'queue.json')[0];
  writeFileSync(join(f.home, 'queue.json'), JSON.stringify([original, { ...original, sessionId: 'unrelated' }]));
  writeFileSync(f.launcher, `#!/usr/bin/env node\n${finish}\n`);
  const retry = f.call(['batch', 'retry', '1']);
  assert.equal(retry.code, 0, retry.stderr);
  assert.match(retry.stdout + retry.stderr, /partial|proposal|ledger|side.effect/i, 'warns about previous side effects');
  const result = await status(f);
  assert.equal(result.status, 'completed');
  assert.notEqual(result.attempt, first.attempt);
  assert.equal(readFileSync(path, 'utf8'), before);
  assert.equal(readState(f.home, 'ledger.json').batchCount, 1);
  assert.deepEqual(readState(f.home, 'queue.json').map((s) => s.sessionId), ['unrelated']);
  assert.ok(!existsSync(join(f.home, 'batches', '2')));
  assert.notEqual(f.call(['batch', 'retry', '1']).code, 0, 'completed batch cannot retry');
});

test('Pi active batch refuses retry, including explicit stale recovery', async () => {
  const f = fixture('setTimeout(() => {}, 1200);');
  f.enqueue();
  const first = await status(f, false);
  assert.equal(first.status, 'running');
  assert.notEqual(f.call(['batch', 'retry', '1']).code, 0);
  assert.notEqual(f.call(['batch', 'retry', '1', '--recover-stale']).code, 0);
  assert.equal((await status(f)).attempt, first.attempt);
});

test('Pi post-spawn child error retains live ownership until observed close', async () => {
  const f = fixture(`const fs = require('node:fs');
const timer = setInterval(() => { if (fs.existsSync('release-child')) { clearInterval(timer); clearTimeout(timeout); } }, 20);
const timeout = setTimeout(() => { clearInterval(timer); }, 10000);`);
  const dir = join(f.home, 'batches', '1');
  const preload = join(f.home, 'post-spawn-error.cjs');
  writeFileSync(preload, `if (process.argv[1]?.endsWith('/pi-runner.js')) {
  const cp = require('node:child_process');
  const original = cp.spawn;
  cp.spawn = (...args) => {
    const child = original(...args);
    child.once('spawn', () => setImmediate(() => {
      for (let i = 0; i < 2; i++) child.emit('error', Object.assign(new Error('synthetic kill EPERM'), { code: 'EPERM' }));
      require('node:fs').writeFileSync(require('node:path').join(process.env.AGENTIC_RETRO_HOME, 'injected-error'), String(child.pid));
    }));
    return child;
  };
  require('node:module').syncBuiltinESMExports();
}\n`);
  try {
    f.enqueue({ NODE_OPTIONS: `--require=${preload}` });
    const marker = join(f.home, 'injected-error');
    for (const end = Date.now() + 5000; !existsSync(marker) && Date.now() < end;) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.ok(existsSync(marker), 'supervisor emitted a controlled error after actual spawn');
    const childPid = Number(readFileSync(marker, 'utf8'));
    assert.doesNotThrow(() => process.kill(childPid, 0), 'fake child is still alive');
    const record = await status(f, false);
    assert.equal(record.status, 'running', 'post-spawn error cannot declare a live child safely failed');
    assert.ok(existsSync(join(dir, 'run.lock')));
    assert.notEqual(f.call(['batch', 'retry', '1']).code, 0);
    assert.notEqual(f.call(['batch', 'retry', '1', '--recover-stale']).code, 0);
  } finally {
    if (existsSync(dir)) writeFileSync(join(dir, 'release-child'), 'exit now');
  }
  assert.equal((await status(f)).status, 'incomplete', 'only observed close settles the child');
});

test('Pi concurrent retries create only one replacement attempt and launch', async () => {
  const f = fixture('process.exit(0);');
  f.enqueue({ AGENTIC_RETRO_LAUNCHER: join(f.home, 'not-installed') });
  const first = await status(f);
  writeFileSync(f.launcher, `#!/usr/bin/env node\nrequire('node:fs').appendFileSync('launch-count', 'launched\\n');\nsetTimeout(() => {}, 1000);\n`);
  const retry = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, 'batch', 'retry', '1'], { env: { ...process.env, ...f.env, AGENTIC_RETRO_HOME: f.home }, stdio: 'ignore' });
    child.once('error', reject);
    child.once('close', resolve);
  });
  const results = await Promise.all([retry(), retry()]);
  assert.equal(results.filter((code) => code === 0).length, 1, `exactly one retry owns the attempt: ${results}`);
  const result = await status(f);
  assert.notEqual(result.attempt, first.attempt);
  assert.equal(result.status, 'incomplete');
  assert.equal(readFileSync(join(f.home, 'batches', '1', 'launch-count'), 'utf8'), 'launched\n');
});

test('Pi stale supervisor recovery requires explicit opt-in and definitively dead processes', async () => {
  const f = fixture('process.exit(0);');
  f.enqueue();
  const first = await status(f);
  const deadPid = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
    child.once('error', reject);
    child.once('close', () => resolve(child.pid));
  });
  const dir = join(f.home, 'batches', '1');
  const manifest = readFileSync(join(dir, 'batch.json'), 'utf8');
  writeFileSync(join(dir, 'status.json'), JSON.stringify({ ...first, status: 'running', supervisorPid: deadPid, childPid: deadPid }));
  mkdirSync(join(dir, 'run.lock'), { recursive: true });
  writeFileSync(join(dir, 'run.lock', 'owner.json'), JSON.stringify({ attempt: first.attempt, pid: deadPid }));
  assert.notEqual(f.call(['batch', 'retry', '1']).code, 0, 'stale state is never retried implicitly');
  const result = f.call(['batch', 'retry', '1', '--recover-stale']);
  assert.equal(result.code, 0, result.stderr);
  const recovered = await status(f);
  assert.equal(recovered.status, 'incomplete');
  assert.notEqual(recovered.attempt, first.attempt);
  assert.equal(readFileSync(join(dir, 'batch.json'), 'utf8'), manifest);
  assert.equal(readState(f.home, 'ledger.json').batchCount, 1);
});

async function terminalLock(terminal = 'incomplete') {
  const f = fixture('process.exit(0);');
  f.enqueue();
  const first = await status(f);
  const deadPid = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
    child.once('error', reject);
    child.once('close', () => resolve(child.pid));
  });
  const dir = join(f.home, 'batches', '1');
  const record = { ...first, status: terminal, supervisorPid: deadPid, childPid: deadPid };
  writeFileSync(join(dir, 'status.json'), JSON.stringify(record));
  mkdirSync(join(dir, 'run.lock'), { recursive: true });
  writeFileSync(join(dir, 'run.lock', 'owner.json'), JSON.stringify({ attempt: first.attempt, pid: deadPid }));
  return { ...f, dir, record };
}

for (const terminal of ['failed', 'incomplete']) {
  test(`Pi ${terminal} stale terminal lock requires explicit recovery of confirmed dead owners`, async () => {
    const f = await terminalLock(terminal);
    const manifest = readFileSync(join(f.dir, 'batch.json'), 'utf8');
    assert.notEqual(f.call(['batch', 'retry', '1']).code, 0);
    const retry = f.call(['batch', 'retry', '1', '--recover-stale']);
    assert.equal(retry.code, 0, retry.stderr);
    const recovered = await status(f);
    assert.equal(recovered.status, 'incomplete');
    assert.notEqual(recovered.attempt, f.record.attempt);
    assert.equal(readFileSync(join(f.dir, 'batch.json'), 'utf8'), manifest);
    assert.equal(readState(f.home, 'ledger.json').batchCount, 1);
  });
}

for (const ownership of ['live supervisor', 'live child', 'missing child', 'mismatched attempt', 'completed']) {
  test(`Pi stale terminal lock refuses ${ownership}`, async () => {
    const f = await terminalLock(ownership === 'completed' ? 'completed' : 'failed');
    if (ownership === 'live supervisor') f.record.supervisorPid = process.pid;
    if (ownership === 'live child') f.record.childPid = process.pid;
    if (ownership === 'missing child') delete f.record.childPid;
    writeFileSync(join(f.dir, 'status.json'), JSON.stringify(f.record));
    if (ownership === 'mismatched attempt') writeFileSync(join(f.dir, 'run.lock', 'owner.json'), JSON.stringify({ attempt: 'unrelated-attempt', pid: f.record.supervisorPid }));
    assert.notEqual(f.call(['batch', 'retry', '1', '--recover-stale']).code, 0);
    assert.equal((await status(f, false)).attempt, f.record.attempt);
    assert.ok(existsSync(join(f.dir, 'run.lock')));
  });
}

test('Pi concurrent stale terminal-lock recoveries launch exactly one replacement', async () => {
  const f = await terminalLock();
  writeFileSync(f.launcher, `#!/usr/bin/env node\nrequire('node:fs').appendFileSync('launch-count', 'launched\\n');\nsetTimeout(() => {}, 1000);\n`);
  const retry = () => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, 'batch', 'retry', '1', '--recover-stale'], { env: { ...process.env, ...f.env, AGENTIC_RETRO_HOME: f.home }, stdio: 'ignore' });
    child.once('error', reject);
    child.once('close', resolve);
  });
  const results = await Promise.all([retry(), retry()]);
  assert.equal(results.filter((code) => code === 0).length, 1, `exactly one stale recovery owns the attempt: ${results}`);
  assert.equal((await status(f)).status, 'incomplete');
  assert.equal(readFileSync(join(f.dir, 'launch-count'), 'utf8'), 'launched\n');
});

test('Pi stale recovery refuses ambiguous supervisor ownership', async () => {
  const f = fixture('process.exit(0);');
  f.enqueue();
  const first = await status(f);
  writeFileSync(join(f.home, 'batches', '1', 'status.json'), JSON.stringify({ ...first, status: 'running', supervisorPid: null }));
  const result = f.call(['batch', 'retry', '1', '--recover-stale']);
  assert.notEqual(result.code, 0);
  assert.match(result.stdout + result.stderr, /ownership|refus|determine/i);
  assert.equal((await status(f, false)).attempt, first.attempt);
});

test('Pi dead supervisor with missing child PID refuses stale recovery', async () => {
  const f = fixture('process.exit(0);');
  f.enqueue();
  const first = await status(f);
  const deadPid = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
    child.once('error', reject);
    child.once('close', () => resolve(child.pid));
  });
  const record = { ...first, status: 'running', supervisorPid: deadPid };
  delete record.childPid;
  writeFileSync(join(f.home, 'batches', '1', 'status.json'), JSON.stringify(record));
  const result = f.call(['batch', 'retry', '1', '--recover-stale']);
  assert.notEqual(result.code, 0);
  assert.match(result.stdout + result.stderr, /child.*(?:ownership|unknown)|ownership.*unknown/i);
  assert.equal((await status(f, false)).attempt, first.attempt);
});

test('Pi supervisor exit before launch acknowledgement preserves uncertain status, lock, and queue', async () => {
  const f = fixture("require('node:fs').writeFileSync('unexpected-launch', 'yes');");
  const preload = join(f.home, 'exit-supervisor.cjs');
  writeFileSync(preload, "if (process.argv[1]?.endsWith('/pi-runner.js')) process.exit(88);\n");
  const result = f.enqueue({ NODE_OPTIONS: `--require=${preload}` });
  assert.match(result.stdout + result.stderr, /acknowledgement|supervisor/i);
  const record = await status(f, false);
  assert.ok(['starting', 'running'].includes(record.status), 'lost acknowledgement must not imply a safely retryable failure');
  const dir = join(f.home, 'batches', '1');
  assert.ok(existsSync(join(dir, 'run.lock')));
  assert.deepEqual(readState(f.home, 'queue.json').map((s) => s.sessionId), ['original']);
  assert.notEqual(f.call(['batch', 'retry', '1', '--recover-stale']).code, 0);
  assert.ok(!existsSync(join(dir, 'unexpected-launch')));
});

test('Pi legacy manifest is unverified and cannot silently retry', () => {
  const f = fixture('process.exit(0);');
  f.enqueue({ AGENTIC_RETRO_DRY_RUN: '1' });
  const result = f.call(['batch', 'status', '1', '--json']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, 'unverified');
  assert.notEqual(f.call(['batch', 'retry', '1']).code, 0);
});

for (const access of ['{"enforced":true}', '{invalid-json']) {
  test(`Pi enforced or malformed restrictions refuse launch (${access})`, () => {
    const f = fixture("require('node:fs').writeFileSync('unexpected-launch', 'yes');");
    const result = f.enqueue({ AC_TEAMS_ACCESS: access });
    assert.match(result.stderr + result.stdout, /sandbox|enforced|access|restriction/i);
    assert.deepEqual(readState(f.home, 'queue.json').map((s) => s.sessionId), ['original']);
    assert.ok(!existsSync(join(f.home, 'batches', '1', 'unexpected-launch')));
  });
}

test('Pi launched environment strips identity, preserves unknown restrictions and credentials', async () => {
  const f = fixture("require('node:fs').writeFileSync('env.json', JSON.stringify(process.env));");
  const identities = ['AC_TEAMS_SOCKET', 'AC_TEAMS_MEMBER', 'AC_TEAMS_TOKEN', 'AC_TEAMS_TERMINAL_SOCKET', 'ACSTACK_AGENT_ROLE', 'PI_SUBAGENT_CHILD', 'PI_SUBAGENTS_HERDR_BRIDGE', 'PI_SESSION_ID', 'PI_SESSION_FILE', 'HERDR_ENV'];
  const preserved = { AC_TEAMS_ACCESS: '{"enforced":false,"read":["/fixture"]}', TEST_UNKNOWN_RESTRICTION: 'keep', PI_CODING_AGENT_DIR: join(f.home, 'pi'), HTTP_PROXY: 'http://127.0.0.1:12345', BILI_UPSTREAM_PROXY: 'test-proxy', TEST_PROVIDER_KEY: 'synthetic-key' };
  f.enqueue({ ...Object.fromEntries(identities.map((key) => [key, '1'])), ...preserved });
  assert.equal((await status(f)).status, 'incomplete');
  const env = readState(f.home, 'batches/1/env.json');
  for (const key of identities) assert.equal(env[key], undefined, `${key} must not leak into independent agent`);
  for (const [key, value] of Object.entries(preserved)) assert.equal(env[key], value, `${key} must be preserved`);
  assert.equal(env.AGENTIC_RETRO_HOME, f.home);
  assert.equal(env.AGENTIC_RETRO_RUN, '1');
  assert.ok(env.AGENTIC_RETRO_ATTEMPT);
});
