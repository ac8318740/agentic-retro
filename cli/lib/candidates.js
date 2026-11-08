// Compact review memory. Immutable events prevent concurrent batches losing evidence.
import { closeSync, constants, existsSync, fstatSync, linkSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { statePath } from './paths.js';
import { batchDir } from './batch.js';
import { CATEGORIES } from './ledger.js';
import { repoOf } from './project.js';

const MAX_FILE = 256 * 1024;
const MAX_RESULT = 1024 * 1024;
const DISPOSITIONS = ['unresolved', 'proposed', 'adopted', 'duplicate', 'rejected', 'unsupported'];

function text(value, field, max = 1000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`candidate ${field} must be nonempty text, at most ${max} characters, without control characters`);
  }
  return value.trim();
}
function path(value, field) {
  const result = text(value, field, 4096);
  if (!isAbsolute(result) || resolve(result) !== result) throw new Error(`candidate ${field} must be an absolute normalized path`);
  return result;
}
function canonicalOwner(value) {
  const suffix = [];
  let existing = value;
  while (!existsSync(existing)) {
    suffix.unshift(basename(existing));
    existing = dirname(existing);
  }
  const resolved = join(realpathSync(existing), ...suffix);
  return repoOf(resolved);
}
function manifest(n) {
  const file = join(batchDir(n), 'batch.json');
  const value = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(value.sessions)) throw new Error(`batch ${n} needs sessions`);
  return value;
}
function jsonFile(file) {
  const fd = openSync(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0));
  try {
    if (!fstatSync(fd).isFile()) throw new Error('candidate input must be a regular file');
    const buffer = Buffer.alloc(MAX_FILE + 1);
    let size = 0;
    while (size < buffer.length) {
      const count = readSync(fd, buffer, size, buffer.length - size, null);
      if (!count) break;
      size += count;
    }
    if (size > MAX_FILE) throw new Error('candidate input exceeds 256 KiB; split the records without dropping evidence');
    return JSON.parse(buffer.toString('utf8', 0, size));
  } finally { closeSync(fd); }
}

function validate(record, n, sources) {
  const owner = canonicalOwner(path(record.owner, 'owner'));
  const category = record.category;
  if (!CATEGORIES.includes(category)) throw new Error('candidate category is invalid');
  if (typeof record.shared !== 'boolean' || (record.shared && category !== 'agent-setup')) throw new Error('only agent-setup candidates may have shared owners');
  const change = text(record.change, 'specific change');
  const hypothesis = text(record.hypothesis, 'hypothesis', 4000);
  const reason = text(record.reason, 'reason', 4000);
  if (!DISPOSITIONS.includes(record.disposition)) throw new Error('candidate disposition is invalid');
  if (!Array.isArray(record.evidence) || !record.evidence.length || record.evidence.length > 20) throw new Error('candidate needs 1 to 20 evidence references per write; split additional evidence into another write');
  const evidence = record.evidence.map((e) => {
    if (!Number.isSafeInteger(e.batch) || e.batch < 1 || e.batch > Number(n)) throw new Error('candidate source batch must exist and not be later than this batch');
    const sessionId = text(e.sessionId, 'source session');
    const repo = path(e.repo, 'source repo');
    if (!record.shared && repo !== owner) throw new Error('repo-local candidate evidence must belong to its owner repository');
    const transcript = path(e.transcript, 'source transcript');
    if (!Number.isSafeInteger(e.line) || e.line < 1) throw new Error('candidate source line must be a positive integer');
    if (!['human', 'agent', 'unknown'].includes(e.attribution)) throw new Error('candidate attribution must be human, agent, or unknown');
    const rationale = text(e.rationale, 'attribution rationale', 2000);
    if (!sources.has(e.batch)) sources.set(e.batch, manifest(e.batch).sessions.map((s) => ({ ...s, repo: repoOf(s.cwd, s.repo) })));
    const source = sources.get(e.batch).find((s) => s.sessionId === sessionId && s.transcript === transcript && s.repo === repo);
    if (!source) throw new Error('candidate evidence does not match its source batch manifest');
    return { batch: e.batch, sessionId, repo, transcript, line: e.line, attribution: e.attribution, rationale };
  });
  const id = createHash('sha256').update(JSON.stringify([owner, category, change])).digest('hex');
  return { id, owner, category, shared: record.shared, change, hypothesis, disposition: record.disposition, reason, evidence };
}

export function saveCandidates(n, file) {
  manifest(n);
  const input = jsonFile(file);
  if (!Array.isArray(input) || input.length > 50) throw new Error('candidate write must be an array of at most 50 records; split larger writes');
  const sources = new Map();
  const records = input.map((record) => validate(record, n, sources));
  if (!records.length) return;
  const dir = statePath('candidates');
  mkdirSync(dir, { recursive: true });
  const event = join(dir, `${n}-${randomUUID()}.json`);
  const temp = `${event}.tmp`;
  const serialized = JSON.stringify({ batch: Number(n), records });
  if (Buffer.byteLength(serialized) > MAX_FILE) throw new Error('candidate event exceeds 256 KiB; split the records without dropping evidence');
  writeFileSync(temp, serialized, { flag: 'wx', mode: 0o600 });
  try { linkSync(temp, event); } finally { unlinkSync(temp); }
}

export function listCandidates(n) {
  const repos = manifest(n).sessions.map((s) => repoOf(s.cwd, s.repo));
  const dir = statePath('candidates');
  if (!existsSync(dir)) return [];
  const candidates = new Map();
  const terminal = new Set();
  const sources = new Map();
  for (const file of readdirSync(dir).filter((f) => /^\d+-[a-f0-9-]+\.json$/.test(f)).sort()) {
    const event = jsonFile(join(dir, file));
    if (!Number.isSafeInteger(event.batch) || event.batch < 1 || !Array.isArray(event.records) || event.records.length > 50) throw new Error(`invalid candidate event: ${file}`);
    for (const raw of event.records) {
      const record = validate(raw, event.batch, sources);
      if (record.disposition !== 'unresolved') terminal.add(record.id);
      const existing = candidates.get(record.id);
      if (existing && existing.shared !== record.shared) throw new Error('candidate sharing scope changed; use a distinct specific-change key');
      const merged = existing ?? { ...record, evidence: [] };
      for (const ref of record.evidence) {
        // One raw moment is not multiple independent observations, even across reviews.
        const same = merged.evidence.find((e) => e.sessionId === ref.sessionId && e.transcript === ref.transcript && e.line === ref.line);
        if (!same) merged.evidence.push(ref);
        else if (same.attribution !== ref.attribution || same.rationale !== ref.rationale) {
          same.attribution = 'unknown';
          same.rationale = 'Conflicting retained attribution; verify the original source';
        }
      }
      candidates.set(record.id, merged);
    }
  }
  const result = [...candidates.values()].filter((c) => !terminal.has(c.id) && (c.shared || repos.includes(c.owner)));
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_RESULT) throw new Error('candidate retrieval exceeds 1 MiB; review the retained event files explicitly before continuing (nothing was deleted)');
  return result;
}
