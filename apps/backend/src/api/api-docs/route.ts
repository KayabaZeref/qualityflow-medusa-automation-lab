import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http";

/**
 * The explorer page is public documentation - it describes the API shape but
 * contains no data, so it does not need a publishable key or an admin session.
 */
export const AUTHENTICATE = false;

/**
 * GET /api-docs
 *
 * A Swagger UI page for browsing every endpoint and trying requests straight
 * from the browser. The spec itself is served by /api-docs/openapi.
 *
 * This route is intentionally public (no publishable key, no admin session) so
 * it is easy to open while testing. It exposes no data - only the shape of
 * the API.
 */
export async function GET(req: MedusaRequest, res: MedusaResponse) {
  const specUrl = "/api-docs/openapi";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Medusa API Explorer</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>
    body { margin: 0; background: #fafafa; }
    .qf-topbar {
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      background: #111827;
      color: #f9fafb;
      padding: 12px 20px;
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }
    .qf-topbar h1 { font-size: 15px; margin: 0; font-weight: 600; }
    .qf-topbar a { color: #93c5fd; font-size: 13px; text-decoration: none; }
    .qf-topbar a:hover { text-decoration: underline; }
    .qf-hint { font-size: 12px; color: #9ca3af; }
    .swagger-ui .info .title { font-size: 26px; }
  </style>
</head>
<body>
  <div class="qf-topbar">
    <h1>Medusa E-commerce API Explorer</h1>
    <a href="${specUrl}" target="_blank">openapi.json</a>
    <a href="http://localhost:8000" target="_blank">Storefront</a>
    <a href="http://localhost:8080" target="_blank">Adminer (DB)</a>
    <span class="qf-hint">Import into Postman: Import &gt; Link &gt; http://localhost:9000${specUrl}</span>
  </div>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-standalone-preset.js" crossorigin></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: "${specUrl}",
      dom_id: "#swagger-ui",
      deepLinking: true,
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
      plugins: [SwaggerUIBundle.plugins.DownloadUrl],
      layout: "StandaloneLayout",
      tryItOutEnabled: true,
      persistAuthorization: true,
      defaultModelsExpandDepth: 1,
      docExpansion: "none",
    });
  </script>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send(html);
}
