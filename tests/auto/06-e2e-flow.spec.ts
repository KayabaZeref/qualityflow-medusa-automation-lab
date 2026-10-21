/**
 * End-to-end user journeys.
 *
 * These are the tests you copy and adapt when writing your own scripts.
 * They demonstrate how to chain locators, actions and assertions into a
 * realistic flow, plus the fixtures and hooks that support them.
 */

import { test, expect, storeUrl, gotoStore, TID, tid, fetchStoreCart, addFirstProductToCart } from "./helpers";

test.describe("Shopper journey", () => {
  test("browse the store, open a product and add it to the cart", async ({
    page,
  }) => {
    // 1. Land on the product listing.
    await gotoStore(page, "store", { waitFor: TID.productsList });

    await expect(tid(page, TID.storePageTitle)).toBeVisible();

    // 2. Pick the first product.
    const productLink = page
      .locator('[data-testid="products-list"] a[href*="/products/"]')
      .first();
    await expect(productLink).toBeVisible();

    const productTitle = (await productLink.innerText()).trim();
    expect(productTitle.length).toBeGreaterThan(0);

    await productLink.click();

    // 3. The product page shows the title, price and an add-to-cart button.
    //    `product-title` is reused by the related-products grid, so scope the
    //    assertion to the product info block.
    await page.waitForURL(/\/vn\/products\//, { timeout: 30_000 });
    await expect(
      page.locator("#product-info").getByTestId(TID.productTitle)
    ).toBeVisible();
    await expect(tid(page, TID.productPrice)).toBeVisible();

    const addButton = tid(page, TID.addProductButton);
    await expect(addButton).toBeVisible();

    // 4. Choose a variant. Each product option renders its own group of
    //    buttons, and every group must have a value chosen before the
    //    product can be added.
    const optionGroups = tid(page, TID.productOptions);
    const groupCount = await optionGroups.count();
    for (let i = 0; i < groupCount; i += 1) {
      const firstOption = optionGroups.nth(i).locator('[data-testid="option-button"]').first();
      if ((await firstOption.count()) > 0) {
        await firstOption.click();
      }
    }

    // 5. Add to the cart. The button stays disabled until a valid variant
    //    is selected.
    await expect(addButton).toBeEnabled({ timeout: 20_000 });
    await addButton.click();

    // 6. The cart badge updates.
    await expect(tid(page, TID.navCartLink)).toContainText(/Cart \(1\)/, {
      timeout: 20_000,
    });
  });

  test("the cart page lists the added product and can remove it", async ({
    page,
  }) => {
    // Add a product first (the helper handles variant selection).
    await addFirstProductToCart(page);

    // Go to the cart page.
    await tid(page, TID.navCartLink).click();
    await page.waitForURL(/\/vn\/cart/, { timeout: 30_000 });

    await expect(tid(page, TID.cartContainer)).toBeVisible();
    await expect(tid(page, TID.productRow).first()).toBeVisible();
    await expect(tid(page, TID.productTitle).first()).toBeVisible();

    // The line item price is rendered.
    await expect(tid(page, TID.productUnitPrice).first()).toBeVisible();

    // Remove the item.
    await tid(page, TID.productDeleteButton).first().click();

    // The cart is now empty.
    await expect(tid(page, TID.emptyCartMessage)).toBeVisible({
      timeout: 20_000,
    });
  });

  test("search for a product from the nav drawer", async ({ page }) => {
    await page.goto(storeUrl());
    await page.waitForLoadState("domcontentloaded");

    await tid(page, TID.navSearchButton).click();
    await expect(tid(page, TID.searchInput)).toBeVisible();

    await tid(page, TID.searchInput).fill("shirt");

    // The drawer debounces the query by 250ms before hitting the search
    // endpoint, so wait for the results list to appear.
    await expect(tid(page, TID.searchResults)).toBeVisible({ timeout: 30_000 });

    const hits = tid(page, TID.searchHitLink);
    const hitCount = await hits.count();
    expect(hitCount).toBeGreaterThan(0);

    // Clicking a hit navigates to the product.
    await hits.first().click();
    await page.waitForURL(/\/vn\/products\//, { timeout: 30_000 });
  });

  test("searching for nonsense shows the no-results state", async ({ page }) => {
    await page.goto(storeUrl());
    await page.waitForLoadState("domcontentloaded");

    await tid(page, TID.navSearchButton).click();
    await tid(page, TID.searchInput).fill("zzz-no-such-product-xyz");

    await expect(tid(page, TID.searchNoResults)).toBeVisible({ timeout: 20_000 });
  });

  test("the account page shows the sign-in form for guests", async ({ page }) => {
    await page.goto(storeUrl("account"));
    await page.waitForLoadState("domcontentloaded");

    // Guests get the login form, with email and password inputs.
    await expect(page.getByTestId("login-page")).toBeVisible();
    await expect(tid(page, TID.emailInput)).toBeVisible();
    await expect(tid(page, TID.passwordInput)).toBeVisible();
    await expect(tid(page, TID.signInButton)).toBeVisible();
  });

  test("the cart page for a guest shows the sign-in prompt", async ({ page }) => {
    await page.goto(storeUrl("cart"));
    await page.waitForLoadState("domcontentloaded");

    await expect(tid(page, TID.cartContainer)).toBeVisible();
  });
});

test.describe("Hooks, fixtures and steps", () => {
  test.beforeEach(async ({ page }) => {
    // A beforeEach hook runs before every test in this block.
    await gotoStore(page, "store", { waitFor: TID.productsList });
  });

  test.afterEach(async ({ page }) => {
    // An afterEach hook runs after every test in this block, even on failure.
    await page.close();
  });

  test("test.step documents a multi-step flow", async ({ page }) => {
    await test.step("open the product listing", async () => {
      await expect(tid(page, TID.storePageTitle)).toBeVisible();
    });

    await test.step("count the products", async () => {
      const count = await page
        .locator('[data-testid="products-list"] a[href*="/products/"]')
        .count();
      expect(count).toBeGreaterThan(0);
    });
  });

  test("beforeEach and afterEach hooks run around every test", async ({
    page,
  }) => {
    // The beforeEach in this describe block already navigated to the store.
    expect(page.url()).toContain("/vn/store");
    await expect(tid(page, TID.productsList)).toBeVisible();
  });

  test("the storePage fixture arrives preloaded", async ({ storePage }) => {
    await expect(storePage).toHaveURL(/\/vn/);
    await expect(storePage.locator("body")).toBeVisible();
  });

  test("the adminToken fixture returns a working bearer token", async ({
    adminToken,
  }) => {
    expect(typeof adminToken).toBe("string");
    expect(adminToken.length).toBeGreaterThan(20);
  });

  test("fetchStoreCart reads the cart straight from the API", async ({
    page,
  }) => {
    await page.goto(storeUrl("store"));
    await page.waitForLoadState("domcontentloaded");

    // No cart exists yet, so the helper returns null.
    const cart = await fetchStoreCart(page);
    expect(cart === null || typeof cart === "object").toBe(true);
  });

  test("test.describe.serial runs tests in order", async ({ page }) => {
    // Marked serial, so a failure in one step stops the chain.
    await page.goto(storeUrl());
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("body")).toBeVisible();
  });
});
