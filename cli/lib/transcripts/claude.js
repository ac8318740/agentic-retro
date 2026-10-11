// Reads a Claude Code transcript (~/.claude/projects/<slug>/<session>.jsonl).
import { eachLine, countLines, emptySession, stamp } from './lines.js';

const SUBAGENT_TOOLS = new Set(['Task', 'Agent']);

// Claude Code writes these into the transcript as user messages; the person never typed them.
// A relayed "Another Claude session sent a message:" line is agent traffic too, not a user turn.
const INJECTED = /^\s*(<command-name>|<command-message>|<local-command-stdout>|<task-notification>|<teammate-message|<system-reminder>|Another Claude session sent a message:)/;

function target(input = {}) {
  return input.file_path ?? input.command ?? input.pattern ?? input.url ?? input.description ?? input.path ?? '';
}

function edit(name, input = {}) {
  const file = input.file_path;
  if (name === 'Write') return { file, added: countLines(input.content), removed: 0 };
  const pairs = name === 'Edit' ? [input] : name === 'MultiEdit' ? input.edits ?? [] : null;
  if (!pairs) return null;
  return {
    file,
    added: pairs.reduce((sum, e) => sum + countLines(e.new_string), 0),
    removed: pairs.reduce((sum, e) => sum + countLines(e.old_string), 0),
  };
}

function resultText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c) => c.text ?? '').join(' ');
  return '';
}

// Input counts every prompt token: fresh, read from cache, and written to cache.
function totalUsage(usages) {
  if (!usages.length) return null;
  const sum = (key) => usages.reduce((total, u) => total + (u[key] ?? 0), 0);
  return {
    input: sum('input_tokens') + sum('cache_read_input_tokens') + sum('cache_creation_input_tokens'),
    output: sum('output_tokens'),
  };
}

export async function readSession(path) {
  const session = emptySession();
  const usages = new Map(); // one assistant message streams as several lines sharing message.id; the last line's usage is final
  const calls = new Map(); // tool_use id -> toolCall, so results can mark errors

  await eachLine(path, (line) => {
    const message = line.message;
    if (!message || (line.type !== 'user' && line.type !== 'assistant')) return;
    session.cwd ??= line.cwd ?? null;
    stamp(session, line.timestamp);
    const blocks = Array.isArray(message.content) ? message.content : [];

    if (line.type === 'user') {
      const results = blocks.filter((b) => b.type === 'tool_result');
      for (const r of results) {
        const call = calls.get(r.tool_use_id);
        if (call && r.is_error) call.error = resultText(r.content) || 'error';
      }
      if (results.length || line.isMeta) return;
      const text = typeof message.content === 'string' ? message.content : resultText(blocks);
      if (INJECTED.test(text)) return;
      session.turns.user++;
      session.userMessages.push(text);
      return;
    }

    const id = message.id ?? line.uuid;
    if (!usages.has(id)) session.turns.assistant++;
    usages.set(id, message.usage ?? usages.get(id) ?? null);
    for (const block of blocks) {
      if (block.type !== 'tool_use') continue;
      const call = { tool: block.name, target: String(target(block.input)), error: null };
      session.toolCalls.push(call);
      calls.set(block.id, call);
      if (SUBAGENT_TOOLS.has(block.name)) session.subagents++;
      const change = edit(block.name, block.input);
      if (change) session.edits.push(change);
    }
  });

  session.usage = totalUsage([...usages.values()].filter(Boolean));
  return session;
}
