#!/usr/bin/env node
'use strict';
// Local, file-only journal writer. No server, listener or write API.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const ENTRY_FIELDS = ['id', 'date', 'time_label', 'category', 'status', 'title', 'summary', 'changes', 'verification', 'rollback', 'evidence'];
const STATUSES = ['verified', 'observed', 'rolled_back', 'pending'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const serialize = value => JSON.stringify(value, null, 2) + '\n';
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function validateEntry(record) {
  if (!object(record)) throw new Error('Entry must be an object');
  if (Object.keys(record).some(key => !ENTRY_FIELDS.includes(key))) throw new Error('Unknown entry field');
  for (const key of ENTRY_FIELDS.filter(key => !['changes', 'verification', 'evidence'].includes(key))) {
    if (!text(record[key])) throw new Error(`${key} must be a nonempty string`);
  }
  if (!/^[a-z0-9-]+$/.test(record.id)) throw new Error('Invalid id');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.date) || !Number.isFinite(Date.parse(record.date)) || new Date(record.date).toISOString().slice(0, 10) !== record.date) throw new Error('Invalid calendar date');
  if (!STATUSES.includes(record.status)) throw new Error('Invalid status');
  for (const key of ['changes', 'verification', 'evidence']) {
    if (!Array.isArray(record[key]) || record[key].length === 0 || !record[key].every(text)) throw new Error(`${key} must be a nonempty string array`);
  }
}

function validateJournal(data) {
  const fields = ['version', 'revision', 'updated_at', 'entries'];
  if (!object(data) || Object.keys(data).some(key => !fields.includes(key)) || data.version !== 1 || !Number.isSafeInteger(data.revision) || data.revision < 1) throw new Error('Invalid journal version/revision');
  if (typeof data.updated_at !== 'string' || !Number.isFinite(Date.parse(data.updated_at)) || new Date(data.updated_at).toISOString() !== data.updated_at) throw new Error('updated_at must be a UTC ISO timestamp');
  if (!Array.isArray(data.entries)) throw new Error('entries must be an array');
  const ids = new Set();
  for (const record of data.entries) {
    validateEntry(record);
    if (ids.has(record.id)) throw new Error(`Duplicate id: ${record.id}`);
    ids.add(record.id);
  }
}

function withLock(file, action) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lock = path.join(path.dirname(file), '.server-changes.lock');
  const deadline = Date.now() + 10000;
  for (;;) {
    try { fs.mkdirSync(lock); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) throw new Error(`Journal is locked: ${lock}; inspect the writer before removing a stale lock`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try { return action(); }
  finally { fs.rmSync(lock, { recursive: true, force: true }); }
}

function atomicWrite(file, content, mode = 0o600) {
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });
  const temp = path.join(directory, `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`);
  let fd;
  try {
    fd = fs.openSync(temp, 'wx', mode);
    fs.writeFileSync(fd, content, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temp, file);
    const directoryFd = fs.openSync(directory, 'r');
    try { fs.fsyncSync(directoryFd); }
    finally { fs.closeSync(directoryFd); }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    fs.rmSync(temp, { force: true });
  }
}

function render(data) {
  const template = fs.readFileSync(path.join(__dirname, 'journal-template.html'), 'utf8');
  const marker = '__JOURNAL_DATA__';
  if (template.split(marker).length !== 2) throw new Error('Template must contain exactly one data marker');
  const escaped = JSON.stringify(data).replace(/[<&\u2028\u2029]/g, char => ({ '<': '\\u003c', '&': '\\u0026', '\u2028': '\\u2028', '\u2029': '\\u2029' })[char]);
  return template.replace(marker, () => escaped);
}

function publish(root, data, html) {
  const output = path.join(root, 'www/yeti/server/log');
  atomicWrite(path.join(output, 'records.json'), serialize(data), 0o644);
  atomicWrite(path.join(output, 'index.html'), html, 0o644);
}

function main(args) {
  const command = args[2];
  const needsInput = ['append', 'import'].includes(command);
  if (args[0] !== '--root' || !text(args[1]) || !['append', 'import', 'build', 'validate'].includes(command) || args.length !== (needsInput ? 4 : 3)) {
    throw new Error('Usage: node change-log.js --root <portal-root> append|import <input.json> | build | validate');
  }
  const root = path.resolve(args[1]);
  const file = path.join(root, 'data/server-changes.json');
  if (command === 'validate') {
    const data = readJSON(file);
    validateJournal(data);
    console.log(`Valid: ${data.entries.length} entries, revision ${data.revision}.`);
    return;
  }
  if (command === 'build') {
    return withLock(file, () => {
      const data = readJSON(file);
      validateJournal(data);
      publish(root, data, render(data));
      console.log(`Built ${data.entries.length} entries, revision ${data.revision}.`);
    });
  }
  const record = readJSON(args[3]);
  const incoming = command === 'import' ? record : [record];
  if (!Array.isArray(incoming)) throw new Error('Import requires an entries array');
  incoming.forEach(validateEntry);
  return withLock(file, () => {
    const exists = fs.existsSync(file);
    if (command === 'import' && exists) throw new Error('Journal already exists; import refused');
    const previous = exists ? readJSON(file) : { revision: 0, entries: [] };
    if (exists) validateJournal(previous);
    if (command === 'append') {
      const existing = previous.entries.find(item => item.id === record.id);
      if (existing && isDeepStrictEqual(existing, record)) {
        console.log('Unchanged: identical entry already exists.');
        return;
      }
      if (existing) throw new Error(`id conflict: ${record.id}; refusing to overwrite`);
    }
    const next = { version: 1, revision: previous.revision + 1, updated_at: new Date().toISOString(), entries: [...previous.entries, ...incoming] };
    validateJournal(next);
    const html = render(next); // Render/validate everything before touching canonical.
    atomicWrite(file, serialize(next));
    try { publish(root, next, html); }
    catch (error) { throw new Error(`Canonical saved at revision ${next.revision}, but output build failed: ${error.message}. Run build to recover.`); }
    console.log(`Saved ${incoming.length} entries; revision ${next.revision}; built ${next.entries.length} total.`);
  });
}
try { main(process.argv.slice(2)); }
catch (error) { console.error(`Journal error: ${error.message}`); process.exitCode = 1; }
