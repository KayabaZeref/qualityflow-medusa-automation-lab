# Playwright Test Reference (`tests/auto`)

A runnable cheat sheet for Playwright. Every file here is a **real, passing
test** — not pseudo-code — so you can read it, run it, and copy the patterns
into your own scripts.

| File | What it covers |
| --- | --- |
| [`helpers.ts`](./helpers.ts) | Shared config, test IDs, fixtures (`storePage`, `adminToken`), and helper functions |
| [`01-navigation.spec.ts`](./01-navigation.spec.ts) | `goto`, `waitForURL`, `waitForLoadState`, `waitForFunction`, `goBack`/`goForward`, `reload`, history, title & URL assertions |
| [`02-locators.spec.ts`](./02-locators.spec.ts) | `getByRole`/`Text`/`Label`/`Placeholder`/`Title`/`AltText`/`TestId`, CSS & XPath, `first`/`last`/`nth`, `filter`, `and`/`or`, chaining, frames, `evaluate`/`evaluateAll` |
| [`03-actions.spec.ts`](./03-actions.spec.ts) | `click`, `dblclick`, `fill`, `clear`, `type`, `press`, `check`/`uncheck`/`setChecked`, `selectOption`, `hover`, `dragTo`, `focus`/`blur`, `setInputFiles`, `scrollIntoViewIfNeeded`, `page.mouse`/`page.keyboard` |
| [`04-assertions.spec.ts`](./04-assertions.spec.ts) | Every `expect()` matcher, `expect.soft`, `expect.poll`, `expect.any`, negated matchers, `toHaveScreenshot` |
| [`05-api-network.spec.ts`](./05-api-network.spec.ts) | The `request` fixture (all verbs), response inspection, cookies, `storageState`, `page.route` mocking/aborting/continuing, `waitForRequest`/`waitForResponse` |
| [`06-e2e-flow.spec.ts`](./06-e2e-flow.spec.ts) | Full shopper journeys plus `test.step`, `beforeEach`/`afterEach`, `test.describe`, custom fixtures |

## Running

The suite targets **Chromium (Chrome) only**, so there is a single project and
no cross-browser flags needed.

```bash
# Everything
npx playwright test tests/auto

# One file
npx playwright test tests/auto/06-e2e-flow.spec.ts

# One test by name
npx playwright test tests/auto -g "add to cart"

# Watch mode, re-runs on save
npx playwright test tests/auto --watch

# List every test without running them
npx playwright test tests/auto --list

# Open the HTML report after a run
npx playwright show-report
```

## Prerequisites

Both servers must be running:

```bash
npm run backend:dev     # http://localhost:9000
npm run storefront:dev  # http://localhost:8000
```

Override the defaults with environment variables:

```bash
STOREFRONT_URL=http://localhost:8000
BACKEND_URL=http://localhost:9000
COUNTRY_CODE=vn
```

## Writing your own test

Copy this skeleton into `tests/auto/`:

```ts
import { test, expect, gotoStore, TID, tid } from "./helpers";

test("my test name", async ({ page }) => {
  await gotoStore(page, "store", { waitFor: TID.productsList });

  await expect(tid(page, TID.productsList)).toBeVisible();
});
```

### The `helpers.ts` exports you should use

| Export | Purpose |
| --- | --- |
| `storeUrl(path?)` | Builds a locale-prefixed URL, e.g. `storeUrl("store")` -> `http://localhost:8000/vn/store` |
| `gotoStore(page, path?, opts?)` | Navigates and waits for a test id to appear. Use this instead of `page.goto` + a manual wait. |
| `TID` | Map of every `data-testid` in the storefront. Prefer these over CSS selectors. |
| `tid(page, id)` | Shorthand for `page.getByTestId(id)` |
| `PUBLISHABLE_KEY` | The Medusa publishable key required by `/store/*` API calls |
| `BACKEND_URL` | Medusa backend origin, for API tests |
| `getAdminToken()` | Logs in to the admin API and returns a bearer token |
| `addFirstProductToCart(page)` | Adds the first product to the cart, handling variant selection |
| `fetchStoreCart(page)` | Reads the active cart straight from the API |
| `uniqueEmail(prefix?)` | Generates a unique email for form submissions |

### Fixtures

| Fixture | What it gives you |
| --- | --- |
| `page` | The standard Playwright page |
| `request` | A standalone API client, no browser involved |
| `context` | The browser context, for cookies and storage state |
| `browser` | The browser instance, to open new contexts |
| `storePage` | *(custom)* A page already navigated to the storefront home page |
| `adminToken` | *(custom)* A Medusa admin bearer token, fetched only if a test asks for it |

## The most important things to know

**Prefer `getByRole` > `getByTestId` > CSS.** `getByRole` matches how a user
perceives the page and fails loudly when the markup changes meaning. Use
`getByTestId` for elements with no meaningful role.

**Never use `waitForTimeout` in real tests.** Playwright's `expect` and
`waitFor*` methods retry automatically. A fixed sleep is a flake waiting to
happen. This suite only uses it to demonstrate the API exists.

**`expect` retries.** `await expect(locator).toBeVisible()` polls for up to
the `expect.timeout` in `playwright.config.ts` (10s). You rarely need
`waitForSelector` alongside it.

**Locators are lazy.** `page.getByRole("button")` does not query the DOM
immediately, so you can build a locator before the page has loaded.

**Strict mode.** If a locator matches more than one element, Playwright
throws rather than guessing. Narrow it down with `.first()`, `.last()`,
`.nth(i)`, or `filter()`.

**`not` is part of `expect`, not the locator.**
`await expect(el).not.toBeVisible()` is correct;
`locator.not(...)` does not exist.

**The storefront talks to the backend server-side.** The product listing is
driven by InstantSearch, which POSTs to `http://localhost:9000/store/search`.
Route mocks must target that URL, not `/store/products`.

**Variants block the add-to-cart button.** A product with options renders one
button group per option, and the button stays disabled until every group has
a selection. `addFirstProductToCart` does this for you.

## Notes on the app

- The storefront is locale-prefixed (`/vn/...`) and prices are in VND.
- `data-testid="product-title"` appears both on the product detail page and on
  every product card in the related-products grid. Scope it with
  `page.locator("#product-info")` when you need the detail heading.
- The Medusa cart update verb is `POST /store/carts/:id`. `PATCH`, `PUT` and
  `DELETE` on that path return 404.

## Useful flags

```bash
--headed              # run with a visible browser
--debug               # open the Playwright Inspector
--ui                  # interactive mode
--workers=1           # serial execution, for tests that share state
--retries=2           # retry flaky tests twice
--grep "cart"         # run tests matching a pattern
```
