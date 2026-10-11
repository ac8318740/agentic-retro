import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir, run } from './helpers/cli.js';

function proposal(id, category, status) {
  return { id, batch: 1, repo: '/r', category, risk: null, title: `title ${id}`, status,
    createdAt: '2026-01-01T00:00:00.000Z', statusAt: null, pr: null, commit: null };
}

function session(batch, sessionId, { input = 0, output = 0, added = 0, removed = 0 } = {}) {
  return { batch, harness: 'claude', sessionId, repo: '/r', userTurns: 1, assistantTurns: 1,
    inputTokens: input, outputTokens: output, linesAdded: added, linesRemoved: removed };
}

// clarity: 3 accepted, 1 rejected, 0 expired, 2 open -> share 0.75
// agent-setup: 1 accepted, 1 rejected, 2 expired, 1 open -> share 0.25
const PROPOSALS = [
  ...['accepted', 'accepted', 'accepted', 'rejected', 'open', 'open'].map((s, i) => proposal(`P${i + 1}`, 'clarity', s)),
  ...['accepted', 'rejected', 'expired', 'expired', 'open'].map((s, i) => proposal(`P${i + 11}`, 'agent-setup', s)),
];

// Written newest batch first, so the output order must come from sorting.
const METRICS = [
  session(3, 'c1', { input: 300, output: 300, added: 2, removed: 1 }), // 600 / 3 = 200
  session(1, 'a1', { input: 700, output: 300, added: 5, removed: 5 }), // batch 1: (1000 + 1000) / (10 + 10) = 100
  session(1, 'a2', { input: 500, output: 500, added: 10, removed: 0 }),
  session(1, 'a3', { input: null, output: null, added: 50, removed: 50 }), // skipped: no tokens
  session(1, 'a4', { input: 9000, output: 9000, added: 0, removed: 0 }), // skipped: no lines
  session(2, 'b1', { input: 250, output: 250, added: 5, removed: 5 }), // 500 / 10 = 50
];

function seeded() {
  const home = tempDir();
  writeFileSync(join(home, 'ledger.json'), JSON.stringify({ nextId: 16, batchCount: 3, proposals: PROPOSALS }));
  writeFileSync(join(home, 'metrics.jsonl'), METRICS.map((m) => JSON.stringify(m)).join('\n') + '\n');
  return home;
}

function statsJson(home) {
  const { code, stdout } = run(home, ['stats', '--json']);
  assert.equal(code, 0);
  return JSON.parse(stdout);
}

test('stats with empty state prints something and exits 0', () => {
  const { code, stdout } = run(tempDir(), ['stats']);
  assert.equal(code, 0);
  assert.ok(stdout.trim().length > 0, 'stats printed nothing');
});

test('stats --json with empty state still returns categories and batches', () => {
  const result = statsJson(tempDir());
  assert.ok(result.categories && typeof result.categories === 'object');
  assert.deepEqual(result.batches, []);
});

test('stats --json counts proposals per category and status', () => {
  const { categories } = statsJson(seeded());
  const pick = ({ accepted, rejected, expired, open }) => ({ accepted, rejected, expired, open });
  assert.deepEqual(pick(categories.clarity), { accepted: 3, rejected: 1, expired: 0, open: 2 });
  assert.deepEqual(pick(categories['agent-setup']), { accepted: 1, rejected: 1, expired: 2, open: 1 });
});

test('stats --json accepted share is accepted over settled proposals, ignoring open ones', () => {
  const { categories } = statsJson(seeded());
  assert.equal(categories.clarity.acceptedShare, 0.75);
  assert.equal(categories['agent-setup'].acceptedShare, 0.25);
});

test('stats --json gives tokens per line changed per batch, oldest first, skipping sessions without data', () => {
  const { batches } = statsJson(seeded());
  assert.deepEqual(batches, [
    { batch: 1, tokensPerLine: 100 },
    { batch: 2, tokensPerLine: 50 },
    { batch: 3, tokensPerLine: 200 },
  ]);
});

test('stats text output shows each category with its counts and the batch ratios oldest first', () => {
  const { code, stdout } = run(seeded(), ['stats']);
  assert.equal(code, 0);
  const clarity = stdout.split('\n').find((line) => line.includes('clarity'));
  assert.ok(clarity, `no clarity line in:\n${stdout}`);
  for (const n of ['3', '1', '0', '2']) assert.match(clarity, new RegExp(`\\b${n}\\b`));
  assert.match(clarity, /75\s*%|0\.75/);
  assert.match(stdout, /agent-setup/);
  const order = ['100', '50', '200'].map((ratio) => stdout.search(new RegExp(`\\b${ratio}\\b`)));
  assert.ok(order.every((i) => i >= 0), `missing a batch ratio in:\n${stdout}`);
  assert.ok(order[0] < order[1] && order[1] < order[2], `batches not oldest first:\n${stdout}`);
});
