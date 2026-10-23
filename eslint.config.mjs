// ESLint flat config for the whole monorepo (Phase 1.5). Run `npm run lint` from the root.
// Rules are the recommended sets only, plus React hooks for the React apps. Nothing is switched off
// to make CI pass: where a rule is relaxed, the reason is written next to it.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-test/**',
      '**/.expo/**',
      '**/web-build/**',
      '**/android/**',
      '**/ios/**',
      '**/coverage/**',
      '**/expo-env.d.ts',
      '**/.wrangler/**',
      // Third-party minified code (three.js) is not ours to lint.
      '**/vendor/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node } },
    rules: {
      // `_`-prefixed names are deliberate (destructuring to omit a key, unused callback parameters).
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none', ignoreRestSiblings: true }],
      // React Native loads images and fonts with require('./file.png') (Metro asset modules); that is the
      // platform's API, not a CommonJS import. Code modules must still use import.
      '@typescript-eslint/no-require-imports': ['error', { allow: ['\\.(png|jpe?g|gif|webp|svg|ttf|otf|mp3|mp4|json)$'] }],
    },
  },
  {
    // React apps (Expo Rider/Driver, the shared UI package, the admin web app).
    files: ['apps/rider/**/*.{ts,tsx}', 'apps/driver/**/*.{ts,tsx}', 'apps/admin/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Browser scripts of the static website and QA helpers.
    files: ['apps/web/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } },
  },
  {
    // CommonJS config files (babel/metro/jest).
    files: ['**/*.cjs', '**/babel.config.js', '**/metro.config.js', '**/jest.config.js', '**/jest.setup.js', '**/app.config.js', 'tools/qa-web/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // Cloudflare Workers run in a worker runtime, not Node.
    files: ['infra/cloudflare/**/*.ts'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  {
    // Jest tests in the Expo apps use the jest globals.
    files: ['apps/rider/**/*.test.{ts,tsx}', 'apps/driver/**/*.test.{ts,tsx}', 'apps/rider/**/__tests__/**', 'apps/driver/**/__tests__/**'],
    languageOptions: { globals: { ...globals.jest } },
    // jest.mock() factories run before imports, so a module used inside one must be require()d there.
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // QA scripts drive a headless browser: callbacks passed to page.evaluate() run in the page.
    files: ['tools/qa-web/**/*.{js,cjs}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
);
