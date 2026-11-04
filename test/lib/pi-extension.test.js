import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { tempDir, run } from '../helpers/cli.js';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXTENSION_PATH = join(PACKAGE_ROOT, 'cli', 'lib', 'pi-extension.ts');

async function loadPiExtension(extensionPath = EXTENSION_PATH) {
  const source = readFileSync(extensionPath, 'utf8')
    .replace(/^import type .*\n/m, '')
    .replace('import { execFile, spawn } from "node:child_process";', 'const execFile = globalThis.__agenticRetroExecFile; const spawn = (...args) => globalThis.__agenticRetroSpawn?.(...args) ?? ({ on() {}, unref() {} });')
    .replace(/type CommandContext = \{[\s\S]*?\};\n\n/, '')
    .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(extensionPath).href))
    .replaceAll(': ExtensionAPI', '')
    .replaceAll(': CommandContext', '')
    .replaceAll('args: string', 'args')
    .replaceAll('message: string', 'message')
    .replaceAll('skill: string', 'skill')
    .replaceAll('path: string', 'path');

  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return import(url);
}

test('agentic-retro command preserves quoted argument values when dispatching to the CLI', async () => {
  let execArgv;
  globalThis.__agenticRetroExecFile = (_command, argv, options, callback) => {
    execArgv = argv;
    assert.equal(options.cwd, '/tmp/active-project');
    callback(null, '', '');
  };

  const { default: registerExtension } = await loadPiExtension();
  const commands = new Map();
  registerExtension({
    registerCommand(name, config) {
      commands.set(name, config);
    },
    on() {},
  });

  await commands.get('agentic-retro').handler('propose --title "hello \\"world\\"" --empty "" --repo "/tmp/with space"', { cwd: '/tmp/active-project' });

  try {
    assert.deepEqual(execArgv.slice(1), [
      'propose',
      '--title',
      'hello "world"',
      '--empty',
      '',
      '--repo',
      '/tmp/with space',
    ]);
  } finally {
    delete globalThis.__agenticRetroExecFile;
  }
});

test('installed agentic-retro command dispatches through node to the package-local CLI', async () => {
  const home = tempDir();
  const piHome = tempDir('agentic-retro-pi-');
  const install = run(home, ['install-pi'], { env: { PI_HOME: piHome } });
  assert.equal(install.code, 0, install.stderr);

  let execCommand;
  let execArgv;
  globalThis.__agenticRetroExecFile = (command, argv, options, callback) => {
    execCommand = command;
    execArgv = argv;
    assert.equal(options.cwd, '/tmp/active-project');
    callback(null, '', '');
  };

  const { default: registerExtension } = await loadPiExtension(join(piHome, 'agent', 'extensions', 'agentic-retro.ts'));
  const commands = new Map();
  registerExtension({
    registerCommand(name, config) {
      commands.set(name, config);
    },
    on() {},
  });

  await commands.get('agentic-retro').handler('notice', { cwd: '/tmp/active-project' });

  try {
    assert.equal(execCommand, process.execPath);
    assert.deepEqual(execArgv, [join(PACKAGE_ROOT, 'cli', 'agentic-retro.js'), 'notice']);
  } finally {
    delete globalThis.__agenticRetroExecFile;
  }
});

for (const marker of ['AC_TEAMS_SOCKET', 'AC_TEAMS_MEMBER', 'AC_TEAMS_TOKEN', 'PI_SUBAGENT_CHILD', 'PI_SUBAGENTS_HERDR_BRIDGE']) {
  test(`Pi shutdown collects ${marker} teammate but suppresses retro RUN`, async () => {
    const home = tempDir();
    const transcript = join(home, 'child.jsonl');
    writeFileSync(transcript, JSON.stringify({ type: 'session', id: 'synthetic-child' }) + '\n');
    const keys = ['AGENTIC_RETRO_RUN', 'AC_TEAMS_SOCKET', 'AC_TEAMS_MEMBER', 'AC_TEAMS_TOKEN', 'PI_SUBAGENT_CHILD', 'PI_SUBAGENTS_HERDR_BRIDGE'];
    const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    let launches = 0;
    globalThis.__agenticRetroSpawn = () => { launches++; return { on() {}, unref() {} }; };
    try {
      for (const key of keys) delete process.env[key];
      process.env[marker] = '1';
      const hooks = new Map();
      const { default: registerExtension } = await loadPiExtension();
      registerExtension({ registerCommand() {}, on(name, handler) { hooks.set(name, handler); } });
      const ctx = { cwd: home, sessionManager: { getSessionFile: () => transcript, getSessionId: () => 'synthetic-child' } };
      await hooks.get('session_shutdown')({ reason: 'quit' }, ctx);
      assert.equal(launches, 1, 'teammate shutdown dispatches enqueue');
      process.env.AGENTIC_RETRO_RUN = '1';
      await hooks.get('session_shutdown')({ reason: 'quit' }, ctx);
      assert.equal(launches, 1, 'retro-internal teammate cannot recursively enqueue');
      delete process.env.AGENTIC_RETRO_RUN;
      delete process.env[marker];
      await hooks.get('session_shutdown')({ reason: 'quit' }, ctx);
      assert.equal(launches, 2, 'top-level shutdown still dispatches enqueue');
    } finally {
      for (const key of keys) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
      delete globalThis.__agenticRetroSpawn;
    }
  });
}

test('native setup alias supplies bundled CLI context without requiring a global binary', async () => {
  const commands = new Map();
  let prompt;
  const { default: registerExtension } = await loadPiExtension();
  registerExtension({ registerCommand(name, config) { commands.set(name, config); }, on() {} });
  await commands.get('agentic-retro:setup').handler('', { addUserMessage(message) { prompt = message; } });
  assert.ok(prompt.includes(join(PACKAGE_ROOT, 'cli', 'agentic-retro.js')), 'setup receives the absolute bundled CLI path');
  assert.ok(prompt.includes(process.execPath), 'setup receives the node executable path');
  assert.match(prompt, /native|already (?:installed|loaded)|package install/i, 'setup knows native installation is already active');
  assert.doesNotMatch(prompt, /npm install -g|run agentic-retro install-pi/i);
});
