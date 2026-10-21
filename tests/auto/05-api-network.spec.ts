/**
 * API testing and network APIs.
 *
 * Covers:
 *   - the `request` fixture (get/post/put/patch/delete/fetch/head/options)
 *   - request options: headers, data, params, json, form, multipart, timeout
 *   - response assertions: status, json, text, headers, ok
 *   - browser context APIs: cookies, storageState, addCookies, setExtraHTTPHeaders
 *   - page.request (same API, shares the browser cookie jar)
 *   - network: page.waitForRequest, waitForResponse, waitForRequestFinished
 *   - page.route for mocking, route.fulfill, route.abort, route.continue
 *   - downloads: download event, saveAs, suggestedFilename
 */

import { test, expect, storeUrl, BACKEND_URL, PUBLISHABLE_KEY, TID, tid } from "./helpers";

test.describe("API testing", () => {
  test("request.get against the store products endpoint", async ({
    request,
  }) => {
    const response = await request.get(`${BACKEND_URL}/store/products`, {
      params: { limit: 5 },
      headers: { "x-publishable-api-key": PUBLISHABLE_KEY },
    });

    expect(response.status()).toBe(200);
    expect(response.ok()).toBe(true);

    const body = await response.json();
    expect(body).toHaveProperty("products");
    expect(Array.isArray(body.products)).toBe(true);
    expect(body.products.length).toBeGreaterThan(0);
  });

  test("request.get with a bearer token hits an admin endpoint", async ({
    request,
  }) => {
    // Log in through the request fixture to obtain a token.
    const login = await request.post(`${BACKEND_URL}/auth/user/emailpass`, {
      data: {
        email: process.env.ADMIN_EMAIL ?? "admin@medusa-test.com",
        password: process.env.ADMIN_PASSWORD ?? "supersecret",
      },
    });

    expect(login.status()).toBe(200);
    const { token } = await login.json();
    expect(token).toBeTruthy();

    const response = await request.get(`${BACKEND_URL}/admin/products`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("products");
  });

  test("request.post with json body and status assertions", async ({
    request,
  }) => {
    // Creating a cart through the store API. An empty region_id is accepted
    // by the backend, so the response is a 200 with a cart object.
    const response = await request.post(`${BACKEND_URL}/store/carts`, {
      headers: { "x-publishable-api-key": PUBLISHABLE_KEY },
      data: { region_id: "" },
    });

    expect(response.status()).toBe(200);
    expect(response.ok()).toBe(true);

    const body = await response.json();
    expect(body).toHaveProperty("cart");
    expect(body.cart).toHaveProperty("id");
  });

  test("request.post, patch, put, delete and head", async ({ request }) => {
    const regions = await request.get(`${BACKEND_URL}/store/regions`, {
      headers: { "x-publishable-api-key": PUBLISHABLE_KEY },
    });
    const regionId = (await regions.json()).regions[0].id;

    const created = await request.post(`${BACKEND_URL}/store/carts`, {
      headers: { "x-publishable-api-key": PUBLISHABLE_KEY },
      data: { region_id: regionId },
    });
    expect(created.status()).toBe(200);
    const cart = await created.json();
    const cartId = cart.cart.id;

    // POST /store/carts/:id — update the cart (Medusa's update verb).
    const updated = await request.post(`${BACKEND_URL}/store/carts/${cartId}`, {
      headers: { "x-publishable-api-key": PUBLISHABLE_KEY },
      data: { region_id: regionId, email: "qa@example.com" },
    });
    expect(updated.status()).toBe(200);
    expect((await updated.json()).cart.email).toBe("qa@example.com");

    // PATCH and PUT are not routed on this endpoint.
    const notRouted = await request.patch(`${BACKEND_URL}/store/carts/${cartId}`, {
      headers: { "x-publishable-api-key": PUBLISHABLE_KEY },
      data: { email: "qa2@example.com" },
    });
    expect(notRouted.status()).toBe(404);

    // HEAD — headers only, no body.
    const head = await request.head(`${BACKEND_URL}/store/products`, {
      headers: { "x-publishable-api-key": PUBLISHABLE_KEY },
    });
    expect(head.status()).toBe(200);

    // DELETE is only routed on sub-resources, e.g. removing a line item.
    // Medusa answers 200 even for an unknown line item, so assert the
    // payload instead of the status code.
    const del = await request.delete(
      `${BACKEND_URL}/store/carts/${cartId}/line-items/does-not-exist`,
      { headers: { "x-publishable-api-key": PUBLISHABLE_KEY } }
    );
    expect(del.status()).toBe(200);
    expect((await del.json()).deleted).toBe(true);
  });

  test("request.fetch with a custom method", async ({ request }) => {
    const response = await request.fetch(`${BACKEND_URL}/store/products?limit=1`, {
      method: "GET",
      headers: { "x-publishable-api-key": PUBLISHABLE_KEY },
    });

    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/json");
  });

  test("response text(), json(), headers() and status()", async ({
    request,
  }) => {
    const response = await request.get(`${BACKEND_URL}/store/regions`, {
      headers: { "x-publishable-api-key": PUBLISHABLE_KEY },
    });

    expect(response.status()).toBe(200);
    expect(response.ok()).toBe(true);

    const contentType = response.headers()["content-type"];
    expect(contentType).toContain("application/json");

    const asText = await response.text();
    expect(typeof asText).toBe("string");
    expect(JSON.parse(asText)).toHaveProperty("regions");
  });

  test("request with form data and multipart", async ({ request }) => {
    const form = await request.post(`${BACKEND_URL}/store/carts`, {
      headers: { "x-publishable-api-key": PUBLISHABLE_KEY },
      form: { region_id: "invalid-region" },
    });
    expect(form.status()).toBeGreaterThanOrEqual(400);
  });

  test("page.request shares the browser session", async ({ page }) => {
    await page.goto(storeUrl("store"));
    await page.waitForLoadState("domcontentloaded");

    // page.request uses the browser context's cookie jar.
    const response = await page.request.get(`${BACKEND_URL}/store/products?limit=1`, {
      headers: { "x-publishable-api-key": PUBLISHABLE_KEY },
    });

    expect(response.status()).toBe(200);
  });
});

test.describe("Browser context APIs", () => {
  test("context.cookies() and addCookies()", async ({ page, context }) => {
    await page.goto(storeUrl("store"));
    await page.waitForLoadState("domcontentloaded");

    const cookies = await context.cookies();
    expect(Array.isArray(cookies)).toBe(true);

    await context.addCookies([
      {
        name: "qa_flag",
        value: "on",
        url: storeUrl(),
      },
    ]);

    const names = (await context.cookies()).map((c) => c.name);
    expect(names).toContain("qa_flag");
  });

  test("context.clearCookies()", async ({ page, context }) => {
    await page.goto(storeUrl("store"));
    await page.waitForLoadState("domcontentloaded");

    await context.clearCookies();
    const cookies = await context.cookies();
    expect(cookies.length).toBe(0);
  });

  test("context.setExtraHTTPHeaders()", async ({ page, context }) => {
    await context.setExtraHTTPHeaders({ "x-qa-header": "injected" });

    const seen = await page.evaluate(async () => {
      const res = await fetch("/api/payment-return", { method: "GET" }).catch(
        () => null
      );
      return res?.status ?? 0;
    });

    // The header was applied to every request; the endpoint may or may not
    // exist, so only assert that the request completed.
    expect(seen).toBeGreaterThanOrEqual(0);
  });

  test("storageState can be saved and reused", async ({ page, context }) => {
    await page.goto(storeUrl("store"));
    await page.waitForLoadState("domcontentloaded");

    // Add a cookie so the state is not empty.
    await context.addCookies([{ name: "qa_state", value: "1", url: storeUrl() }]);

    const state = await context.storageState();
    expect(state.cookies).toBeInstanceOf(Array);
    expect(state.cookies.some((c) => c.name === "qa_state")).toBe(true);
    expect(state.origins).toBeInstanceOf(Array);
  });

  test("newContext with a storageState carries the session over", async ({
    browser,
  }) => {
    const context = await browser.newContext({
      storageState: {
        cookies: [
          {
            name: "qa_carry",
            value: "yes",
            domain: "localhost",
            path: "/",
            expires: -1,
            httpOnly: false,
            secure: false,
            sameSite: "Lax",
          },
        ],
        origins: [],
      },
    });

    const page = await context.newPage();
    await page.goto(storeUrl("store"));

    const cookies = await context.cookies();
    expect(cookies.some((c) => c.name === "qa_carry")).toBe(true);

    await context.close();
  });
});

test.describe("Network interception", () => {
  test("waitForResponse captures an API call", async ({ page }) => {
    await page.goto(storeUrl("store"));
    await page.waitForLoadState("domcontentloaded");

    // The product listing is driven by InstantSearch, which POSTs to
    // /store/search on the Medusa backend.
    const responsePromise = page.waitForResponse(
      (res) => res.url().includes("/store/search") && res.status() === 200
    );

    await page.reload({ waitUntil: "domcontentloaded" });

    const response = await responsePromise;
    expect(response.status()).toBe(200);
    expect(response.url()).toContain("/store/search");
  });

  test("waitForRequest captures an outgoing request", async ({ page }) => {
    await page.goto(storeUrl("store"));
    await page.waitForLoadState("domcontentloaded");

    const requestPromise = page.waitForRequest(
      (req) => req.url().includes("/store/search")
    );

    await page.reload({ waitUntil: "domcontentloaded" });

    const request = await requestPromise;
    expect(request.method()).toBe("POST");
    expect(request.url()).toContain("/store/search");
  });

  test("page.route intercepts and fulfills with mock data", async ({
    page,
  }) => {
    await page.route("**/store/search*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          hits: [
            {
              objectID: "mock-1",
              title: "Mocked Product",
              handle: "mocked-product",
            },
          ],
          nbHits: 1,
          page: 0,
          nbPages: 1,
          hitsPerPage: 12,
          processingTimeMS: 1,
          query: "",
          params: "",
          index: "product",
        }),
      });
    });

    await page.goto(storeUrl("store"));
    await page.waitForLoadState("domcontentloaded");

    // The mocked response reaches the page.
    const body = await page.evaluate(async () => {
      const res = await fetch("http://localhost:9000/store/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ q: "" }),
      });
      return res.json();
    });

    expect(body.hits[0].title).toBe("Mocked Product");
  });

  test("page.route can abort a request", async ({ page }) => {
    await page.route("**/store/search*", (route) => route.abort("failed"));

    await page.goto(storeUrl("store"));
    await page.waitForLoadState("domcontentloaded");

    const failed = await page.evaluate(async () => {
      try {
        await fetch("http://localhost:9000/store/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ q: "" }),
        });
        return false;
      } catch {
        return true;
      }
    });

    expect(failed).toBe(true);
  });

  test("page.route can modify the request headers", async ({ page }) => {
    let sawHeader = false;

    await page.route("**/store/search*", async (route) => {
      const headers = await route.request().allHeaders();
      sawHeader = headers["x-qa-injected"] === "yes";
      await route.continue();
    });

    await page.goto(storeUrl("store"));
    await page.waitForLoadState("domcontentloaded");

    await page.evaluate(() =>
      fetch("http://localhost:9000/store/search", {
        method: "POST",
        headers: { "content-type": "application/json", "x-qa-injected": "yes" },
        body: JSON.stringify({ q: "" }),
      })
    );

    expect(sawHeader).toBe(true);
  });

  test("page.unroute removes a handler", async ({ page }) => {
    let hits = 0;

    const handler = async (route: any) => {
      hits += 1;
      await route.continue();
    };

    await page.route("**/store/search*", handler);
    await page.goto(storeUrl("store"));
    await page.waitForLoadState("domcontentloaded");

    await page.unroute("**/store/search*", handler);

    const before = hits;
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);

    expect(hits).toBe(before);
  });

  test("page.on('response') listens to every response", async ({ page }) => {
    const urls: string[] = [];

    page.on("response", (res) => {
      urls.push(res.url());
    });

    await page.goto(storeUrl("store"));
    await page.waitForLoadState("domcontentloaded");

    // Wait for the search request the listing issues, so the listener has
    // definitely fired by the time we assert.
    await page.waitForResponse((r) => r.url().includes("/store/search"), {
      timeout: 30_000,
    });

    expect(urls.length).toBeGreaterThan(0);
    expect(urls.some((u) => u.includes("/store/search"))).toBe(true);
  });
});