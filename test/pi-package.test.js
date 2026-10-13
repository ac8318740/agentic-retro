import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE_JSON = join(PACKAGE_ROOT, 'package.json');

function packageJson() {
  return JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'));
}

function declaredExtensionPaths(pkg) {
  const extensions = pkg.pi?.extensions ?? [];
  return extensions.map((extensionPath) => join(PACKAGE_ROOT, extensionPath));
}

function extensionSource() {
  const [extensionPath] = declaredExtensionPaths(packageJson());
  assert.ok(extensionPath, 'package.json declares a Pi extension');
  assert.ok(existsSync(extensionPath), `declared extension exists: ${extensionPath}`);
  return readFileSync(extensionPath, 'utf8');
}

function bundledSkillNames() {
  return readdirSync(join(PACKAGE_ROOT, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

test('package.json exposes agentic-retro as a Pi extension package only', () => {
  const pkg = packageJson();

  assert.ok(pkg.keywords?.includes('pi-package'), 'package is discoverable as a Pi package');
  assert.deepEqual(
    declaredExtensionPaths(pkg).map((path) => normalize(path).replace(normalize(PACKAGE_ROOT) + '/', '')),
    ['cli/lib/pi-extension.ts'],
  );
  assert.ok(!pkg.pi?.skills || pkg.pi.skills.length === 0, 'Pi package must not expose skills directly');
  assert.equal(pkg.peerDependencies?.['@earendil-works/pi-coding-agent'], '*');
});

test('Pi extension registers the native dispatcher, skill aliases, and lifecycle hooks', () => {
  const source = extensionSource();
  const skills = bundledSkillNames();

  assert.match(source, /registerCommand\(\s*["']agentic-retro["']/, 'registers /agentic-retro');
  for (const skill of skills) {
    assert.match(
      source,
      new RegExp(`registerCommand\\(\\s*["']agentic-retro:${skill}["']`),
      `registers /agentic-retro:${skill}`,
    );
    assert.match(source, new RegExp(`skills[/\\\\]${skill}|skills["'],\\s*["']${skill}`), `alias expands bundled ${skill} skill`);
  }
  assert.match(source, /on\(\s*["']session_start["']/, 'retains session_start notice');
  assert.match(source, /on\(\s*["']session_shutdown["']/, 'retains session_shutdown enqueue');
});

test('Pi extension resolves the CLI from the package instead of PATH', () => {
  const source = extensionSource();

  assert.match(source, /agentic-retro\.js/, 'extension points at the package-local CLI file');
  assert.doesNotMatch(source, /(?:spawn|execFile)\(\s*["']agentic-retro["']/, 'must not require global agentic-retro on PATH');
});
