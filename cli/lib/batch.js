// Durable Pi attempts; a finish request is not a successful process exit.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { statePath, readJson, writeJson } from './paths.js';
import { independentPiEnv } from './pi-context.js';
import { writeBatchDigests } from './digest.js';

export function batchDir(n) {
  if (!/^[1-9]\d*$/.test(String(n))) throw new Error('batch needs a positive integer ID');
  return statePath('batches', String(n));
}

export function readStatus(n) {
  const dir = batchDir(n);
  if (!existsSync(join(dir, 'batch.json'))) throw new Error(`batch ${n} has no manifest`);
  const path = join(dir, 'status.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { batch: Number(n), status: 'unverified' };
}

function atomicJson(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  renameSync(temp, path);
}

export function updateStatus(n, attempt, patch) {
  const current = readStatus(n);
  if (current.attempt !== attempt) throw new Error('stale batch attempt');
  const next = { ...current, ...patch };
  atomicJson(join(batchDir(n), 'status.json'), next);
  return next;
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error('Cannot determine batch process ownership; refusing recovery');
  try { process.kill(pid, 0); return true; } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw new Error('Cannot determine batch process ownership; refusing recovery');
  }
}

function checkRetry(status, recoverStale, locked = false) {
  if (status.status === 'completed') throw new Error('Completed batch cannot be retried');
  if (['starting', 'running'].includes(status.status) || (locked && ['failed', 'incomplete'].includes(status.status))) {
    if (!recoverStale) throw new Error('Batch may be active; inspect it before using --recover-stale');
    if (alive(status.supervisorPid) || (status.childPid !== undefined && alive(status.childPid))) {
      throw new Error('Batch process is still active; refusing retry');
    }
    if (status.childPid === undefined) throw new Error('Batch child ownership is unknown; refusing automatic stale recovery');
  } else if (status.status === 'unverified') {
    if (!recoverStale) throw new Error('Unverified legacy batch; inspect processes and side effects before --recover-stale');
  } else if (!['failed', 'incomplete'].includes(status.status)) {
    throw new Error('Unknown batch status; refusing retry');
  }
}

export function releaseAttempt(n, attempt) {
  const lock = join(batchDir(n), 'run.lock');
  if (JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8')).attempt !== attempt) throw new Error('stale batch lock');
  rmSync(lock, { recursive: true });
}

export async function launchPi(n, command, { retry = false, recoverStale = false } = {}) {
  const dir = batchDir(n);
  const previous = readStatus(n);
  const lock = join(dir, 'run.lock');
  const locked = existsSync(lock);
  if (retry) checkRetry(previous, recoverStale, locked);
  if (locked) {
    if (!retry || !recoverStale || !['starting', 'running', 'failed', 'incomplete'].includes(previous.status)) throw new Error('Batch attempt is locked');
    const owner = JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8'));
    if (owner.attempt !== previous.attempt || !/^[a-zA-Z0-9-]+$/.test(previous.attempt)) throw new Error('Ambiguous batch lock; refusing recovery');
    // A deterministic, nonempty destination prevents two stale recoveries removing a new lock.
    renameSync(lock, join(dir, `stale-${previous.attempt}.lock`));
  }
  mkdirSync(lock);
  const attempt = randomUUID();
  writeFileSync(join(lock, 'owner.json'), JSON.stringify({ attempt, pid: process.pid }), { mode: 0o600 });
  let supervisor;
  try {
    // Recheck under the exclusive lock: another retry may have already finished.
    if (retry) checkRetry(readStatus(n), recoverStale, locked);
    atomicJson(join(dir, 'status.json'), { batch: Number(n), status: 'starting', attempt, supervisorPid: process.pid, startedAt: new Date().toISOString() });
    const env = { ...independentPiEnv(), ...command.env, AGENTIC_RETRO_ATTEMPT: attempt };
    if (retry) {
      const { sessions } = JSON.parse(readFileSync(join(dir, 'batch.json'), 'utf8'));
      await writeBatchDigests(n, sessions.filter((session) => !existsSync(join(dir, `${session.sessionId}.md`))));
    }
    const out = openSync(join(dir, 'run.log'), 'a', 0o600);
    try {
      await new Promise((resolve, reject) => {
        const child = supervisor = spawn(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), 'pi-runner.js'), String(n), JSON.stringify(command)], {
          cwd: dir, env, detached: true, stdio: ['ignore', out, out, 'ipc'],
        });
        if (child.pid) updateStatus(n, attempt, { supervisorPid: child.pid });
        let acknowledged = false;
        child.once('error', reject);
        child.once('exit', () => { if (!acknowledged) reject(new Error('Pi supervisor exited before launch acknowledgement')); });
        child.once('message', (message) => {
          acknowledged = true;
          child.disconnect();
          child.unref();
          if (message.error) reject(new Error(message.error));
          else resolve();
        });
      });
    } finally { closeSync(out); }
  } catch (error) {
    const current = readStatus(n);
    const uncertain = supervisor?.pid && ['starting', 'running'].includes(current.status);
    if (current.attempt === attempt) updateStatus(n, attempt, { ...(uncertain ? {} : { status: 'failed', endedAt: new Date().toISOString() }), error: error.message });
    if (!uncertain && existsSync(lock) && JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8')).attempt === attempt) releaseAttempt(n, attempt);
    throw error;
  }
  return n;
}

export function finishBatch(n, summary) {
  const status = readStatus(n);
  const attempt = process.env.AGENTIC_RETRO_ATTEMPT;
  if (!attempt || attempt !== status.attempt || status.status !== 'running') throw new Error('finish requires the current running batch attempt');
  if (!summary?.trim()) throw new Error('finish requires a nonempty --summary');
  atomicJson(join(batchDir(n), `finish-${attempt}.json`), { attempt, summary: summary.trim() });
}

export function completion(n, attempt) {
  const path = join(batchDir(n), `finish-${attempt}.json`);
  if (!existsSync(path)) return null;
  const result = JSON.parse(readFileSync(path, 'utf8'));
  return result.attempt === attempt && result.summary?.trim() ? result.summary : null;
}

export async function retryBatch(n, recoverStale) {
  checkRetry(readStatus(n), recoverStale);
  console.error('Retry may repeat partial side effects. Inspect the ledger, proposals, PRs, and run.log first.');
  const { resumePiBatch } = await import('./runner.js');
  await resumePiBatch(n, { retry: true, recoverStale });
  const sessions = JSON.parse(readFileSync(join(batchDir(n), 'batch.json'), 'utf8')).sessions;
  const ids = new Set(sessions.map((session) => session.sessionId));
  writeJson('queue.json', readJson('queue.json', []).filter((session) => !ids.has(session.sessionId)));
}
