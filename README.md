# Sistem Keuangan Guang Ji

Aplikasi pembukuan untuk Fothang di bawah Yayasan Guang Ji — saat ini dipakai untuk **Kuang Hang Fo Thang**,
dan disiapkan untuk banyak Fothang.

Alur kerjanya mengikuti proses manual di Excel:

**Mutasi Bank → Draf → Laporan per Pos → Cek Saldo → Laporan PDF**, ditambah **Dashboard** total & per pos.

- Kode aplikasi, cara menjalankan, dan penjelasan struktur: **[app/README.md](app/README.md)**
- Pengujian otomatis: `cd app && npm test`

> Data keuangan (mutasi bank, file Excel/PDF, database) **tidak** disimpan di repository ini — lihat `.gitignore`.
