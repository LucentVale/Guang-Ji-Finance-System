# CLAUDE.md — Sistem Keuangan Guang Ji

Panduan kerja untuk Claude di proyek ini. Baca seluruhnya di awal setiap sesi.

## Apa ini

Aplikasi laporan keuangan untuk **Yayasan Guang Ji**, dimulai dari **Kuang Hang Fo Thang**, dirancang siap untuk banyak Fothang.
Alurnya mengikuti cara kerja manual di folder `Bahan/` (mutasi BCA → DRAF → Laporan Keuangan Tahunan per pos → cek saldo → PDF):

1. **Mutasi Bank** — impor rekening koran BCA (.xlsx), otomatis dialokasikan ke pos
2. **Draf** — semua transaksi satu bulan seperti rekening koran; rapikan pos/kategori; impor/ekspor file DRAF
3. **Laporan per Pos** — padanan file "Laporan Keuangan Kuang Hang Tahun 2026" (Rekap + sheet per pos)
4. **Cek Saldo** — saldo sistem vs bank
5. **Laporan PDF** — "Bentuk Laporan Keuangan" bulanan, satu pos per halaman

Ditambah Dashboard (Keseluruhan & Per Bulan), Riwayat (audit log), Pengguna, Pengaturan.

## Aturan kerja (WAJIB, disepakati dengan pengguna)

1. **Plan dulu.** Sebelum membuat/mengubah/menghapus file: analisis, tulis rencana (file apa, kenapa, dampak ke modul lain), lalu **tunggu persetujuan**.
   Pengecualian: perintah eksplisit kecil dari pengguna (mis. "commit & push").
2. **Eksekusi bertahap.** Satu tahap kecil → validasi → ringkasan. Jangan menumpuk banyak perubahan sekaligus.
   Bila pengguna membagi pekerjaan per tahap, berhenti dan **tunggu konfirmasi** sesudah tiap tahap.
3. **Validasi otomatis sesudah tiap perubahan**: `npm run check` (ESLint + seluruh test) harus lulus tanpa error.
   Untuk perubahan tampilan: cek juga di browser (konsol bebas error; ukur luapan di 375 / 768 / 1366 px).
4. **Rollback bila gagal.** Kembalikan file ke kondisi terakhir yang lulus (`git diff` / `git checkout -- <file>` hanya untuk file yang kamu ubah di tahap itu), analisis ulang, baru coba lagi.
5. **Commit / push hanya bila diminta.** Pesan commit Bahasa Indonesia, baris pertama ringkas, diakhiri baris `Co-Authored-By` sesuai instruksi sistem.
6. Bahasa: jawab pengguna dalam **Bahasa Indonesia**. Komentar kode & teks UI juga Bahasa Indonesia.

## Perintah (Windows, Node 24, jalankan dari `app/`)

```powershell
npm run check             # VALIDASI UTAMA: ESLint lalu seluruh test — jalankan sesudah setiap perubahan
npm run lint              # ESLint saja (eslint.config.mjs); 0 error adalah syarat
npm run lint:fix          # perbaiki otomatis temuan yang aman diperbaiki
npm test                  # node --test, saat ini 48 test — WAJIB lulus semua
npm start                 # server di http://localhost:3000 (atau pakai ikon "Sistem Keuangan" di Desktop)
npm run create-admin      # buat Admin pertama dari terminal
npm run import-folder     # impor massal mutasi dari folder
```

ESLint (`app/eslint.config.mjs`) memeriksa backend (Node, CommonJS) dan frontend (browser, ES module) dengan
aturan **pencari bug saja** (bukan gaya). Jangan mematikan aturan dengan `eslint-disable` tanpa alasan tertulis
di komentar yang sama. ESLint, `@eslint/js`, dan `globals` adalah devDependencies dengan versi dikunci persis;
belum ada pengecekan tipe (TypeScript/checkJs). Sesudah `npm run check`, perubahan tampilan tetap dicek di browser.

**Menguji tanpa menyentuh data asli:** salin DB dengan `VACUUM INTO` ke folder scratchpad, lalu jalankan salinan di port lain:
`PORT=3103 LOGIN_REQUIRED=1 DATABASE_FILE=<salinan.db> node server.js` (lewat Bash). Hapus salinannya sesudah selesai.

**Me-restart aplikasi desktop** (sesudah mengubah kode server):
1. pastikan proses di port 3000 adalah `node server.js`, lalu hentikan
2. tutup jendela Edge "Sistem Keuangan Guang Ji"
3. jalankan pintasan "Sistem Keuangan" di Desktop (`app/desktop/Buka Sistem Keuangan.vbs` menunggu `/api/auth/status`)

Perubahan yang hanya di `app/public/` cukup memuat ulang halaman.

## Arsitektur

