/**
 * Generates an OpenAPI 3.0 specification from the Medusa backend's actual
 * runtime routes and zod validators.
 *
 * Why this works: Medusa builds its HTTP surface by scanning `route.js` files.
 * Each folder under `dist/api/{admin,store,auth}` maps to a URL path, with `[id]`
 * folders becoming `:id` params. The exported HTTP verbs are the handlers, and a
 * sibling `middlewares.js` binds zod schemas by *name* (`validateBody` ->
 * `AdminCreateProduct`, `validateQuery` -> `AdminGetProductsParams`). We recover
 * those schemas and emit them as OpenAPI parameters / request bodies.
 *
 * Usage: node scripts/generate-openapi.cjs [--out FILE] [--filter admin|store|auth]
 */

const fs = require("fs");
const path = require("path");

// scripts/openapi/ -> scripts/ -> repo root
const ROOT = path.resolve(__dirname, "..", "..");
const MEDUSA_API = path.join(ROOT, "node_modules", "@medusajs", "medusa", "dist", "api");
const LOCAL_API = path.join(ROOT, "apps", "backend", "src", "api");
const ZOD = require(path.join(ROOT, "node_modules", "zod"));

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

/** Turn a filesystem folder chain into an express-style path. */
function toRoutePath(segments) {
  const params = new Set();
  const parts = segments
    .filter(Boolean)
    .map((seg) => {
      if (seg.startsWith("[")) {
        const inner = seg.replace(/^\[|\].*$/g, "");
        params.add(inner);
        return `:${inner}`;
      }
      return seg;
    });
  return { path: "/" + parts.join("/"), params: [...params] };
}

/** Recursively list every route.js under a source root, relative to it. */
function findRouteFiles(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
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
      } else if (entry.name === "route.js" || entry.name === "route.ts") {
        out.push(full);
      }
    }
  };
  walk(root);
  return out;
}

function routeKind(routePath) {
  if (routePath === "/admin" || routePath.startsWith("/admin/")) return "admin";
  if (routePath === "/store" || routePath.startsWith("/store/")) return "store";
  if (routePath === "/auth" || routePath.startsWith("/auth/")) return "auth";
  return "custom";
}

module.exports = { ROOT, MEDUSA_API, LOCAL_API, ZOD, HTTP_METHODS, toRoutePath, findRouteFiles, routeKind };