// The queue: finished sessions wait here until their group fills a batch.
import { createReadStream, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { createInterface } from 'node:readline';
import { readJson, writeJson } from './paths.js';
import { loadConfig } from './config.js';
import { startBatch } from './runner.js';
import { projectEnabled, repoOf } from './project.js';

// Codex sometimes ends a session with a null transcript_path, so look for its rollout file.
function findCodexRollout(sessionId) {
  const sessions = join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions');
  try {
    const match = readdirSync(sessions, { recursive: true }).find((f) => f.endsWith(`-${sessionId}.jsonl`));
    return match ? join(sessions, match) : null;
  } catch {
    return null;
  }
}

// Claude Code and Codex share one hook, so the transcript path tells them apart.
// Only Codex ends a session with no transcript path.
function harnessOf(transcript) {
  if (!transcript) return 'codex';
  if (transcript.includes('/.codex/') || basename(transcript).startsWith('rollout-')) return 'codex';
  if (transcript.includes('/.claude/')) return 'claude';
  if (transcript.includes('/.pi/')) return 'pi';
  return undefined;
}

async function isPiChildTranscript(transcript) {
  if (!transcript) return false;
  try {
    const lines = createInterface({ input: createReadStream(transcript), crlfDelay: Infinity });
    for await (const line of lines) {
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      if (entry?.type !== 'session') continue;
      return Object.hasOwn(entry, 'parentSession');
    }
  } catch {
    return false;
  }
  return false;
}

export async function enqueue({ harness, sessionId, transcript, cwd }) {
  if (process.env.AGENTIC_RETRO_RUN === '1') return; // batch agents never queue themselves
  if (!projectEnabled(cwd)) return;
  transcript ||= findCodexRollout(sessionId) ?? null;
  harness ||= harnessOf(transcript);
  if (!harness || !sessionId || !cwd) throw new Error('enqueue needs a harness, session, and cwd');
  if (harness === 'pi' && await isPiChildTranscript(transcript)) return;

  const queue = readJson('queue.json', []).map((s) => ({ ...s, repo: repoOf(s.cwd, s.repo) }));
  if (queue.some((s) => s.sessionId === sessionId)) return writeJson('queue.json', queue);
  const entry = { harness, sessionId, transcript, cwd, repo: repoOf(cwd), endedAt: new Date().toISOString() };
  queue.push(entry);

  const { batch } = loadConfig();
  const sameGroup = (s) => batch.group === 'global' || s.repo === entry.repo;
  const group = queue.filter((s) => sameGroup(s) && projectEnabled(s.repo));
  if (group.length < batch.size) return writeJson('queue.json', queue);

  // Save first and remove after, so a failed hand-off leaves the sessions queued.
  writeJson('queue.json', queue);
  const sessions = group.slice(0, batch.size);
  await startBatch(sessions);
  writeJson('queue.json', queue.filter((s) => !sessions.includes(s)));
}
