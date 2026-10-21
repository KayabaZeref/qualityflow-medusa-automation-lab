#!/usr/bin/env node
/**
 * Generate an OpenAPI 3.0 spec from the Medusa backend's real routes + zod
 * validators, ready to import into Postman.
 *
 *   node scripts/generate-openapi.cjs
 *   node scripts/generate-openapi.cjs --filter store --out docs/store.json
 *
 * Options:
 *   --filter <kind>   only include admin | store | auth | custom
 *   --out <file>      output path (default: docs/openapi.json)
 *   --compact         do not pretty-print
 */

const fs = require("fs");
const path = require("path");

const {
  ROOT,
  MEDUSA_API,
  LOCAL_API,
  HTTP_METHODS,
  toRoutePath,
  findRouteFiles,
  routeKind,
} = require("./openapi/discover.cjs");
const { middlewareRoles, guessValidatorNames, fuzzyValidatorNames } = require("./openapi/bind-schemas.cjs");
const { buildBindingMap } = require("./openapi/parse-middlewares.cjs");
const { resolveSchema, toJsonSchema } = require("./openapi/resolve-schema.cjs");

// ---------------------------------------------------------------- CLI parsing
const argv = process.argv.slice(2);
function argValue(flag, fallback = undefined) {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}
const FILTER = argValue("--filter");
const OUT = path.resolve(ROOT, argValue("--out", "docs/openapi.json"));
const PRETTY = !argv.includes("--compact");

// ------------------------------------------------------------------ collecting
const routeFiles = [...findRouteFiles(MEDUSA_API), ...findRouteFiles(LOCAL_API)];

const operations = [];

/**
 * Require a module, transparently handling TypeScript.
 *
 * Medusa's own routes ship as compiled JS under `dist/api`, but the project's
 * own routes live in `src/api` as `.ts`. Node cannot require those directly, so
 * we strip the type-only syntax with the `typescript` compiler that is already a
 * dependency of the workspace and evaluate the result.
 */
let tsCompiler = null;
try {
  tsCompiler = require(path.join(ROOT, "node_modules", "typescript"));
} catch {
  tsCompiler = null;
}

function requireTypeScript(file) {
  if (!tsCompiler) return null;
  const source = fs.readFileSync(file, "utf8");
  const js = tsCompiler.transpileModule(source, {
    compilerOptions: {
      module: tsCompiler.ModuleKind.CommonJS,
      target: tsCompiler.ScriptTarget.ES2021,
      esModuleInterop: true,
    },
    fileName: file,
  }).outputText;

  const Module = require("module");
  const m = new Module(file, null);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(js, file);
  return m.exports;
}

function safeRequire(p) {
  try {
    if (p.endsWith(".ts")) {
      return requireTypeScript(p);
    }
    return require(p);
  } catch (err) {
    return null;
  }
}

/**
 * Pre-pass: build a global map of "matcher|method" -> { body, query, valMod }.
 *
 * A route's validators are often declared in a *parent* folder. For example
 * `api/admin/products/middlewares.js` declares the matcher `/admin/products/:id`
 * for the `[id]` route folder, and `api/admin/products/[id]/middlewares.js`
 * does not exist at all. So we index every middlewares file in the API tree
 * and look routes up globally.
 */
const GLOBAL_BINDINGS = new Map();
const GLOBAL_PARSED = new Set();

function indexMiddlewares() {
  const roots = [MEDUSA_API, LOCAL_API];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const walk = (dir) => {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name.startsWith("_") || entry.name === "node_modules") continue;
          walk(full);
          continue;
        }
        if (entry.name !== "middlewares.js") continue;
        if (GLOBAL_PARSED.has(full)) continue;
        GLOBAL_PARSED.add(full);

        const mod = safeRequire(full);
        if (!mod) continue;
        const valMod = safeRequire(path.join(dir, "validators.js")) || {};
        let map;
        try {
          map = buildBindingMap(full, mod);
        } catch (err) {
          continue;
        }
        for (const [k, v] of map.entries()) {
          if (!GLOBAL_BINDINGS.has(k)) {
            GLOBAL_BINDINGS.set(k, { ...v, valMod });
          }
        }
      }
    };
    walk(root);
  }
}

indexMiddlewares();

