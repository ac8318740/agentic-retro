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
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  session.teamLifecycle = [];
  session.legacyDelegations = [];
  let hasUsage = false;
  const addUsage = (value) => {
    if (!value) return;
    hasUsage = true;
    for (const key of Object.keys(usage)) {
      usage[key] = usage[key] === null || !Number.isFinite(value[key]) || value[key] < 0 ? null : usage[key] + value[key];
    }
  };

  await eachLine(path, (line, lineNumber) => {
    if (line.type === 'session') session.cwd ??= line.cwd ?? null;
    if (['usage', 'compaction', 'branch_summary'].includes(line.type)) addUsage(line.usage);
    if (line.type !== 'message' || !line.message) return;
    const message = line.message;
    stamp(session, line.timestamp);

    if (message.role === 'user') {
      session.turns.user++;
      session.userMessages.push(text(message.content));
    } else if (message.role === 'toolResult') {
      const call = calls.get(message.toolCallId);
      if (call && message.isError) call.error = text(message.content) || 'error';
      if (call?.delegation) call.delegation.outcome = message.isError ? 'failed' : 'succeeded';
      if (call?.lifecycle) {
        const event = call.lifecycle;
        let result = message.details;
        if (!result) {
          try { result = JSON.parse(text(message.content)); } catch {}
        }
        event.outcome = message.isError || result?.error ? 'failed' : result?.id ? 'succeeded' : 'unknown';
        for (const [key, source] of [['memberId', 'id'], ['name', 'name'], ['sessionId', 'sessionId'], ['sessionFile', 'sessionFile']]) {
          if (typeof result?.[source] === 'string') event[key] = result[source];
        }
        if (event.action === 'launch' && event.outcome === 'succeeded') session.subagents++;
      }
      if ((call?.tool ?? message.toolName) === 'ask_user_question' && !message.isError && !message.details?.cancelled) {
        const answer = text(message.content).trim();
        if (answer) session.questionnaires.push({ line: lineNumber, text: answer });
      }
    } else if (message.role === 'assistant') {
      session.turns.assistant++;
      addUsage(message.usage);
      for (const item of message.content ?? []) {
        if (item.type !== 'toolCall') continue;
        const args = item.arguments ?? {};
        const call = { tool: item.name, target: String(target(args)), error: null };
        if (item.name === 'team_agent') {
          call.target = [args.action, args.name, args.id].filter(Boolean).join(' ');
          if (['launch', 'resume', 'stop'].includes(args.action)) {
            call.lifecycle = { action: args.action, name: args.name ?? null, memberId: args.id ?? null, outcome: 'unknown', line: lineNumber };
            session.teamLifecycle.push(call.lifecycle);
          }
        }
        session.toolCalls.push(call);
        calls.set(item.id, call);
        if (SUBAGENT_TOOLS.has(item.name)) {
          call.delegation = { tool: item.name, line: lineNumber, outcome: 'unknown' };
          session.legacyDelegations.push(call.delegation);
        }
        const change = edit(item.name, item.arguments);
        if (change) session.edits.push(change);
      }
    }
  });

  session.usage = hasUsage ? usage : null;
  return session;
}
