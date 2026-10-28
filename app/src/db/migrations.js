// Migrasi skema database. Versi tersimpan di PRAGMA user_version.
// ATURAN: jangan ubah migrasi yang sudah ada; tambahkan migrasi baru di akhir array.

const MIGRATIONS = [
  // 1 — skema awal (multi-Fothang, multi-akun)
  `
  CREATE TABLE fothang (
    id          INTEGER PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE,            -- kode singkat, mis. KUANG-HANG
    name        TEXT NOT NULL,                   -- nama lengkap, mis. Kuang Hang Fo Thang
    short_name  TEXT NOT NULL,                   -- dipakai di judul laporan, mis. Kuang Hang
    start_date  TEXT NOT NULL,                   -- tanggal saldo awal mulai berlaku (YYYY-MM-DD)
    created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- Akun tempat uang disimpan: rekening bank (BCA) atau kas (Kas Kecil).
  CREATE TABLE account (
    id            INTEGER PRIMARY KEY,
    fothang_id    INTEGER NOT NULL REFERENCES fothang(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    kind          TEXT NOT NULL CHECK (kind IN ('bank', 'cash')),
    account_no    TEXT NOT NULL DEFAULT '',
    opening_cents INTEGER NOT NULL DEFAULT 0,  -- saldo awal per start_date
    sort          INTEGER NOT NULL DEFAULT 0,
    UNIQUE (fothang_id, name)
  );

  -- Pos keuangan (CU THAN, KFCC, ...). "number" = nomor sheet di Laporan Keuangan Tahunan.
  CREATE TABLE pos (
    id          INTEGER PRIMARY KEY,
    fothang_id  INTEGER NOT NULL REFERENCES fothang(id) ON DELETE CASCADE,
    number      INTEGER NOT NULL,
    code        TEXT NOT NULL,                   -- kode di kolom C mutasi, mis. CU THAN
    name        TEXT NOT NULL,                   -- nama tampilan, mis. Cu Than
    aliases     TEXT NOT NULL DEFAULT '',        -- kode lain, dipisah koma. "KODE=Kategori" memberi kategori otomatis
    show_donors INTEGER NOT NULL DEFAULT 0,      -- tampilkan Daftar Donatur di laporan bulanan
    active      INTEGER NOT NULL DEFAULT 1,
    UNIQUE (fothang_id, code)
  );

  -- Saldo awal tiap pos per akun (mis. CU THAN di BCA dan di Kas Kecil).
  CREATE TABLE pos_opening (
    pos_id       INTEGER NOT NULL REFERENCES pos(id) ON DELETE CASCADE,
    account_id   INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    amount_cents INTEGER NOT NULL,
    PRIMARY KEY (pos_id, account_id)
  );

  -- Semua uang masuk/keluar. amount_cents positif = masuk, negatif = keluar.
  CREATE TABLE transactions (
    id            INTEGER PRIMARY KEY,
    fothang_id    INTEGER NOT NULL REFERENCES fothang(id) ON DELETE CASCADE,
    account_id    INTEGER NOT NULL REFERENCES account(id),
    pos_id        INTEGER REFERENCES pos(id),   -- NULL = belum dialokasikan
    date          TEXT NOT NULL,
    category      TEXT NOT NULL DEFAULT '',     -- DONATUR, PELITA, ANGPAO, BUNGA BANK, ... (huruf besar)
    name          TEXT NOT NULL DEFAULT '',     -- nama donatur / uraian pengeluaran
    amount_cents  INTEGER NOT NULL CHECK (amount_cents <> 0),
    receipt_no    TEXT NOT NULL DEFAULT '',
    piao_wen      TEXT NOT NULL DEFAULT '',
    note          TEXT NOT NULL DEFAULT '',
    source        TEXT NOT NULL CHECK (source IN ('mutasi', 'manual', 'pindahan')),
    bank_type     TEXT NOT NULL DEFAULT '',     -- kolom B mutasi, mis. TRSF E-BANKING CR
    bank_code     TEXT NOT NULL DEFAULT '',     -- kolom C mutasi apa adanya
    bank_desc     TEXT NOT NULL DEFAULT '',     -- baris keterangan tambahan dari bank
    balance_cents INTEGER,                      -- saldo menurut rekening koran
    seq           INTEGER NOT NULL DEFAULT 0,   -- urutan baris dalam file mutasi
    dedupe_key    TEXT,                         -- pencegah impor ganda
    transfer_id   TEXT,                         -- pasangan baris pindahan antar pos
    created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE (account_id, dedupe_key)
  );
  CREATE INDEX idx_transactions_date ON transactions (fothang_id, date);
  CREATE INDEX idx_transactions_pos ON transactions (pos_id, date);

  -- Sheet "Barang": donasi dalam bentuk barang (tidak memengaruhi saldo).
  CREATE TABLE goods_donation (
    id          INTEGER PRIMARY KEY,
    fothang_id  INTEGER NOT NULL REFERENCES fothang(id) ON DELETE CASCADE,
    date        TEXT NOT NULL,
    name        TEXT NOT NULL,
    item        TEXT NOT NULL,
    note        TEXT NOT NULL DEFAULT ''
  );
  `,

  // 2 — pecah transaksi: satu baris mutasi dibagi ke beberapa pos (mis. transfer Sherly 1 juta = 500rb CU THAN + 500rb KFCC).
  //     Baris pecahan menunjuk ke baris asalnya lewat split_of; saldo bank tetap dicek pada baris asal.
  `
  ALTER TABLE transactions ADD COLUMN split_of INTEGER REFERENCES transactions(id) ON DELETE CASCADE;
  CREATE INDEX idx_transactions_split ON transactions (split_of);
  `,

  // 3 — login: pengguna, akses per Fothang, sesi, dan catatan aktivitas.
  `
  -- Peran: admin (semua), bendahara (input data Fothang-nya), pimpinan (hanya melihat).
  CREATE TABLE app_user (
    id                   INTEGER PRIMARY KEY,
    username             TEXT NOT NULL UNIQUE COLLATE NOCASE,
    full_name            TEXT NOT NULL,
    password_hash        TEXT NOT NULL,
    role                 TEXT NOT NULL CHECK (role IN ('admin', 'bendahara', 'pimpinan')),
    active               INTEGER NOT NULL DEFAULT 1,
    must_change_password INTEGER NOT NULL DEFAULT 0,   -- wajib ganti kata sandi saat login berikutnya
    failed_attempts      INTEGER NOT NULL DEFAULT 0,
    locked_until         TEXT,                          -- ISO waktu; terkunci sementara setelah salah berkali-kali
    last_login_at        TEXT,
    created_at           TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );

  -- Fothang yang boleh diakses pengguna non-admin.
  CREATE TABLE user_fothang (
    user_id    INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    fothang_id INTEGER NOT NULL REFERENCES fothang(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, fothang_id)
  );

  -- Sesi login. Yang disimpan hanya hash token; token aslinya hanya ada di cookie browser.
  CREATE TABLE session (
    token_hash   TEXT PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
    created_at   TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at   TEXT NOT NULL                       -- batas mutlak; sesi juga berakhir bila lama tidak aktif
  );

  -- Catatan aktivitas: siapa mengubah apa, kapan.
  CREATE TABLE audit_log (
    id         INTEGER PRIMARY KEY,
    at         TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    user_id    INTEGER,
    username   TEXT NOT NULL,
    fothang_id INTEGER,
    action     TEXT NOT NULL,
    entity_id  TEXT,
    detail     TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX idx_audit_at ON audit_log (at);
  `,

  // 4 — sumber data baru 'draf' (baris yang diimpor dari file DRAF Laporan Keuangan).
  //     SQLite tidak bisa mengubah CHECK, jadi tabel dibangun ulang dengan isi yang sama.
  `
  CREATE TABLE transactions_new (
    id            INTEGER PRIMARY KEY,
    fothang_id    INTEGER NOT NULL REFERENCES fothang(id) ON DELETE CASCADE,
    account_id    INTEGER NOT NULL REFERENCES account(id),
    pos_id        INTEGER REFERENCES pos(id),
    date          TEXT NOT NULL,
    category      TEXT NOT NULL DEFAULT '',
    name          TEXT NOT NULL DEFAULT '',
    amount_cents  INTEGER NOT NULL CHECK (amount_cents <> 0),
    receipt_no    TEXT NOT NULL DEFAULT '',
    piao_wen      TEXT NOT NULL DEFAULT '',
    note          TEXT NOT NULL DEFAULT '',
    source        TEXT NOT NULL CHECK (source IN ('mutasi', 'manual', 'pindahan', 'draf')),
    bank_type     TEXT NOT NULL DEFAULT '',
    bank_code     TEXT NOT NULL DEFAULT '',
    bank_desc     TEXT NOT NULL DEFAULT '',
    balance_cents INTEGER,
    seq           INTEGER NOT NULL DEFAULT 0,
    dedupe_key    TEXT,
    transfer_id   TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    split_of      INTEGER REFERENCES transactions(id) ON DELETE CASCADE,
    UNIQUE (account_id, dedupe_key)
  );
  INSERT INTO transactions_new (id, fothang_id, account_id, pos_id, date, category, name, amount_cents, receipt_no, piao_wen, note,
      source, bank_type, bank_code, bank_desc, balance_cents, seq, dedupe_key, transfer_id, created_at, updated_at, split_of)
    SELECT id, fothang_id, account_id, pos_id, date, category, name, amount_cents, receipt_no, piao_wen, note,
      source, bank_type, bank_code, bank_desc, balance_cents, seq, dedupe_key, transfer_id, created_at, updated_at, split_of
    FROM transactions;
  DROP TABLE transactions;
  ALTER TABLE transactions_new RENAME TO transactions;
  CREATE INDEX idx_transactions_date ON transactions (fothang_id, date);
  CREATE INDEX idx_transactions_pos ON transactions (pos_id, date);
  CREATE INDEX idx_transactions_split ON transactions (split_of);
  `,
];

/**
 * Jalankan migrasi yang belum diterapkan, masing-masing dalam satu transaksi.
 * Foreign key dimatikan selama migrasi (wajib untuk membangun ulang tabel di SQLite),
 * lalu keutuhan relasi diperiksa sebelum dinyalakan kembali.
 */
function migrate(db) {
  const current = db.prepare('PRAGMA user_version').get().user_version;
  if (current >= MIGRATIONS.length) return;
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    for (let version = current; version < MIGRATIONS.length; version++) {
      db.exec('BEGIN');
      try {
        db.exec(MIGRATIONS[version]);
        const broken = db.prepare('PRAGMA foreign_key_check').all();
        if (broken.length) throw new Error(`${broken.length} relasi data rusak setelah migrasi`);
        db.exec(`PRAGMA user_version = ${version + 1}`);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw new Error(`Migrasi database versi ${version + 1} gagal: ${err.message}`);
      }
    }
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

module.exports = { migrate, MIGRATIONS };
