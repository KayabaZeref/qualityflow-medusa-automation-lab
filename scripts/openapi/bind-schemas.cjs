/**
 * Binds zod validators to (route, method) pairs.
 *
 * Medusa's `middlewares.js` binds schemas by convention: inside a middleware
 * array, the function named `validateBody` closes over a body schema and
 * `validateQuery` closes over a query schema. The schema itself lives in the
 * sibling `validators.js` module under a name that follows a predictable
 * convention, which we match against:
 *
 *   validateQuery on GET  /admin/products  -> AdminGetProductsParams
 *   validateBody  on POST /admin/products  -> AdminCreateProduct
 *   validateQuery on POST /admin/products  -> AdminGetProductsParams
 *
 * The middleware's own `matcher` string is the most reliable signal, because it
 * is the exact path Medusa registered. We translate the matcher into the same
 * shape as the folder-derived route path and prefer it over the folder path.
 */

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/** Middleware arrays are positional: [0]=body (POST/PUT/PATCH), [0/1]=query. */
function middlewareRoles(entry) {
  const list = entry.middlewares || [];
  const roles = [];
  list.forEach((fn, index) => {
    if (typeof fn !== "function") return;
    const name = fn.name || "";
    if (name === "validateBody") roles.push({ role: "body", index });
    else if (name === "validateQuery") roles.push({ role: "query", index });
  });
  return roles;
}

/**
 * Normalise a Medusa middleware matcher into a comparable path.
 * `/admin/products/*` -> `/admin/products/:wildcard`
 */
function normalizeMatcher(matcher) {
  return String(matcher)
    .replace(/\/\*+$/, "/:wildcard")
    .replace(/\/:[^/]+/g, (m) => m); // keep :param style as-is
}

/**
 * Produce candidate validator names for a (path, method, role) triple.
 */
function guessValidatorNames(routePath, method, role, validatorExports) {
  const has = (n) => n && Object.prototype.hasOwnProperty.call(validatorExports, n);

  const isAdmin = routePath.startsWith("/admin");
  const isAuth = routePath.startsWith("/auth");
  const prefix = isAuth ? "Auth" : isAdmin ? "Admin" : "Store";

  const segments = routePath.split("/").filter(Boolean);
  const resource = (segments[1] || "root").replace(/:.*$/, "");
  const singular = resource.replace(/s$/, "");
  const Title = singular.charAt(0).toUpperCase() + singular.slice(1);
  const Resource = resource.charAt(0).toUpperCase() + resource.slice(1);

  if (role === "query") {
    const candidates = [
      `${prefix}Get${Title}Params`,
      `${prefix}Get${Title}sParams`,
      `${prefix}Get${Resource}Params`,
      `${prefix}Get${Resource}sParams`,
      `${prefix}List${Resource}Params`,
      `${prefix}Get${Resource}${Title}Params`,
      `${prefix}GetOrdersOrderParams`,
      `${prefix}Get${Resource}ParamsFields`,
      `${prefix}Get${Title}ParamsFields`,
    ];
    const hit = candidates.find(has);
    return hit ? [hit] : [];
  }

  const action =
    method === "POST" ? "Create" : method === "PUT" || method === "PATCH" ? "Update" : "";
  if (!action) return [];

  const candidates = [
    `${prefix}${action}${Title}`,
    `${prefix}${action}${Resource}`,
    `${action}${Title}`,
    `${action}${Resource}`,
    `Admin${action}Product`,
    `Admin${action}ProductVariant`,
    `Admin${action}ProductOption`,
    `AdminBatchUpdate${Resource}`,
  ];
  const hit = candidates.find(has);
  return hit ? [hit] : [];
}

/**
 * Given the full set of exported validator names, try to find the *best* match
 * for a route by scoring how well the name relates to the route path.
 * Used as a fallback when the strict convention does not hit.
 */
function fuzzyValidatorNames(routePath, method, role, validatorExports) {
  const names = Object.keys(validatorExports);
  if (!names.length) return [];

  const segments = routePath.split("/").filter(Boolean);
  const resource = (segments[1] || "").replace(/:.*$/, "");
  const singular = resource.replace(/s$/, "");
  const Title = singular.charAt(0).toUpperCase() + singular.slice(1);
  const isAdmin = routePath.startsWith("/admin");
  const isAuth = routePath.startsWith("/auth");
  const prefix = isAuth ? "Auth" : isAdmin ? "Admin" : "Store";
  const action =
    method === "POST" ? "Create" : method === "PUT" || method === "PATCH" ? "Update" : "";

  const scored = names
    .map((n) => {
      let score = 0;
      if (n.startsWith(prefix)) score += 2;
      if (role === "body") {
        if (action && n.includes(action)) score += 3;
        if (n.includes(Title) || n.includes(resource)) score += 3;
      } else {
        if (/Params$/.test(n)) score += 3;
        if (n.includes(Title) || n.includes(resource)) score += 3;
        if (/Get|List/.test(n)) score += 2;
      }
      if (/_Fields$/.test(n)) score -= 1; // prefer the merged schema
      return { n, score };
    })
    .filter((x) => x.score >= 6)
    .sort((a, b) => b.score - a.score);

  return scored.map((s) => s.n);
}

module.exports = { middlewareRoles, guessValidatorNames, fuzzyValidatorNames, normalizeMatcher };