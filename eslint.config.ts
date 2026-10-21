import { defineConfig } from "eslint/config"
import medusa from "@medusajs/eslint-plugin"

export default defineConfig([
  ...medusa.configs.recommended,
  {
    // The Medusa rules target backend HTTP handlers, where an error's type
    // decides the HTTP status it maps to. Test helpers throw plain Errors on
    // purpose, so the rule is not meaningful here.
    files: ["tests/**/*.ts"],
    rules: {
      "@medusajs/use-medusa-error-not-generic-error": "off",
    },
  },
])
