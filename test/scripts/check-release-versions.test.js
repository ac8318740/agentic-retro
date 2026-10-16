import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from '../helpers/cli.js';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RELEASE_GATE = join(PACKAGE_ROOT, 'scripts', 'check-release-versions.js');
const BASE_VERSION = '1.0.0';
const NEXT_VERSION = '1.0.1';

function git(repo, args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeReleaseSurfaces(repo, versions = {}) {
  const {
    packageVersion = NEXT_VERSION,
    lockRootVersion = NEXT_VERSION,
    lockPackageVersion = NEXT_VERSION,
    claudeVersion = NEXT_VERSION,
    codexVersion = NEXT_VERSION,
  } = versions;

  writeJson(join(repo, 'package.json'), {
    name: 'agentic-retro',
    version: packageVersion,
  });
  writeJson(join(repo, 'package-lock.json'), {
    name: 'agentic-retro',
    version: lockRootVersion,
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: 'agentic-retro',
        version: lockPackageVersion,
      },
    },
  });
  writeJson(join(repo, '.claude-plugin', 'plugin.json'), {
    name: 'agentic-retro',
    version: claudeVersion,
  });
  writeJson(join(repo, '.codex-plugin', 'plugin.json'), {
    name: 'agentic-retro',
    version: codexVersion,
  });
}

function makeRepo() {
  const repo = tempDir('agentic-retro-release-gate-');
  git(repo, ['init', '--initial-branch=main']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test User']);
  writeReleaseSurfaces(repo, {
    packageVersion: BASE_VERSION,
    lockRootVersion: BASE_VERSION,
    lockPackageVersion: BASE_VERSION,
    claudeVersion: BASE_VERSION,
    codexVersion: BASE_VERSION,
  });
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'base release versions']);
  const base = git(repo, ['rev-parse', 'HEAD']);
  return { repo, base };
}

function makeRepoWithoutCodexPlugin() {
  const repo = tempDir('agentic-retro-release-gate-');
  git(repo, ['init', '--initial-branch=main']);
  git(repo, ['config', 'user.email', 'test@example.com']);
  git(repo, ['config', 'user.name', 'Test User']);
  writeReleaseSurfaces(repo, {
    packageVersion: BASE_VERSION,
    lockRootVersion: BASE_VERSION,
    lockPackageVersion: BASE_VERSION,
    claudeVersion: BASE_VERSION,
    codexVersion: BASE_VERSION,
  });
  rmSync(join(repo, '.codex-plugin'), { recursive: true, force: true });
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', 'base release versions without codex plugin']);
  const base = git(repo, ['rev-parse', 'HEAD']);
  return { repo, base };
}

function commitHead(repo, message = 'head release versions') {
  git(repo, ['add', '.']);
  git(repo, ['commit', '-m', message]);
  return git(repo, ['rev-parse', 'HEAD']);
}

function runGate(repo, { base, head, target }) {
  return spawnSync('node', [RELEASE_GATE, '--base', base, '--head', head, '--target', target], {
    cwd: repo,
    encoding: 'utf8',
  });
}

function assertGateExecuted(result) {
  assert.doesNotMatch(result.stderr, /Cannot find module|MODULE_NOT_FOUND/, result.stderr);
}

test('main-targeted pull requests pass when every release surface bumps from the base ref', () => {
  const { repo, base } = makeRepo();
  writeReleaseSurfaces(repo);
  const head = commitHead(repo);

  const result = runGate(repo, { base, head, target: 'main' });

  assertGateExecuted(result);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('main-targeted pull requests pass when the head ref adds a bumped Codex plugin version missing from the base ref', () => {
  const { repo, base } = makeRepoWithoutCodexPlugin();
  writeReleaseSurfaces(repo);
  const head = commitHead(repo, 'add bumped codex plugin release surface');

  const result = runGate(repo, { base, head, target: 'main' });

  assertGateExecuted(result);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

const unbumpedSurfaceCases = [
  ['package.json version', { packageVersion: BASE_VERSION }],
  ['package-lock root version', { lockRootVersion: BASE_VERSION }],
  ['package-lock package version', { lockPackageVersion: BASE_VERSION }],
  ['Claude plugin version', { claudeVersion: BASE_VERSION }],
  ['Codex plugin version', { codexVersion: BASE_VERSION }],
];

for (const [surface, override] of unbumpedSurfaceCases) {
  test(`main-targeted pull requests fail when the ${surface} does not bump`, () => {
    const { repo, base } = makeRepo();
    writeReleaseSurfaces(repo, override);
    const head = commitHead(repo, `leave ${surface} unchanged`);

    const result = runGate(repo, { base, head, target: 'main' });

    assertGateExecuted(result);
    assert.notEqual(result.status, 0, `${surface} must be required for main-targeted PRs`);
  });
}

test('pull requests targeting branches other than main pass without version bumps', () => {
  const { repo, base } = makeRepo();
  writeFileSync(join(repo, 'README.md'), 'non-release change\n');
  const head = commitHead(repo, 'non-main change');

  const result = runGate(repo, { base, head, target: 'dev' });

  assertGateExecuted(result);
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
