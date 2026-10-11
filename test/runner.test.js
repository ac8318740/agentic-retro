import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULTS } from '../cli/lib/config.js';
import { buildCommand } from '../cli/lib/runner.js';
import { tempDir, run, readState } from './helpers/cli.js';

// buildCommand(config, batchDir, n) -> { file, args, env, cwd } (herdr: a list of such steps).
// Tests assert the parts that matter, not full argv, so flags can follow each harness's --help.

const DIR = '/tmp/batches/7';
const build = (runner) => buildCommand({ ...DEFAULTS, runner: { ...DEFAULTS.runner, ...runner } }, DIR, 7);
const promptOf = (args) => args.find((a) => /\brun\b/.test(a) && a.includes('7'));
const after = (args, flag) => args[args.indexOf(flag) + 1];

function assertRunsInBatch(cmd) {
  assert.equal(cmd.cwd, DIR);
  assert.equal(cmd.env.AGENTIC_RETRO_RUN, '1');
  assert.ok(promptOf(cmd.args), `a prompt names the run skill and batch 7: ${cmd.args}`);
}

test('runner.permissions defaults to auto and accepts scoped', () => {
  const home = tempDir();
  assert.equal(run(home, ['config', 'get', 'runner.permissions']).stdout.trim(), 'auto');
  assert.equal(run(home, ['config', 'set', 'runner.permissions', 'scoped']).code, 0);
  assert.equal(run(home, ['config', 'get', 'runner.permissions']).stdout.trim(), 'scoped');
});

test('claude: claude -p with the model and auto permission mode', () => {
  const cmd = build({ harness: 'claude', model: 'opus', permissions: 'auto' });
  assert.equal(cmd.file, 'claude');
  assert.ok(cmd.args.includes('-p'));
  assertRunsInBatch(cmd);
  assert.equal(after(cmd.args, '--model'), 'opus');
  assert.equal(after(cmd.args, '--permission-mode'), 'auto');
});

test('claude: model default omits --model; bypass and scoped map to permission flags', () => {
  const bypass = build({ harness: 'claude', model: 'default', permissions: 'bypass' });
  assert.ok(!bypass.args.includes('--model'));
  assert.equal(after(bypass.args, '--permission-mode'), 'bypassPermissions');

  const scoped = build({ harness: 'claude', permissions: 'scoped' });
  assert.equal(after(scoped.args, '--permission-mode'), 'acceptEdits');
  const allowed = scoped.args.join(' ');
  for (const tool of ['Bash(git:*)', 'Bash(gh:*)', 'Bash(agentic-retro:*)']) assert.ok(allowed.includes(tool), tool);
});

test('codex: codex exec passes the env through and maps each permission mode', () => {
  const auto = build({ harness: 'codex', model: 'o3', permissions: 'auto' });
  assert.equal(auto.file, 'codex');
  assert.equal(auto.args[0], 'exec');
  assertRunsInBatch(auto);
  assert.ok(auto.args.includes('shell_environment_policy.inherit=all'));
  assert.equal(after(auto.args, '-m'), 'o3');
  assert.ok(auto.args.includes('--approve-for-me'));
  assert.equal(after(auto.args, '-s'), 'workspace-write');

  const bypass = build({ harness: 'codex', model: 'default', permissions: 'bypass' });
  assert.ok(!bypass.args.includes('-m'));
  assert.ok(bypass.args.includes('--dangerously-bypass-approvals-and-sandbox'));

  const scoped = build({ harness: 'codex', permissions: 'scoped' });
  assert.equal(after(scoped.args, '-s'), 'workspace-write');
  assert.ok(!scoped.args.includes('--approve-for-me'));
});

test('pi: pi -p with --model unless default or opus (opus is a Claude model)', () => {
  const cmd = build({ harness: 'pi', model: 'o3' });
  assert.equal(cmd.file, 'pi');
  assert.ok(cmd.args.includes('-p'));
  assertRunsInBatch(cmd);
  assert.equal(after(cmd.args, '--model'), 'o3');
  assert.ok(!build({ harness: 'pi', model: 'default' }).args.includes('--model'));
  assert.ok(!build({ harness: 'pi', model: 'opus' }).args.includes('--model'));
});

