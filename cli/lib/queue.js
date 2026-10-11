// The queue: finished sessions wait here until their group fills a batch.
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { readJson, writeJson } from './paths.js';
import { loadConfig } from './config.js';
import { startBatch } from './runner.js';

function repoOf(cwd) {
  try {
    return execFileSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return cwd;
  }
}

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

export async function enqueue({ harness, sessionId, transcript, cwd }) {
  if (process.env.AGENTIC_RETRO_RUN === '1') return; // batch agents never queue themselves
  transcript ||= findCodexRollout(sessionId) ?? null;
  harness ||= harnessOf(transcript);
  if (!harness || !sessionId || !cwd) throw new Error('enqueue needs a harness, session, and cwd');

  const queue = readJson('queue.json', []);
  if (queue.some((s) => s.sessionId === sessionId)) return;
  const entry = { harness, sessionId, transcript, cwd, repo: repoOf(cwd), endedAt: new Date().toISOString() };
  queue.push(entry);

  const { batch } = loadConfig();
  const sameGroup = (s) => batch.group === 'global' || s.repo === entry.repo;
  const group = queue.filter(sameGroup);
  if (group.length < batch.size) return writeJson('queue.json', queue);

  // Save first and remove after, so a failed hand-off leaves the sessions queued.
  writeJson('queue.json', queue);
  const sessions = group.slice(0, batch.size);
  await startBatch(sessions);
  writeJson('queue.json', queue.filter((s) => !sessions.includes(s)));
}
