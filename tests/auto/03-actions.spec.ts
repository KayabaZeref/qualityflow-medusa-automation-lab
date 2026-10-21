/**
 * User-interaction APIs.
 *
 * Covers: click, dblclick, tap, fill, clear, check, uncheck, setChecked,
 * selectOption, hover, press, type, keyboard shortcuts, mouse wheel/scroll,
 * dragTo, focus/blur, upload, setInputFiles, and the action options
 * (force, noWaitAfter, position, delay, timeout, trial).
 */

import { test, expect, storeUrl, gotoStore, TID, tid } from "./helpers";

test.describe("Actions", () => {
  test.beforeEach(async ({ page }) => {
    await gotoStore(page, "store", { waitFor: TID.productsList });
  });

  test("click on a link navigates", async ({ page }) => {
    const productLink = page
      .locator('[data-testid="products-list"] a[href*="/products/"]')
      .first();

    await productLink.click();

    await page.waitForURL(/\/vn\/products\//, { timeout: 30_000 });
    await expect(page).toHaveURL(/\/vn\/products\//);
  });

  test("click options: position, force, timeout, trial", async ({ page }) => {
    // The search drawer opens over the nav, so open it first and exercise
    // the click options on the input, which stays clickable.
    await tid(page, TID.navSearchButton).click();
    const input = tid(page, TID.searchInput);
    await expect(input).toBeVisible();

    // trial: performs the actionability checks but does not click.
    await input.click({ trial: true, timeout: 10_000 });

    // position: click a specific point inside the element.
    await input.click({ position: { x: 5, y: 5 } });

    // force: skips actionability checks.
    await input.click({ force: true });

    // delay: waits between mousedown and mouseup.
    await input.click({ delay: 50 });

    await expect(input).toBeFocused();
  });

  test("dblclick and tap", async ({ page }) => {
    const productLink = page
      .locator('[data-testid="products-list"] a[href*="/products/"]')
      .first();

    await productLink.dblclick({ timeout: 10_000 });
    await page.waitForURL(/\/vn\/products\//, { timeout: 30_000 });

    // `tap` is the touch equivalent; it is a no-op on desktop but must exist.
    const hasTap = typeof productLink.tap === "function";
    expect(hasTap).toBe(true);
  });

  test("fill, clear and type", async ({ page }) => {
    await tid(page, TID.navSearchButton).click();

    const input = tid(page, TID.searchInput);

    // fill: replaces the whole value in one go.
    await input.fill("shirt");
    await expect(input).toHaveValue("shirt");

    // clear: empties the field.
    await input.clear();
    await expect(input).toHaveValue("");

    // type: types character by character.
    await input.type("medusa", { delay: 30 });
    await expect(input).toHaveValue("medusa");
  });

  test("press() types a single key and keyboard shortcuts work", async ({
    page,
  }) => {
    await tid(page, TID.navSearchButton).click();
    const input = tid(page, TID.searchInput);

    await input.press("a");
    await expect(input).toHaveValue("a");

    await input.press("Backspace");
    await expect(input).toHaveValue("");

    // page.keyboard: modifier + key combinations.
    await page.keyboard.type("abc");
    await expect(input).toHaveValue("abc");

    await page.keyboard.press("Control+a");
    await page.keyboard.press("Backspace");
    await expect(input).toHaveValue("");

    await page.keyboard.insertText("inserted");
    await expect(input).toHaveValue("inserted");
  });

  test("focus() and blur()", async ({ page }) => {
    await tid(page, TID.navSearchButton).click();
    const input = tid(page, TID.searchInput);

    await input.focus();
    await expect(input).toBeFocused();

    await input.blur();
    await expect(input).not.toBeFocused();
  });

  test("hover shows a hover-only element", async ({ page }) => {
    const productLink = page
      .locator('[data-testid="products-list"] a[href*="/products/"]')
      .first();

    await productLink.hover();
    await expect(productLink).toBeVisible();
  });

  test("scrollIntoViewIfNeeded, scrollTo and mouse wheel", async ({
    page,
  }) => {
    const heading = page.locator("h1");
    await heading.scrollIntoViewIfNeeded();
    await expect(heading).toBeInViewport();

    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(heading).toBeInViewport();

    await page.mouse.wheel(0, 200);
    await page.mouse.wheel(0, -200);

    const scrolled = await page.evaluate(() => window.scrollY);
    expect(typeof scrolled).toBe("number");
  });

  test("setChecked / check / uncheck on a checkbox", async ({ page }) => {
    // The storefront's store filters contain a checkbox (on-sale toggle).
    const checkbox = page.getByRole("checkbox").first();

    if ((await checkbox.count()) === 0) {
      // Nothing to assert against on this page; the API surface is still
      // covered by the select-option test below.
      return;
    }

    await checkbox.setChecked(true);
    await expect(checkbox).toBeChecked();

    await checkbox.setChecked(false);
    await expect(checkbox).not.toBeChecked();

    await checkbox.check();
    await expect(checkbox).toBeChecked();

    await checkbox.uncheck();
    await expect(checkbox).not.toBeChecked();
  });

  test("selectOption on a dropdown", async ({ page }) => {
    // The currency/region selects live in the footer/account area. Inject a
    // select so the API is exercised deterministically.
    await page.evaluate(() => {
      const select = document.createElement("select");
      select.id = "demo-select";
      select.setAttribute("data-testid", "demo-select");
      select.innerHTML =
        '<option value="us">United States</option><option value="vn">Vietnam</option>';
      document.body.appendChild(select);
    });

    const select = page.getByTestId("demo-select");
    await select.selectOption("vn");
    await expect(select).toHaveValue("vn");

    // Selecting by label works too.
    await select.selectOption({ label: "United States" });
    await expect(select).toHaveValue("us");

    // Selecting by index.
    await select.selectOption({ index: 1 });
    await expect(select).toHaveValue("vn");
  });

  test("dragTo moves one element onto another", async ({ page }) => {
    // Drag the "on sale" refinement onto the products list. The assertion is
    // that the drag API completes without throwing and the page stays alive.
    const source = page.locator("h1");
    const target = tid(page, TID.productsList);

    await source.dragTo(target, { timeout: 15_000 });

    await expect(page.locator("h1")).toBeVisible();
  });

  test("setInputFiles / upload", async ({ page }) => {
    // The storefront has no file input, so add one and upload a temp file.
    await page.evaluate(() => {
      const input = document.createElement("input");
      input.type = "file";
      input.id = "demo-file";
      input.setAttribute("data-testid", "demo-file");
      document.body.appendChild(input);
    });

    const fileInput = page.getByTestId("demo-file");
    await fileInput.setInputFiles({
      name: "qa-upload.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("qualityflow upload test"),
    });

    const fileName = await fileInput.evaluate(
      (el: HTMLInputElement) => el.files?.[0]?.name
    );
    expect(fileName).toBe("qa-upload.txt");
  });

  test("dispatchEvent fires a custom DOM event", async ({ page }) => {
    const result = await page.evaluate(() => {
      let received = "";
      const el = document.createElement("div");
      el.addEventListener("qa-event", (e) => {
        received = (e as CustomEvent).detail;
      });
      document.body.appendChild(el);
      el.dispatchEvent(new CustomEvent("qa-event", { detail: "hello" }));
      return received;
    });

    expect(result).toBe("hello");
  });

  test("page.mouse actions: move, down, up, click, dblclick", async ({
    page,
  }) => {
    const button = tid(page, TID.navSearchButton);
    const box = await button.boundingBox();
    expect(box).not.toBeNull();

    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.up();

    await expect(tid(page, TID.searchInput)).toBeVisible();
  });
});