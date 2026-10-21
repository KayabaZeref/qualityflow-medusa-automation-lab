/**
 * Shared test configuration and helpers for the automated test suite.
 *
 * Everything the specs need lives here so the individual spec files stay
 * focused on *what* is being tested rather than how the app is wired up.
 */

import { test as base, expect, type Page, type Locator } from "@playwright/test";

/* ------------------------------------------------------------------ config */

/** Storefront origin. The app is locale-prefixed (`/vn/...`). */
export const STOREFRONT_URL =
  process.env.STOREFRONT_URL ?? "http://localhost:8000";

/** Medusa backend origin. */
export const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:9000";

/** Default locale segment used by this storefront. */
export const COUNTRY_CODE = process.env.COUNTRY_CODE ?? "vn";

/** Publishable API key, required by every `/store/*` request. */
export const PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY ??
  "pk_750f454742d6c02d050aa67fd2b607a40da558cac02ee40da898779dc81a968c";

/** Seeded admin credentials, used by the API specs. */
export const ADMIN_EMAIL =
  process.env.ADMIN_EMAIL ?? "admin@medusa-test.com";
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "supersecret";

/** Build a localized storefront URL, e.g. storeUrl("store") -> /vn/store */
export function storeUrl(path = ""): string {
  const clean = path.replace(/^\//, "");
  return `${STOREFRONT_URL}/${COUNTRY_CODE}${clean ? `/${clean}` : ""}`;
}

/**
 * Navigate to a storefront page and wait for it to be interactive.
 *
 * The product listing is rendered from a search request to the Medusa
 * backend, and that first request after a cold start can take a while, so
 * the wait is generous to avoid a flaky timeout.
 */
export async function gotoStore(
  page: Page,
  path = "",
  options: { waitFor?: string; timeout?: number } = {}
): Promise<void> {
  const { waitFor, timeout = 60_000 } = options;

  await page.goto(storeUrl(path), { waitUntil: "domcontentloaded" });

  if (waitFor) {
    await tid(page, waitFor).waitFor({ state: "attached", timeout });
  }
}

/* -------------------------------------------------------------- test ids */

export const TID = {
  // layout / navigation
  navSearchButton: "nav-search-button",
  navStoreLink: "nav-store-link",
  navAccountLink: "nav-account-link",
  navCartLink: "nav-cart-link",
  navMenuButton: "nav-menu-button",
  closeMenuButton: "close-menu-button",
  sideMenuPopup: "nav-menu-popup",
  footerCategories: "footer-categories",
  categoryLink: "category-link",

  // search
  searchInput: "search-input",
  searchResults: "search-results",
  searchHitLink: "search-hit-link",
  searchNoResults: "search-no-results",
  searchEmpty: "search-empty",
  searchLoading: "search-loading",
  storeSearchInput: "store-search-input",
  storeSearchClear: "store-search-clear",

  // product listing
  productsList: "products-list",
  storePageTitle: "store-page-title",
  categoryContainer: "category-container",
  categoryPageTitle: "category-page-title",
  productPagination: "product-pagination",
  sortByContainer: "sort-by-container",
  sortByLink: "sort-by-link",
  currentRefinements: "current-refinements",
  clearRefinements: "clear-refinements",
  removeRefinement: "remove-refinement",
  onSaleToggle: "on-sale-toggle",
  optionRefinement: "option-refinement",

  // product detail
  productTitle: "product-title",
  productDescription: "product-description",
  productPrice: "product-price",
  originalProductPrice: "original-product-price",
  productOptions: "product-options",
  optionButton: "option-button",
  addProductButton: "add-product-button",
  mobileCartButton: "mobile-cart-button",

  // cart
  cartContainer: "cart-container",
  emptyCartMessage: "empty-cart-message",
  productRow: "product-row",
  productDeleteButton: "product-delete-button",
  productSelectButton: "product-select-button",
  productUnitPrice: "product-unit-price",
  productUnitOriginalPrice: "product-unit-original-price",
  signInButton: "sign-in-button",

  // checkout
  shippingFirstNameInput: "shipping-first-name-input",
  shippingLastNameInput: "shipping-last-name-input",
  shippingAddressInput: "shipping-address-input",
  shippingCompanyInput: "shipping-company-input",
  shippingPostalCodeInput: "shipping-postal-code-input",
  shippingCityInput: "shipping-city-input",
  shippingCountrySelect: "shipping-country-select",
  shippingProvinceInput: "shipping-province-input",
  shippingEmailInput: "shipping-email-input",
  shippingPhoneInput: "shipping-phone-input",
  billingAddressCheckbox: "billing-address-checkbox",
  billingFirstNameInput: "billing-first-name-input",
  billingLastNameInput: "billing-last-name-input",
  billingAddressInput: "billing-address-input",
  billingCountrySelect: "billing-country-select",
  deliveryOptionsContainer: "delivery-options-container",
  deliveryOptionRadio: "delivery-option-radio",
  submitDeliveryOptionButton: "submit-delivery-option-button",
  editDeliveryButton: "edit-delivery-button",
  discountInput: "discount-input",
  discountApplyButton: "discount-apply-button",
  discountErrorMessage: "discount-error-message",
  discountRow: "discount-row",
  discountCode: "discount-code",
  removeDiscountButton: "remove-discount-button",
  submitPaymentButton: "submit-payment-button",
  submitOrderButton: "submit-order-button",
  paymentMethodSummary: "payment-method-summary",
  editPaymentButton: "edit-payment-button",
  submitAddressButton: "submit-address-button",
  addressErrorMessage: "address-error-message",

  // account
  registerPage: "register-page",
  registerButton: "register-button",
  registerError: "register-error",
  firstNameInput: "first-name-input",
  lastNameInput: "last-name-input",
  emailInput: "email-input",
  phoneInput: "phone-input",
  passwordInput: "password-input",
  verifyAccountPage: "verify-account-page",
  ordersPageWrapper: "orders-page-wrapper",
  orderCard: "order-card",
  orderDisplayId: "order-display-id",
  orderDetailsLink: "order-details-link",
} as const;

/* -------------------------------------------------------------- locators */

/** Shorthand for a test-id lookup: tid(page, "nav-cart-link") */
export function tid(page: Page, testId: string): Locator {
  return page.getByTestId(testId);
}

/**
 * Log in to the Medusa admin API and return a bearer token.
 * Used by the admin endpoint specs.
 */
export async function getAdminToken(): Promise<string> {
  const res = await fetch(`${BACKEND_URL}/auth/user/emailpass`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });

  if (!res.ok) {
    throw new Error(
      `Admin login failed (${res.status}). Is the backend running at ${BACKEND_URL}?`
    );
  }

  const body = (await res.json()) as { token?: string };
  if (!body.token) {
    throw new Error("Admin login succeeded but no token was returned.");
  }

  return body.token;
}

