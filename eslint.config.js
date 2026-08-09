import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-control-regex': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // JR-0129 (09/08/2026) : ce projet n'utilise pas le React Compiler
      // (aucun plugin babel-plugin-react-compiler dans vite.config.ts) -- ces
      // deux regles de eslint-plugin-react-hooks@7 preparent du code pour un
      // Compiler qui ne tourne pas ici. Elles se declenchaient sur des
      // patterns React standards et corrects (fetch de donnees au montage
      // dans useJobRadarOnboarding/DesiredRoleGate/OnboardingAlertInviteBanner,
      // callbacks memorises dependant de session?.user) sans qu'aucun bug
      // reel n'ait ete trouve a l'audit (JR-0129). Les reexecuter sans le
      // Compiler ferait perdre plus en clarte/risque de regression qu'elles
      // n'apportent de securite reelle aujourd'hui. A reactiver si le
      // Compiler est un jour adopte.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
    },
  },
])
