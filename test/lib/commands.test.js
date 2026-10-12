import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from '../helpers/cli.js';

for (const [harness, permissions] of [['claude', 'auto'], ['codex', 'auto'], ['codex', 'scoped']]) {
  test(`${harness} ${permissions}: home-relative editable files grant their containing directory and preserve directory access`, () => {
    const home = tempDir('retro-user-home-');
    const state = tempDir();
    const batch = join(state, 'batches', '1');
    const notes = join(home, '.claude');
    const skills = join(home, 'skills');
    const writable = join(home, 'future-notes');
    const repo = tempDir('retro-command-repo-');
    const checkout = tempDir('retro-command-worktree-');
    for (const dir of [batch, notes, skills]) mkdirSync(dir, { recursive: true });
    writeFileSync(join(notes, 'CLAUDE.md'), '# Notes');
    const configUrl = new URL('../../cli/lib/config.js', import.meta.url).href;
    const runnerUrl = new URL('../../cli/lib/runner.js', import.meta.url).href;
    const script = `
      import { DEFAULTS } from ${JSON.stringify(configUrl)};
      import { buildCommand } from ${JSON.stringify(runnerUrl)};
      const config = { ...DEFAULTS, editable: ['~/.claude/CLAUDE.md', '~/skills', ${JSON.stringify(writable)}],
        runner: { ...DEFAULTS.runner, harness: ${JSON.stringify(harness)}, permissions: ${JSON.stringify(permissions)} } };
      const command = buildCommand(config, ${JSON.stringify(batch)}, 1,
        [{ harness: 'claude', sessionId: 's1', repo: ${JSON.stringify(repo)}, cwd: ${JSON.stringify(checkout)}, transcript: '/t/s1.jsonl' }]);
      process.stdout.write(JSON.stringify(command));
    `;
    const cmd = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8', env: { ...process.env, HOME: home, AGENTIC_RETRO_HOME: state, AGENTIC_RETRO_DRY_RUN: '1' },
    }));
    const dirs = [];
    cmd.args.forEach((arg, i) => {
      if (arg === '--add-dir') {
        for (let j = i + 1; j < cmd.args.length && !cmd.args[j].startsWith('-'); j++) dirs.push(cmd.args[j]);
      }
    });
    assert.equal(dirs.filter((dir) => dir === notes).length, 1, 'file access uses the containing directory');
    assert.equal(dirs.includes(join(notes, 'CLAUDE.md')), false, 'file paths are not passed as directories');
    for (const dir of [skills, writable, repo, checkout]) assert.equal(dirs.filter((d) => d === dir).length, 1);
    if (harness === 'codex') assert.equal(dirs.filter((d) => d === state).length, 1);
  });
}