```
app/
  server.js                 titik masuk: createContext() + createServer()
  src/config.js             port, host, path DB, auth (config.local.json / env: PORT, DATABASE_FILE, LOGIN_REQUIRED)
  src/context.js            merangkai db -> repositories -> services (createContext(':memory:') untuk test)
  src/db/                   node:sqlite (DatabaseSync); migrations.js berversi via PRAGMA user_version; seed.js
  src/repositories/         SQL saja, nominal dalam SEN (integer)
  src/services/             logika bisnis; saling panggil lewat ctx.services; konversi sen <-> rupiah di presenters/lib/money
  src/http/                 router sendiri + routes/*; opsi route: public, permission (read/write/admin), audit, rawBody
  src/lib/                  money, period, password (scrypt), text, errors
  public/                   frontend tanpa build step (vanilla ES modules)
    index.html              kerangka: sidebar, topbar, #view, #modalRoot, #toast
    css/base.css            SEMUA token desain (warna, huruf, jarak, sudut) + elemen dasar + utilitas
    css/{layout,sheet,dashboard,report,auth}.css
    js/main.js              boot (status login) + router hash (#/dashboard, #/tahunan?sheet=1, ...)
    js/core/                dom (html``, render, on, $), api, store, format, a11y, router
    js/components/          feedback (toast, modal, attempt), controls (segmented, debounce), charts (SVG),
                            dashboardCards, transactionForms, options, drafImport, userMenu
    js/views/               satu file per halaman (dashboardView + dashboardMonth, workbookView = Laporan per Pos, ...)
  test/                     node:test; helpers.createTestContext() memakai DB in-memory
  data/                     keuangan.db (+ backup/) — DATA ASLI, tidak di-git
  desktop/                  launcher .vbs + ikon
```

Konsep penting:
- **Uang disimpan dalam sen** (integer) di DB; rupiah (desimal) hanya di tepi (API/UI). Selalu bulatkan saat menjumlah di frontend (`Math.round(x * 100) / 100`).
- **Saldo** = saldo awal pos (`pos_opening`) + transaksi sejak `fothang.start_date` (`balanceService.snapshot`). Jangan hitung ulang saldo dengan cara lain.
- **Pindahan antar pos** = dua baris `source = 'pindahan'` dengan `transfer_id` sama; tidak dihitung sebagai pemasukan/pengeluaran; diletakkan paling bawah pada tanggalnya (`seq`).
- **Sumber transaksi**: `mutasi` (nominal & tanggal terkunci), `draf`, `manual`, `pindahan`.
- **Hak akses**: `accessPolicy.js` (admin / bendahara / pimpinan). Mode tanpa login (`config.local.json` `loginRequired: false`) hanya untuk komputer lokal; server menolak jalan tanpa login di host non-loopback.
- **Multi-Fothang**: semua data di-scope `fothang_id`; service memakai `assertOwned()`.

## Gaya kode

- Ikuti gaya sekitarnya: komentar ringkas Bahasa Indonesia di atas fungsi/logika yang tidak jelas, JSDoc untuk parameter objek.
- Backend CommonJS (`require`), frontend ES modules (`import`). Tanpa framework, tanpa build.
- **Template HTML** selalu lewat `html``...`` (auto-escape). `false/null` menjadi teks kosong, jadi atribut ARIA boolean ditulis `aria-pressed="${String(aktif)}"`.
- **Event**: delegasi dengan `on(root, 'click', selector, fn)` pada elemen milik halaman itu — **jangan** pada `main`/`#view` (dipakai ulang tiap pindah halaman → listener menumpuk).
- **CSS**: pakai token dari `base.css` (mis. `var(--accent-strong)`, `var(--fs-sm)`, `var(--space-3)`); jangan menulis kode warna baru atau `style="..."` di template — tambahkan token/kelas utilitas. Kontras teks ≥ 4.5:1, garis kontrol & cincin fokus ≥ 3:1.
- **Aksesibilitas**: baris tabel yang bisa diklik cukup diberi kelas `clickable`/`viewable` (keyboard diurus `core/a11y.js`); dialog lewat `openModal()`; aksi async lewat `attempt()` (tombol otomatis nonaktif + pemintal, galat jadi toast).
- Komponen bersama dulu (`controls.js`, `dashboardCards.js`, `format.js`) sebelum menulis ulang pola yang sama (DRY).
- Respons API hanya boleh **menambah** field; jangan menghapus/mengganti field yang dipakai.

## Batasan & keamanan data

- **Jangan pernah** meng-commit `Bahan/`, `_arsip_v1/`, `app/data/`, `*.db*`, `*.xlsx`, `*.pdf`, `app/config.local.json` (sudah di `.gitignore`; cek `git status` sebelum commit).
- Sebelum menulis ke **database asli** (`app/data/keuangan.db`): buat cadangan `VACUUM INTO app/data/backup/<keterangan>-<waktu>.db`, dan hanya atas permintaan pengguna.
- Uji fitur yang menyimpan data pada **salinan** DB, bukan data asli.
- Ekspor Excel (`excelExport.js`, `drafFormat.js`) harus sama persis dengan file manual pengguna — jangan ubah formatnya tanpa diminta.
- Repo GitHub: https://github.com/LucentVale/Guang-Ji-Finance-System (branch `main`).

## Catatan teknis (jebakan yang pernah terjadi)

- PowerShell 5.1: `Set-Content -Encoding UTF8` menambah BOM dan CRLF — tulis file dengan tool Write/Edit atau Node. Pesan commit panjang: tulis ke file lalu `git commit -F <file>`.
- Hindari skrip Node satu baris berisi banyak tanda kutip di PowerShell; tulis skripnya ke folder scratchpad lalu jalankan.
- `npm test` mencetak ringkasan `ℹ tests / pass / fail`; saring dengan `Select-String`.
- `npm audit` melaporkan 2 kerentanan "moderate" dari `exceljs` → `uuid` (sudah ada sejak awal, bukan dari ESLint).
  JANGAN jalankan `npm audit fix --force`: itu menurunkan exceljs ke 3.4.0 dan merusak ekspor Excel.
- Launcher menjalankan `npm install --omit=dev` bila `node_modules` belum ada, jadi komputer pemakai tidak mengunduh ESLint.
- Pane browser bawaan kadang tidak bisa screenshot bila tidak tampil — verifikasi lewat `javascript_tool` (ukur elemen) dan sebutkan bahwa tampilan belum dilihat langsung.
