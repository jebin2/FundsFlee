import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// ── Shared pattern lists ───────────────────────────────────────────────────────

const FRAMEWORK_SDKS = [
  { group: ["react", "react-*", "next", "next/*", "@next/*"], message: "Domain modules must not import React or Next.js." },
  { group: ["googleapis", "@anthropic-ai/*", "@google/generative-ai"], message: "Domain modules must not import SDK packages." },
];

const INFRA_PATHS = [
  { group: ["@/lib/sheets", "@/lib/sheets/*"], message: "Domain modules must not import infrastructure." },
  { group: ["@/lib/ai", "@/lib/ai/*"], message: "Domain modules must not import AI infrastructure." },
  { group: ["@/server/*"], message: "Domain modules must not import server code." },
];

const SERVER_AND_SHEETS = [
  { group: ["@/server/*"], message: "Use a hook or API client — feature/component code must not import server modules directly." },
  { group: ["@/lib/sheets", "@/lib/sheets/*"], message: "Use a hook or API client — feature/component code must not import Sheets directly." },
];

const PRODUCT_PATHS = [
  { group: ["@/features/*"], message: "AI provider adapters must not import feature code." },
  { group: ["@/domain/*"], message: "AI provider adapters must not import domain code." },
  { group: ["@/server/*"], message: "AI provider adapters must not import server code." },
  { group: ["@/app/*"], message: "AI provider adapters must not import app code." },
];

const SCHEMA_RESTRICTIONS = [
  { group: ["@/app/*"], message: "Schema modules must not import app code." },
  { group: ["@/features/*"], message: "Schema modules must not import feature code." },
  { group: ["@/server/*"], message: "Schema modules must not import server code." },
];

// ── Config ────────────────────────────────────────────────────────────────────

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),

  // Domain modules: pure business logic, no framework/SDK/infrastructure
  {
    files: ["src/domain/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [...FRAMEWORK_SDKS, ...INFRA_PATHS] }],
    },
  },

  // Feature code: no direct server or Sheets access
  {
    files: ["src/features/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: SERVER_AND_SHEETS }],
    },
  },

  // Shared UI components: same boundary as features
  {
    files: ["src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: SERVER_AND_SHEETS }],
    },
  },

  // AI provider adapters: pure HTTP adapters, no product-layer imports
  {
    files: ["src/lib/ai/providers/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: PRODUCT_PATHS }],
    },
  },

  // Sheets schema modules: no app/feature/server imports
  {
    files: ["src/lib/sheets/schema/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: SCHEMA_RESTRICTIONS }],
    },
  },
]);

export default eslintConfig;