for (const file of routeFiles) {
  const dir = path.dirname(file);
  const base = file.startsWith(MEDUSA_API) ? MEDUSA_API : LOCAL_API;
  const relFromApiRoot = path.relative(base, path.dirname(file));
  const { path: routePath, params } = toRoutePath(relFromApiRoot.split(path.sep));
  const kind = routeKind(routePath);

  if (FILTER && kind !== FILTER) continue;

  const routeMod = safeRequire(file);
  if (!routeMod) continue;
  const methods = HTTP_METHODS.filter((m) => typeof routeMod[m] === "function");
  if (!methods.length) continue;

  const localValMod = safeRequire(path.join(dir, "validators.js")) || {};

  for (const method of methods) {
    // Medusa's matchers use `:id` style, which matches the folder-derived
    // route path exactly for nested routes. Fall back to a regex match so a
    // matcher like /admin/products/* also covers /admin/products/:id.
    let slot = GLOBAL_BINDINGS.get(`${routePath}|${method}`);
    if (!slot) {
      let best = null;
      let bestLen = -1;
      for (const [k, v] of GLOBAL_BINDINGS.entries()) {
        const idx = k.lastIndexOf("|");
        const matcher = k.slice(0, idx);
        const m = k.slice(idx + 1);
        if (m !== method) continue;
        if (!matcher.includes(":")) continue;
        const pattern = new RegExp(
          "^" + matcher.replace(/:\*/g, ".*").replace(/:[^/]+/g, "[^/]+") + "$"
        );
        if (pattern.test(routePath) && matcher.length > bestLen) {
          best = v;
          bestLen = matcher.length;
        }
      }
      if (best) slot = best;
    }
    slot = slot || {};
    const valMod = slot.valMod || localValMod;
    operations.push({
      method,
      routePath,
      kind,
      params,
      bodySchemaName: slot.body,
      querySchemaName: slot.query,
      valMod,
    });
  }
}

// --------------------------------------------------- zod -> OpenAPI conversion
const SCHEMA_REGISTRY = new Map();

/** Name of the schema currently being converted, used to rewrite $defs refs. */
let CURRENT_SCHEMA_NAME = "";

/**
 * Convert a JSON-Schema union (anyOf / oneOf) to OpenAPI 3.0.
 *
 * JSON Schema expresses "string or null" as `anyOf: [{type:"string"},{type:"null"}]`.
 * OpenAPI 3.0 has no `null` type, so the null branch is removed and the
 * remaining branch is marked `nullable: true`.
 */
function convertUnion(branches) {
  if (!Array.isArray(branches)) return convertSchema(branches);

  const converted = branches.map((b) => convertSchema(b));

  // Split off the null branches.
  const nullBranches = converted.filter(
    (b) => b && b.type === "null" && Object.keys(b).length === 1
  );
  const real = converted.filter(
    (b) => !(b && b.type === "null" && Object.keys(b).length === 1)
  );

  if (!nullBranches.length) return real;

  if (real.length === 0) {
    // Only null: express as a nullable string.
    return [{ type: "string", nullable: true }];
  }
  if (real.length === 1) {
    return [{ ...real[0], nullable: true }];
  }
  // Multiple real branches: keep them, and wrap the union as nullable.
  return real.map((b) => ({ ...b, nullable: true }));
}

