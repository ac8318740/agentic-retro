// Reads a Pi transcript (~/.pi/agent/sessions/<cwd-slug>/<time>_<id>.jsonl).
import { eachLine, countLines, emptySession, stamp } from './lines.js';

const SUBAGENT_TOOLS = new Set(['subagent', 'delegate', 'task']);

function target(args = {}) {
  return args.path ?? args.command ?? args.pattern ?? args.url ?? '';
}

function edit(name, args = {}) {
  if (name === 'write') return { file: args.path, added: countLines(args.content), removed: 0 };
  if (name !== 'edit') return null;
  const edits = args.edits ?? [{ oldText: args.oldText, newText: args.newText }];
  return {
    file: args.path,
    added: edits.reduce((sum, e) => sum + countLines(e.newText), 0),
    removed: edits.reduce((sum, e) => sum + countLines(e.oldText), 0),
  };
}

const text = (content) => (Array.isArray(content) ? content.map((c) => c.text ?? '').join(' ') : String(content ?? ''));

export async function readSession(path) {
  const session = emptySession();
  const calls = new Map(); // toolCall id -> toolCall, so results can mark errors
  const usage = { input: 0, output: 0 };
  let hasUsage = false;

  await eachLine(path, (line) => {
    if (line.type === 'session') session.cwd ??= line.cwd ?? null;
    if (line.type !== 'message' || !line.message) return;
    const message = line.message;
    stamp(session, line.timestamp);

    if (message.role === 'user') {
      session.turns.user++;
      session.userMessages.push(text(message.content));
    } else if (message.role === 'toolResult') {
      const call = calls.get(message.toolCallId);
      if (call && message.isError) call.error = text(message.content) || 'error';
    } else if (message.role === 'assistant') {
      session.turns.assistant++;
      if (message.usage) {
        hasUsage = true;
        usage.input += message.usage.input ?? 0;
        usage.output += message.usage.output ?? 0;
      }
      for (const item of message.content ?? []) {
        if (item.type !== 'toolCall') continue;
        const call = { tool: item.name, target: String(target(item.arguments)), error: null };
        session.toolCalls.push(call);
        calls.set(item.id, call);
        if (SUBAGENT_TOOLS.has(item.name)) session.subagents++;
        const change = edit(item.name, item.arguments);
        if (change) session.edits.push(change);
      }
    }
  });

  session.usage = hasUsage ? usage : null;
  return session;
}
