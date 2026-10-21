/**
 * Extracts the exact validator bindings for each (matcher, method) by parsing
 * the *source text* of Medusa's compiled `middlewares.js` files.
 *
 * Why source parsing: the compiled middleware array reads like
 *
 *   middlewares: [
 *     (0, framework_1.validateAndTransformBody)(validators_1.AdminCreateProduct),
 *     (0, framework_1.validateAndTransformQuery)(validators_1.AdminGetProductsParams),
 *   ]
 *
 * The validator name is a literal in the source, so we can recover the exact
 * binding instead of guessing from naming conventions. This is precise where
 * heuristics fail (e.g. `/admin/products/:id/variants` legitimately binds
 * `AdminGetProductVariantParams`, not `AdminGetProductParams`).
 *
 * Parsing strategy: split the file into top-level route entries by brace
 * matching, then read `matcher`, `method` and the middleware list from each
 * entry. Brace matching is used because `method:` and `matcher:` can appear in
 * either order, and because a policy-only entry has no `middlewares` array.
 */

const fs = require("fs");

/**
 * Find the route entries in a compiled middlewares module.
 *
 * The module body looks like:
 *
 *   exports.adminProductRoutesMiddlewares = [
 *     { matcher: "/admin/products", method: ["GET"], middlewares: [...] },
 *     ...
 *   ]
 *
 * We locate the exported array and then take each top-level `{ ... }` object
 * inside it. Brace matching must ignore braces inside string literals.
 */
function splitEntries(source) {
  // Find the array that holds the route entries. It is the value of an
  // `exports.<name> = [ ... ]` assignment. Anchoring on `exports` avoids
  // matching unrelated `= [` occurrences inside compiler helper boilerplate.
  const arrMatch = source.match(/exports\.[A-Za-z0-9_]+\s*=\s*\[/);
  if (!arrMatch) return [];

  const entries = [];
  let depth = 0;
  let objStart = -1;
  let inString = null;
  let escaped = false;

  // Start just after the opening `[` of the exports array.
  let i = arrMatch.index + arrMatch[0].length;
  depth = 1; // depth of the array itself

  for (; i < source.length; i++) {
    const c = source[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === inString) inString = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      inString = c;
      continue;
    }

    if (c === "{" || c === "[" || c === "(") {
      if (depth === 1 && c === "{" && objStart < 0) {
        objStart = i; // beginning of a route entry object
      }
      depth++;
      continue;
    }

    if (c === "}" || c === "]" || c === ")") {
      depth--;
      if (depth === 1 && objStart >= 0) {
        // just closed a route entry object
        const chunk = source.slice(objStart, i + 1);
        if (/\bmatcher\s*:/.test(chunk)) {
          entries.push({ start: objStart, end: i + 1, text: chunk });
        }
        objStart = -1;
      }
      if (depth === 0) break; // closed the exports array
      continue;
    }
  }

  return entries;
}

/** Read the `matcher` string from an entry. */
function readMatcher(text) {
  const m = text.match(/\bmatcher\s*:\s*(?:"([^"]*)"|'([^']*)')/);
  if (!m) return null;
  return m[1] !== undefined ? m[1] : m[2];
}

/** Read the HTTP methods declared on an entry. */
function readMethods(text) {
  const m = text.match(/\bmethod\s*:\s*\[([^\]]*)\]/);
  if (!m) return [];
  const out = [];
  const re = /["']([A-Z]+)["']/g;
  let hit;
  while ((hit = re.exec(m[1])) !== null) out.push(hit[1]);
  return out;
}

/**
 * Read the ordered validator expressions on an entry.
 * Returns { bodies: [...], queries: [...] } where each item is the argument
 * expression of validateAndTransformBody / validateAndTransformQuery.
 */
