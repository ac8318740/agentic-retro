import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs, { readFileSync, writeFileSync, mkdirSync, readdirSync, symlinkSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { saveCandidates } from '../cli/lib/candidates.js';
import { join } from 'node:path';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tempDir, run, enabledRepo } from './helpers/cli.js';

function setup() {
  const home = tempDir();
  for (const [n, repo] of [[1, '/repo/a'], [2, '/repo/b'], [3, '/repo/a']]) {
    mkdirSync(join(home, 'batches', String(n)), { recursive: true });
    writeFileSync(join(home, 'batches', String(n), 'batch.json'), JSON.stringify({ sessions: [
      { harness: 'pi', sessionId: `s${n}`, repo, cwd: repo, transcript: `/logs/s${n}.jsonl` },
    ] }));
  }
  return home;
}
const evidence = (n) => ({ batch: n, sessionId: `s${n}`, repo: n === 2 ? '/repo/b' : '/repo/a', transcript: `/logs/s${n}.jsonl`, line: 7, attribution: 'unknown', rationale: 'Transport role alone cannot establish authorship' });
const candidate = (extra = {}) => ({ owner: '/tools/shared', category: 'agent-setup', shared: true, change: 'Require result before reporting verification complete', hypothesis: 'Launch acknowledgements are mistaken for completed verification', disposition: 'unresolved', reason: 'Needs recurring evidence', evidence: [evidence(1)], ...extra });
function save(home, n, records) {
  const file = join(home, 'input.json');
  writeFileSync(file, JSON.stringify(records));
  return run(home, ['candidates', 'save', '--batch', String(n), '--file', file]);
}
function list(home, n) {
  const result = run(home, ['candidates', 'list', '--batch', String(n)]);
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('candidate evidence carries across batches without expiry, preserving exact provenance and deduplicating repeats', () => {
  const home = setup();
  assert.deepEqual(list(home, 1), [], 'older installations have no candidate memory');
  assert.equal(save(home, 1, [candidate()]).code, 0);
  const first = list(home, 2)[0];
  assert.deepEqual(first.evidence, [evidence(1)]);
  assert.equal(save(home, 2, [candidate({ evidence: [evidence(1), evidence(2), evidence(2)] })]).code, 0);
  const combined = list(home, 3);
  assert.equal(combined.length, 1);
  assert.deepEqual(combined[0].evidence, [evidence(1), evidence(2)]);
});

test('sharing requires same explicit owner and change; repo-local evidence stays local', () => {
  const home = setup();
  assert.equal(save(home, 1, [
    candidate(), candidate({ change: 'Different specific mechanism' }),
    candidate({ owner: '/tools/other' }),
    candidate({ owner: '/repo/a', category: 'clarity', shared: false }),
  ]).code, 0);
  assert.equal(list(home, 2).length, 3);
  assert.equal(list(home, 3).length, 4);
  const crossRepo = save(home, 2, [candidate({ owner: '/repo/a', shared: false, evidence: [evidence(2)] })]);
  assert.notEqual(crossRepo.code, 0, 'repo-local candidates cannot pool evidence from another repository');
});

for (const disposition of ['proposed', 'adopted', 'duplicate', 'rejected', 'unsupported']) {
  test(`${disposition} candidate cannot resurrect from a stale later unresolved write`, () => {
    const home = setup();
    assert.equal(save(home, 1, [candidate()]).code, 0);
    assert.equal(save(home, 2, [candidate({ disposition })]).code, 0);
    assert.equal(save(home, 3, [candidate()]).code, 0);
    assert.deepEqual(list(home, 3), []);
    assert.equal(readdirSync(join(home, 'candidates')).length, 3, 'events retained, never overwritten');
  });
}

test('candidate writes reject malformed, oversized, invented and cross-batch provenance without partial state', () => {
  const home = setup();
  for (const records of [
    [candidate({ owner: '../escape' })],
    [candidate({ category: 'unknown' })],
    [candidate({ category: 'clarity' })], // only shared tooling can cross repositories
    [candidate({ hypothesis: 'x'.repeat(4001) })],
    [candidate({ evidence: Array.from({ length: 21 }, () => evidence(1)) })],
    [candidate({ evidence: [{ ...evidence(1), line: 0 }] })],
    [candidate({ evidence: [{ ...evidence(1), attribution: 'verified-human' }] })],
    [candidate({ evidence: [{ ...evidence(1), transcript: '/logs/invented.jsonl' }] })],
    Array.from({ length: 51 }, () => candidate()),
  ]) {
    const result = save(home, 1, records);
    assert.notEqual(result.code, 0, JSON.stringify(records).slice(0, 100));
  }
  assert.deepEqual(list(home, 1), []);
  assert.notEqual(save(home, 1, [candidate({ evidence: [evidence(2)] })]).code, 0, 'current batch must contribute evidence');
  assert.notEqual(run(home, ['candidates', 'list', '--batch', '../escape']).code, 0);
  const oversized = join(home, 'oversized.json');
  writeFileSync(oversized, ' '.repeat(256 * 1024 + 1));
  assert.match(run(home, ['candidates', 'save', '--batch', '1', '--file', oversized]).stderr, /exceeds 256 KiB/);
});

test('candidate input rejects FIFOs without blocking', { skip: process.platform === 'win32' }, () => {
  const home = setup();
  const fifo = join(home, 'input.fifo');
  execFileSync('mkfifo', [fifo]);
  const cli = fileURLToPath(new URL('../cli/agentic-retro.js', import.meta.url));
  const result = spawnSync(process.execPath, [cli, 'candidates', 'save', '--batch', '1', '--file', fifo], {
    env: { ...process.env, AGENTIC_RETRO_HOME: home }, encoding: 'utf8', timeout: 2000,
  });
  assert.equal(result.error, undefined, 'nonregular input must fail promptly instead of timing out');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /regular file/);
});

