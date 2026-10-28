// Membuka database SQLite (modul bawaan Node.js, tanpa instalasi tambahan).
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { migrate } = require('./migrations');

/**
 * @param {string} file path file database, atau ':memory:' untuk pengujian
 */
function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  migrate(db);
  return db;
}

/**
 * Jalankan fn di dalam satu transaksi database; dibatalkan seluruhnya bila ada error.
 * Bila sudah berada di dalam transaksi (dipanggil bertingkat), fn ikut transaksi luar.
 */
function inTransaction(db, fn) {
  if (db.isTransaction) return fn();
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { openDatabase, inTransaction };