/** JSON Schema 2020-12 -> OpenAPI 3.0/3.1 compatible shape. */
function convertSchema(json) {
  if (!json || typeof json !== "object") return json;
  if (Array.isArray(json)) return json.map(convertSchema);

  const out = {};
  for (const [k, v] of Object.entries(json)) {
    switch (k) {
      case "$schema":
      case "contentEncoding":
      case "contentMediaType":
      case "patternProperties":
      case "propertyNames":
      case "unevaluatedProperties":
      case "unevaluatedItems":
      case "$defs":
      case "definitions":
      case "nullable":
        continue;
      case "$ref": {
        // JSON Schema refs point at `#/$defs/<name>`. Those are hoisted into
        // the component registry under `<parentName>_<name>`, so the reference
        // has to be rewritten with the parent schema's name.
        const raw = String(v);
        const defMatch = raw.match(/^#\/\$defs\/(.+)$/);
        if (defMatch) {
          out.$ref = `#/components/schemas/${CURRENT_SCHEMA_NAME}_${defMatch[1]}`;
        } else {
          out.$ref = raw;
        }
        continue;
      }
      case "$id":
      case "title":
      case "description":
      case "default":
      case "deprecated":
      case "examples":
        if (k === "title" && !out.title) out.title = v;
        else if (k !== "title") out[k] = v;
        continue;
      case "const":
        // OpenAPI 3.0 has no `const`; express it as a single-value enum.
        out.enum = [v];
        continue;
      case "propertyNames":
        // Not representable in OpenAPI 3.0; the object shape is enough.
        continue;
      case "additionalProperties":
        if (typeof v === "boolean") continue;
        out.additionalProperties = convertSchema(v);
        continue;
      case "prefixItems":
        if (Array.isArray(v)) out.items = convertSchema({ anyOf: v });
        continue;
      case "items":
        out.items = convertSchema(v);
        continue;
      case "type":
        if (Array.isArray(v)) {
          const nonNull = v.filter((t) => t !== "null");
          if (nonNull.length === 1) out.type = nonNull[0];
          else if (nonNull.length === 0) out.type = "string";
          else out.oneOf = nonNull.map((t) => ({ type: t }));
          continue;
        }
        if (v === "null") {
          // OpenAPI 3.0 has no null type; a schema that is only null is
          // expressed as a nullable string.
          out.type = "string";
          out.nullable = true;
          continue;
        }
        out.type = v;
        continue;
      case "format":
        out.format = v;
        continue;
      case "required":
        out.required = v;
        continue;
      case "properties":
        out.properties = {};
        for (const [pn, ps] of Object.entries(v || {})) {
          out.properties[pn] = convertSchema(ps);
        }
        continue;
      case "anyOf":
        out.anyOf = convertUnion(v);
        continue;
      case "oneOf":
        out.oneOf = convertUnion(v);
        continue;
      case "allOf":
        out.allOf = v.map(convertSchema);
        continue;
      case "minimum":
        out.minimum = v;
        continue;
      case "maximum":
        out.maximum = v;
        continue;
      case "exclusiveMinimum":
        // OpenAPI 3.0 uses a boolean flag next to `minimum`; JSON Schema 2020-12
        // puts the bound in the value itself.
        if (typeof v === "number") {
          out.minimum = v;
          out.exclusiveMinimum = true;
        } else {
          out.exclusiveMinimum = v;
        }
        continue;
      case "exclusiveMaximum":
        if (typeof v === "number") {
          out.maximum = v;
          out.exclusiveMaximum = true;
        } else {
          out.exclusiveMaximum = v;
        }
        continue;
      case "minLength":
        out.minLength = v;
        continue;
      case "maxLength":
        out.maxLength = v;
        continue;
      case "minItems":
        out.minItems = v;
        continue;
      case "maxItems":
        out.maxItems = v;
        continue;
      case "pattern":
        out.pattern = v;
        continue;
      case "enum":
        out.enum = v;
        continue;
      default:
        if (v && typeof v === "object") out[k] = convertSchema(v);
        else out[k] = v;
    }
  }
  return out;
}

function registerSchema(name, zodSchema) {
  if (!name || !zodSchema) return null;
  const resolved = resolveSchema(zodSchema);
  if (!resolved) return null;
  const json = toJsonSchema(resolved);
  if (!json) return null;

  // Hoist JSON-Schema `$defs` into the component registry so that internal
  // `#/$defs/...` references resolve to real OpenAPI component schemas.
  CURRENT_SCHEMA_NAME = name;
  const defs = json.$defs || {};
  for (const [defName, defSchema] of Object.entries(defs)) {
    const componentName = `${name}_${defName}`;
    if (!SCHEMA_REGISTRY.has(componentName)) {
      const savedName = CURRENT_SCHEMA_NAME;
      CURRENT_SCHEMA_NAME = name;
      const convertedDef = convertSchema(defSchema);
      CURRENT_SCHEMA_NAME = savedName;
      delete convertedDef.$defs;
      SCHEMA_REGISTRY.set(componentName, convertedDef);
    }
  }

  const converted = convertSchema(json);
  delete converted.$defs;
  SCHEMA_REGISTRY.set(name, converted);
  return converted;
}

/** Flatten a JSON-schema object into OpenAPI query parameters. */
function objectToParameters(schema) {
  const params = [];
  if (!schema || schema.type !== "object" || !schema.properties) return params;
  const required = new Set(schema.required || []);
  for (const [propName, propRaw] of Object.entries(schema.properties)) {
    const prop = convertSchema(propRaw);

    // `$and` / `$or` are logical filter groups: an array of filter objects.
    // The server expects JSON-encoded objects, e.g.
    //   ?$and=[{"id":"prod_1"}]
    if (propName === "$and" || propName === "$or") {
      params.push({
        name: propName,
        in: "query",
        required: false,
        description:
          `JSON-encoded array of filter objects, e.g. ${propName}=` +
          `[{"id":"prod_01..."}]`.concat(propName === "$and" ? " (AND group)" : " (OR group)"),
        schema: { type: "string" },
        example: `[{"id":"prod_01HXXXXXXXXXXXXXX"}]`,
      });
      continue;
    }

    const simplified = simplifyQuerySchema(prop, propName.startsWith("$"));
    const param = {
      name: propName,
      in: "query",
      required: required.has(propName),
      description: prop.description || "",
      schema: simplified,
    };
    // Array query params use form style with explode so Postman generates
    // `?id[]=a&id[]=b` style values the server understands.
    if (simplified.type === "array") {
      param.style = "form";
      param.explode = true;
    }
    params.push(param);
  }
  return params;
}

/**
 * Query strings are flat, so complex JSON schemas are collapsed into the string
 * forms the server actually accepts:
 *
 *  - arrays            -> `type: array`, `style: form`, `explode: true`
 *                        (Express parses `?id[]=a&id[]=b` and `?id=a&id=b`)
 *  - operator maps     -> `created_at[$gt]=...`
 *  - objects           -> a JSON string
 */
function simplifyQuerySchema(schema, isOperator) {
  if (!schema || typeof schema !== "object") return { type: "string" };

  if (isOperator) {
    return {
      type: "string",
      description:
        "Operator value. Use created_at[$gt]=2024-01-01 style for date operators. " +
        "Supported: $eq, $ne, $in, $nin, $gt, $gte, $lt, $lte, $like, $ilike, $re, $contains.",
    };
  }

  if (schema.type === "array") {
    const itemType =
      schema.items && schema.items.type ? schema.items.type : "string";
    return {
      type: "array",
      items: { type: itemType },
      description:
        schema.description ||
        "Send as repeated params (id[]=a&id[]=b) or comma-separated (id=a,b).",
    };
  }

  if (schema.type === "object" || schema.anyOf || schema.oneOf) {
    return { type: "string", description: schema.description || "JSON object" };
  }

  const s = { ...schema };
  delete s.$schema;
  delete s.title;
  return s;
}

// ----------------------------------------------------------------- build spec
const SERVER = process.env.OPENAPI_SERVER_URL || "http://localhost:9000";
const PUBLISHABLE_KEY =
  process.env.MEDUSA_PUBLISHABLE_KEY ||
  "pk_750f454742d6c02d050aa67fd2b607a40da558cac02ee40da898779dc81a968c";

const paths = {};
let boundCount = 0;

for (const op of operations) {
  const pathItem = (paths[op.routePath] ||= {});
  const parameters = [];

  for (const p of op.params) {
    parameters.push({
      name: p,
      in: "path",
      required: true,
      description: `Replace with a real ${p}`,
      example: p === "id" ? "prod_01HXXXXXXXXXXXXXX" : `{${p}}`,
      schema: { type: "string" },
    });
  }

  if (op.querySchemaName && op.valMod[op.querySchemaName]) {
    const raw = toJsonSchema(resolveSchema(op.valMod[op.querySchemaName]));
    if (raw) {
      parameters.push(...objectToParameters(convertSchema(raw)));
      boundCount++;
    }
  }

  let bodySchemaName = null;
  if (op.bodySchemaName && op.valMod[op.bodySchemaName]) {
    const converted = registerSchema(op.bodySchemaName, op.valMod[op.bodySchemaName]);
    if (converted) {
      bodySchemaName = op.bodySchemaName;
      boundCount++;
    }
  }

  const security =
    op.kind === "admin" ? [{ adminSession: [] }] : op.kind === "store" ? [{ publishableKey: [] }] : [];

  const tag =
    op.kind === "custom" ? "Custom" : op.kind.charAt(0).toUpperCase() + op.kind.slice(1);

  pathItem[op.method.toLowerCase()] = {
    tags: [tag],
    summary: `${op.method} ${op.routePath}`,
    operationId: `${op.method.toLowerCase()}_${op.routePath
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")}`,
    security,
    parameters,
    ...(bodySchemaName
      ? {
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: `#/components/schemas/${bodySchemaName}` },
              },
            },
          },
        }
      : {}),
    responses: {
      200: {
        description: "Successful response",
        content: {
          "application/json": { schema: { type: "object", additionalProperties: true } },
        },
      },
    },
  };
}