test('herdr: opens a workspace in the batch folder, then types the claude command into its pane', () => {
  const steps = build({ harness: 'herdr', model: 'opus', permissions: 'auto' });
  assert.ok(Array.isArray(steps));
  const [create, ...rest] = steps;
  assert.equal(create.file, 'herdr');
  assert.deepEqual(create.args.slice(0, 2), ['workspace', 'create']);
  assert.equal(after(create.args, '--cwd'), DIR);
  assert.equal(after(create.args, '--env'), 'AGENTIC_RETRO_RUN=1');
  assert.ok(create.args.includes('--no-focus'));

  const paneRun = rest.find((s) => s.args[0] === 'pane' && s.args[1] === 'run');
  assert.ok(paneRun, 'a herdr pane run step');
  const line = paneRun.args.at(-1);
  assert.match(line, /^claude\b.*-p/);
  assert.match(line, /--model opus/);
  assert.match(line, /7/);
});

// Fake agent: records argv, env, and cwd beside itself, prints a line, then lingers.
const FAKE_AGENT = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
fs.writeFileSync(path.join(__dirname, 'launch.json'), JSON.stringify({
  argv: process.argv.slice(2), run: process.env.AGENTIC_RETRO_RUN, cwd: process.cwd() }));
console.log('fake agent started');
setTimeout(() => {}, 3000);
`;

async function waitFor(check, ms = 5000) {
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 50))) {
    if (check()) return;
  }
  assert.fail('timed out waiting');
}

test('a ready batch syncs outcomes, then launches the agent detached with output in run.log', async () => {
  const home = tempDir();
  const fakeDir = tempDir('agentic-retro-fake-');
  const fake = join(fakeDir, 'fake-agent.cjs');
  writeFileSync(fake, FAKE_AGENT);
  chmodSync(fake, 0o755);
  writeFileSync(join(home, 'ledger.json'), JSON.stringify({ nextId: 2, batchCount: 3, proposals: [
    { id: 'P1', batch: 0, repo: '/r', category: 'clarity', risk: null, title: 'stale', status: 'open',
      createdAt: '2026-01-01T00:00:00.000Z', statusAt: null, pr: null, commit: null }] }));
  run(home, ['config', 'set', 'batch.size', '1']);
  const cwd = tempDir('agentic-retro-plain-');

  const started = Date.now();
  const { code, stderr } = run(home, ['enqueue', '--harness', 'claude', '--session', 's1',
    '--transcript', '/t/s1.jsonl', '--cwd', cwd], { env: { AGENTIC_RETRO_DRY_RUN: '', AGENTIC_RETRO_LAUNCHER: fake } });
  assert.equal(code, 0, stderr);
  assert.ok(Date.now() - started < 2500, 'enqueue returns without waiting for the agent');

  const ledger = readState(home, 'ledger.json');
  assert.equal(ledger.batchCount, 4);
  assert.equal(ledger.proposals[0].status, 'expired', 'outcome sync ran');

  const batchDir = join(home, 'batches', '4');
  assert.ok(existsSync(join(batchDir, 'batch.json')));
  await waitFor(() => existsSync(join(fakeDir, 'launch.json')));
  const launch = JSON.parse(readFileSync(join(fakeDir, 'launch.json'), 'utf8'));
  assert.ok(launch.argv.includes('-p'));
  assert.ok(launch.argv.some((a) => /\brun\b/.test(a) && a.includes('4')));
  assert.equal(launch.run, '1');
  assert.equal(launch.cwd, batchDir);
  await waitFor(() => existsSync(join(batchDir, 'run.log'))
    && readFileSync(join(batchDir, 'run.log'), 'utf8').includes('fake agent started'));
});
