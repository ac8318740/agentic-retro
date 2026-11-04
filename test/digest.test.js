import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeBatchDigests } from '../cli/lib/digest.js';
import { tempDir } from './helpers/cli.js';
import { readSession as readPiSession } from '../cli/lib/transcripts/pi.js';

// Each fixture's assistant prose contains PROSE_MARKER_<HARNESS>; digests must never carry it.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function session(harness, sessionId, transcript) {
  return { harness, sessionId, transcript, cwd: '/work/demo', repo: '/work/demo', endedAt: '2026-10-01T13:00:00.000Z' };
}

async function digestFor(harness, sessionId, transcript, n = 1) {
  const home = tempDir();
  process.env.AGENTIC_RETRO_HOME = home;
  await writeBatchDigests(n, [session(harness, sessionId, transcript)]);
  return readFileSync(join(home, 'batches', String(n), `${sessionId}.md`), 'utf8');
}

const lineCount = (text) => text.trimEnd().split('\n').length;

test('claude digest keeps the header, user messages, tool calls, edits, errors, and subagents', async () => {
  const digest = await digestFor('claude', 'claude-s1', join(FIXTURES, 'claude.jsonl'));
  assert.match(digest, /claude/);
  assert.match(digest, /\/work\/demo/);
  assert.match(digest, /Add a greeting function to src\/greet\.js/);
  assert.match(digest, /Thanks, also run the tests/);
  assert.match(digest, /^.*Read.*greet\.js.*$/m);
  assert.match(digest, /^.*Bash.*npm test.*$/m);
  assert.match(digest, /^.*greet\.js.*\+3.*-2.*$/m);
  assert.match(digest, /^.*notes\.md.*\+4.*-0.*$/m);
  assert.match(digest, /^.*util\.js.*\+4.*-4.*$/m);
  assert.match(digest, /Test failed/);
  assert.match(digest, /subagents?\W+1\b/i);
  assert.doesNotMatch(digest, /PROSE_MARKER/);
});

test('codex digest keeps user messages, shell commands, apply_patch files, and failed commands', async () => {
  const digest = await digestFor('codex', 'codex-s1', join(FIXTURES, 'codex.jsonl'));
  assert.match(digest, /codex/);
  assert.match(digest, /Fix the off-by-one in src\/count\.js/);
  assert.match(digest, /Now tidy src\/sum\.js and run the tests/);
  assert.match(digest, /npm test/);
  assert.match(digest, /^.*count\.js.*\+1.*-1.*$/m);
  assert.match(digest, /^.*one\.js.*\+2.*-0.*$/m);
  assert.match(digest, /^.*sum\.js.*\+3.*-2.*$/m);
  assert.match(digest, /1 failing: sum adds numbers/);
  assert.doesNotMatch(digest, /environment_context/);
  assert.doesNotMatch(digest, /PROSE_MARKER/);
});

test('pi digest keeps user messages, tool calls, edits, and errors', async () => {
  const digest = await digestFor('pi', 'pi-s1', join(FIXTURES, 'pi.jsonl'));
  assert.match(digest, /\bpi\b/);
  assert.match(digest, /Rename the config loader in src\/config\.js/);
  assert.match(digest, /ok, stop there/);
  assert.match(digest, /^.*bash.*npm test.*$/m);
  assert.match(digest, /^.*config\.js.*\+3.*-3.*$/m);
  assert.match(digest, /^.*loader\.js.*\+2.*-0.*$/m);
  assert.match(digest, /1 failing in loader\.test\.js/);
  assert.doesNotMatch(digest, /PROSE_MARKER/);
});

