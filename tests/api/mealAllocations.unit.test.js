const { buildMealAllocationProjection, safeUnit } = require('../../utils/mealAllocations');

const items = [
  { _id: 'onion', name: 'White Onion', unit: 'each' },
  { _id: 'chicken', name: 'Chicken Breast', unit: 'each' },
  { _id: 'milk', name: 'Milk', unit: 'carton' }
];

function plan(days) {
  return {
    weekStart: '2026-01-05T00:00:00.000Z',
    days: days.map((meals, index) => ({
      date: `2026-01-${String(index + 5).padStart(2, '0')}T00:00:00.000Z`,
      meals
    }))
  };
}

function meal(name, notes, mealType = 'dinner') {
  return { mealType, name, notes };
}

describe('weekly meal allocation projection', () => {
  it('keeps fractional quantities exact across chronological meals', () => {
    const result = buildMealAllocationProjection({
      plan: plan([
        [meal('Soup', 'White Onion x0.25')],
        [meal('Salad', 'White Onion x0.5')]
      ]),
      items,
      inventoryItems: [{ itemId: 'onion', trackingMode: 'exact', quantity: 1 }]
    });

    expect(result.mealAllocations).toEqual([
      expect.objectContaining({
        mealName: 'Soup',
        quantity: 0.25,
        availableBefore: 1,
        projectedAfter: 0.75,
        shortageQuantity: 0,
        shoppingQuantity: 0
      }),
      expect.objectContaining({
        mealName: 'Salad',
        quantity: 0.5,
        availableBefore: 0.75,
        projectedAfter: 0.25,
        shortageQuantity: 0,
        shoppingQuantity: 0
      })
    ]);
    expect(result.itemSummaries[0]).toMatchObject({
      itemId: 'onion',
      onHandQuantity: 1,
      plannedQuantity: 0.75,
      projectedQuantity: 0.25,
      shortageQuantity: 0
    });
  });

  it('makes later meals compete against quantities allocated earlier', () => {
    const result = buildMealAllocationProjection({
      plan: plan([
        [meal('Monday dinner', 'Chicken Breast x2')],
        [],
        [meal('Wednesday dinner', 'Chicken Breast x3')]
      ]),
      items,
      inventoryItems: [{ itemId: 'chicken', trackingMode: 'exact', quantity: 4 }]
    });

    expect(result.mealAllocations[0]).toMatchObject({
      mealName: 'Monday dinner',
      availableBefore: 4,
      projectedAfter: 2,
      coverageStatus: 'covered'
    });
    expect(result.mealAllocations[1]).toMatchObject({
      mealName: 'Wednesday dinner',
      availableBefore: 2,
      projectedAfter: 0,
      shortageQuantity: 1,
      shoppingQuantity: 1,
      coverageStatus: 'shortage'
    });
    expect(result.itemSummaries[0]).toMatchObject({
      plannedQuantity: 5,
      projectedQuantity: 0,
      shortageQuantity: 1,
      shoppingQuantity: 1
    });
  });

  it('subtracts quantities already on the List from uncovered shortage demand', () => {
    const result = buildMealAllocationProjection({
      plan: plan([
        [meal('Monday dinner', 'Chicken Breast x2')],
        [],
        [meal('Wednesday dinner', 'Chicken Breast x3')]
      ]),
      items,
      inventoryItems: [{ itemId: 'chicken', trackingMode: 'exact', quantity: 4 }],
      listItems: [{ itemId: 'chicken', quantity: 1 }]
    });

    expect(result.mealAllocations[1]).toMatchObject({
      shortageQuantity: 1,
      shoppingQuantity: 0,
      coverageStatus: 'on-list'
    });
    expect(result.itemSummaries[0]).toMatchObject({
      shortageQuantity: 1,
      listQuantity: 1,
      shoppingQuantity: 0
    });
  });

  it('does not treat checked List history as future shopping coverage', () => {
    const result = buildMealAllocationProjection({
      plan: plan([[meal('Dinner', 'Chicken Breast x5')]]),
      items,
      inventoryItems: [{ itemId: 'chicken', quantity: 1, checked: true }]
    });

    expect(result.itemSummaries[0]).toMatchObject({
      shortageQuantity: 4,
      listQuantity: 0,
      shoppingQuantity: 4
    });
  });

  it('recalculates from source data when a meal is edited or removed', () => {
    const inventoryItems = [{ itemId: 'chicken', trackingMode: 'exact', quantity: 4 }];
    const original = buildMealAllocationProjection({
      plan: plan([[meal('First', 'Chicken Breast x2')], [meal('Second', 'Chicken Breast x3')]]),
      items,
      inventoryItems
    });
    const edited = buildMealAllocationProjection({
      plan: plan([[meal('First', 'Chicken Breast x2')], [meal('Second', 'Chicken Breast x1')]]),
      items,
      inventoryItems
    });
    const removed = buildMealAllocationProjection({
      plan: plan([[meal('First', 'Chicken Breast x2')], []]),
      items,
      inventoryItems
    });

    expect(original.itemSummaries[0]).toMatchObject({ plannedQuantity: 5, shortageQuantity: 1 });
    expect(edited.itemSummaries[0]).toMatchObject({ plannedQuantity: 3, projectedQuantity: 1, shortageQuantity: 0 });
    expect(removed.itemSummaries[0]).toMatchObject({ plannedQuantity: 2, projectedQuantity: 2, shortageQuantity: 0 });
    expect(inventoryItems[0].quantity).toBe(4);
  });

  it('keeps simple Pantry tracking qualitative instead of inventing projected counts', () => {
    const have = buildMealAllocationProjection({
      plan: plan([[meal('Breakfast', 'Milk x2', 'breakfast')]]),
      items,
      inventoryItems: [{ itemId: 'milk', trackingMode: 'simple', quantity: 1, stockStatus: 'have' }]
    });
    const low = buildMealAllocationProjection({
      plan: plan([[meal('Breakfast', 'Milk x2', 'breakfast')]]),
      items,
      inventoryItems: [{ itemId: 'milk', trackingMode: 'simple', quantity: 1, stockStatus: 'low' }],
      listItems: [{ itemId: 'milk', quantity: 1 }]
    });

    expect(have.mealAllocations[0]).toMatchObject({
      projectedAfter: null,
      shortageQuantity: null,
      shoppingQuantity: 0,
      coverageStatus: 'qualitative-have'
    });
    expect(low.mealAllocations[0]).toMatchObject({
      projectedAfter: null,
      shortageQuantity: null,
      shoppingQuantity: 1,
      coverageStatus: 'qualitative-low'
    });
  });

  it('reports ambiguous needs without allocating them to a guessed item', () => {
    const result = buildMealAllocationProjection({
      plan: plan([[meal('Tacos', 'Tortillas x2')]]),
      items: [
        { _id: 'corn', name: 'Corn Tortillas', unit: 'pack' },
        { _id: 'flour', name: 'Flour Tortillas', unit: 'pack' }
      ],
      inventoryItems: []
    });

    expect(result.mealAllocations).toEqual([]);
    expect(result.unresolvedNeeds).toEqual([
      expect.objectContaining({ sourceText: 'Tortillas', quantity: 2, matchStatus: 'ambiguous' })
    ]);
  });

  it('never exposes numeric-only stored values as display units', () => {
    expect(safeUnit('1')).toBe('');
    expect(safeUnit('2.5')).toBe('');
    expect(safeUnit('each')).toBe('each');

    const result = buildMealAllocationProjection({
      plan: plan([[meal('Dinner', 'Chicken Breast')]]),
      items: [{ _id: 'chicken', name: 'Chicken Breast', unit: '1' }],
      inventoryItems: [{ itemId: 'chicken', trackingMode: 'exact', quantity: 0, unit: '1' }]
    });

    expect(result.itemSummaries[0]).toMatchObject({ unit: '', shoppingQuantity: 1 });
    expect(result.mealAllocations[0]).toMatchObject({ unit: '', quantity: 1 });
  });
});
