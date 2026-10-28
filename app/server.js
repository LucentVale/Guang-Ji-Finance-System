// Titik masuk aplikasi: node server.js  ->  http://localhost:3000
const config = require('./src/config');
const { createContext } = require('./src/context');
const { createServer } = require('./src/http/app');

const ctx = createContext(config.databaseFile);
const server = createServer(ctx, config);

server.on('error', (err) => {
  // Ikon desktop bisa diklik berkali-kali: bila server sudah berjalan, proses kedua cukup berhenti.
  if (err.code === 'EADDRINUSE') {
    // Tidak memakai process.exit() agar pesan ini sempat tertulis ke log; proses berhenti sendiri karena tidak ada yang ditunggu.
    console.log(`Server sudah berjalan di http://localhost:${config.port}`);
    return;
  }
  throw err;
});

server.listen(config.port, config.host, () => {
  console.log(`Sistem Keuangan Guang Ji berjalan di http://localhost:${config.port}`);
  // Bersihkan sesi login yang sudah kedaluwarsa setiap jam.
  ctx.services.auth.purgeExpiredSessions();
  setInterval(() => ctx.services.auth.purgeExpiredSessions(), 60 * 60 * 1000).unref();
});
