// Detached supervisor: stays alive until Pi exits, independently of enqueue.
import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { batchDir, updateStatus, releaseAttempt, completion } from './batch.js';

const [n, serialized] = process.argv.slice(2);
const attempt = process.env.AGENTIC_RETRO_ATTEMPT;
let child;
let spawned = false;
let settled = false;

function notify(message) {
  if (process.connected) process.send(message);
}

function settle(patch) {
  if (settled) return;
  settled = true;
  updateStatus(n, attempt, { ...patch, endedAt: new Date().toISOString() });
  releaseAttempt(n, attempt);
}

try {
  const command = JSON.parse(serialized);
  updateStatus(n, attempt, { supervisorPid: process.pid });
  child = spawn(process.env.AGENTIC_RETRO_LAUNCHER || command.file, command.args, {
    cwd: command.cwd, env: process.env, stdio: ['ignore', 'inherit', 'inherit'],
  });
  child.once('spawn', () => {
    spawned = true;
    updateStatus(n, attempt, { status: 'running', childPid: child.pid });
    notify({ started: true });
  });
  child.on('error', (error) => {
    appendFileSync(join(batchDir(n), 'run.log'), `${command.file} process error: ${error.message}\n`);
    // A failed signal is not proof the spawned process exited.
    if (spawned) updateStatus(n, attempt, { error: error.message });
    else {
      settle({ status: 'failed', error: error.message });
      notify({ error: error.message });
    }
  });
  child.once('close', (exitCode, signal) => {
    if (settled) return;
    try {
      const summary = completion(n, attempt);
      settle({ status: exitCode === 0 ? (summary ? 'completed' : 'incomplete') : 'failed', exitCode, signal, ...(summary ? { summary } : {}) });
    } catch (error) {
      settle({ status: 'failed', error: error.message, exitCode, signal });
    }
  });
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
} catch (error) {
  settle({ status: 'failed', error: error.message });
  notify({ error: error.message });
}
