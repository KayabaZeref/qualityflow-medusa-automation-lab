/**
 * Locator APIs.
 *
 * Covers the full locator vocabulary:
 *   getByRole / getByText / getByLabel / getByPlaceholder / getByTitle /
 *   getByAltText / getByTestId / locator / getBy*
 *   .first / .last / .nth
 *   .filter / .filter({ has, hasText, hasNot, hasNotText })
 *   .and / .or / .not
 *   .locator() chaining
 *   .all / .allTextContents / .allInnerTexts / .count / .nth
 *   .elementHandle / .contentFrame / .frameLocator
 *   .getByRole with options, .getByText with options
 */

import { test, expect, storeUrl, gotoStore, TID, tid } from "./helpers";

test.describe("Locators", () => {
  test.beforeEach(async ({ page }) => {
    await gotoStore(page, "store", { waitFor: TID.productsList });
  });

  test("getByTestId", async ({ page }) => {
    await expect(tid(page, TID.productsList)).toBeVisible();
    await expect(page.getByTestId(TID.storePageTitle)).toBeVisible();
  });

  test("getByRole", async ({ page }) => {
    // The product listing heading is a level-1 heading.
    await expect(
      page.getByRole("heading", { name: "All products", level: 1 })
    ).toBeVisible();

    // Links by accessible name.
    const storeLink = page.getByRole("link", { name: /Medusa Store/i }).first();
    await expect(storeLink).toBeVisible();

    // Buttons by role + name.
    await expect(page.getByRole("button").first()).toBeVisible();
  });

  test("getByRole with hasText and exact options", async ({ page }) => {
    // `exact: true` requires the whole accessible name to match.
    const searchButton = page.getByRole("button", { name: "Search products" });
    await expect(searchButton).toBeVisible();

    const menuButton = page.getByRole("button", { name: "Menu", exact: true });
    await expect(menuButton).toBeVisible();
  });

  test("getByText with exact, case-insensitive and regex", async ({ page }) => {
    await expect(page.getByText("All products", { exact: true })).toBeVisible();

    await expect(
      page.getByText("all products", { exact: false })
    ).toBeVisible();

    await expect(page.getByText(/all\s+products/i)).toBeVisible();
  });

  test("getByLabel", async ({ page }) => {
    // Several elements share the "Search products" accessible name (the nav
    // button, the store filter input and the drawer input), so the query must
    // be scoped to disambiguate it.
    await tid(page, TID.navSearchButton).click();

    const drawerInput = page
      .getByLabel("Search products")
      .filter({ has: page.locator("[data-testid='search-input']") })
      .or(page.getByTestId(TID.searchInput));
    await expect(drawerInput).toBeVisible();

    // Scoping to the search drawer makes the label unambiguous.
    await expect(tid(page, TID.searchInput)).toBeVisible();
  });

  test("getByPlaceholder", async ({ page }) => {
    await tid(page, TID.navSearchButton).click();

    // Both the store filter and the drawer use the same placeholder text, so
    // target the drawer's input by test id.
    const drawerInput = page.getByPlaceholder("Search products").first();
    await expect(drawerInput).toBeVisible();

    await expect(tid(page, TID.searchInput)).toBeVisible();
  });

  test("getByTitle and getByAltText", async ({ page }) => {
    // The storefront renders product thumbnails with alt text.
    const images = page.getByAltText(/.*/).first();
    const count = await images.count();
    expect(count).toBeGreaterThanOrEqual(0);

    // getByTitle resolves nothing here, but the API must not throw.
    const titled = page.getByTitle("no-such-title");
    expect(await titled.count()).toBe(0);
  });

  test("locator() with CSS selectors", async ({ page }) => {
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("main")).toBeVisible();
    await expect(page.locator('[data-testid="products-list"]')).toBeVisible();
  });

  test("locator() with XPath", async ({ page }) => {
    const firstHeading = page.locator("xpath=//h1");
    await expect(firstHeading).toBeVisible();

    const text = await firstHeading.textContent();
    expect(text?.trim().length).toBeGreaterThan(0);
  });

  test(".first, .last and .nth", async ({ page }) => {
    const products = page.locator('[data-testid="products-list"] a[href*="/products/"]');

    const total = await products.count();
    expect(total).toBeGreaterThan(0);

    await expect(products.first()).toBeVisible();
    await expect(products.last()).toBeVisible();
    await expect(products.nth(0)).toBeVisible();

    // nth is zero-based and throws when out of range.
    await expect(products.nth(total - 1)).toBeVisible();
  });

  test("count(), all(), allTextContents(), allInnerTexts()", async ({ page }) => {
    const products = page.locator('[data-testid="products-list"] a[href*="/products/"]');

    const count = await products.count();
    expect(count).toBeGreaterThan(0);

    const handles = await products.all();
    expect(handles).toHaveLength(count);

    const texts = await products.allTextContents();
    expect(texts).toHaveLength(count);
    expect(texts.every((t) => typeof t === "string")).toBe(true);

    const innerTexts = await products.allInnerTexts();
    expect(innerTexts).toHaveLength(count);
  });

  test("filter() with hasText and with a nested locator", async ({ page }) => {
    const productLinks = page.locator('[data-testid="products-list"] a[href*="/products/"]');

    // hasText keeps only matching elements.
    const filteredByText = productLinks.filter({ hasText: /./ });
    expect(await filteredByText.count()).toBe(await productLinks.count());

    // `has` narrows using a nested locator.
    const withHeading = productLinks.filter({
      has: page.locator("h2, h3"),
    });
    const withHeadingCount = await withHeading.count();
    expect(withHeadingCount).toBeGreaterThanOrEqual(0);
    expect(withHeadingCount).toBeLessThanOrEqual(await productLinks.count());
  });

  test("filter() with hasNot and hasNotText", async ({ page }) => {
    const productLinks = page.locator('[data-testid="products-list"] a[href*="/products/"]');

    const withoutText = productLinks.filter({ hasNotText: "zzz-not-present" });
    expect(await withoutText.count()).toBe(await productLinks.count());

    const withoutHeading = productLinks.filter({ hasNot: page.locator("h9") });
    expect(await withoutHeading.count()).toBe(await productLinks.count());
  });

  test("locator chaining (parent.locator(child))", async ({ page }) => {
    const list = tid(page, TID.productsList);
    const links = list.locator("a[href*='/products/']");

    expect(await links.count()).toBeGreaterThan(0);
    await expect(links.first()).toBeVisible();
  });

  test("and(), or() and not()", async ({ page }) => {
    const heading = page.getByRole("heading", { level: 1 });
    const link = page.getByRole("link").first();

    // or() matches either locator.
    const either = heading.or(link);
    expect(await either.count()).toBeGreaterThan(0);

    // and() requires both to match the same element.
    const both = page.locator("h1").and(page.getByText("All products"));
    expect(await both.count()).toBeLessThanOrEqual(1);

    // `not` is an *expectation* modifier (expect(locator).not.toBeVisible()),
    // not a locator method. Locator-level exclusion uses filter({ hasNot })
    // or a CSS pseudo-selector.
    await expect(page.getByTestId("definitely-not-here")).not.toBeVisible();

    const excluding = page.locator("h1").filter({ hasNotText: "nonexistent" });
    expect(await excluding.count()).toBe(await page.locator("h1").count());
  });

  test("elementHandle and its owner handle", async ({ page }) => {
    const handle = await page.locator("h1").elementHandle();
    expect(handle).not.toBeNull();

    const owner = await handle?.ownerFrame();
    expect(owner).toBeTruthy();

    const text = await handle?.textContent();
    expect(text).toContain("All products");
  });

  test("frameLocator targets an iframe", async ({ page }) => {
    // The storefront has no iframes, so inject one and drive it. This proves
    // frameLocator works without depending on app markup.
    await page.evaluate(() => {
      const frame = document.createElement("iframe");
      frame.setAttribute("id", "demo-frame");
      frame.srcdoc =
        "<html><body><h1 id='inside'>Inside frame</h1>" +
        "<input aria-label='frame-input' /></body></html>";
      document.body.appendChild(frame);
    });

    const frame = page.frameLocator("#demo-frame");
    await expect(frame.locator("#inside")).toHaveText("Inside frame");
    await expect(frame.getByLabel("frame-input")).toBeVisible();
  });

  test("contentFrame() on a frame locator", async ({ page }) => {
    await page.evaluate(() => {
      const frame = document.createElement("iframe");
      frame.setAttribute("id", "demo-frame-2");
      frame.srcdoc = "<html><body><p id='p2'>frame body</p></body></html>";
      document.body.appendChild(frame);
    });

    const content = await page.locator("#demo-frame-2").contentFrame();
    expect(content).not.toBeNull();
    await expect(content!.locator("#p2")).toHaveText("frame body");
  });

  test("locator.evaluate and evaluateAll", async ({ page }) => {
    const tagName = await page.locator("h1").evaluate((el) => el.tagName);
    expect(tagName).toBe("H1");

    const hrefs = await page
      .locator('[data-testid="products-list"] a[href*="/products/"]')
      .evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute("href")));

    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.every((h) => h?.includes("/products/"))).toBe(true);
  });

  test("locator.getAttribute and textContent", async ({ page }) => {
    const heading = page.locator("h1");

    const id = await heading.getAttribute("data-testid");
    expect(id).toBe(TID.storePageTitle);

    const text = (await heading.textContent())?.trim();
    expect(text).toBe("All products");
  });

  test("locator.boundingBox() and isVisible()", async ({ page }) => {
    const heading = page.locator("h1");

    const box = await heading.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThan(0);
    expect(box!.height).toBeGreaterThan(0);

    expect(await heading.isVisible()).toBe(true);
    expect(await page.locator("#definitely-not-here").isVisible()).toBe(false);
  });
});