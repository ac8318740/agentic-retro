import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { tempDir, enabledRepo, readState } from './helpers/cli.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const work = tempDir('retro package ');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
let archive, plugin, env;
const run = (file, args, options = {}) => execFileSync(file, args, { cwd: work, encoding: 'utf8', ...options });
before(() => {
  const packed = JSON.parse(run('npm', ['pack', root, '--json', '--ignore-scripts']));
  archive = join(work, packed[0].filename);
  run('tar', ['-xzf', archive]);
  plugin = join(work, 'package');
  const bin = join(work, 'bin');
  mkdirSync(bin);
  symlinkSync(process.execPath, join(bin, 'node'));
  symlinkSync('/bin/bash', join(bin, 'bash'));
  symlinkSync(run('which', ['git']).trim(), join(bin, 'git'));
  env = { PATH: bin, HOME: join(work, 'home'), AGENTIC_RETRO_HOME: join(work, 'state'), AGENTIC_RETRO_DRY_RUN: '1' };
  mkdirSync(env.HOME);
});
after(() => rmSync(work, { recursive: true, force: true }));

function hook(event, payload, extraEnv = {}) {
  const command = json(join(plugin, 'hooks/hooks.json')).hooks[event][0].hooks[0].command;
  const result = spawnSync('/bin/bash', ['-c', command], {
    cwd: work, encoding: 'utf8', input: JSON.stringify(payload),
    env: { ...env, CLAUDE_PLUGIN_ROOT: plugin, ...extraEnv },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

test('npm ships both plugin manifests, hooks, skills, and a working bundled CLI', () => {
  const pkg = json(join(plugin, 'package.json'));
  for (const host of ['claude', 'codex']) {
    assert.equal(json(join(plugin, `.${host}-plugin/plugin.json`)).version, pkg.version);
  }
  assert.match(run(process.execPath, [join(plugin, 'cli/agentic-retro.js'), 'about'], { env }), /agentic-retro/);
  for (const skill of ['run', 'setup', 'retro', 'review']) {
    assert.match(readFileSync(join(plugin, `skills/${skill}/SKILL.md`), 'utf8'), /\.\.\/\.\.\/cli\/agentic-retro\.js/);
  }
});

test('packed hook captures Claude and Codex sessions and notices proposals without a global CLI', () => {
  const cwd = enabledRepo();
  for (const harness of ['claude', 'codex']) {
    const fixture = join(root, 'test/fixtures', harness === 'claude' ? 'claude.jsonl' : 'codex-current.jsonl');
    const transcript = join(work, harness === 'claude' ? 'custom config/projects/app/session.jsonl' : 'rollout-codex.jsonl');
    mkdirSync(dirname(transcript), { recursive: true });
    writeFileSync(transcript, readFileSync(fixture));
    hook('SessionEnd', { hook_event_name: 'SessionEnd', session_id: harness, transcript_path: transcript, cwd, reason: 'other' }, { CLAUDE_CONFIG_DIR: join(work, 'custom config') });
    const entry = readState(env.AGENTIC_RETRO_HOME, 'queue.json').find((s) => s.sessionId === harness);
    assert.equal(entry.harness, harness);
    assert.equal(entry.transcript, transcript);
  }
  run(process.execPath, ['--input-type=module', '-e', `
    import { readFileSync } from 'node:fs';
    import { writeBatchDigests } from ${JSON.stringify(join(plugin, 'cli/lib/digest.js'))};
    await writeBatchDigests(1, JSON.parse(readFileSync(process.env.AGENTIC_RETRO_HOME + '/queue.json', 'utf8')));
  `], { env });
  for (const [harness, request] of [['claude', 'Add a greeting function'], ['codex', 'Rename add to sum']]) {
    const digest = readFileSync(join(env.AGENTIC_RETRO_HOME, `batches/1/${harness}.md`), 'utf8');
    assert.ok(digest.includes(request), `${harness} fixture request survives packaged capture and digest`);
    assert.doesNotMatch(digest, /PROSE_MARKER_/);
  }
  writeFileSync(join(env.AGENTIC_RETRO_HOME, 'ledger.json'), JSON.stringify({ nextId: 2, batchCount: 1, proposals: [
    { id: 'P1', batch: 1, repo: cwd, category: 'clarity', title: 'Packaged proposal', status: 'open', pr: 'https://github.com/example/repo/pull/1' },
  ] }));
  const payload = { hook_event_name: 'SessionStart', session_id: 'start', cwd };
  assert.match(JSON.parse(hook('SessionStart', payload)).systemMessage, /1 new proposal: https:\/\/github.com\/example\/repo\/pull\/1/);
  assert.equal(hook('SessionStart', payload), '');
  const before = readState(env.AGENTIC_RETRO_HOME, 'queue.json');
  hook('SessionEnd', { session_id: 'retro', cwd }, { AGENTIC_RETRO_RUN: '1' });
  hook('SessionEnd', { session_id: 'disabled', cwd: work });
  assert.deepEqual(readState(env.AGENTIC_RETRO_HOME, 'queue.json'), before);
});

async function details(catalog, nativeEnv) {
  const child = spawn('codex', ['app-server'], { cwd: work, env: nativeEnv, stdio: ['pipe', 'pipe', 'pipe'] });
  const lines = createInterface({ input: child.stdout });
  let errors = '';
  child.stderr.on('data', (data) => { errors = (errors + data).slice(-8000); });
  child.on('error', (error) => { errors = error.message; lines.close(); });
  const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
  const send = (message) => child.stdin.write(JSON.stringify(message) + '\n');
  try {
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'retro-package-test', version: '1' }, capabilities: { experimentalApi: true } } });
    for await (const line of lines) {
      const message = JSON.parse(line);
      assert.equal(message.error, undefined, JSON.stringify(message.error));
      if (message.id === 1) {
        send({ method: 'initialized', params: {} });
        send({ id: 2, method: 'plugin/read', params: { pluginName: 'agentic-retro', marketplacePath: join(catalog, '.agents/plugins/marketplace.json') } });
      }
      if (message.id === 2) return message.result.plugin;
    }
    throw new Error(`plugin/read ended without response: ${errors}`);
  } finally {
    clearTimeout(timer);
    lines.close();
    child.kill();
  }
}

