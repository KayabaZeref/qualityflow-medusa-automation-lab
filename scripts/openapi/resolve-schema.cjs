/**
 * Resolves a Medusa validator export into a usable zod schema.
 *
 * Two important details about Medusa v2's validators:
 *
 * 1. They are built on Medusa's **own zod fork** (`@medusajs/deps/zod`), not the
 *    `zod` package in the app's node_modules. Schemas must be converted with that
 *    fork's `z.toJSONSchema`, otherwise conversion fails with
 *    "Cannot read properties of undefined (reading 'def')".
 *
 * 2. Validators come in two shapes:
 *      - Plain zod schema objects (most GET/POST query validators).
 *      - Factory functions produced by `WithAdditionalData(...)`, e.g.
 *        `AdminCreateCampaign`. These take an `additionalDataValidator` and
 *        return the real schema, so they must be *invoked* first.
 */

const path = require("path");

let cachedZod = null;
function medusaZod() {
  if (cachedZod) return cachedZod;
  cachedZod = require(path.join(
    path.resolve(__dirname, "..", ".."),
    "node_modules",
    "@medusajs",
    "deps",
    "dist",
    "zod.js"
  ));
  return cachedZod;
}

/**
 * Resolve a validator export to a concrete zod schema, or null.
 */
function resolveSchema(exported) {
  if (!exported) return null;

  // Plain zod schema object
  if (typeof exported === "object" && exported._zod) return exported;

  // Factory function (WithAdditionalData wrapper). It accepts an optional
  // additionalDataValidator; passing undefined makes it fall back to a
  // permissive `additional_data` record, which is what the server does by default.
  if (typeof exported === "function") {
    try {
      const result = exported(undefined);
      if (result && typeof result === "object" && result._zod) return result;
      if (result && typeof result === "object") {
        for (const v of Object.values(result)) {
          if (v && typeof v === "object" && v._zod) return v;
        }
      }
    } catch (err) {
      return null;
    }
    return null;
  }

  return null;
}

/** Convert a resolved schema to a JSON Schema using Medusa's zod fork. */
function toJsonSchema(schema) {
  if (!schema) return null;
  const z = medusaZod();
  try {
    return z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  } catch (err) {
    return null;
  }
}

module.exports = { resolveSchema, toJsonSchema, medusaZod };