test('candidate byte limit uses bytes actually read, not a stale reported file size', (t) => {
  const home = setup();
  const file = join(home, 'grown.json');
  writeFileSync(file, ' '.repeat(256 * 1024 + 1));
  const original = fs.fstatSync;
  t.mock.method(fs, 'fstatSync', (fd) => ({ ...original(fd), size: 0, isFile: () => true }));
  const oldHome = process.env.AGENTIC_RETRO_HOME;
  process.env.AGENTIC_RETRO_HOME = home;
  syncBuiltinESMExports();
  try { assert.throws(() => saveCandidates(1, file), /exceeds 256 KiB/); }
  finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    if (oldHome === undefined) delete process.env.AGENTIC_RETRO_HOME;
    else process.env.AGENTIC_RETRO_HOME = oldHome;
  }
});

test('event publication refuses an existing destination without overwriting it', (t) => {
  const home = setup();
  const file = join(home, 'publish.json');
  writeFileSync(file, JSON.stringify([candidate()]));
  const original = fs.linkSync;
  let destination;
  t.mock.method(fs, 'linkSync', (source, target) => {
    destination = target;
    writeFileSync(target, 'existing event', { flag: 'wx' });
    return original(source, target);
  });
  const oldHome = process.env.AGENTIC_RETRO_HOME;
  process.env.AGENTIC_RETRO_HOME = home;
  syncBuiltinESMExports();
  try {
    assert.throws(() => saveCandidates(1, file), /EEXIST/);
    assert.equal(readFileSync(destination, 'utf8'), 'existing event');
    assert.equal(readdirSync(join(home, 'candidates')).length, 1, 'temporary publication file was cleaned');
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
    if (oldHome === undefined) delete process.env.AGENTIC_RETRO_HOME;
    else process.env.AGENTIC_RETRO_HOME = oldHome;
  }
});

test('shared owner symlink and repository aliases share terminal identity', () => {
  const home = setup();
  const owner = enabledRepo();
  const alias = join(home, 'owner-link');
  symlinkSync(owner, alias, 'dir');
  const nested = join(owner, 'skills');
  mkdirSync(nested);
  assert.equal(save(home, 1, [candidate({ owner: alias })]).code, 0);
  assert.equal(list(home, 2)[0].owner, owner);
  assert.equal(save(home, 2, [candidate({ owner: nested, disposition: 'adopted' })]).code, 0);
  assert.equal(save(home, 3, [candidate({ owner: alias })]).code, 0);
  assert.deepEqual(list(home, 3), []);
});

test('conflicting retained attribution becomes unknown rather than crediting a human source', () => {
  const home = setup();
  assert.equal(save(home, 1, [candidate()]).code, 0);
  assert.equal(save(home, 2, [candidate({ evidence: [{ ...evidence(1), attribution: 'human', rationale: 'A later reviewer asserted human authorship' }] })]).code, 0);
  assert.equal(list(home, 3)[0].evidence[0].attribution, 'unknown');
});

test('oversized retrieval fails visibly without deleting unresolved events', () => {
  const home = setup();
  for (let part = 0; part < 6; part++) {
    const records = Array.from({ length: 50 }, (_, i) => candidate({ change: `specific-change-${part}-${i}`, hypothesis: 'x'.repeat(4000) }));
    const result = save(home, 1, records);
    assert.equal(result.code, 0, result.stderr);
  }
  const result = run(home, ['candidates', 'list', '--batch', '3']);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /exceeds 1 MiB.*nothing was deleted/);
  assert.equal(readdirSync(join(home, 'candidates')).filter((f) => f.endsWith('.json')).length, 6);
});

test('parallel candidate saves preserve both evidence and terminal dispositions', async () => {
  const home = setup();
  const cli = fileURLToPath(new URL('../cli/agentic-retro.js', import.meta.url));
  const records = [candidate(), candidate({ evidence: [evidence(2)] }), candidate({ disposition: 'adopted' })];
  const files = records.map((record, i) => {
    const file = join(home, `concurrent-${i}.json`);
    writeFileSync(file, JSON.stringify([record]));
    return file;
  });
  await Promise.all(files.map((file) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'candidates', 'save', '--batch', '3', '--file', file], {
      env: { ...process.env, AGENTIC_RETRO_HOME: home, AGENTIC_RETRO_DRY_RUN: '1' }, stdio: 'pipe',
    });
    let error = '';
    child.stderr.on('data', (text) => { error += text; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(error)));
  })));
  assert.equal(readdirSync(join(home, 'candidates')).filter((f) => f.endsWith('.json')).length, 3);
  assert.deepEqual(list(home, 3), []);
});