test('native Codex npm install discovers all four skills and both lifecycle hooks', { skip: process.env.AGENTIC_RETRO_TEST_CODEX !== '1' }, async () => {
  const catalog = join(work, 'catalog');
  mkdirSync(join(catalog, '.agents/plugins'), { recursive: true });
  writeFileSync(join(catalog, '.agents/plugins/marketplace.json'), JSON.stringify({ name: 'retro-test', plugins: [{
    name: 'agentic-retro', source: { source: 'npm', package: 'agentic-retro', version: json(join(plugin, 'package.json')).version },
    policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity',
  }] }));
  const bin = join(work, 'native-bin');
  mkdirSync(bin);
  // Stub registry transport only. Codex parses the npm catalog and extracts the real tarball.
  const npmLog = join(work, 'npm-args.json');
  writeFileSync(join(bin, 'npm'), `#!${process.execPath}\nconst fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(npmLog)}, JSON.stringify(process.argv.slice(2))); fs.copyFileSync(${JSON.stringify(archive)}, 'retro.tgz');\n`, { mode: 0o755 });
  const nativeEnv = { ...process.env, HOME: env.HOME, CODEX_HOME: join(env.HOME, '.codex'), PATH: `${bin}:${process.env.PATH}` };
  mkdirSync(nativeEnv.CODEX_HOME);
  run('codex', ['plugin', 'marketplace', 'add', catalog, '--json'], { env: nativeEnv });
  run('codex', ['plugin', 'add', 'agentic-retro@retro-test', '--json'], { env: nativeEnv });
  const npmArgs = json(npmLog);
  assert.equal(npmArgs[0], 'pack');
  assert.ok(npmArgs.includes('--ignore-scripts'));
  assert.equal(npmArgs.at(-1), `agentic-retro@${json(join(plugin, 'package.json')).version}`);
  const result = await details(catalog, nativeEnv);
  assert.equal(result.skills.length, 4);
  assert.deepEqual(result.hooks.map((h) => h.eventName).sort(), ['sessionEnd', 'sessionStart']);
  const cache = join(nativeEnv.CODEX_HOME, 'plugins/cache/retro-test/agentic-retro');
  assert.ok(readdirSync(cache).some((entry) => existsSync(join(cache, entry, 'cli/agentic-retro.js'))));
});