for (const parentSession of [undefined, 'parent-agent']) {
  test(`Pi role-only messages stay speaker-unverified (${parentSession ? 'teammate' : 'lead'})`, async () => {
    const path = join(tempDir(), 'mixed-speakers.jsonl');
    const texts = [
      'Correction: never change the public API without asking me.',
      'Parent-agent brief: own test/** only; report to the coordinator.',
      'Please investigate the failing test.',
    ];
    const lines = [
      { type: 'session', id: 'mixed', cwd: '/work/demo', ...(parentSession ? { parentSession } : {}) },
      ...texts.map((text, i) => ({ type: 'message', timestamp: `2026-10-01T12:00:0${i}.000Z`, message: { role: 'user', content: [{ type: 'text', text }] } })),
      { type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'tool', name: 'bash', arguments: { command: 'npm test -- --test-concurrency=1' } }] } },
      { type: 'custom_message', customType: 'ac-teams', content: 'TEAM_NOTIFICATION_NOT_HUMAN_FEEDBACK' },
    ];
    writeFileSync(path, lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
    const digest = await digestFor('pi', 'mixed', path);
    assert.match(digest, /## User-role messages \(speaker unverified\)/);
    assert.match(digest, /role[= -]*user[\s\S]*(?:human[\s\S]*agent|agent[\s\S]*human)/i);
    for (const text of texts) assert.ok(digest.includes(text), 'keep text without inventing its author');
    assert.match(digest, /bash.*npm test -- --test-concurrency=1/);
    assert.doesNotMatch(digest, /## (?:Human feedback|User messages)|TEAM_NOTIFICATION_NOT_HUMAN_FEEDBACK/);
  });
}

test('a digest truncates long user messages to about 500 characters', async () => {
  const dir = tempDir('agentic-retro-transcript-');
  const path = join(dir, 'long-message.jsonl');
  const message = 'START_OF_MESSAGE ' + 'x'.repeat(2000) + ' END_OF_MESSAGE';
  writeFileSync(path, JSON.stringify({ type: 'user', sessionId: 'long-msg', cwd: '/work/demo', message: { role: 'user', content: message } }) + '\n');
  const digest = await digestFor('claude', 'long-msg', path);
  assert.match(digest, /START_OF_MESSAGE/);
  assert.doesNotMatch(digest, /END_OF_MESSAGE/);
  assert.ok(!digest.includes('x'.repeat(700)), 'message cut near 500 characters');
});

test('a digest stays under 200 lines for a long session', async () => {
  const dir = tempDir('agentic-retro-transcript-');
  const path = join(dir, 'long-session.jsonl');
  const lines = [];
  for (let i = 0; i < 400; i++) {
    const base = { sessionId: 'long-session', cwd: '/work/demo', timestamp: '2026-10-01T10:00:00.000Z' };
    lines.push({ ...base, type: 'user', message: { role: 'user', content: `Request number ${i}: ${'please '.repeat(80)}` } });
    lines.push({ ...base, type: 'assistant', message: { id: `msg_${i}`, role: 'assistant', usage: { input_tokens: 10, output_tokens: 5 },
      content: [{ type: 'tool_use', id: `tu${i}`, name: 'Edit', input: { file_path: `/work/demo/src/file${i % 50}.js`, old_string: 'a', new_string: 'b\nc' } }] } });
    lines.push({ ...base, type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `tu${i}`, content: 'ok' }] } });
  }
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  const digest = await digestFor('claude', 'long-session', path);
  assert.ok(lineCount(digest) < 200, `digest has ${lineCount(digest)} lines`);
  assert.match(digest, /Request number 0:/);
});

