// Runs the CLI as a black box against a throwaway state folder.
import { spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'cli', 'agentic-retro.js');

export function tempDir(prefix = 'agentic-retro-test-') {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

// Existing collection tests opt in explicitly; ordinary temp directories remain disabled.
export function enabledRepo() {
  const cwd = tempDir('agentic-retro-enabled-');
  execFileSync('git', ['init', '-q', cwd]);
  execFileSync('git', ['-C', cwd, 'config', '--local', 'agentic-retro.enabled', 'true']);
  return cwd;
}

// Every run gets AGENTIC_RETRO_DRY_RUN=1 so a ready batch never launches real agents.
export function run(home, args, { env = {}, input = '', cwd } = {}) {
  const baseEnv = { ...process.env };
  delete baseEnv.AGENTIC_RETRO_RUN;
  const result = spawnSync('node', [CLI, ...args], {
    cwd,
    input,
    encoding: 'utf8',
    env: { ...baseEnv, AGENTIC_RETRO_HOME: home, AGENTIC_RETRO_DRY_RUN: '1', ...env },
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

export function readState(home, file) {
  const path = join(home, file);
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : undefined;
}