/* -------------------------------------------------------------- fixtures */

/**
 * A `test` with a couple of extra fixtures available to every spec:
 *
 *  - `storePage`  a page already navigated to the storefront home page
 *  - `adminToken` a Medusa admin bearer token (API only, not browser auth)
 *
 * Use `storePage` only when you specifically want the storefront preloaded;
 * most specs should take the plain `page` fixture and navigate explicitly.
 */
export const test = base.extend<{
  storePage: Page;
  adminToken: string;
}>({
  storePage: async ({ page }, use) => {
    await page.goto(storeUrl());
    await page.waitForLoadState("domcontentloaded");
    await use(page);
  },

  // Only fetched when a spec asks for it, so UI specs never depend on the
  // admin account existing.
  adminToken: async ({}, use) => {
    await use(await getAdminToken());
  },
});

export { expect };

/* ------------------------------------------------------------- utilities */

/**
 * Read the active cart straight from the storefront API so tests can assert on
 * cart state without scraping the DOM.
 */
export async function fetchStoreCart(page: Page) {
  return page.evaluate(async (pk: string) => {
    const cartId = window.localStorage.getItem("_medusa_cart_id");
    if (!cartId) {
      return null;
    }
    const res = await fetch(`/store/carts/${cartId}`, {
      headers: { "x-publishable-api-key": pk },
    });
    return res.ok ? await res.json() : null;
  }, PUBLISHABLE_KEY);
}

/** Unique value for form fields that must differ between test runs. */
export function uniqueEmail(prefix = "qa"): string {
  return `${prefix}.${Date.now()}@example.com`;
}

/**
 * Open the first product in the listing and add it to the cart.
 *
 * Products with variants render one button group per option, and the
 * add-to-cart button stays disabled until every group has a selection.
 * This helper does that selection for you and returns the product title.
 */
export async function addFirstProductToCart(page: Page): Promise<string> {
  await gotoStore(page, "store", { waitFor: TID.productsList });

  const productLink = page
    .locator('[data-testid="products-list"] a[href*="/products/"]')
    .first();
  await productLink.click();
  await page.waitForURL(/\/vn\/products\//, { timeout: 30_000 });

  // Select the first value of every option group.
  const groups = tid(page, TID.productOptions);
  const groupCount = await groups.count();
  for (let i = 0; i < groupCount; i += 1) {
    const option = groups
      .nth(i)
      .locator('[data-testid="option-button"]')
      .first();
    if ((await option.count()) > 0) {
      await option.click();
    }
  }

  const addButton = tid(page, TID.addProductButton);
  await expect(addButton).toBeEnabled({ timeout: 20_000 });
  await addButton.click();

  // Wait for the cart badge to reflect the new item.
  await expect(tid(page, TID.navCartLink)).toContainText(/Cart \(1\)/, {
    timeout: 20_000,
  });

  const title = await page
    .locator("#product-info")
    .getByTestId(TID.productTitle)
    .innerText();

  return title.trim();
}