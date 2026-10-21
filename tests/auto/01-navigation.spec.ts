/**
 * Navigation and page-state APIs.
 *
 * Covers: page.goto, waitForURL, waitForLoadState, waitForTimeout,
 * page.waitForFunction, page.waitForSelector, page.waitForRequest /
 * waitForResponse / waitForLoadState, history manipulation, reload, title and
 * URL assertions, and popstate handling.
 */

import { test, expect, storeUrl, gotoStore, STOREFRONT_URL, TID, tid } from "./helpers";

test.describe("Navigation", () => {
  test("goto accepts a full URL and waits for load", async ({ page }) => {
    await page.goto(storeUrl());

    await expect(page).toHaveURL(new RegExp(`/${"vn"}/?$`));
    await expect(page.locator("main")).toBeVisible();
  });

  test("goto can wait for a specific load state", async ({ page }) => {
    await page.goto(storeUrl("store"), { waitUntil: "domcontentloaded" });

    // The product grid is rendered client-side, so wait for it explicitly.
    await page.waitForSelector(`[data-testid="${TID.productsList}"]`, {
      state: "attached",
      timeout: 30_000,
    });

    await expect(tid(page, TID.productsList)).toBeVisible();
  });

  test("goto with waitUntil: networkidle", async ({ page }) => {
    // Networkidle is flaky by design; it is shown here for completeness and
    // given a generous timeout.
    await page.goto(storeUrl(), { waitUntil: "networkidle", timeout: 45_000 });
    await expect(page.locator("body")).toBeVisible();
  });

  test("waitForURL resolves after client-side navigation", async ({ page }) => {
    await page.goto(storeUrl());
    await page.waitForLoadState("domcontentloaded");

    // The side menu holds the link to the product listing.
    await tid(page, TID.navMenuButton).click();
    await tid(page, TID.sideMenuPopup).waitFor({ state: "visible" });
    await tid(page, TID.sideMenuPopup).getByTestId("store-link").click();

    await page.waitForURL(/\/vn\/store/, { timeout: 30_000 });
    await expect(page).toHaveURL(/\/vn\/store/);
  });

  test("waitForURL can match with a predicate", async ({ page }) => {
    await page.goto(storeUrl());
    await page.waitForLoadState("domcontentloaded");

    await tid(page, TID.navMenuButton).click();
    await tid(page, TID.sideMenuPopup).waitFor({ state: "visible" });
    await tid(page, TID.sideMenuPopup).getByTestId("store-link").click();

    await page.waitForURL((url) => url.pathname.endsWith("/store"), {
      timeout: 30_000,
    });

    expect(new URL(page.url()).pathname).toBe("/vn/store");
  });

  test("waitForLoadState covers load, domcontentloaded, networkidle", async ({
    page,
  }) => {
    await page.goto(storeUrl());

    await page.waitForLoadState("load");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForLoadState("networkidle", { timeout: 45_000 });

    expect(await page.evaluate(() => document.readyState)).toBeTruthy();
  });

  test("waitForFunction waits until a browser condition holds", async ({
    page,
  }) => {
    await page.goto(storeUrl());
    await page.waitForLoadState("domcontentloaded");

    // Wait until Next.js has hydrated at least one product link.
    await page.waitForFunction(
      () => document.querySelectorAll("a[href*='/products/']").length > 0,
      undefined,
      { timeout: 30_000 }
    );

    const count = await page.evaluate(
      () => document.querySelectorAll("a[href*='/products/']").length
    );
    expect(count).toBeGreaterThan(0);
  });

  test("waitForTimeout is an explicit pause (used sparingly)", async ({
    page,
  }) => {
    await page.goto(storeUrl());
    await page.waitForTimeout(500);

    // Nothing should have navigated.
    expect(page.url()).toContain("/vn");
  });

  test("goBack and goForward walk the history stack", async ({ page }) => {
    await page.goto(storeUrl());
    await page.waitForLoadState("domcontentloaded");

    await tid(page, TID.navMenuButton).click();
    await tid(page, TID.sideMenuPopup).waitFor({ state: "visible" });
    await tid(page, TID.sideMenuPopup).getByTestId("store-link").click();
    await page.waitForURL(/\/vn\/store/, { timeout: 30_000 });
    expect(page.url()).toContain("/store");

    await page.goBack();
    await page.waitForURL((url) => !url.pathname.endsWith("/store"), {
      timeout: 30_000,
    });
    expect(page.url()).not.toContain("/store");

    await page.goForward();
    await page.waitForURL(/\/vn\/store/, { timeout: 30_000 });
    expect(page.url()).toContain("/store");
  });

  test("reload re-fetches the current page", async ({ page }) => {
    await gotoStore(page, "store", { waitFor: TID.productsList });

    await page.reload({ waitUntil: "domcontentloaded" });

    await expect(page).toHaveURL(/\/vn\/store/);

    // The grid is rendered from the search response, so wait for it to be
    // re-attached before asserting on visibility.
    await tid(page, TID.productsList).waitFor({ state: "attached", timeout: 60_000 });
    await expect(tid(page, TID.productsList)).toBeVisible();
  });

  test("page.title and document.title", async ({ page }) => {
    await page.goto(storeUrl("store"));

    const viaApi = await page.title();
    const viaDom = await page.evaluate(() => document.title);

    expect(viaApi).toBe(viaDom);
    expect(viaApi.length).toBeGreaterThan(0);
  });

  test("URL assertions: toHaveURL with string, regex, and predicate", async ({
    page,
  }) => {
    await page.goto(storeUrl("cart"));

    // Exact string
    await expect(page).toHaveURL(`${storeUrl("cart")}`);
    // Regular expression
    await expect(page).toHaveURL(/\/vn\/cart$/);
    // Predicate
    await expect(page).toHaveURL((url) => url.pathname === "/vn/cart");

    // Parsing the URL for finer checks
    const parsed = new URL(page.url());
    expect(parsed.origin).toBe(STOREFRONT_URL);
    expect(parsed.pathname).toBe("/vn/cart");
    expect(parsed.searchParams.get("nope")).toBeNull();
  });

  test("history.pushState and popstate", async ({ page }) => {
    await page.goto(storeUrl());
    await page.waitForLoadState("domcontentloaded");

    const result = await page.evaluate(() => {
      // Next.js manages history.state itself, so we tag the state object
      // rather than replacing it wholesale.
      const current = window.history.state ?? {};
      window.history.pushState(
        { ...current, qaMarker: "from-test" },
        "",
        "/vn/pushed-state"
      );
      return {
        href: window.location.href,
        marker: (window.history.state ?? {}).qaMarker,
      };
    });

    expect(result.href).toContain("/vn/pushed-state");
    expect(result.marker).toBe("from-test");

    // Going back restores the previous entry.
    await page.goBack();
    await page.waitForURL((url) => !url.pathname.includes("pushed-state"), {
      timeout: 30_000,
    });
    expect(page.url()).not.toContain("pushed-state");
  });

  test("cross-origin navigation to the backend", async ({ page }) => {
    await page.goto(storeUrl());

    await page.goto("http://localhost:9000/api-docs");
    await expect(page).toHaveTitle(/Medusa API Explorer/);

    // And back to the storefront.
    await page.goto(storeUrl());
    await expect(page).toHaveURL(/\/vn/);
  });
});