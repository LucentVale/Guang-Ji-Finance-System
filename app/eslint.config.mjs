// Konfigurasi ESLint (format "flat", ESLint 10). Jalankan: npm run lint  (perbaiki otomatis: npm run lint:fix)
//
// Prinsip: hanya aturan PENCARI BUG, bukan aturan gaya penulisan — kode yang sudah rapi tidak dipaksa diformat ulang.
// Dua lingkungan berbeda di proyek ini:
//   - backend  (server.js, src/, scripts/, test/): Node.js, CommonJS (require / module.exports)
//   - frontend (public/js/): browser, ES module (import / export), tanpa build step
import js from '@eslint/js';
import globals from 'globals';

/** Aturan tambahan di atas "recommended", berlaku untuk kedua lingkungan. */
const sharedRules = {
  // Variabel/import tak terpakai = kode mati atau salah ketik. Argumen/variabel berawalan "_" sengaja diabaikan.
  'no-unused-vars': ['error', { args: 'after-used', argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
  // Pakai === / !==, kecuali "x == null" (pola yang sengaja dipakai untuk null ATAU undefined).
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'no-var': 'error',
  'prefer-const': ['error', { destructuring: 'all' }],
  // Pola yang hampir selalu bug.
  'no-self-compare': 'error',
  'no-template-curly-in-string': 'error', // "${x}" di string biasa, mestinya template literal
  'no-unmodified-loop-condition': 'error',
  'no-unreachable-loop': 'error',
  'no-constructor-return': 'error',
  'no-promise-executor-return': 'error',
  'array-callback-return': ['error', { checkForEach: false }],
};

export default [
  { ignores: ['node_modules/', 'data/', 'desktop/'] },

  js.configs.recommended,

  // ---- Backend: Node.js CommonJS
  {
    files: ['server.js', 'src/**/*.js', 'scripts/**/*.js', 'test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: sharedRules,
  },

  // ---- Frontend: browser ES module
  {
    files: ['public/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      ...sharedRules,
      'no-implicit-globals': 'error',
    },
  },

  // ---- File konfigurasi ini sendiri
  {
    files: ['eslint.config.mjs'],
    languageOptions: { sourceType: 'module', globals: { ...globals.node } },
  },
];
