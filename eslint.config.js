import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist/', 'artifacts/', '.instatic/']),
  {
    files: ['**/*.{ts,tsx,js}'],
    extends: [js.configs.recommended, tseslint.configs.recommended, reactHooks.configs.flat.recommended],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser, ...globals.builtin, Bun: 'readonly' },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '(^_|Schema$)',
      }],
    },
  },
  {
    // Server code runs in the host's QuickJS sandbox, which has no browser or
    // Node globals beyond URL, TextEncoder, crypto.subtle.digest, fetch,
    // timers and console. Tests run in Bun, where these names all exist, so
    // only this rule and `bun run verify:sandbox` catch a slip.
    files: ['server/**/*.ts', 'src/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', ...[
        'btoa', 'atob', 'Buffer', 'process', 'require', 'structuredClone', 'performance', 'Intl',
        'window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'XMLHttpRequest',
        'WebSocket', 'Blob', 'File', 'FormData', 'ReadableStream', 'WeakRef', 'FinalizationRegistry',
      ].map((name) => ({
        name,
        message: 'Not available in the plugin sandbox. Use src/og/base64.ts for base64, or keep this code in admin/.',
      }))],
    },
  },
])
