// Membuat akun Admin dari terminal (dipakai di server online, karena halaman "Admin pertama" hanya terbuka dari komputer server).
// Pemakaian: node scripts/create-admin.js <nama-pengguna> "<Nama Lengkap>"
// Kata sandi ditanyakan di terminal (tidak ikut tersimpan di riwayat perintah).
const readline = require('node:readline');
const config = require('../src/config');
const { createContext } = require('../src/context');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); resolve(answer); }));
}

async function main() {
  const [username, fullName] = process.argv.slice(2);
  if (!username || !fullName) throw new Error('Pemakaian: node scripts/create-admin.js <nama-pengguna> "<Nama Lengkap>"');
  const password = await ask('Kata sandi (min. 8 karakter, huruf & angka): ');
  const { services } = createContext(config.databaseFile);
  services.user.create({ username, full_name: fullName, role: 'admin', password, must_change_password: false });
  console.log(`Admin ${username} berhasil dibuat.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
