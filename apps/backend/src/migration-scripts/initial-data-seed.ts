import { MedusaContainer } from "@medusajs/framework";
import { FulfillmentWorkflow } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  MedusaError,
  ModuleRegistrationName,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils";
import {
  createApiKeysWorkflow,
  createCollectionsWorkflow,
  createInventoryLevelsWorkflow,
  createProductCategoriesWorkflow,
  createProductOptionsWorkflow,
  createProductsWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  createStoresWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
} from "@medusajs/medusa/core-flows";

export default async function initial_data_seed({
  container,
}: {
  container: MedusaContainer;
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const link = container.resolve(ContainerRegistrationKeys.LINK);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const fulfillmentModuleService = container.resolve(
    ModuleRegistrationName.FULFILLMENT
  );

  const countries = ["gb", "de", "dk", "se", "fr", "es", "it"];

/**
 * The seed reuses whatever already exists. Entities read back through
 * `query.graph` come back as full models, while the create workflows return
 * DTOs, so the reused values are typed to just the fields this script reads.
 */
type SalesChannelRef = { id: string; name: string };
type ApiKeyRef = {
  id: string;
  title: string;
  token: string;
  revoked_at: Date | string | null;
};
type RegionRef = {
  id: string;
  name: string;
  currency_code: string;
  countries?: ({ iso_2?: string } | null)[] | null;
};
type StockLocationRef = { id: string; name: string };
type FulfillmentSetRef = {
  id: string;
  name: string;
  service_zones: { id: string }[];
};

/** Fails loudly instead of letting a missing entity fail further down. */
function requireEntity<T>(value: T | undefined, message: string): T {
  if (!value) {
    throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, message);
  }

  return value;
}

  logger.info("Seeding store data...");
  // Sales channels and publishable keys are unique by name/title, so reuse
  // whatever already exists rather than failing on a re-run.
  const { data: existingSalesChannels } = await query.graph({
    entity: "sales_channel",
    fields: ["id", "name"],
  });

  let defaultSalesChannel: SalesChannelRef | undefined =
    existingSalesChannels.find(
      (channel) => channel.name === "Default Sales Channel"
    );

  if (!defaultSalesChannel) {
    const {
      result: [createdSalesChannel],
    } = await createSalesChannelsWorkflow(container).run({
      input: {
        salesChannelsData: [
          {
            name: "Default Sales Channel",
            description: "Created by Medusa",
          },
        ],
      },
    });
    defaultSalesChannel = createdSalesChannel;
  } else {
    logger.info('Sales channel "Default Sales Channel" already exists.');
  }

  const { data: existingApiKeys } = await query.graph({
    entity: "api_key",
    fields: ["id", "title", "token", "revoked_at", "type"],
  });

  let publishableApiKey: ApiKeyRef | undefined = existingApiKeys.find(
    (key) => key.title === "Default Publishable API Key" && !key.revoked_at
  );

  if (!publishableApiKey) {
    const {
      result: [createdApiKey],
    } = await createApiKeysWorkflow(container).run({
      input: {
        api_keys: [
          {
            title: "Default Publishable API Key",
            type: "publishable",
            created_by: "",
          },
        ],
      },
    });
    publishableApiKey = createdApiKey;
  } else {
    logger.info(
      'Publishable API key "Default Publishable API Key" already exists.'
    );
  }

  requireEntity(
    defaultSalesChannel,
    'Sales channel "Default Sales Channel" is missing after seeding.'
  );
  requireEntity(
    publishableApiKey,
    'Publishable API key "Default Publishable API Key" is missing after seeding.'
  );

  await linkSalesChannelsToApiKeyWorkflow(container).run({
    input: {
      id: publishableApiKey.id,
      add: [defaultSalesChannel.id],
    },
  });

  const { data: existingStores } = await query.graph({
    entity: "store",
    fields: ["id", "name"],
  });

  if (!existingStores.find((existing) => existing.name === "Default Store")) {
    await createStoresWorkflow(container).run({
      input: {
        stores: [
          {
            name: "Default Store",
            supported_currencies: [
              {
                currency_code: "eur",
                is_default: true,
              },
              {
                currency_code: "usd",
                is_default: false,
              },
            ],
            default_sales_channel_id: defaultSalesChannel.id,
          },
        ],
      },
    });
  } else {
    logger.info('Store "Default Store" already exists.');
  }

  logger.info("Seeding region data...");
  // Region creation is not idempotent - Medusa rejects a country that is
  // already assigned to another region. Reuse the existing region when one
  // already covers these countries so the seed can be re-run safely.
  const { data: existingRegions } = await query.graph({
    entity: "region",
    fields: ["id", "name", "currency_code", "countries.iso_2"],
  });

  const regionCountries = (existing: RegionRef): string[] =>
    (existing.countries ?? [])
      .map((country) => country?.iso_2)
      .filter((code): code is string => !!code);

  let region: RegionRef | undefined = existingRegions.find((existing) =>
    countries.every((code) => regionCountries(existing as RegionRef).includes(code))
  );

  if (region) {
    logger.info(`Region "${region.name}" already exists, skipping creation.`);
  } else {
    const { result: regionResult } = await createRegionsWorkflow(container).run({
      input: {
        regions: [
          {
            name: "Europe",
            currency_code: "eur",
            countries,
            payment_providers: ["pp_system_default"],
          },
        ],
      },
    });
    region = regionResult[0];
  }

  requireEntity(region, "Region is missing after seeding.");

  logger.info("Finished seeding regions.");

  logger.info("Seeding tax regions...");
  // A country can only belong to one tax region, so only create the ones that
  // are missing. This keeps the seed re-runnable.
  const { data: existingTaxRegions } = await query.graph({
    entity: "tax_region",
    fields: ["id", "country_code"],
  });
  const existingTaxCountries = new Set(
    existingTaxRegions.map((taxRegion) => taxRegion.country_code)
  );
  const missingTaxCountries = countries.filter(
    (country_code) => !existingTaxCountries.has(country_code)
  );

  if (missingTaxCountries.length) {
    await createTaxRegionsWorkflow(container).run({
      input: missingTaxCountries.map((country_code) => ({
        country_code,
        provider_id: "tp_system",
      })),
    });
  } else {
    logger.info("Tax regions already exist, skipping creation.");
  }

  logger.info("Finished seeding tax regions.");

  logger.info("Seeding stock location data...");
  // Stock locations, fulfillment sets and shipping options are unique by name,
  // so re-creating them throws. Reuse whatever already exists.
  const { data: existingStockLocations } = await query.graph({
    entity: "stock_location",
    fields: ["id", "name"],
  });

  let stockLocation: StockLocationRef | undefined =
    existingStockLocations.find(
      (location) => location.name === "European Warehouse"
    );

  if (!stockLocation) {
    const { result: stockLocationResult } = await createStockLocationsWorkflow(
      container
    ).run({
      input: {
        locations: [
          {
            name: "European Warehouse",
            address: {
              city: "Copenhagen",
              country_code: "DK",
              address_1: "",
            },
          },
        ],
      },
    });
    stockLocation = stockLocationResult[0];
  } else {
    logger.info('Stock location "European Warehouse" already exists.');
  }

  requireEntity(stockLocation, "Stock location is missing after seeding.");

  await link.create({
    [Modules.STOCK_LOCATION]: {
      stock_location_id: stockLocation.id,
    },
    [Modules.FULFILLMENT]: {
      fulfillment_provider_id: "manual_manual",
    },
  });

  logger.info("Seeding fulfillment data...");
  // This is created by a migration script in core.
  const { data: shippingProfileResult } = await query.graph({
    entity: "shipping_profile",
    fields: ["id"],
  });
  const shippingProfile = shippingProfileResult[0];

  const { data: existingFulfillmentSets } = await query.graph({
    entity: "fulfillment_set",
    fields: ["id", "name", "service_zones.id"],
  });

  let fulfillmentSet: FulfillmentSetRef | undefined =
    existingFulfillmentSets.find(
      (set) => set.name === "European Warehouse delivery"
    );

  if (fulfillmentSet) {
    logger.info('Fulfillment set "European Warehouse delivery" already exists.');
  } else {
    fulfillmentSet = await fulfillmentModuleService.createFulfillmentSets({
      name: "European Warehouse delivery",
      type: "shipping",
      service_zones: [
      {
        name: "Europe",
        geo_zones: [
          {
            country_code: "gb",
            type: "country",
          },
          {
            country_code: "de",
            type: "country",
          },
          {
            country_code: "dk",
            type: "country",
          },
          {
            country_code: "se",
            type: "country",
          },
          {
            country_code: "fr",
            type: "country",
          },
          {
            country_code: "es",
            type: "country",
          },
          {
            country_code: "it",
            type: "country",
          },
        ],
      },
    ],
    });
  }

  requireEntity(fulfillmentSet, "Fulfillment set is missing after seeding.");

  await link.create({
    [Modules.STOCK_LOCATION]: {
      stock_location_id: stockLocation.id,
    },
    [Modules.FULFILLMENT]: {
      fulfillment_set_id: fulfillmentSet.id,
    },
  });

  const { data: existingShippingOptions } = await query.graph({
    entity: "shipping_option",
    fields: ["id", "name"],
  });
  const existingShippingNames = new Set(
    existingShippingOptions.map((option) => option.name)
  );

  const shippingOptions: FulfillmentWorkflow.CreateShippingOptionsWorkflowInput[] = [
    {
      name: "Standard Shipping",
      price_type: "flat" as const,
      provider_id: "manual_manual",
      service_zone_id: fulfillmentSet.service_zones[0].id,
      shipping_profile_id: shippingProfile.id,
      type: {
        label: "Standard",
        description: "Ship in 2-3 days.",
        code: "standard",
      },
      prices: [
        {
          currency_code: "usd",
          amount: 10,
        },
        {
          currency_code: "eur",
          amount: 10,
        },
        {
          region_id: region.id,
          amount: 10,
        },
      ],
      rules: [
        {
          attribute: "enabled_in_store",
          value: "true",
          operator: "eq" as const,
        },
        {
          attribute: "is_return",
          value: "false",
          operator: "eq" as const,
        },
      ],
    },
    {
      name: "Express Shipping",
      price_type: "flat" as const,
      provider_id: "manual_manual",
      service_zone_id: fulfillmentSet.service_zones[0].id,
      shipping_profile_id: shippingProfile.id,
      type: {
        label: "Express",
        description: "Ship in 24 hours.",
        code: "express",
      },
      prices: [
        {
          currency_code: "usd",
          amount: 10,
        },
        {
          currency_code: "eur",
          amount: 10,
        },
        {
          region_id: region.id,
          amount: 10,
        },
      ],
      rules: [
        {
          attribute: "enabled_in_store",
          value: "true",
          operator: "eq" as const,
        },
        {
          attribute: "is_return",
          value: "false",
          operator: "eq" as const,
        },
      ],
    },
  ].filter((option) => !existingShippingNames.has(option.name));

  if (shippingOptions.length) {
    await createShippingOptionsWorkflow(container).run({
      input: shippingOptions,
    });
  } else {
    logger.info("Shipping options already exist, skipping creation.");
  }

  logger.info("Finished seeding fulfillment data.");

  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: {
      id: stockLocation.id,
      add: [defaultSalesChannel.id],
    },
  });
  logger.info("Finished seeding stock location data.");

  logger.info("Seeding product data...");

  // Categories, options and products are unique by handle/title, so reuse
  // whatever already exists.
  const { data: existingCategories } = await query.graph({
    entity: "product_category",
    fields: ["id", "name", "handle"],
  });

  const categoryNames = ["Shirts", "Sweatshirts", "Pants", "Merch"];
  const categories = existingCategories.filter((category) =>
    categoryNames.includes(category.name)
  );

  const missingCategories = categoryNames.filter(
    (name) => !categories.some((category) => category.name === name)
  );

  if (missingCategories.length) {
    const { result: categoryResult } = await createProductCategoriesWorkflow(
      container
    ).run({
      input: {
        product_categories: missingCategories.map((name) => ({
          name,
          is_active: true,
        })),
      },
    });
    categories.push(...(categoryResult as unknown as typeof categories));
  } else {
    logger.info("Product categories already exist, skipping creation.");
  }

  const { data: existingOptions } = await query.graph({
    entity: "product_option",
    fields: ["id", "title"],
  });

  const optionDefinitions = [
    {
      title: "Size",
      values: ["S", "M", "L", "XL"],
    },
    {
      title: "Color",
      values: ["Black", "White"],
    },
  ];

  const productOptions = existingOptions.filter((option) =>
    optionDefinitions.some((definition) => definition.title === option.title)
  );

  const missingOptions = optionDefinitions.filter(
    (definition) =>
      !productOptions.some((option) => option.title === definition.title)
  );

  if (missingOptions.length) {
    const { result: productOptionsResult } = await createProductOptionsWorkflow(
      container
    ).run({
      input: {
        product_options: missingOptions,
      },
    });
    productOptions.push(...(productOptionsResult as typeof productOptions));
  } else {
    logger.info("Product options already exist, skipping creation.");
  }

  const sizeOption = productOptions.find((o) => o.title === "Size")!;
  const colorOption = productOptions.find((o) => o.title === "Color")!;

  // Products are unique by handle, so skip the whole block when they exist.
  const seedProductHandles = ["t-shirt", "sweatshirt", "pants", "merch"];
  const { data: existingProducts } = await query.graph({
    entity: "product",
    fields: ["id", "handle"],
  });
  const existingHandles = new Set(existingProducts.map((p) => p.handle));

  const productsToCreate = seedProductHandles.filter(
    (handle) => !existingHandles.has(handle)
  );

  if (!productsToCreate.length) {
    logger.info("Products already exist, skipping creation.");
  } else {
    await createProductsWorkflow(container).run({
      input: {
        products: [
        {
          title: "Medusa T-Shirt",
          category_ids: [
            categories.find((cat) => cat.name === "Shirts")!.id,
          ],
          description:
            "Reimagine the feeling of a classic T-shirt. With our cotton T-shirts, everyday essentials no longer have to be ordinary.",
          handle: "t-shirt",
          weight: 400,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          images: [
            {
              url: "https://medusa-public-images.s3.eu-west-1.amazonaws.com/tee-black-front.png",
            },
            {
              url: "https://medusa-public-images.s3.eu-west-1.amazonaws.com/tee-black-back.png",
            },
            {
              url: "https://medusa-public-images.s3.eu-west-1.amazonaws.com/tee-white-front.png",
            },
            {
              url: "https://medusa-public-images.s3.eu-west-1.amazonaws.com/tee-white-back.png",
            },
          ],
          options: [
            { id: sizeOption.id },
            { id: colorOption.id },
          ],
          variants: [
            {
              title: "S / Black",
              sku: "SHIRT-S-BLACK",
              options: {
                Size: "S",
                Color: "Black",
              },
              prices: [
                {
                  amount: 10,
                  currency_code: "eur",
                },
                {
                  amount: 15,
                  currency_code: "usd",
                },
              ],
            },
            {
              title: "S / White",
              sku: "SHIRT-S-WHITE",
              options: {
                Size: "S",
                Color: "White",
              },
              prices: [
                {
                  amount: 10,
                  currency_code: "eur",
                },
                {
                  amount: 15,
                  currency_code: "usd",
                },
              ],
            },
            {
              title: "M / Black",
              sku: "SHIRT-M-BLACK",
              options: {
                Size: "M",
                Color: "Black",
              },
              prices: [
                {
                  amount: 10,
                  currency_code: "eur",
                },
                {
                  amount: 15,
                  currency_code: "usd",
                },
              ],
            },
            {
              title: "M / White",
              sku: "SHIRT-M-WHITE",
              options: {
                Size: "M",
                Color: "White",
              },
              prices: [
                {
                  amount: 10,
                  currency_code: "eur",
                },
                {
                  amount: 15,
                  currency_code: "usd",
                },
              ],
            },
            {
              title: "L / Black",
              sku: "SHIRT-L-BLACK",
              options: {
                Size: "L",
                Color: "Black",
              },
              prices: [
                {
                  amount: 10,
                  currency_code: "eur",
                },
                {
                  amount: 15,
                  currency_code: "usd",
                },
              ],
            },
            {
              title: "L / White",
              sku: "SHIRT-L-WHITE",
              options: {
                Size: "L",
                Color: "White",
              },
              prices: [
                {
                  amount: 10,
                  currency_code: "eur",
                },
                {
                  amount: 15,
                  currency_code: "usd",
                },
              ],
            },
            {
              title: "XL / Black",
              sku: "SHIRT-XL-BLACK",
              options: {
                Size: "XL",
                Color: "Black",
              },
              prices: [
                {
                  amount: 10,
                  currency_code: "eur",
                },
                {
                  amount: 15,
                  currency_code: "usd",
                },
              ],
            },
            {
              title: "XL / White",
              sku: "SHIRT-XL-WHITE",
              options: {
                Size: "XL",
                Color: "White",
              },
              prices: [
                {
                  amount: 10,
                  currency_code: "eur",
                },
                {
                  amount: 15,
                  currency_code: "usd",
                },
              ],
            },
          ],
          sales_channels: [
            {
              id: defaultSalesChannel.id,
            },
          ],
        },
        {
          title: "Medusa Sweatshirt",
          category_ids: [
            categories.find((cat) => cat.name === "Sweatshirts")!.id,
          ],
          description:
            "Reimagine the feeling of a classic sweatshirt. With our cotton sweatshirt, everyday essentials no longer have to be ordinary.",
          handle: "sweatshirt",
          weight: 400,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          images: [
            {
              url: "https://medusa-public-images.s3.eu-west-1.amazonaws.com/sweatshirt-vintage-front.png",
            },
            {
              url: "https://medusa-public-images.s3.eu-west-1.amazonaws.com/sweatshirt-vintage-back.png",
            },
          ],
          options: [{ id: sizeOption.id }],
          variants: [
            {
              title: "S",
              sku: "SWEATSHIRT-S",
              options: {
                Size: "S",
              },
              prices: [
                {
                  amount: 10,
                  currency_code: "eur",
                },
                {
                  amount: 15,
                  currency_code: "usd",
                },
              ],
            },
            {
              title: "M",
              sku: "SWEATSHIRT-M",
              options: {
                Size: "M",
              },
              prices: [
                {
                  amount: 10,
                  currency_code: "eur",
                },
                {
                  amount: 15,
                  currency_code: "usd",
                },
              ],
            },
            {
              title: "L",
              sku: "SWEATSHIRT-L",
              options: {
                Size: "L",
              },
              prices: [
                {
                  amount: 10,
                  currency_code: "eur",
                },
                {
                  amount: 15,
                  currency_code: "usd",
                },
              ],
            },
            {
              title: "XL",
              sku: "SWEATSHIRT-XL",
              options: {
                Size: "XL",
              },
              prices: [
                {
                  amount: 10,
                  currency_code: "eur",
                },
                {
                  amount: 15,
                  currency_code: "usd",
                },
              ],
            },
          ],
          sales_channels: [
            {
              id: defaultSalesChannel.id,
            },
          ],
        },
        {
          title: "Medusa Sweatpants",
          category_ids: [
            categories.find((cat) => cat.name === "Pants")!.id,
          ],
          description:
            "Reimagine the feeling of classic sweatpants. With our cotton sweatpants, everyday essentials no longer have to be ordinary.",
          handle: "sweatpants",
          weight: 400,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          images: [
            {
              url: "https://medusa-public-images.s3.eu-west-1.amazonaws.com/sweatpants-gray-front.png",
            },
            {
              url: "https://medusa-public-images.s3.eu-west-1.amazonaws.com/sweatpants-gray-back.png",
            },
          ],
          options: [{ id: sizeOption.id }],
          variants: [
            {
              title: "S",
              sku: "SWEATPANTS-S",
              options: {
                Size: "S",
              },
              prices: [
                {
                  amount: 10,
                  currency_code: "eur",
                },
                {
                  amount: 15,
                  currency_code: "usd",
                },
              ],
            },
            {
              title: "M",
              sku: "SWEATPANTS-M",
              options: {
                Size: "M",
              },
              prices: [
                {
                  amount: 10,
                  currency_code: "eur",
                },
                {
                  amount: 15,
                  currency_code: "usd",
                },
              ],
            },
            {
              title: "L",
              sku: "SWEATPANTS-L",
              options: {
                Size: "L",
              },
              prices: [
                {
                  amount: 10,
                  currency_code: "eur",
                },
                {
                  amount: 15,
                  currency_code: "usd",
                },
              ],
            },
            {
              title: "XL",
              sku: "SWEATPANTS-XL",
              options: {
                Size: "XL",
              },
              prices: [
                {
                  amount: 10,
                  currency_code: "eur",
                },
                {
                  amount: 15,
                  currency_code: "usd",
                },
              ],
            },
          ],
          sales_channels: [
            {
              id: defaultSalesChannel.id,
            },
          ],
        },
        {
          title: "Medusa Shorts",
          category_ids: [
            categories.find((cat) => cat.name === "Merch")!.id,
          ],
          description:
            "Reimagine the feeling of classic shorts. With our cotton shorts, everyday essentials no longer have to be ordinary.",
          handle: "shorts",
          weight: 400,
          status: ProductStatus.PUBLISHED,
          shipping_profile_id: shippingProfile.id,
          images: [
            {
              url: "https://medusa-public-images.s3.eu-west-1.amazonaws.com/shorts-vintage-front.png",
            },
            {
              url: "https://medusa-public-images.s3.eu-west-1.amazonaws.com/shorts-vintage-back.png",
            },
          ],
          options: [{ id: sizeOption.id }],
          variants: [
            {
              title: "S",
              sku: "SHORTS-S",
              options: {
                Size: "S",
              },
              prices: [
                {
                  amount: 10,
                  currency_code: "eur",
                },
                {
                  amount: 15,
                  currency_code: "usd",
                },
              ],
            },
            {
              title: "M",
              sku: "SHORTS-M",
              options: {
                Size: "M",
              },
              prices: [
                {
                  amount: 10,
                  currency_code: "eur",
                },
                {
                  amount: 15,
                  currency_code: "usd",
                },
              ],
            },
            {
              title: "L",
              sku: "SHORTS-L",
              options: {
                Size: "L",
              },
              prices: [
                {
                  amount: 10,
                  currency_code: "eur",
                },
                {
                  amount: 15,
                  currency_code: "usd",
                },
              ],
            },
            {
              title: "XL",
              sku: "SHORTS-XL",
              options: {
                Size: "XL",
              },
              prices: [
                {
                  amount: 10,
                  currency_code: "eur",
                },
                {
                  amount: 15,
                  currency_code: "usd",
                },
              ],
            },
          ],
          sales_channels: [
            {
              id: defaultSalesChannel.id,
            },
          ],
        },
        ].filter((product) => productsToCreate.includes(product.handle)),
      },
    });
  }

  logger.info("Finished seeding product data.");

  logger.info("Seeding inventory levels.");

  const { data: inventoryItems } = await query.graph({
    entity: "inventory_item",
    fields: ["id"],
  });

  // Only give stock to items that do not have a level at this location yet.
  const { data: existingLevels } = await query.graph({
    entity: "inventory_level",
    fields: ["id", "inventory_item_id", "location_id"],
  });
  const stockedItemIds = new Set(
    existingLevels
      .filter((level) => level.location_id === stockLocation.id)
      .map((level) => level.inventory_item_id)
  );
  const itemsToStock = inventoryItems.filter(
    (item) => !stockedItemIds.has(item.id)
  );

  if (itemsToStock.length) {
    await createInventoryLevelsWorkflow(container).run({
      input: {
        inventory_levels: itemsToStock.map((item) => ({
          location_id: stockLocation.id,
          stocked_quantity: 1000000,
          inventory_item_id: item.id,
        })),
      },
    });
  } else {
    logger.info("Inventory levels already exist, skipping creation.");
  }

  logger.info("Finished seeding inventory levels data.");
}
