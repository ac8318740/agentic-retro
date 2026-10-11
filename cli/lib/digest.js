// Writes a short markdown digest and one metrics.jsonl line per session in a batch.
import { mkdirSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { dirname, basename } from 'node:path';
import { statePath } from './paths.js';
import * as claude from './transcripts/claude.js';
import * as codex from './transcripts/codex.js';
import * as pi from './transcripts/pi.js';

const readers = { claude, codex, pi };

// Caps keep a digest under 200 lines however long the session ran.
const MAX_MESSAGE = 500;
const MAX_TARGET = 120;
const MAX_USER = 50;
const MAX_TIMELINE = 60;
const MAX_ERRORS = 20;
const MAX_FILES = 30;

const oneLine = (text, max) => {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
};

// The first `max` items as lines, plus a note for the rest.
function capped(items, max, format) {
  const lines = items.slice(0, max).map(format);
  if (items.length > max) lines.push(`- ... ${items.length - max} more`);
  return lines.length ? lines : ['- none'];
}

async function readTranscript(harness, transcript) {
  const reader = readers[harness];
  if (!reader || !transcript || !existsSync(transcript)) return null;
  try {
    return await reader.readSession(transcript);
  } catch {
    return null;
  }
}

function metricsOf(n, s, parsed) {
  const sum = (key) => (parsed ? parsed.edits.reduce((total, e) => total + e[key], 0) : null);
  return {
    batch: n, harness: s.harness, sessionId: s.sessionId, repo: s.repo ?? null,
    userTurns: parsed?.turns.user ?? null,
    assistantTurns: parsed?.turns.assistant ?? null,
    inputTokens: parsed?.usage?.input ?? null,
    outputTokens: parsed?.usage?.output ?? null,
    linesAdded: sum('added'),
    linesRemoved: sum('removed'),
  };
}

// Sums edits per file, in the order files were first touched.
function filesEdited(edits) {
  const files = new Map();
  for (const { file, added, removed } of edits) {
    const total = files.get(file) ?? { file, added: 0, removed: 0 };
    files.set(file, { file, added: total.added + added, removed: total.removed + removed });
  }
  return [...files.values()];
}

function digestOf(s, parsed, m) {
  const header = [
    `# Session ${s.sessionId}`, '',
    `- harness: ${s.harness}`,
    `- repo: ${s.repo ?? 'unknown'}`,
    `- cwd: ${parsed?.cwd ?? s.cwd ?? 'unknown'}`,
    `- transcript: ${s.transcript ?? 'none'}`,
  ];
  if (!parsed) return [...header, '', 'Transcript missing: no transcript was found for this session, so there is no digest or metrics.'];

  const show = (v) => (v === null ? 'n/a' : v);
  const calls = parsed.toolCalls;
  const errors = calls.filter((c) => c.error);
  return [
    ...header,
    `- start: ${parsed.start ?? 'unknown'}`,
    `- end: ${s.endedAt ?? parsed.end ?? 'unknown'}`,
    `- turns: ${m.userTurns} user, ${m.assistantTurns} assistant`,
    `- tokens: ${show(m.inputTokens)} in, ${show(m.outputTokens)} out`,
    `- lines: +${m.linesAdded} -${m.linesRemoved}`,
    `- subagents: ${parsed.subagents}`,
    '', `## User messages (${parsed.userMessages.length})`, '',
    ...capped(parsed.userMessages, MAX_USER, (text, i) => `${i + 1}. ${oneLine(text, MAX_MESSAGE)}`),
    '', `## Tool calls (${calls.length})`, '',
    ...capped(calls, MAX_TIMELINE, (c) => `- ${c.tool} ${oneLine(c.target, MAX_TARGET)}${c.error ? ' [error]' : ''}`),
    '', `## Errors (${errors.length})`, '',
    ...capped(errors, MAX_ERRORS, (c) => `- ${c.tool} ${oneLine(c.target, 60)}: ${oneLine(c.error, MAX_TARGET)}`),
    '', '## Files edited', '',
    ...capped(filesEdited(parsed.edits), MAX_FILES, (f) => `- ${basename(f.file ?? '?')} +${f.added} -${f.removed} (${f.file})`),
  ];
}

export async function writeBatchDigests(n, sessions) {
  const metricsPath = statePath('metrics.jsonl');
  mkdirSync(dirname(metricsPath), { recursive: true });
  for (const s of sessions) {
    const parsed = await readTranscript(s.harness, s.transcript);
    const m = metricsOf(n, s, parsed);
    const path = statePath('batches', String(n), `${s.sessionId}.md`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, digestOf(s, parsed, m).join('\n') + '\n');
    appendFileSync(metricsPath, JSON.stringify(m) + '\n');
  }
}