function readValidators(text) {
  const bodies = [];
  const queries = [];

  // Only look inside the `middlewares: [ ... ]` array.
  const mm = text.match(/\bmiddlewares\s*:\s*\[/);
  if (!mm) return { bodies, queries };
  const arrStart = mm.index + mm[0].length;

  // find matching close bracket
  let depth = 1;
  let i = arrStart;
  let inString = null;
  let escaped = false;
  while (i < text.length && depth > 0) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === inString) inString = null;
    } else if (c === '"' || c === "'" || c === "`") {
      inString = c;
    } else if (c === "[" || c === "(") {
      depth++;
    } else if (c === "]" || c === ")") {
      depth--;
    }
    i++;
  }
  const arrText = text.slice(arrStart, i - 1);

  const bodyRe = /validateAndTransformBody\)\(([\s\S]*?)\)(?=,\s*(?:\(|\w)|,?\s*$)/g;
  const queryRe = /validateAndTransformQuery\)\(([\s\S]*?)\)(?=,\s*(?:\(|\w)|,?\s*$)/g;

  let b;
  while ((b = bodyRe.exec(arrText)) !== null) bodies.push(b[1].trim());
  let q;
  while ((q = queryRe.exec(arrText)) !== null) queries.push(q[1].trim());

  return { bodies, queries };
}

/**
 * Extract the validator *export name* from an argument expression.
 *   `validators_3.AdminCreateProduct` -> `AdminCreateProduct`
 *   `validators_1.AdminGetProductsParams, QueryConfig.x` -> `AdminGetProductsParams`
 *
 * Batch bodies are composed like
 *   `createBatchBody(validators_1.CreateProduct, validators_1.AdminBatchUpdateProduct)`
 * — we take the first referenced validator, which is the "create" array shape.
 */
function extractValidatorName(expr) {
  if (!expr) return null;
  const all = expr.match(/validators_\d+\.([A-Za-z0-9_]+)/g);
  if (all && all.length) {
    const first = all[0].match(/validators_\d+\.([A-Za-z0-9_]+)/);
    return first ? first[1] : null;
  }
  return null;
}

/**
 * Build a map: "matcher|method" -> { body?: name, query?: name }
 * using the live module for exact matcher/method and the source for the
 * validator name.
 */
function buildBindingMap(mwFile, mwMod) {
  const source = fs.readFileSync(mwFile, "utf8");
  const entries = splitEntries(source);

  // source: matcher+method -> { bodies, queries }
  //
  // The same matcher can appear for several methods (e.g. "/admin/products"
  // for both GET and POST), so we key by matcher *and* method. Entries that
  // declare no method apply to every method.
  const byMatcherMethod = new Map();
  const byMatcherAny = new Map();
  for (const e of entries) {
    const matcher = readMatcher(e.text);
    if (!matcher) continue;
    const validators = readValidators(e.text);
    const methods = readMethods(e.text);
    if (!methods.length) {
      if (!byMatcherAny.has(matcher)) byMatcherAny.set(matcher, validators);
      continue;
    }
    for (const m of methods) {
      const key = `${matcher}|${m}`;
      if (!byMatcherMethod.has(key)) byMatcherMethod.set(key, validators);
    }
  }

  // live module: exact matcher + method -> middleware array
  const liveEntries = [];
  for (const key of Object.keys(mwMod || {})) {
    const v = mwMod[key];
    if (Array.isArray(v)) liveEntries.push(...v);
    else if (v && Array.isArray(v.middlewares)) liveEntries.push(v);
  }

  const out = new Map();
  for (const entry of liveEntries) {
    if (!entry.matcher) continue;

    const methods = entry.method
      ? Array.isArray(entry.method)
        ? entry.method
        : [entry.method]
      : ["GET", "POST", "PUT", "PATCH", "DELETE"];

    for (const method of methods) {
      const src =
        byMatcherMethod.get(`${entry.matcher}|${method}`) || byMatcherAny.get(entry.matcher);
      if (!src) continue;

      const key = `${entry.matcher}|${method}`;
      const slot = out.get(key) || {};

      // Pair by ordinal occurrence: the live array may contain other
      // middlewares (authenticate, applyDefaultFilters, ...) that shift
      // absolute positions.
      const list = entry.middlewares || [];
      let bodyOrdinal = 0;
      let queryOrdinal = 0;
      list.forEach((fn) => {
        if (typeof fn !== "function") return;
        const name = fn.name || "";
        if (name === "validateBody") {
          const expr = src.bodies[bodyOrdinal++];
          const n = extractValidatorName(expr);
          if (n && !slot.body) slot.body = n;
        } else if (name === "validateQuery") {
          const expr = src.queries[queryOrdinal++];
          const n = extractValidatorName(expr);
          if (n && !slot.query) slot.query = n;
        }
      });

      out.set(key, slot);
    }
  }

  return out;
}

module.exports = {
  splitEntries,
  readMatcher,
  readMethods,
  readValidators,
  extractValidatorName,
  buildBindingMap,
};