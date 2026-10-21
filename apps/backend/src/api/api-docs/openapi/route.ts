import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import fs from "fs";
import path from "path";

/**
 * The spec is public documentation - it describes the API shape but contains
 * no data, so it does not need a publishable key or an admin session.
 */
export const AUTHENTICATE = false;

/**
 * Resolve the generated OpenAPI spec.
 *
 * The spec is produced by `npm run api:openapi` (see scripts/generate-openapi.cjs)
 * and written to <repo-root>/docs/openapi.json. The backend runs with
 * apps/backend as its working directory, but we probe a few candidates so the
 * route also works when started from the repo root or via Docker.
 */
function resolveSpecPath(): string | null {
  const candidates = [
    path.resolve(process.cwd(), "docs", "openapi.json"),
    path.resolve(process.cwd(), "..", "..", "docs", "openapi.json"),
    path.resolve(__dirname, "..", "..", "..", "..", "..", "docs", "openapi.json"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

/**
 * GET /api-docs/openapi
 *
 * Serves the OpenAPI 3.0 specification. Import this URL straight into Postman:
 *   Postman > Import > Link > http://localhost:9000/api-docs/openapi
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const specPath = resolveSpecPath();

  if (!specPath) {
    res.status(404).json({
      type: "not_found",
      message:
        "OpenAPI spec not found. Generate it first with: npm run api:openapi",
    });
    return;
  }

  try {
    const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json(spec);
  } catch (error) {
    res.status(500).json({
      type: "invalid_data",
      message: `Failed to read OpenAPI spec: ${(error as Error).message}`,
    });
  }
}
