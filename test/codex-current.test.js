import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeBatchDigests } from '../cli/lib/digest.js';
import { tempDir } from './helpers/cli.js';

// codex-current.jsonl copies the codex-cli 0.162 shape: messages are response_item records,
// the shell tool is a custom_tool_call named exec whose input is a script, subagents come from spawn_agent.
const TRANSCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'codex-current.jsonl');
const SESSION = { harness: 'codex', sessionId: 'codex-c1', transcript: TRANSCRIPT, cwd: '/work/demo', repo: '/work/demo', endedAt: '2026-10-02T11:00:00.000Z' };

async function digestAndMetrics() {
  const home = tempDir();
  process.env.AGENTIC_RETRO_HOME = home;
  await writeBatchDigests(1, [SESSION]);
  return {
    digest: readFileSync(join(home, 'batches', '1', 'codex-c1.md'), 'utf8'),
    metrics: JSON.parse(readFileSync(join(home, 'metrics.jsonl'), 'utf8').trim()),
  };
}

test('current codex metrics count response_item turns, token totals, and apply_patch lines inside exec', async () => {
  // Injected environment, AGENTS.md, and user_instructions messages are not turns.
  // Three assistant messages. apply_patch: math.js -2 +3, extra.js (Add File) +2.
  const { metrics } = await digestAndMetrics();
  const { userTurns, assistantTurns, inputTokens, outputTokens, linesAdded, linesRemoved } = metrics;
  assert.deepEqual({ userTurns, assistantTurns, inputTokens, outputTokens, linesAdded, linesRemoved }, {
    userTurns: 2, assistantTurns: 3, inputTokens: 9000, outputTokens: 450, linesAdded: 5, linesRemoved: 2,
  });
});

test('current codex digest lists the real user messages and none of the injected ones', async () => {
  const { digest } = await digestAndMetrics();
  assert.match(digest, /Rename add to sum in src\/math\.js/);
  assert.match(digest, /Now run the tests with a helper agent/);
  for (const injected of ['environment_context', 'INJECTED_AGENTS_MD', 'INJECTED_USER_INSTRUCTIONS', 'INJECTED_DEVELOPER']) {
    assert.ok(!digest.includes(injected), injected);
  }
  assert.doesNotMatch(digest, /PROSE_MARKER/);
});

test('current codex digest shows each exec call as the command it ran', async () => {
  const { digest } = await digestAndMetrics();
  for (const command of [/^.*cat src\/math\.js.*$/m, /^.*npm test.*$/m]) {
    const line = digest.match(command)?.[0];
    assert.ok(line, `a tool line for ${command}`);
    assert.ok(!line.includes('tools.exec_command'), `the line names the command, not the script: ${line}`);
  }
});

test('current codex digest shows apply_patch edits per file and counts spawn_agent subagents', async () => {
  const { digest } = await digestAndMetrics();
  assert.match(digest, /^.*math\.js.*\+3.*-2.*$/m);
  assert.match(digest, /^.*extra\.js.*\+2.*-0.*$/m);
  assert.match(digest, /subagents?\W+1\b/i);
});
