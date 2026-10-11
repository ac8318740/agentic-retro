import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeBatchDigests } from '../cli/lib/digest.js';
import { tempDir } from './helpers/cli.js';

// claude-meta.jsonl has two real user messages among meta lines, slash-command echoes, and injected tags.
// Every injected line carries an INJECTED_ marker so the digest can be checked for leaks.
const TRANSCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'claude-meta.jsonl');
const SESSION = { harness: 'claude', sessionId: 'claude-m1', transcript: TRANSCRIPT, cwd: '/work/demo', repo: '/work/demo', endedAt: '2026-10-02T11:00:00.000Z' };

async function digestAndMetrics() {
  const home = tempDir();
  process.env.AGENTIC_RETRO_HOME = home;
  await writeBatchDigests(1, [SESSION]);
  return {
    digest: readFileSync(join(home, 'batches', '1', 'claude-m1.md'), 'utf8'),
    metrics: JSON.parse(readFileSync(join(home, 'metrics.jsonl'), 'utf8').trim()),
  };
}

test('claude user turns skip meta lines, slash-command echoes, and injected tags', async () => {
  const { metrics } = await digestAndMetrics();
  assert.equal(metrics.userTurns, 2);
  assert.equal(metrics.assistantTurns, 2);
});

test('claude digest lists only the real user messages', async () => {
  const { digest } = await digestAndMetrics();
  assert.match(digest, /Refactor src\/shapes\.js into one class per shape/);
  assert.match(digest, /Keep the public API the same/);
  assert.ok(!digest.includes('INJECTED_'), 'no injected text in the digest');
  assert.ok(!digest.includes('<command-name>'), 'no slash-command echo in the digest');
});

test('claude input tokens include cache reads and cache writes', async () => {
  // msg_a: 10 + 1000 read + 200 written. msg_b: 20 + 1500 read.
  const { metrics } = await digestAndMetrics();
  assert.equal(metrics.inputTokens, 2730);
});

test('claude output tokens take the last streamed line of each message id', async () => {
  // msg_a streams 1, 30, 80. msg_b streams 5, 40.
  const { metrics } = await digestAndMetrics();
  assert.equal(metrics.outputTokens, 120);
});
