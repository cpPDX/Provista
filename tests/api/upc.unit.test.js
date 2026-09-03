const { normalizeUpc } = require('../../utils/upc');

describe('UPC/EAN normalization', () => {
  it('preserves UPC-A', () => {
    expect(normalizeUpc('012345678905')).toBe('012345678905');
  });

  it('canonicalizes a zero-prefixed EAN-13 to the equivalent UPC-A', () => {
    expect(normalizeUpc('0012345678905')).toBe('012345678905');
  });

  it('preserves a genuine EAN-13 identifier', () => {
    expect(normalizeUpc('4006381333931')).toBe('4006381333931');
    expect(normalizeUpc('9780201379624')).toBe('9780201379624');
  });

  it('normalizes formatting characters before classifying the identifier', () => {
    expect(normalizeUpc('4006 3813-33931')).toBe('4006381333931');
  });

  it('rejects unsupported barcode lengths', () => {
    expect(normalizeUpc('1234567')).toBeNull();
    expect(normalizeUpc('12345678901234')).toBeNull();
  });
});
