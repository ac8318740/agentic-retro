#!/usr/bin/env node
// agentic-retro: parses argv and routes each command to its module.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadConfig, getKey, setKey } from './lib/config.js';
import { setup } from './lib/setup.js';
import { enqueue } from './lib/queue.js';
import { propose, mark, link, listProposals, formatProposal } from './lib/ledger.js';
import { syncOutcomes } from './lib/outcomes.js';
import { notice } from './lib/notice.js';
import { stats } from './lib/stats.js';
import { installPi } from './lib/pi.js';
import { INTRO } from './lib/intro.js';

const USAGE = `usage: agentic-retro <command>
  about
  setup
  config list | get <key> | set <key> <value>
  enqueue [--harness <h>] [--session <id> --transcript <path> --cwd <dir>]   (or hook JSON on stdin)
  propose --repo <path> --category <c> [--risk low|high] --title <t> [--pr <pr> --commit <msg>]
  mark <id> <accepted|rejected>
  link <id> [--pr <url>] [--commit <sha>]
  ledger [--status <s>[,<s>...]]
  notice [--json]
  stats [--json]
  sync
  install-pi`;

const FLAGS = ['harness', 'session', 'transcript', 'cwd', 'repo', 'category', 'risk', 'title', 'pr', 'commit', 'status'];
const options = Object.fromEntries(FLAGS.map((flag) => [flag, { type: 'string' }]));
options.json = { type: 'boolean' };

function config([action, key, value]) {
  const current = loadConfig();
  if (action === 'list') return console.log(JSON.stringify(current, null, 2));
  if (action === 'set') return setKey(key, value);
  if (action !== 'get') throw new Error(USAGE);
  const found = getKey(current, key);
  if (found === undefined) throw new Error(`unknown config key: ${key}`);
  console.log(typeof found === 'object' ? JSON.stringify(found) : String(found));
}

// Harness hooks pipe JSON like {"session_id", "transcript_path", "cwd"} on stdin.
// Bad JSON reads as no hook: a session-end hook must not fail the session.
function readHook() {
  if (process.stdin.isTTY) return {};
  try {
    return JSON.parse(readFileSync(0, 'utf8')) ?? {};
  } catch {
    return {};
  }
}

function enqueueCommand(flags) {
  const hook = flags.session ? {} : readHook();
  if (!flags.session && !hook.session_id) return; // nothing to queue, and a hook must not fail the session
  return enqueue({
    harness: flags.harness,
    sessionId: flags.session ?? hook.session_id,
    transcript: flags.transcript ?? hook.transcript_path,
    cwd: flags.cwd ?? hook.cwd,
  });
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (command === 'help' || command === '--help') return console.log(USAGE);
  const { values: flags, positionals } = parseArgs({ args: rest, options, allowPositionals: true });

  if (command === 'setup') return setup();
  if (command === 'config') return config(positionals);
  if (command === 'enqueue') return enqueueCommand(flags);
  if (command === 'propose') return console.log(propose(flags));
  if (command === 'mark') return mark(...positionals);
  if (command === 'link') return link(positionals[0], flags);
  if (command === 'ledger') return listProposals(flags.status).forEach((p) => console.log(formatProposal(p)));
  if (command === 'sync') return syncOutcomes();
  if (command === 'notice') return notice(flags);
  if (command === 'stats') return stats(flags);
  if (command === 'install-pi') return installPi();
  if (command === 'about') return process.stdout.write(INTRO);
  throw new Error(USAGE);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