const spec = {
  openapi: "3.0.3",
  info: {
    title: "Medusa E-commerce API",
    version: "1.0.0",
    description:
      "Auto-generated from the Medusa backend's real routes and zod validators.\n\n" +
      "**Import into Postman:** Import > Link > (choose this file). " +
      "Postman will create one request per endpoint, grouped by tag.\n\n" +
      "**Auth**\n" +
      "1. *Store* routes use the publishable key, which is already filled in.\n" +
      "2. *Admin* routes need a JWT. Call `POST /auth/user/emailpass` with " +
      "`{ \"email\": \"...\", \"password\": \"...\" }`, copy the `token` from the " +
      "response, then paste it into the `adminSession` value in the Authorize dialog.\n" +
      "3. *Auth* routes are public.\n\n" +
      "**Note:** path parameters (`:id`) are prefilled with `{id}` — replace them " +
      "with a real id from the list endpoint.",
  },
  servers: [
    {
      url: SERVER,
      description: "Local Medusa backend",
      variables: {
        baseUrl: { default: SERVER, description: "Backend base URL" },
      },
    },
  ],
  tags: [
    { name: "Store", description: "Storefront APIs (publishable key)" },
    { name: "Admin", description: "Admin APIs (JWT required)" },
    { name: "Auth", description: "Authentication APIs (public)" },
    { name: "Custom", description: "Custom project APIs" },
  ],
  components: {
    securitySchemes: {
      publishableKey: {
        type: "apiKey",
        in: "header",
        name: "x-publishable-api-key",
        description:
          "Store API key. Pre-filled with your local key. Find or create one at POST /admin/api-keys.",
      },
      adminSession: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description:
          "Admin JWT. Get it from POST /auth/user/emailpass with { email, password }; " +
          "the response contains a `token` field. Paste it into the Authorize dialog.",
      },
    },
    schemas: Object.fromEntries(SCHEMA_REGISTRY),
  },
  paths,
  "x-publishable-api-key": PUBLISHABLE_KEY,
};

