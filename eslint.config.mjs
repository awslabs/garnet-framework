import js from '@eslint/js'
import tseslint from 'typescript-eslint'

/**
 * Lint configuration for the Garnet Framework.
 *
 * The intent is to catch the class of defect that has actually bitten this
 * codebase - undefined variables, unreachable or dropped control flow, floating
 * promises - rather than to enforce a formatting style across a codebase that
 * predates the linter. Stylistic rules are deliberately left off so the first
 * run is actionable instead of producing thousands of diffs.
 */
export default tseslint.config(
  {
    // Generated, vendored, or not ours
    ignores: [
      'node_modules/**',
      'cdk.out/**',
      'lib/layers/nodejs/node_modules/**',
      '**/*.d.ts',
      'context.jsonld'
    ]
  },

  // Infrastructure: TypeScript CDK code
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module'
      }
    },
    rules: {
      // The codebase intentionally keeps some unused imports and commented-out
      // alternatives; surface them as warnings instead of blocking CI.
      '@typescript-eslint/no-unused-vars': ['warn', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_'
      }],
      // CDK constructs are frequently instantiated for their side effect
      'no-new': 'off',
      // `any` is pervasive in the existing dashboard/az-list code
      '@typescript-eslint/no-explicit-any': 'warn',
      // Non-null assertions are the established idiom for deployment_params here
      '@typescript-eslint/no-non-null-assertion': 'off',
      // Every construct declares an empty props interface as an extension point.
      // Warn so new code is nudged, but do not fail CI on the existing pattern.
      '@typescript-eslint/no-empty-object-type': 'warn',
      // constants.ts reads the version out of package.json at synth time
      '@typescript-eslint/no-require-imports': 'warn'
    }
  },

  // Lambda handlers: CommonJS running on the Node 24 runtime
  {
    files: ['lib/**/lambda/**/*.js', 'lib/layers/nodejs/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        exports: 'writable',
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly'
      }
    },
    rules: {
      // This is the rule that catches the bug class we just fixed by hand: a
      // handler referencing a variable that does not exist in scope.
      'no-undef': 'error',
      'no-unreachable': 'error',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // An await inside a loop is usually intentional here (sequential upserts)
      'no-await-in-loop': 'off'
    }
  },

  // Build and pipeline tooling
  {
    files: ['jest.config.js', 'install.js', '.github/scripts/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        exports: 'writable',
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        // Provided by the Node runtime, not by a bundler
        fetch: 'readonly',
        AbortController: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly'
      }
    },
    extends: [js.configs.recommended]
  },
  {
    files: ['test/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: {
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        jest: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        require: 'readonly'
      }
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': 'warn'
    }
  }
)
