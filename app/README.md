# Sistem Keuangan Guang Ji

Aplikasi pembukuan untuk Fothang di bawah Yayasan Guang Ji. Saat ini berisi data **Kuang Hang Fo Thang**,
dan sudah disiapkan untuk banyak Fothang (setiap Fothang punya akun, pos, dan transaksi sendiri).

## Alur kerja (sama dengan proses manual di Excel)

| Langkah | Menu | Padanan file manual |
|---|---|---|
| 1 | **Mutasi Bank**: impor rekening koran (.xlsx) | `Mutasi Keuangan/Mutasi Kuang Hang <Bulan> 2026.xlsx` |
| 2 | **Draf**: rapikan & alokasikan tiap baris ke pos, saldo dicocokkan dengan bank | `DRAF Laporan Keuangan Kuang Hang 2026.xlsx` |
| 3 | **Laporan per Pos**: buku tahunan dengan sheet Tabel, Barang, 1 CU THAN, 2 KFCC, … | `Laporan Keuangan Kuang Hang Tahun 2026.xlsx` |
| 4 | **Cek Saldo**: saldo awal/akhir & saldo berjalan harus cocok dengan rekening koran | (pengecekan manual) |
| 5 | **Laporan PDF**: laporan bulanan per pos, cetak / simpan PDF | `PDF BENTUK LAPORAN KEUANGAN 2026/` |

Setiap langkah juga bisa diekspor ke Excel dengan tata letak yang sama seperti file manual.

## Menjalankan

### Sebagai aplikasi desktop (disarankan)

1. Sekali saja per komputer: klik dua kali **`desktop\Pasang Ikon di Desktop.vbs`**.
   Ikon **Sistem Keuangan Guang Ji** muncul di Desktop dan Start Menu.
2. Klik ikon itu. Server berjalan di belakang layar dan aplikasi terbuka di jendela sendiri (Microsoft Edge mode aplikasi).
3. Server tetap berjalan setelah jendela ditutup, jadi membuka berikutnya lebih cepat.
   Untuk mematikannya (mis. setelah kode diperbarui): klik **`desktop\Matikan Server.vbs`**.

Catatan server tersimpan di `data\server.log`.

### Cara lain

- Klik dua kali **`Jalankan Aplikasi.bat`** (dengan jendela hitam berisi log), lalu buka http://localhost:3000
- Atau dari terminal di folder `app`:
  ```
  npm install
  npm start
  ```
- Menjalankan pengujian otomatis: `npm test`
- Impor satu folder mutasi sekaligus: `npm run import-folder -- "..\Bahan\Mutasi Keuangan"`

Butuh Node.js versi 22.13 atau lebih baru (memakai SQLite bawaan Node). Data tersimpan di `data/keuangan.db`;
backup bisa diunduh dari menu **Pengaturan → Backup Database**.

## Login & hak akses

**Saat ini login dimatikan** lewat file `app/config.local.json` (`"loginRequired": false`), untuk demo di komputer ini.
Dalam mode ini aplikasi hanya bisa dibuka dari komputer ini, dan server menolak berjalan bila diatur agar bisa diakses dari luar.
Untuk menyalakan login: ubah menjadi `"loginRequired": true` (atau hapus file itu), lalu jalankan `desktop\Matikan Server.vbs` dan buka aplikasi lagi.

Saat pertama kali dibuka, aplikasi meminta pembuatan **akun Admin pertama**. Langkah ini hanya bisa dilakukan
langsung di komputer server. Di server online, pakai `npm run create-admin -- <nama-pengguna> "<Nama Lengkap>"`.

| Peran | Bisa apa |
|---|---|
| Admin Yayasan | Semua, termasuk Pengaturan, Pengguna, Backup; semua Fothang |
| Bendahara Fothang | Impor mutasi, Draf, transaksi, barang, laporan — hanya Fothang yang ditugaskan |
| Pimpinan | Hanya melihat laporan, Cek Saldo, Riwayat — hanya Fothang yang ditugaskan |

- Kata sandi di-hash (scrypt); minimal 8 karakter berisi huruf & angka. Pengguna baru wajib mengganti kata sandi sementara.
- Sesi berakhir setelah 2 jam tidak aktif (maks. 12 jam). Salah kata sandi 5× → akun dikunci 15 menit.
- Semua perubahan data tercatat di menu **Riwayat** (siapa, kapan, apa).
- Hak akses diperiksa di server (`src/services/accessPolicy.js`, `src/http/app.js`), bukan hanya disembunyikan di tampilan.
- Saat online di HTTPS, jalankan dengan `COOKIE_SECURE=1`.

## Aturan kode kolom C pada mutasi

| Kode di mutasi | Hasil |
|---|---|
| `CU THAN ; SAHABAT SEJATI` (uang masuk) | Pos CU THAN, kategori **Donatur**, masuk Daftar Donatur |
| `CU THAN ; IURAN MABGI` (uang keluar) | Pos CU THAN, pengeluaran "Iuran MABGI" |
| `CU THAN ; PELITA ; IRENE` | Pos CU THAN, kategori **Pelita**, nama Irene |
| Baris bank `BUNGA` / `PAJAK BUNGA` / `BIAYA ADM` | Kategori baku Bunga Bank / Pajak Bunga / Biaya ADM |
| `KELAS ; …`, `PAT WU AI LIU ; …` | Dicocokkan dengan **alias** pos (atur di Pengaturan). `PAT WU AI LIU=Wu Ai Liu` memberi kategori otomatis |

