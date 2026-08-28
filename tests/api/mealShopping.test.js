const { pantryProjection, buildMealShoppingSuggestions } = require('../../utils/mealShopping');

describe('meal shopping Pantry projection', () => {
  it('suggests shopping when an exact-tracked meal reaches the low threshold', () => {
    expect(pantryProjection({
      trackingMode: 'exact',
      quantity: 3,
      lowStockThreshold: 1
    }, 2)).toMatchObject({
      pantryTrackingMode: 'exact',
      pantryQuantity: 3,
      projectedQuantity: 1,
      lowStockThreshold: 1,
      shoppingNeeded: true,
      shoppingReason: 'threshold'
    });
  });

  it('does not suggest shopping when exact Pantry remains above the threshold', () => {
    expect(pantryProjection({
      trackingMode: 'exact',
      quantity: 5,
      lowStockThreshold: 1
    }, 2)).toMatchObject({
      pantryQuantity: 5,
      projectedQuantity: 3,
      shoppingNeeded: false,
      shoppingReason: 'covered'
    });
  });

  it('uses the qualitative status for simple Pantry tracking', () => {
    expect(pantryProjection({ trackingMode: 'simple', stockStatus: 'have', quantity: 1 }, 8))
      .toMatchObject({ pantryTrackingMode: 'simple', shoppingNeeded: false, shoppingReason: 'covered' });
    expect(pantryProjection({ trackingMode: 'simple', stockStatus: 'low', quantity: 1 }, 1))
      .toMatchObject({ pantryTrackingMode: 'simple', shoppingNeeded: true, shoppingReason: 'low' });
    expect(pantryProjection({ trackingMode: 'simple', stockStatus: 'out', quantity: 0 }, 1))
      .toMatchObject({ pantryTrackingMode: 'simple', shoppingNeeded: true, shoppingReason: 'out' });
  });

  it('treats an item not tracked in Pantry as a shopping need', () => {
    expect(pantryProjection(null, 1)).toMatchObject({
      pantryTrackingMode: null,
      pantryStatus: 'not-tracked',
      shoppingNeeded: true,
      shoppingReason: 'not-tracked'
    });
  });

  it('projects the parsed meal quantity into matched catalog suggestions', () => {
    const item = {
      _id: '64b000000000000000000001',
      name: 'Black Beans',
      brand: '',
      category: 'Pantry',
      unit: 'can'
    };
    const result = buildMealShoppingSuggestions({
      notes: 'Black Beans x2',
      items: [item],
      inventoryItems: [{
        itemId: item._id,
        trackingMode: 'exact',
        quantity: 3,
        lowStockThreshold: 1,
        stockStatus: 'have'
      }]
    });

    expect(result.shoppingNeededCount).toBe(1);
    expect(result.suggestions[0]).toMatchObject({
      quantity: 2,
      matchStatus: 'matched',
      item: {
        _id: item._id,
        pantryQuantity: 3,
        projectedQuantity: 1,
        shoppingNeeded: true,
        shoppingReason: 'threshold'
      }
    });
  });
});
