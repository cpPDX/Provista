# External Pricing

Provista treats external/catalog pricing as advisory market data, not household purchase history.

## Data boundary

- `PriceEntry` means the household paid or explicitly submitted a price. It can feed Spend and household price history.
- `PriceObservation` means an external provider reported a price. It never feeds Spend by itself.
- Shopping-trip completion may use a household historical price, a user-entered price, or `null` when the user chooses to review the price later.

Keeping these records separate prevents a retailer/catalog quote from being mistaken for an amount the household actually paid.

## Provider contract

Providers register through `services/externalPricing/providerRegistry.js` and implement:

```js
{
  id: 'provider-id',
  displayName: 'Provider Name',
  async fetchPrices(context) {
    return [/* normalized observations */];
  }
}
```

Provider-specific product and store identifiers belong in the generic `externalIds` maps on `Item` and `Store`. UPC remains the preferred shared product key.

Adding another provider should require an adapter plus registration, not changes to shopping, Spend, or `PriceEntry` semantics.

## Open Prices

Open Prices is the first configured provider.

Provista currently:

1. Uses an item's UPC as `product_code`.
2. Requires a reliably matched Open Prices location for the Provista store.
3. Reuses a cached provider location ID when one has already been resolved.
4. Otherwise attempts a conservative store-name/location match and refuses ambiguous matches.
5. Requests prices observed within the last 30 days.
6. Caches successful observations for 12 hours.
7. Refreshes at most 25 shopping-list candidates with concurrency limited to four requests.
8. Treats provider/network failure as optional enrichment failure - the shopping list continues working normally.

The shopping UI labels these records as community-observed Open Prices data and does not silently substitute them for what the user paid.

### Configuration

Optional environment variables:

- `OPEN_PRICES_BASE_URL` - defaults to `https://prices.openfoodfacts.org`.
- `OPEN_PRICES_TIMEOUT_MS` - request timeout, default 5000 ms.
- `OPEN_PRICES_USER_AGENT` - defaults to a Provista identifier.

Read access does not require authentication. If Provista later contributes data, that write flow should use Open Prices authentication separately from the read adapter.

## Licensing

Open Prices / Open Food Facts data is open data under ODbL terms. Provista surfaces the Open Prices source in the shopping UI. Any future export, redistribution, or data-combination work must continue to preserve required attribution and comply with the source license.
