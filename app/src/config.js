// Konfigurasi aplikasi untuk proses ini (dari process.env). Aturan & urutan prioritasnya: lihat configLoader.js.
const path = require('node:path');
const { loadConfig } = require('./configLoader');

module.exports = loadConfig(process.env, { rootDir: path.join(__dirname, '..') });
