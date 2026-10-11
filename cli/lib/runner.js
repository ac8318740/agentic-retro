// Starts a batch run: writes the batch manifest, syncs outcomes and digests, then launches the batch agent.
import { spawn, execFileSync } from 'node:child_process';
import { openSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeJson, statePath } from './paths.js';
import { nextBatch } from './ledger.js';
import { loadConfig } from './config.js';
import { syncOutcomes } from './outcomes.js';
import { writeBatchDigests } from './digest.js';
import { buildCommand, PANE_ID } from './commands.js';

export { buildCommand };

function runHerdr([create, paneRun]) {
  let output;
  try {
    output = execFileSync(create.file, create.args, { cwd: create.cwd, encoding: 'utf8' });
  } catch (error) {
    throw new Error(`herdr could not open a workspace – is the herdr server running? (${error.message})`);
  }
  const paneId = JSON.parse(output).result.root_pane.pane_id;
  const args = paneRun.args.map((arg) => (arg === PANE_ID ? paneId : arg));
  execFileSync(paneRun.file, args, { cwd: paneRun.cwd });
}

// Detached with output in run.log, so enqueue (a session-end hook) returns at once.
function launch({ file, args, env, cwd }) {
  const log = join(cwd, 'run.log');
  const out = openSync(log, 'a');
  const child = spawn(process.env.AGENTIC_RETRO_LAUNCHER || file, args, {
    cwd, env: { ...process.env, ...env }, detached: true, stdio: ['ignore', out, out],
  });
  child.on('error', (error) => appendFileSync(log, `could not start ${file}: ${error.message}\n`));
  child.unref();
}

export async function startBatch(sessions) {
  const n = nextBatch();
  writeJson(`batches/${n}/batch.json`, { sessions });
  if (process.env.AGENTIC_RETRO_DRY_RUN === '1') return n;

  syncOutcomes();
  await writeBatchDigests(n, sessions);
  const command = buildCommand(loadConfig(), statePath('batches', String(n)), n, sessions);
  if (Array.isArray(command)) runHerdr(command);
  else launch(command);
  return n;
}