| `CU THAN ; SHERLY THE (500K) KFCC ; SHERLY THE (500K)` (masuk 1 juta) | **Dipecah otomatis**: 500rb CU THAN + 500rb KFCC. Format: `<nama> <angka>K/RB/JT <KODE POS>` |

Kode yang tidak dikenal (mis. `X`) tetap diimpor tanpa pos, lalu dialokasikan di langkah 2 (Draf).

## File DRAF (ekspor & impor)

- **⭳ Excel Draf** (halaman Draf) membuat file dengan tata letak sama seperti "DRAF Laporan Keuangan …xlsx":
  satu sheet per bulan (January … Sep), masing-masing kumulatif sejak Januari, kolom
  Tgl | Pos | Keterangan | No Kwitansi | Piao Wen | Keterangan | Masuk | Keluar | Saldo, rumus saldo berjalan.
  Kolom Tgl berisi tanggal lengkap (1/1/2026); setiap bulan diawali satu baris kosong.
  Saat impor, file lama dengan judul bulan ("JANUARI 2026") + nomor hari juga tetap bisa dibaca.
- **⇪ Impor File DRAF** membaca file DRAF (tata letak baru maupun lama "NAMA" gabungan). Data akun di bulan yang dipilih
  **diganti** dengan isi file (tidak ditambah), jadi aman walau bulan itu sudah diimpor dari mutasi.
- **+ Baris** menambah transaksi langsung di halaman Draf.
- Aturan & tata letak ada di satu file: `src/services/drafFormat.js`.

**Pecah transaksi manual**: klik baris di Draf → *✂ Pecah ke pos lain*. Total tetap sama dengan rekening koran;
menghapus pecahan menggabungkannya kembali ke baris asal.

## Struktur kode

```
app/
├─ server.js                 titik masuk: membuat context lalu menjalankan server HTTP
├─ src/
│  ├─ config.js              port, lokasi database (bisa diatur lewat environment variable)
│  ├─ context.js             merangkai database → repositories → services
│  ├─ db/
│  │  ├─ connection.js       membuka SQLite + helper transaksi database
│  │  ├─ migrations.js       skema tabel (berversi; tambahkan migrasi baru di akhir)
│  │  └─ seed.js             data awal Kuang Hang (akun, pos, saldo awal)
│  ├─ lib/                   helper umum: uang (sen), periode/tanggal, teks, error
│  ├─ repositories/          HANYA query SQL, satu file per tabel
│  ├─ services/              aturan bisnis (tidak tahu soal HTTP)
│  │  ├─ mutasiParser.js     membaca file rekening koran BCA
│  │  ├─ classifier.js       kode kolom C → pos / kategori / nama
│  │  ├─ importService.js    upload → preview → simpan
│  │  ├─ transactionService.js  input manual, ubah, alokasi, pindahan antar pos
│  │  ├─ balanceService.js   saldo per pos per akun pada suatu tanggal
│  │  ├─ ledgerService.js    sheet Tabel, sheet per pos, Draf
│  │  ├─ reconciliationService.js  Cek Saldo
│  │  ├─ reportService.js    laporan bulanan (Bentuk Laporan Keuangan)
│  │  └─ excelExport.js      semua ekspor Excel
│  └─ http/
│     ├─ app.js              server HTTP, validasi Fothang, file statis
│     ├─ router.js, respond.js
│     └─ routes/             daftar endpoint API per topik
├─ public/                   frontend (HTML + CSS + JavaScript modul, tanpa build)
│  ├─ css/                   base, layout, sheet (gaya Excel), report (cetak PDF)
│  └─ js/
│     ├─ main.js             header (Fothang & tahun) + router halaman
│     ├─ core/               api, store (state), dom (template aman), format
│     ├─ components/         modal/toast, pilihan dropdown, form transaksi
│     └─ views/              satu file per langkah alur kerja + pengaturan
├─ scripts/import-folder.js  impor banyak file mutasi sekaligus
└─ test/                     pengujian otomatis (node --test)
```

### Prinsip

- **Uang selalu dalam sen (integer)** di database dan perhitungan; dikonversi ke rupiah hanya di tepi (API/Excel).
- **Lapisan terpisah**: `routes` → `services` → `repositories`. Aturan bisnis hanya di `services`, SQL hanya di `repositories`.
- **Data rekening koran tidak bisa diubah** (tanggal/nominal), hanya alokasinya, supaya selalu cocok dengan bank.
- **Setiap data terikat ke satu Fothang**; service memeriksa kepemilikan sebelum membaca/mengubah.
- **Frontend tanpa build**: modul JavaScript biasa, `html\`\`` meng-escape nilai otomatis.

### Contoh perubahan umum

- *Menambah kategori baku dari bank* → `src/services/classifier.js` (`systemCategory`)
- *Mengubah tata letak laporan bulanan* → `public/js/views/laporanView.js` dan `src/services/excelExport.js`
- *Menambah kolom di tabel transaksi* → tambahkan migrasi baru di `src/db/migrations.js`, lalu `transactionRepo.js`
- *Menambah pemeriksaan di Cek Saldo* → `src/services/reconciliationService.js` (`check(label, ok, detail)`)
