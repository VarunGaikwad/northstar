// ESLint 9 flat config (typescript-eslint).
// Run:  npm run lint          (report, warnings don't fail the build)
//       npm run lint:fix      (auto-fix)
const js = require("@eslint/js");
const tseslint = require("typescript-eslint");
const globals = require("globals");

module.exports = tseslint.config(
  // ── Global ignores: generated / config / build artefacts. ──────────
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "prisma/**/*",
      "prisma.config.ts",
      "lrdata.json",
      "eslint.config.js",
    ],
  },

  // ── Base recommendations for ALL JS/TS (non-type-checked). ─────────
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ── Project-wide settings & rule tuning. ──────────────────────────
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.nodeBuiltin,
      },
    },
    rules: {
      // Server app: allow console.*.
      "no-console": "off",
      // Delegate unused-vars entirely to the typed rule below.
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // Express handlers commonly ignore `next`; recommended covers us.
      "no-unused-expressions": "off",
      // `any` is a warning, not an error — keep it visible without breaking CI.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      // The global Express.Request.user augmentation uses namespaces intentionally.
      "@typescript-eslint/no-namespace": "off",
      "prefer-const": "warn",
    },
  },

  // ── Type-checked linting: scoped to src/** only (these files live in
  //    tsconfig.json). Config files and scripts/ are kept out so the project
  //    service doesn't choke on them. ─────────────────────────────────
  {
    files: ["src/**/*.ts"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      // The global Express.Request.user augmentation in src/middleware/auth.ts
      // uses namespaces intentionally — recommendedTypeChecked re-enables this.
      "@typescript-eslint/no-namespace": "off",
      // `{}` is the idiomatic Express convention for empty Params/ResBody in
      // `Request<{}, {}, ReqBody>` generics — not a bug. recommendedTypeChecked
      // flags it; turn it off to avoid noisy false positives.
      "@typescript-eslint/no-empty-object-type": "off",
      // Express controllers receive `req.body` typed as `any` from the validate
      // middleware; the resulting unsafe-* noise is pattern, not bug → warn only.
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      // Type assertions sometimes needed for narrowing; warn instead of error.
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
    },
  },

  // ── Node scripts: outside tsconfig, no type-checked rules; allow a
  //    little more freedom (seed/parse helpers). ──────────────────────
  {
    files: ["scripts/**/*"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
    },
  },

  // ── Test files: run with the built-in node:test runner. Each `test(...)`
  //    call returns a promise handled by the runner (not awaited inline), so
  //    relax the floating-promises rule. Keep everything else type-checked. ─
  {
    files: ["**/*.test.ts", "**/*.test.js"],
    rules: {
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
    },
  },
);