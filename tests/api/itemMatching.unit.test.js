const {
  matchCatalogItem,
  parseShoppingText,
  scoreCatalogItem
} = require('../../utils/itemMatching');

describe('shared grocery item parsing', () => {
  it('parses multiple ordinary groceries and quantities', () => {
    expect(parseShoppingText('milk, bananas, 2 cans black beans, cereal')).toEqual([
      expect.objectContaining({ sourceText: 'milk', quantity: 1, normalized: 'milk' }),
      expect.objectContaining({ sourceText: 'bananas', quantity: 1, normalized: 'banana' }),
      expect.objectContaining({ sourceText: 'black beans', quantity: 2, normalized: 'black bean' }),
      expect.objectContaining({ sourceText: 'cereal', quantity: 1, normalized: 'cereal' })
    ]);
  });

  it('handles list prefixes, instructions, and x-quantity suffixes', () => {
    expect(parseShoppingText('- Pick up apples x2\n• check pantry for olive oil')).toEqual([
      expect.objectContaining({ sourceText: 'apples', quantity: 2 }),
      expect.objectContaining({ sourceText: 'olive oil', quantity: 1 })
    ]);
  });
});

describe('shared grocery catalog matching', () => {
  const items = [
    { _id: '1', name: 'Corn Tortillas', brand: '', category: 'Bakery', unit: 'pack' },
    { _id: '2', name: 'Flour Tortillas (8-inch)', brand: '', category: 'Bakery', unit: 'pack' },
    { _id: '3', name: 'Salsa', brand: '', category: 'Sauces', unit: 'jar' }
  ];

  it('returns an explicit deterministic match outcome and confidence', () => {
    const parsed = parseShoppingText('salsa')[0];
    const result = matchCatalogItem(parsed, items);

    expect(scoreCatalogItem('salsa', items[2])).toBe(120);
    expect(result).toMatchObject({
      matchStatus: 'matched',
      confidenceScore: 120,
      item: { _id: '3', name: 'Salsa' }
    });
  });

  it('does not silently choose between equally plausible variants', () => {
    const parsed = parseShoppingText('tortillas')[0];
    const result = matchCatalogItem(parsed, items);

    expect(result.matchStatus).toBe('ambiguous');
    expect(result.item).toBeNull();
    expect(result.candidates).toHaveLength(2);
    expect(result.confidenceGap).toBe(0);
  });

  it('uses household usage only as a deterministic tie-breaker', () => {
    const parsed = parseShoppingText('tortillas')[0];
    const result = matchCatalogItem(parsed, items, {
      usageByItemId: new Map([['2', 4]])
    });

    expect(result).toMatchObject({
      matchStatus: 'matched',
      item: { _id: '2', name: 'Flour Tortillas (8-inch)' }
    });
  });

  it('returns unmatched rather than guessing below the score threshold', () => {
    const parsed = parseShoppingText('dish soap')[0];
    const result = matchCatalogItem(parsed, items);

    expect(result).toMatchObject({
      matchStatus: 'unmatched',
      confidenceScore: 0,
      item: null,
      candidates: []
    });
  });
});