/**
 * Also emit a Postman environment file so the publishable key and base URL are
 * available as environment variables right after import.
 */
const postmanEnv = {
  id: "medusa-local-env",
  name: "Medusa Local",
  values: [
    { key: "baseUrl", value: SERVER, enabled: true, type: "default" },
    { key: "publishableKey", value: PUBLISHABLE_KEY, enabled: true, type: "secret" },
    { key: "adminToken", value: "", enabled: true, type: "secret" },
  ],
  _postman_variable_scope: "environment",
  _postman_exported_using: "medusa-openapi-generator",
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, PRETTY ? JSON.stringify(spec, null, 2) : JSON.stringify(spec));
fs.writeFileSync(
  path.join(path.dirname(OUT), "postman-environment.json"),
  JSON.stringify(postmanEnv, null, 2)
);

const byKind = operations.reduce((acc, o) => ((acc[o.kind] = (acc[o.kind] || 0) + 1), acc), {});
console.log(`OpenAPI spec written to ${path.relative(ROOT, OUT)}`);
console.log(`  paths:   ${Object.keys(paths).length}`);
console.log(`  ops:     ${operations.length}`);
console.log(`  schemas: ${SCHEMA_REGISTRY.size}`);
console.log(`  bindings:${boundCount}`);
console.log(`  by kind: ${JSON.stringify(byKind)}`);