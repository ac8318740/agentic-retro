// Interactive setup: one question per config setting, each with presets. Enter keeps the current value.
import { createInterface } from 'node:readline';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { loadConfig, saveConfig, getKey, parseValue } from './config.js';
import { INTRO } from './intro.js';

const onPath = (bin) => (process.env.PATH || '').split(delimiter).some((dir) => existsSync(join(dir, bin)));

function questions() {
  const harnesses = ['claude', 'codex', 'pi', ...(onPath('herdr') ? ['herdr'] : [])];
  return [
    ['batch.size', 'Sessions per batch', ['5', '10']],
    ['batch.group', 'Group sessions by', ['repo', 'global']],
    ['runner.harness', 'Harness that runs batch agents', harnesses],
    ['runner.model', 'Model for batch agents (opus applies to Claude; Codex/Pi use their own default unless given a model name)', ['opus', 'default']],
    ['runner.permissions', 'Batch agent permissions', ['auto', 'scoped', 'bypass']],
    ['categories.clarity', 'Propose code-clarity changes?', ['true', 'false']],
    ['categories.agent-setup', 'Propose agent-setup changes (skills, hooks, instructions)?', ['true', 'false']],
    ['categories.repo-for-agents', 'Propose changes that make repos easier for agents?', ['true', 'false']],
    ['scope', 'Code-clarity scope', ['touched', 'neighbours', 'two-layers']],
    ['output', 'Output', ['pr', 'report']],
    ['autoMergeLowRisk', 'Auto-merge low-risk agent-setup PRs?', ['false', 'true']],
    ['expireAfterBatches', 'Expire open proposals after how many batches', ['3', '5']],
    ['editable', 'Writable paths (JSON list)', ['[]']],
    ['targets.preset', 'Where agent-setup changes go', ['~/.claude/skills', '~/.codex/skills', '<plugin repo path>']],
    ['targets.note', 'Note for agents about targets', []],
    ['notes', 'Anything else batch agents should know', []],
  ];
}

const show = (value) => (typeof value === 'string' ? value : JSON.stringify(value));

export async function setup() {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  const config = loadConfig();
  process.stdout.write(`${INTRO}\nThese questions take about two minutes. Press Enter to keep the value in brackets.\n\n`);

  for (const [key, label, presets] of questions()) {
    const current = show(getKey(config, key));
    const choices = presets.length ? ` (${presets.join(' / ')})` : '';
    process.stdout.write(`${label}${choices} [${current}]: `);
    const { value, done } = await lines.next();
    const answer = done ? '' : value.trim();
    const parts = key.split('.');
    const last = parts.pop();
    parts.reduce((node, part) => node[part], config)[last] = parseValue(key, answer || current);
  }

  rl.close();
  saveConfig(config);
  process.stdout.write('\nSaved config.json\n');
}
