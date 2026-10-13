import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { tempDir, run } from '../helpers/cli.js';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const EXTENSION_PATH = join(PACKAGE_ROOT, 'cli', 'lib', 'pi-extension.ts');

async function loadPiExtension(extensionPath = EXTENSION_PATH) {
  const source = readFileSync(extensionPath, 'utf8')
    .replace(/^import type .*\n/m, '')
    .replace('import { execFile, spawn } from "node:child_process";', 'const execFile = globalThis.__agenticRetroExecFile; const spawn = () => ({ unref() {} });')
    .replace(/type CommandContext = \{[\s\S]*?\};\n\n/, '')
    .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(extensionPath).href))
    .replaceAll(': ExtensionAPI', '')
    .replaceAll(': CommandContext', '')
    .replaceAll('args: string', 'args')
    .replaceAll('message: string', 'message')
    .replaceAll('skill: string', 'skill');

  const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  return import(url);
}

test('agentic-retro command preserves quoted argument values when dispatching to the CLI', async () => {
  let execArgv;
  globalThis.__agenticRetroExecFile = (_command, argv, callback) => {
    execArgv = argv;
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

  await commands.get('agentic-retro').handler('propose --title "hello \\"world\\"" --empty "" --repo "/tmp/with space"', {});

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
  globalThis.__agenticRetroExecFile = (command, argv, callback) => {
    execCommand = command;
    execArgv = argv;
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

  await commands.get('agentic-retro').handler('notice', {});

  try {
    assert.equal(execCommand, process.execPath);
    assert.deepEqual(execArgv, [join(PACKAGE_ROOT, 'cli', 'agentic-retro.js'), 'notice']);
  } finally {
    delete globalThis.__agenticRetroExecFile;
  }
});