test('Pi questionnaire decisions stay discoverable after the ordinary message and tool previews fill up', async () => {
  const path = join(tempDir(), 'questionnaires.jsonl');
  const answer = 'Question: What should dev pushes run? Answer: Affected checks, not the full suite on every push.';
  const lines = [
    ...Array.from({ length: 65 }, (_, i) => ({ type: 'message', message: { role: 'user', content: `Request ${i}` } })),
    ...Array.from({ length: 65 }, (_, i) => ({ type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', id: `r${i}`, name: 'read', arguments: { path: 'README.md' } }] } })),
    { type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'q1', name: 'ask_user_question', arguments: { questions: [{ question: 'What should dev pushes run?' }] } }] } },
    { type: 'message', message: { role: 'toolResult', toolCallId: 'q1', toolName: 'ask_user_question', content: [{ type: 'text', text: answer }], isError: false } },
  ];
  // Raw line references must count blank and malformed records too.
  writeFileSync(path, '\nnot-json\n' + lines.map(JSON.stringify).join('\n') + '\n');
  const parsed = await readPiSession(path);
  assert.deepEqual(parsed.questionnaires, [{ line: 134, text: answer }]);
  assert.equal(parsed.turns.user, 65, 'tool-mediated answers are not invented user turns');
  assert.ok(!parsed.userMessages.includes(answer), 'keep the transport source separate');
  const digest = await digestFor('pi', 'decisions', path);
  assert.match(digest, /## Questionnaire answers \(speaker unverified\) \(1\)/);
  assert.ok(digest.includes(answer));
  assert.ok(digest.includes(`${path}:134`), 'point directly to the raw answer record');
  assert.match(digest, /untrusted.*tool|tool.*untrusted/i);
  assert.doesNotMatch(digest, /## Human feedback/);
});

test('Pi questionnaire capture excludes errors, cancellations, empty answers, and other tool output', async () => {
  const path = join(tempDir(), 'questionnaire-results.jsonl');
  const result = (toolName, text, extra = {}) => ({ type: 'message', message: { role: 'toolResult', toolName, content: [{ type: 'text', text }], ...extra } });
  writeFileSync(path, [
    result('read', 'NOT_A_QUESTIONNAIRE'),
    result('ask_user_question', 'FAILED_VALIDATION', { isError: true }),
    result('ask_user_question', 'CANCELLED', { details: { cancelled: true } }),
    result('ask_user_question', '  '),
    result('ask_user_question', 'Question: What matters? Answers: shared ownership; native controls; custom: keep focus.'),
  ].map(JSON.stringify).join('\n') + '\n');
  const parsed = await readPiSession(path);
  assert.deepEqual(parsed.questionnaires, [{ line: 5, text: 'Question: What matters? Answers: shared ownership; native controls; custom: keep focus.' }], 'self-contained tool results survive even without the original call');
  const digest = await digestFor('pi', 'results', path);
  assert.match(digest, /shared ownership; native controls; custom: keep focus/);
  assert.doesNotMatch(digest, /NOT_A_QUESTIONNAIRE|FAILED_VALIDATION|CANCELLED/);
});

test('questionnaire previews stay bounded with every digest section full', async () => {
  const path = join(tempDir(), 'bounded-questionnaires.jsonl');
  const lines = [];
  for (let i = 0; i < 100; i++) {
    lines.push({ type: 'message', message: { role: 'user', content: `Request ${i}` } });
    lines.push({ type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', id: `w${i}`, name: 'write', arguments: { path: `file${i}.js`, content: 'hello' } }] } });
    lines.push({ type: 'message', message: { role: 'toolResult', toolCallId: `w${i}`, isError: true, content: [{ type: 'text', text: 'write error' }] } });
    lines.push({ type: 'message', message: { role: 'toolResult', toolName: 'ask_user_question', content: [{ type: 'text', text: `Question ${i}\nAnswer: ${'x'.repeat(5000)} END_OF_ANSWER` }] } });
  }
  writeFileSync(path, lines.map(JSON.stringify).join('\n') + '\n');
  const digest = await digestFor('pi', 'bounded', path);
  assert.match(digest, /Questionnaire answers.*\(100\)/);
  assert.match(digest, /90 more/);
  assert.doesNotMatch(digest, /END_OF_ANSWER/);
  assert.ok(lineCount(digest) < 200, `digest has ${lineCount(digest)} lines`);
});

test('a null or missing transcript writes a short digest that says so, without throwing', async () => {
  const home = tempDir();
  process.env.AGENTIC_RETRO_HOME = home;
  await writeBatchDigests(3, [session('claude', 'no-path', null), session('pi', 'gone', '/nonexistent/agentic-retro/gone.jsonl')]);
  for (const id of ['no-path', 'gone']) {
    const path = join(home, 'batches', '3', `${id}.md`);
    assert.ok(existsSync(path), `${id}.md exists`);
    const digest = readFileSync(path, 'utf8');
    assert.match(digest, /transcript/i);
    assert.match(digest, /missing|unavailable|not found|no transcript/i);
    assert.ok(lineCount(digest) < 20);
  }
});
