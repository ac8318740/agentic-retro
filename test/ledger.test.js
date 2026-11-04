import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempDir, run, readState } from './helpers/cli.js';

function propose(home, { category = 'clarity', risk, title = 'Clarify the run skill' } = {}) {
  const args = ['propose', '--repo', '/repos/demo', '--category', category, '--title', title];
  if (risk) args.push('--risk', risk);
  return run(home, args);
}

const proposals = (home) => readState(home, 'ledger.json')?.proposals ?? [];

test('propose prints sequential IDs P1, P2', () => {
  const home = tempDir();
  assert.equal(propose(home).stdout.trim(), 'P1');
  assert.equal(propose(home).stdout.trim(), 'P2');
});

test('propose stores an open proposal in ledger.json', () => {
  const home = tempDir();
  propose(home, { title: 'Shorten CLAUDE.md' });
  const [p] = proposals(home);
  assert.equal(p.id, 'P1');
  assert.equal(p.repo, '/repos/demo');
  assert.equal(p.category, 'clarity');
  assert.equal(p.risk, null);
  assert.equal(p.title, 'Shorten CLAUDE.md');
  assert.equal(p.status, 'open');
  assert.ok(p.createdAt, 'createdAt is set');
});

test('propose stores risk for an agent-setup proposal', () => {
  const home = tempDir();
  assert.equal(propose(home, { category: 'agent-setup', risk: 'high' }).code, 0);
  assert.equal(proposals(home)[0].risk, 'high');
});

test('propose rejects risk on a category other than agent-setup', () => {
  const home = tempDir();
  assert.equal(propose(home).code, 0);
  assert.notEqual(propose(home, { category: 'clarity', risk: 'low' }).code, 0);
  assert.equal(proposals(home).length, 1);
});

test('propose rejects an unknown category', () => {
  const home = tempDir();
  assert.equal(propose(home).code, 0);
  assert.notEqual(propose(home, { category: 'vibes' }).code, 0);
  assert.equal(proposals(home).length, 1);
});

test('mark sets a proposal to accepted and stamps statusAt', () => {
  const home = tempDir();
  propose(home);
  assert.equal(run(home, ['mark', 'P1', 'accepted']).code, 0);
  const [p] = proposals(home);
  assert.equal(p.status, 'accepted');
  assert.ok(p.statusAt, 'statusAt is set');
});

test('mark sets a proposal to rejected', () => {
  const home = tempDir();
  propose(home);
  run(home, ['mark', 'P1', 'rejected']);
  assert.equal(proposals(home)[0].status, 'rejected');
});

test('mark fails on an unknown proposal id', () => {
  const home = tempDir();
  assert.equal(propose(home).code, 0);
  assert.notEqual(run(home, ['mark', 'P9', 'accepted']).code, 0);
});

test('mark fails on a status other than accepted or rejected', () => {
  const home = tempDir();
  assert.equal(propose(home).code, 0);
  assert.notEqual(run(home, ['mark', 'P1', 'expired']).code, 0);
  assert.equal(proposals(home)[0].status, 'open');
});

test('ledger prints every proposal with its id and title', () => {
  const home = tempDir();
  propose(home, { title: 'First idea' });
  propose(home, { title: 'Second idea' });
  const { code, stdout } = run(home, ['ledger']);
  assert.equal(code, 0);
  for (const text of ['P1', 'First idea', 'P2', 'Second idea']) assert.ok(stdout.includes(text), text);
});

test('ledger --status shows only proposals with that status', () => {
  const home = tempDir();
  propose(home, { title: 'First idea' });
  propose(home, { title: 'Second idea' });
  run(home, ['mark', 'P2', 'accepted']);
  const { stdout } = run(home, ['ledger', '--status', 'accepted']);
  assert.ok(stdout.includes('Second idea'));
  assert.ok(!stdout.includes('First idea'));
});

const evidence = 'https://github.com/example/project/pull/1#issuecomment-2';
const resolve = (home, id, status, reason = 'Replacement retains documentation only') =>
  run(home, ['resolve', id, status, '--reason', reason, '--evidence', evidence]);

