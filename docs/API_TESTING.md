# API Testing with Postman

This project generates a **real OpenAPI 3.0 specification** from the Medusa
backend — not a hand-written approximation. Every route, query parameter and
request body is read from the code the server actually runs.

| | |
|---|---|
| Operations | 491 across 334 paths |
| Groups | Store (55), Admin (411), Auth (20), Custom (5) |
| Request bodies | 196 with real schemas |
| Query parameters | 1709 documented |
| Component schemas | 186 |

---

## 1. Start the stack

```bash
docker compose up -d          # PostgreSQL (5432) + Adminer (8080)
npm run backend:dev           # API on http://localhost:9000
npm run storefront:dev        # Storefront on http://localhost:8000
```

## 2. Generate the spec

```bash
npm run api:openapi
```

Writes two files:

- `docs/openapi.json` — the full spec
- `docs/postman-environment.json` — a ready-made Postman environment

Split it by area if you prefer smaller collections:

```bash
npm run api:openapi:store     # docs/openapi-store.json
npm run api:openapi:admin     # docs/openapi-admin.json
```

## 3. Import into Postman

1. Open Postman → **Import** → **Link**
2. Paste `http://localhost:9000/api-docs/openapi` — or pick `docs/openapi.json`
3. Select the **Medusa Local** environment if prompted
4. Press **Import**

Postman creates one request per operation, grouped by tag.

## 4. Authorize

### Store routes — ready to go
The publishable key is pre-filled:

```
x-publishable-api-key: pk_750f454742d6c02d050aa67fd2b607a40da558cac02ee40da898779dc81a968c
```

### Admin routes — need a JWT

Call the auth endpoint once:

```
POST http://localhost:9000/auth/user/emailpass
Content-Type: application/json

{ "email": "admin@medusa-test.com", "password": "supersecret" }
```

Copy the `token` from the response, then in Postman click **Authorize** →
`adminSession` → paste it.

### Auth routes
Public, no credentials needed.

---

## Browser explorer (no Postman needed)

| URL | What it is |
|---|---|
| <http://localhost:9000/api-docs> | Swagger UI — browse and "Try it out" |
| <http://localhost:9000/api-docs/openapi> | The raw spec |
| <http://localhost:8080> | Adminer — inspect the database |

---

## How the spec is generated

`scripts/generate-openapi.cjs` reads Medusa's compiled API tree:

1. **Route discovery** — walks `node_modules/@medusajs/medusa/dist/api` plus
   `apps/backend/src/api` for `route.js` / `route.ts` files. Exported HTTP verbs
   become operations; `[id]` folders become `:id` path parameters.

2. **Schema binding** — parses each `middlewares.js` to find the exact validator
   bound to each `(matcher, method)`. Medusa declares them literally:

   ```js
   validateAndTransformBody(validators_3.AdminCreateProduct),
   validateAndTransformQuery(validators_3.AdminGetProductsParams, ...),
   ```

   This is why `/admin/products/:id/variants` correctly documents
   `AdminGetProductVariantParams` rather than a guessed name. Bindings are
   indexed globally, because a route's middlewares are often declared in a
   **parent** folder.

3. **Zod → JSON Schema** — validators are built on Medusa's own zod fork
   (`@medusajs/deps/zod`), not the app's `zod` package. Using the wrong instance
   fails with *"Cannot read properties of undefined (reading 'def')"*. Factories
   like `AdminCreateCampaign` are invoked before conversion.

4. **JSON Schema → OpenAPI 3.0** — down-converts 2020-12 keywords that 3.0
   rejects: `type: null` → `nullable: true`, `const` → single-value `enum`,
   numeric `exclusiveMinimum` → boolean form, `$defs` → `components/schemas`.

The output is validated with `@apidevtools/swagger-parser` on every run.

### Verify it yourself

```bash
npx @apidevtools/swagger-cli validate docs/openapi.json
```