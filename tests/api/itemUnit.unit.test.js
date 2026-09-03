const { normalizeUnit } = require('../../models/Item');

describe('catalog unit normalization', () => {
  it('keeps meaningful units and replaces numeric quantity tokens', () => {
    expect(normalizeUnit('each')).toBe('each');
    expect(normalizeUnit(' lb ')).toBe('lb');
    expect(normalizeUnit('1')).toBe('each');
    expect(normalizeUnit('2.5')).toBe('each');
    expect(normalizeUnit('')).toBe('each');
  });
});