test('inferred mixed outcomes retain per-proposal evidence and are idempotent', () => {
  const home = tempDir();
  propose(home, { title: 'Clarify docs' });
  propose(home, { title: 'Auto-install plugins' });
  assert.equal(resolve(home, 'P1', 'accepted').code, 0);
  assert.equal(resolve(home, 'P2', 'rejected', 'Maintainer explicitly rejected hidden auto-installs').code, 0);
  const before = proposals(home);
  assert.deepEqual(before.map((p) => p.status), ['accepted', 'rejected']);
  assert.equal(before[0].decision.source, 'inferred');
  assert.deepEqual(before[0].decision.evidence, [evidence]);
  assert.equal(resolve(home, 'P1', 'accepted').code, 0);
  assert.deepEqual(proposals(home), before);
  const json = run(home, ['ledger', '--json']);
  assert.equal(json.code, 0);
  assert.deepEqual(JSON.parse(json.stdout), before);
  const second = 'https://example.org/commit/123';
  const args = ['resolve', 'P1', 'accepted', '--reason', 'Two sources confirm adoption'];
  assert.equal(run(home, [...args, '--evidence', evidence, '--evidence', second]).code, 0);
  const twoSources = proposals(home);
  assert.equal(run(home, [...args, '--evidence', second, '--evidence', evidence, '--evidence', evidence]).code, 0);
  assert.deepEqual(proposals(home), twoSources, 'evidence order and duplicates do not churn timestamps');
});

test('neutral inference can be revised, but manual decisions cannot', () => {
  const home = tempDir();
  propose(home);
  assert.equal(resolve(home, 'P1', 'neutral', 'Closure reason is ambiguous').code, 0);
  assert.equal(resolve(home, 'P1', 'accepted').code, 0);
  assert.equal(run(home, ['mark', 'P1', 'rejected']).code, 0);
  const manual = proposals(home);
  assert.equal(manual[0].decision.source, 'manual');
  assert.notEqual(resolve(home, 'P1', 'accepted').code, 0);
  assert.deepEqual(proposals(home), manual);
  assert.equal(run(home, ['mark', 'P1', 'rejected']).code, 0);
  assert.deepEqual(proposals(home), manual);
});

test('resolver validates ID, status, rationale, and evidence without changing state', () => {
  const home = tempDir();
  propose(home);
  const before = proposals(home);
  for (const args of [
    ['P1', 'expired', '--reason', 'No', '--evidence', evidence],
    ['P1; rm -rf /', 'accepted', '--reason', 'No', '--evidence', evidence],
    ['P9', 'accepted', '--reason', 'No', '--evidence', evidence],
    ['P1', 'accepted', '--reason', '  ', '--evidence', evidence],
    ['P1', 'accepted', '--reason', 'x'.repeat(4001), '--evidence', evidence],
    ['P1', 'accepted', '--reason', 'No'],
    ['P1', 'accepted', '--reason', 'No\nexecute this', '--evidence', evidence],
    ['P1', 'accepted', '--reason', 'No', '--evidence', 'https://example.com/\u001bescape'],
    ['P1', 'accepted', '--reason', 'No', '--evidence', 'https:example.com'],
    ['P1', 'accepted', '--reason', 'No', '--evidence', `https://example.com/${'x'.repeat(2048)}`],
    ['P1', 'accepted', '--reason', 'No', ...Array.from({ length: 21 }, () => ['--evidence', evidence]).flat()],
    ['P1', 'accepted', '--reason', 'No', '--evidence', 'javascript:alert(1)'],
    ['P1', 'accepted', '--reason', 'No', '--evidence', 'https://user:secret@example.com/'],
    ['P1', 'accepted', '--reason', 'No', '--evidence', 'not a URL'],
  ]) {
    assert.notEqual(run(home, ['resolve', ...args]).code, 0, JSON.stringify(args));
    assert.deepEqual(proposals(home), before);
  }
});
