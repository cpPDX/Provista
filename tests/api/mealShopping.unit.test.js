const {
  buildMealShoppingSuggestions,
  parseMealShoppingNotes,
  scoreCatalogItem
} = require('../../utils/mealShopping');

describe('meal shopping note parsing', () => {
  it('parses comma-separated needs, quantities, and duplicate phrases', () => {
    expect(parseMealShoppingNotes('Need tortillas, lettuce, and salsa x2; salsa')).toEqual([
      expect.objectContaining({ sourceText: 'tortillas', quantity: 1, normalized: 'tortilla' }),
      expect.objectContaining({ sourceText: 'lettuce', quantity: 1, normalized: 'lettuce' }),
      expect.objectContaining({ sourceText: 'salsa', quantity: 2, normalized: 'salsa' })
    ]);
  });

  it('understands common list prefixes and measurement words', () => {
    expect(parseMealShoppingNotes('- Pick up 2 bags of apples\n• check pantry for olive oil')).toEqual([
      expect.objectContaining({ sourceText: 'apples', quantity: 2 }),
      expect.objectContaining({ sourceText: 'olive oil', quantity: 1 })
    ]);
  });
});

describe('meal shopping catalog matching', () => {
  const items = [
    { _id: '1', name: 'Corn Tortillas', category: 'Bakery', unit: 'pack' },
    { _id: '2', name: 'Flour Tortillas (8-inch)', category: 'Bakery', unit: 'pack' },
    { _id: '3', name: 'Salsa', category: 'Sauces', unit: 'jar' }
  ];

  it('uses exact normalized matches without guessing among ambiguous variants', () => {
    expect(scoreCatalogItem('salsa', items[2])).toBe(120);
    const preview = buildMealShoppingSuggestions({ notes: 'tortillas, salsa', items });
    expect(preview.suggestions[0]).toMatchObject({ matchStatus: 'ambiguous', item: null });
    expect(preview.suggestions[0].candidates).toHaveLength(2);
    expect(preview.suggestions[1]).toMatchObject({ matchStatus: 'matched', item: { _id: '3', name: 'Salsa' } });
  });

  it('uses household history to resolve a repeated ambiguous item', () => {
    const preview = buildMealShoppingSuggestions({
      notes: 'tortillas',
      items,
      usageByItemId: new Map([['2', 4]])
    });
    expect(preview.suggestions[0]).toMatchObject({
      matchStatus: 'matched',
      item: { _id: '2', name: 'Flour Tortillas (8-inch)' }
    });
  });

  it('flags List and Pantry context on a resolved match', () => {
    const preview = buildMealShoppingSuggestions({
      notes: 'salsa',
      items,
      listItems: [{ itemId: '3' }],
      inventoryItems: [{ itemId: '3', quantity: 2 }]
    });
    expect(preview.suggestions[0].item).toMatchObject({ onList: true, pantryQuantity: 2 });
  });
});
