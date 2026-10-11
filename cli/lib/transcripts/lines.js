// Shared helpers for the transcript readers: stream JSONL and count lines in edit text.
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

// Calls fn on each parsed line; skips lines that are not JSON. Streams, so 100MB+ transcripts stay cheap.
export async function eachLine(path, fn) {
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of lines) {
    let entry;
    try { entry = JSON.parse(line); } catch { continue; }
    if (entry && typeof entry === 'object') fn(entry);
  }
}

// "a\nb\n" is two lines; "" is none.
export function countLines(text) {
  if (typeof text !== 'string' || text === '') return 0;
  return text.replace(/\n$/, '').split('\n').length;
}

export function emptySession() {
  return {
    cwd: null, start: null, end: null, userMessages: [], toolCalls: [], edits: [],
    usage: null, turns: { user: 0, assistant: 0 }, subagents: 0,
  };
}

// Keeps the first and last timestamp seen.
export function stamp(session, timestamp) {
  if (!timestamp) return;
  session.start ??= timestamp;
  session.end = timestamp;
}
