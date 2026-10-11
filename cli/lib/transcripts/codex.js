// Reads a Codex transcript (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl).
import { eachLine, emptySession, stamp } from './lines.js';
import { toolCalls, failure } from './codex-tools.js';

// Codex injects these as user messages; the person never typed them.
const INJECTED = /^\s*(<environment_context>|<user_instructions>|<permissions instructions>|# AGENTS\.md instructions)/;

function messageText(content) {
  return Array.isArray(content) ? content.map((c) => c.text ?? '').join('\n') : String(content ?? '');
}

export async function readSession(path) {
  const session = emptySession();
  const calls = new Map(); // call_id -> last toolCall, so outputs can mark errors
  // Older Codex logs turns as event_msg records and mirrors them as response_items; newer Codex only has the response_items.
  const events = { user: [], assistant: 0 };
  const items = { user: [], assistant: 0 };
  let usage = null;

  await eachLine(path, (line) => {
    const p = line.payload ?? {};
    stamp(session, line.timestamp);
    if (line.type === 'session_meta' || line.type === 'turn_context') session.cwd ??= p.cwd ?? null;
    if (line.type === 'event_msg') {
      if (p.type === 'user_message') events.user.push(String(p.message ?? ''));
      else if (p.type === 'agent_message') events.assistant++;
      else if (p.type === 'token_count' && p.info?.total_token_usage) {
        const total = p.info.total_token_usage;
        usage = { input: total.input_tokens ?? 0, output: total.output_tokens ?? 0 };
      }
    }
    if (line.type !== 'response_item') return;

    if (p.type === 'message') {
      const text = messageText(p.content);
      if (p.role === 'user' && !INJECTED.test(text)) items.user.push(text);
      else if (p.role === 'assistant') items.assistant++;
      return;
    }
    const error = failure(p);
    if (error && calls.has(p.call_id)) calls.get(p.call_id).error = error;
    for (const { call, edits } of toolCalls(p) ?? []) {
      session.toolCalls.push(call);
      session.edits.push(...edits);
      calls.set(p.call_id, call);
      if (call.tool === 'spawn_agent') session.subagents++;
    }
  });

  const turns = events.user.length || events.assistant ? events : items;
  session.userMessages = turns.user;
  session.turns = { user: turns.user.length, assistant: turns.assistant };
  session.usage = usage;
  return session;
}
