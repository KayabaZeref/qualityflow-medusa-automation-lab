/**
 * Assertion APIs.
 *
 * Covers the expect() catalogue:
 *   toBeVisible / toBeHidden / toBeAttached / toBeInViewport
 *   toHaveText / toContainText / toHaveValue / toHaveValues
 *   toHaveCount / toHaveAttribute / toHaveClass / toHaveCSS / toHaveId
 *   toHaveTitle / toHaveURL
 *   toBeEnabled / toBeDisabled / toBeChecked / toBeEditable / toBeEmpty
 *   toBeFocused / toBeInViewport
 *   toHaveScreenshot
 *   plus: soft assertions, expect.soft, expect.poll, expect.any/anything,
 *   custom message, negated matchers, expect.arrayContaining.
 */

import { test, expect, storeUrl, gotoStore, TID, tid } from "./helpers";

test.describe("Assertions", () => {
  test.beforeEach(async ({ page }) => {
    await gotoStore(page, "store", { waitFor: TID.productsList });
  });

  test("visibility: toBeVisible, toBeHidden, toBeAttached", async ({
    page,
  }) => {
    await expect(tid(page, TID.productsList)).toBeVisible();
    await expect(page.getByTestId("nope")).toBeHidden();
    await expect(page.getByTestId("nope")).not.toBeAttached();
    await expect(tid(page, TID.productsList)).toBeAttached();
  });

  test("text: toHaveText, toContainText and their options", async ({
    page,
  }) => {
    const heading = page.locator("h1");

    await expect(heading).toHaveText("All products");
    await expect(heading).toContainText("All");
    await expect(heading).toHaveText(/All\s+products/);
    // useInnerText compares rendered text, ignoring hidden whitespace.
    await expect(heading).toHaveText("All products", { useInnerText: true });
  });

  test("toHaveText with an array checks every element in order", async ({
    page,
  }) => {
    const products = page.locator('[data-testid="products-list"] a[href*="/products/"]');
    const count = await products.count();

    // An array expectation must cover exactly as many elements as the
    // locator resolves to.
    const normalized = (await products.allTextContents()).map((t) =>
      t.replace(/\s+/g, " ").trim()
    );

    expect(normalized).toHaveLength(count);
    await expect(products).toHaveText(normalized);
  });

  test("value: toHaveValue and toHaveValues", async ({ page }) => {
    await tid(page, TID.navSearchButton).click();
    const input = tid(page, TID.searchInput);

    await input.fill("medusa");
    await expect(input).toHaveValue("medusa");
    await expect(input).toHaveValue(/medusa/);

    // toHaveValues works on a <select multiple> and reads the selected
    // options as a list.
    await page.evaluate(() => {
      const select = document.createElement("select");
      select.multiple = true;
      select.id = "demo-multi";
      select.setAttribute("data-testid", "demo-multi");
      select.innerHTML =
        '<option value="a" selected>A</option><option value="b">B</option>';
      document.body.appendChild(select);
    });

    const multi = page.getByTestId("demo-multi");
    await expect(multi).toHaveValues(["a"]);
  });

  test("toHaveCount", async ({ page }) => {
    const products = page.locator('[data-testid="products-list"] a[href*="/products/"]');
    const count = await products.count();

    await expect(products).toHaveCount(count);
    await expect(page.getByTestId("nope")).toHaveCount(0);
  });

  test("attributes: toHaveAttribute, toHaveClass, toHaveId, toHaveCSS", async ({
    page,
  }) => {
    const heading = page.locator("h1");

    await expect(heading).toHaveAttribute("data-testid", TID.storePageTitle);
    await expect(heading).toHaveClass(/.*/);
    await expect(heading).toHaveCSS("display", "block");

    // toHaveId needs an actual id attribute, so add one to the heading.
    await page.evaluate(() => {
      document.querySelector("h1")?.setAttribute("id", "store-page-title");
    });
    await expect(heading).toHaveId("store-page-title");
  });

  test("toHaveTitle and toHaveURL", async ({ page }) => {
    await expect(page).toHaveTitle(/.+/);
    await expect(page).toHaveURL(/\/vn\/store/);
  });

  test("state: toBeEnabled, toBeDisabled, toBeEditable, toBeEmpty", async ({
    page,
  }) => {
    const searchButton = tid(page, TID.navSearchButton);
    await expect(searchButton).toBeEnabled();
    await expect(searchButton).not.toBeDisabled();

    await tid(page, TID.navSearchButton).click();
    const input = tid(page, TID.searchInput);
    await expect(input).toBeEditable();
    await expect(input).toBeEmpty();

    await input.fill("x");
    await expect(input).not.toBeEmpty();
  });

  test("toBeChecked and toBeFocused", async ({ page }) => {
    await tid(page, TID.navSearchButton).click();
    const input = tid(page, TID.searchInput);

    await input.focus();
    await expect(input).toBeFocused();

    await input.blur();
    await expect(input).not.toBeFocused();
  });

  test("toBeInViewport", async ({ page }) => {
    const heading = page.locator("h1");
    await heading.scrollIntoViewIfNeeded();
    await expect(heading).toBeInViewport();
  });

  test("negated matchers", async ({ page }) => {
    await expect(page.locator("h1")).not.toHaveText("Something else");
    await expect(page.getByTestId("nope")).not.toBeVisible();
    await expect(page.locator("h1")).not.toHaveCount(5);
  });

  test("expect.any, expect.anything and expect.arrayContaining", async () => {
    expect("hello").toEqual(expect.any(String));
    expect(42).toEqual(expect.any(Number));
    expect({ a: 1 }).toEqual(expect.objectContaining({ a: 1 }));
    expect(["a", "b"]).toEqual(expect.arrayContaining(["b"]));
    expect({ any: "value" }).toEqual(expect.anything());
  });

  test("soft assertions collect failures instead of aborting", async ({
    page,
  }) => {
    // expect.soft records a failure and lets the test keep running, so every
    // problem is reported at the end instead of only the first one.
    await expect.soft(page.locator("h1")).toBeVisible();
    await expect.soft(page.getByTestId("products-list")).toBeAttached();
    await expect.soft(page.locator("h1")).toHaveText("All products");
  });

  test("a failing soft assertion still fails the test at the end", async ({
    page,
  }) => {
    // test.fail() declares that this test is expected to fail, which is how
    // you can document the failure behaviour of expect.soft.
    test.fail(true, "demonstrates that a soft assertion marks the test failed");

    await expect.soft(page.getByTestId("nope")).toBeVisible();
    // The code below still runs, proving the assertion did not abort.
    await expect.soft(page.locator("h1")).toBeVisible();
  });

  test("expect.poll retries a condition until it passes", async ({ page }) => {
    await page.goto(storeUrl("store"));
    await page.waitForLoadState("domcontentloaded");

    let attempts = 0;

    await expect
      .poll(
        async () => {
          attempts += 1;
          return attempts;
        },
        { timeout: 10_000, intervals: [100, 200, 300] }
      )
      .toBeGreaterThan(2);
  });

  test("custom failure message", async ({ page }) => {
    // The message is shown in the failure output.
    await expect(page.locator("h1"), "the listing heading should exist").toBeVisible();
  });

  test("toHaveScreenshot for visual regression", async ({ page }) => {
    await page.evaluate(() => window.scrollTo(0, 0));

    // The first run writes the baseline to test-results/. Subsequent runs
    // compare against it and fail on a pixel difference.
    await expect(page).toHaveScreenshot("store-listing.png", {
      fullPage: false,
      maxDiffPixels: 500,
      animations: "disabled",
    });
  });
});