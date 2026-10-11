import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeBatchDigests } from '../cli/lib/digest.js';
import { tempDir } from './helpers/cli.js';

// Expected values are counted by hand from the fixture transcripts in test/fixtures/.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function session(harness, sessionId, transcript) {
  return { harness, sessionId, transcript, cwd: '/work/demo', repo: '/work/demo', endedAt: '2026-10-01T13:00:00.000Z' };
}

async function metricsFor(n, sessions) {
  const home = tempDir();
  process.env.AGENTIC_RETRO_HOME = home;
  await writeBatchDigests(n, sessions);
  return readMetrics(home);
}

function readMetrics(home) {
  return readFileSync(join(home, 'metrics.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
}

const COUNTS = ['userTurns', 'assistantTurns', 'inputTokens', 'outputTokens', 'linesAdded', 'linesRemoved'];
const counts = (line) => Object.fromEntries(COUNTS.map((k) => [k, line[k]]));

test('claude metrics count each streamed message id once and count Edit, Write, and MultiEdit lines', async () => {
  // usage repeats on every line of one message id (msg_1, msg_5, msg_6); tool_result lines are not user turns.
  // Edit: 2 old lines out, 3 new lines in. Write: 4 lines in. MultiEdit: (1->2) + (2->1) + (1->1).
  const [line] = await metricsFor(1, [session('claude', 'claude-s1', join(FIXTURES, 'claude.jsonl'))]);
  assert.deepEqual(counts(line), {
    userTurns: 2, assistantTurns: 6, inputTokens: 910, outputTokens: 165, linesAdded: 11, linesRemoved: 6,
  });
});

test('codex metrics read user_message and agent_message events, token totals, and apply_patch lines', async () => {
  // Synthetic setup messages and mirrored response_item user messages are not turns.
  // apply_patch: count.js -1 +1, one.js (Add File) +2, sum.js via heredoc -2 +3.
  const [line] = await metricsFor(1, [session('codex', 'codex-s1', join(FIXTURES, 'codex.jsonl'))]);
  assert.deepEqual(counts(line), {
    userTurns: 2, assistantTurns: 2, inputTokens: 2500, outputTokens: 120, linesAdded: 6, linesRemoved: 3,
  });
});

test('codex metrics report tokens as null, not 0, when the transcript has no token_count events', async () => {
  const dir = tempDir('agentic-retro-transcript-');
  const path = join(dir, 'codex-no-tokens.jsonl');
  const kept = readFileSync(join(FIXTURES, 'codex.jsonl'), 'utf8').split('\n').filter((l) => !l.includes('"token_count"'));
  writeFileSync(path, kept.join('\n'));
  const [line] = await metricsFor(1, [session('codex', 'codex-s2', path)]);
  assert.equal(line.inputTokens, null);
  assert.equal(line.outputTokens, null);
  assert.equal(line.userTurns, 2);
  assert.equal(line.linesAdded, 6);
});

test('pi metrics count message turns, per-turn usage, and edit and write lines', async () => {
  // toolResult messages and model/thinking change lines are not turns.
  // edit: (2->1) + (1->2). write: 2 lines in.
  const [line] = await metricsFor(1, [session('pi', 'pi-s1', join(FIXTURES, 'pi.jsonl'))]);
  assert.deepEqual(counts(line), {
    userTurns: 2, assistantTurns: 5, inputTokens: 1920, outputTokens: 165, linesAdded: 5, linesRemoved: 3,
  });
});

test('each metrics line names its batch, harness, session, and repo', async () => {
  const lines = await metricsFor(4, [
    session('claude', 'claude-s1', join(FIXTURES, 'claude.jsonl')),
    session('pi', 'pi-s1', join(FIXTURES, 'pi.jsonl')),
  ]);
  assert.equal(lines.length, 2);
  for (const line of lines) {
    assert.equal(line.batch, 4);
    assert.equal(line.repo, '/work/demo');
  }
  assert.deepEqual(lines.map((l) => [l.harness, l.sessionId]), [['claude', 'claude-s1'], ['pi', 'pi-s1']]);
});

test('later batches append to metrics.jsonl', async () => {
  const home = tempDir();
  process.env.AGENTIC_RETRO_HOME = home;
  await writeBatchDigests(1, [session('claude', 'claude-s1', join(FIXTURES, 'claude.jsonl'))]);
  await writeBatchDigests(2, [session('pi', 'pi-s1', join(FIXTURES, 'pi.jsonl'))]);
  assert.deepEqual(readMetrics(home).map((l) => l.batch), [1, 2]);
});

test('a null or missing transcript gives a metrics line of nulls', async () => {
  const lines = await metricsFor(1, [
    session('claude', 'no-path', null),
    session('codex', 'gone', '/nonexistent/agentic-retro/gone.jsonl'),
  ]);
  assert.equal(lines.length, 2);
  for (const line of lines) {
    for (const key of COUNTS) assert.equal(line[key], null, `${line.sessionId} ${key}`);
  }
});

test('unparseable lines in a transcript are skipped', async () => {
  const dir = tempDir('agentic-retro-transcript-');
  const path = join(dir, 'broken.jsonl');
  writeFileSync(path, 'not json\n' + readFileSync(join(FIXTURES, 'pi.jsonl'), 'utf8') + '{"truncated":');
  const [line] = await metricsFor(1, [session('pi', 'pi-broken', path)]);
  assert.equal(line.userTurns, 2);
  assert.equal(line.linesAdded, 5);
});
