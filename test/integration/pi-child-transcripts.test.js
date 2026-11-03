import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeBatchDigests } from '../../cli/lib/digest.js';
import { tempDir, run, readState, enabledRepo } from '../helpers/cli.js';

function piTranscript(dir, name, header) {
  const path = join(dir, `${name}.jsonl`);
  const lines = [
    { type: 'session', version: 3, id: name, timestamp: '2026-10-01T12:00:00.000Z', cwd: '/work/demo', ...header },
    { type: 'message', id: `${name}-user`, timestamp: '2026-10-01T12:00:01.000Z', message: { role: 'user', content: [{ type: 'text', text: `${name} user request` }] } },
    { type: 'message', id: `${name}-assistant`, timestamp: '2026-10-01T12:00:02.000Z', message: { role: 'assistant', content: [{ type: 'toolCall', id: `${name}-tool`, name: 'bash', arguments: { command: `echo ${name}` } }], model: 'pi-test', usage: { input: 10, output: 5 } } },
  ];
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
  return path;
}

function enqueuePi(home, sessionId, transcript, cwd, env = {}) {
  return run(home, ['enqueue', '--harness', 'pi', '--session', sessionId, '--transcript', transcript, '--cwd', cwd], { env });
}

function batchCount(home) {
  const dir = join(home, 'batches');
  return existsSync(dir) ? readdirSync(dir).length : 0;
}

for (const marker of ['AC_TEAMS_SOCKET', 'AC_TEAMS_MEMBER', 'AC_TEAMS_TOKEN', 'PI_SUBAGENT_CHILD', 'PI_SUBAGENTS_HERDR_BRIDGE']) {
  test(`Pi teammate marker ${marker} permits deduplicated collection but RUN suppresses it`, () => {
    const home = tempDir();
    const cwd = enabledRepo();
    const transcript = piTranscript(tempDir(), 'no-parent-header', {});
    const env = { AC_TEAMS_SOCKET: '', AC_TEAMS_MEMBER: '', AC_TEAMS_TOKEN: '', PI_SUBAGENT_CHILD: '', PI_SUBAGENTS_HERDR_BRIDGE: '', [marker]: '1' };
    assert.equal(enqueuePi(home, 'retro-child', transcript, cwd, { ...env, AGENTIC_RETRO_RUN: '1' }).code, 0);
    assert.deepEqual(readState(home, 'queue.json') ?? [], []);
    assert.equal(enqueuePi(home, 'child', transcript, cwd, env).code, 0);
    assert.equal(enqueuePi(home, 'child', transcript, cwd, env).code, 0);
    assert.deepEqual(readState(home, 'queue.json').map((entry) => entry.sessionId), ['child']);
    assert.equal(batchCount(home), 0);
    assert.equal(enqueuePi(home, 'top', transcript, cwd, { ...env, [marker]: '' }).code, 0);
    assert.deepEqual(readState(home, 'queue.json').map((entry) => entry.sessionId), ['child', 'top']);
  });
}

test('eligible sandbox teammate stays queued when enforced access refuses independent launch', () => {
  const home = tempDir();
  const cwd = enabledRepo();
  const transcript = piTranscript(tempDir(), 'restricted-teammate', { parentSession: 'parent-session' });
  assert.equal(run(home, ['config', 'set', 'batch.size', '1']).code, 0);
  assert.equal(run(home, ['config', 'set', 'runner.harness', 'pi']).code, 0);
  const result = enqueuePi(home, 'restricted-teammate', transcript, cwd, {
    AC_TEAMS_MEMBER: 'synthetic-teammate', AC_TEAMS_ACCESS: '{"enforced":true}',
    AGENTIC_RETRO_DRY_RUN: '', AGENTIC_RETRO_LAUNCHER: join(home, 'never-launch-real-agent'),
  });
  assert.match(result.stdout + result.stderr, /sandbox|enforced|access|restriction/i);
  assert.deepEqual(readState(home, 'queue.json').map((entry) => entry.sessionId), ['restricted-teammate']);
});

test('Pi parentSession teammate and lead both contribute to a batch, but retro RUN never collects', async () => {
  const digestHome = tempDir();
  const enqueueHome = tempDir();
  const cwd = enabledRepo();
  const transcriptDir = join(tempDir('agentic-retro-pi-transcripts-'), '.pi', 'agent', 'sessions', 'demo');
  mkdirSync(transcriptDir, { recursive: true });
  const childTranscript = piTranscript(transcriptDir, 'child-session', { parentSession: 'parent-session' });
  const topTranscript = piTranscript(transcriptDir, 'top-session', {});

  process.env.AGENTIC_RETRO_HOME = digestHome;
  await writeBatchDigests(1, [{ harness: 'pi', sessionId: 'child-session', transcript: childTranscript, cwd, repo: cwd, endedAt: '2026-10-01T12:10:00.000Z' }]);
  const childDigest = readFileSync(join(digestHome, 'batches', '1', 'child-session.md'), 'utf8');
  assert.match(childDigest, /child-session user request/);
  assert.match(childDigest, /echo child-session/);

  assert.equal(run(enqueueHome, ['config', 'set', 'batch.size', '2']).code, 0);
  assert.equal(enqueuePi(enqueueHome, 'retro-child', childTranscript, cwd, { AGENTIC_RETRO_RUN: '1' }).code, 0);
  assert.deepEqual(readState(enqueueHome, 'queue.json') ?? [], []);
  assert.equal(enqueuePi(enqueueHome, 'child-session', childTranscript, cwd).code, 0);
  const queue = readState(enqueueHome, 'queue.json');
  assert.deepEqual(queue.map((entry) => entry.sessionId), ['child-session']);
  assert.equal(queue[0].harness, 'pi');
  assert.equal(queue[0].transcript, childTranscript);
  assert.equal(batchCount(enqueueHome), 0);

  assert.equal(enqueuePi(enqueueHome, 'top-session', topTranscript, cwd).code, 0);
  assert.deepEqual(readState(enqueueHome, 'queue.json'), []);
  assert.equal(batchCount(enqueueHome), 1, 'a teammate plus lead reaches the dry-run batch threshold');
  assert.deepEqual(readState(enqueueHome, 'batches/1/batch.json').sessions.map((entry) => entry.sessionId), ['child-session', 'top-session']);
});
