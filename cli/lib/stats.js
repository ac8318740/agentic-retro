// Stats: how often each kind of proposal lands, and how many tokens each changed line costs.
import { existsSync, readFileSync } from 'node:fs';
import { statePath } from './paths.js';
import { CATEGORIES, loadLedger } from './ledger.js';

function categoryStats(proposals) {
  const counts = { accepted: 0, rejected: 0, expired: 0, open: 0 };
  for (const p of proposals) counts[p.status] += 1;
  // Share of settled proposals only: open ones have no verdict yet.
  const settled = counts.accepted + counts.rejected + counts.expired;
  return { ...counts, acceptedShare: settled ? counts.accepted / settled : null };
}

function readMetrics() {
  const path = statePath('metrics.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

// A session counts only when it has token data and changed at least one line.
function batchRatios(metrics) {
  const totals = new Map();
  for (const m of metrics) {
    const lines = (m.linesAdded ?? 0) + (m.linesRemoved ?? 0);
    if (m.inputTokens == null || m.outputTokens == null || !lines) continue;
    const total = totals.get(m.batch) ?? { tokens: 0, lines: 0 };
    total.tokens += m.inputTokens + m.outputTokens;
    total.lines += lines;
    totals.set(m.batch, total);
  }
  return [...totals]
    .sort(([a], [b]) => a - b)
    .map(([batch, { tokens, lines }]) => ({ batch, tokensPerLine: tokens / lines }));
}

export function collectStats() {
  const { proposals } = loadLedger();
  const categories = Object.fromEntries(CATEGORIES.map((c) =>
    [c, categoryStats(proposals.filter((p) => p.category === c))]));
  return { categories, batches: batchRatios(readMetrics()) };
}

function formatStats({ categories, batches }) {
  const lines = Object.entries(categories).map(([name, c]) => {
    const share = c.acceptedShare === null ? '-' : `${Math.round(c.acceptedShare * 100)}%`;
    return `${name}: ${c.accepted} accepted, ${c.rejected} rejected, ${c.expired} expired, ${c.open} open, ${share} accepted`;
  });
  lines.push('tokens per line changed:');
  if (!batches.length) lines.push('  no metrics yet');
  for (const b of batches) lines.push(`  batch ${b.batch}: ${Math.round(b.tokensPerLine)}`);
  return lines.join('\n');
}

export function stats({ json }) {
  const result = collectStats();
  console.log(json ? JSON.stringify(result, null, 2) : formatStats(result));
}
