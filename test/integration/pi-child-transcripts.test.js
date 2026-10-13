import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeBatchDigests } from '../../cli/lib/digest.js';
import { tempDir, run, readState } from '../helpers/cli.js';

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

function enqueuePi(home, sessionId, transcript, cwd) {
  return run(home, ['enqueue', '--harness', 'pi', '--session', sessionId, '--transcript', transcript, '--cwd', cwd]);
}

function batchCount(home) {
  const dir = join(home, 'batches');
  return existsSync(dir) ? readdirSync(dir).length : 0;
}

test('pi child transcripts remain readable context but do not enqueue or create retro batches', async () => {
  const digestHome = tempDir();
  const enqueueHome = tempDir();
  const cwd = tempDir('agentic-retro-pi-cwd-');
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
  assert.equal(enqueuePi(enqueueHome, 'child-session', childTranscript, cwd).code, 0);
  assert.deepEqual(readState(enqueueHome, 'queue.json') ?? [], []);
  assert.equal(batchCount(enqueueHome), 0);

  assert.equal(enqueuePi(enqueueHome, 'top-session', topTranscript, cwd).code, 0);
  const queue = readState(enqueueHome, 'queue.json') ?? [];
  assert.deepEqual(queue.map((entry) => entry.sessionId), ['top-session']);
  assert.equal(queue[0].harness, 'pi');
  assert.equal(queue[0].transcript, topTranscript);
  assert.equal(batchCount(enqueueHome), 0, 'a child plus one top-level transcript must not reach the enqueue batch threshold');
});
