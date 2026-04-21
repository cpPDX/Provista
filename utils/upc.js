/**
 * Normalizes a raw barcode string to a canonical 12-digit UPC-A string.
 * Returns null for unrecognized or invalid input.
 *
 * Handles:
 *   - UPC-A (12 digits) → returned as-is
 *   - EAN-13 starting with 0 (13 digits) → strip leading zero → UPC-A
 *   - UPC-E (8 digits) → expand to UPC-A using standard algorithm
 */
function normalizeUpc(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const digits = raw.replace(/\D/g, '');

  if (digits.length === 12) return digits;

  if (digits.length === 13 && digits[0] === '0') return digits.slice(1);

  if (digits.length === 8) return expandUpce(digits);

  return null;
}

// Standard UPC-E to UPC-A expansion
function expandUpce(e) {
  // e is 8 digits: number system (0), 6 data digits, check digit
  const ns = e[0];
  const check = e[7];
  const d = e.slice(1, 7); // 6 middle digits

  let upca;
  const lastDigit = d[5];

  if (lastDigit === '0' || lastDigit === '1' || lastDigit === '2') {
    upca = `${ns}${d[0]}${d[1]}${lastDigit}0000${d[2]}${d[3]}${d[4]}`;
  } else if (lastDigit === '3') {
    upca = `${ns}${d[0]}${d[1]}${d[2]}00000${d[3]}${d[4]}`;
  } else if (lastDigit === '4') {
    upca = `${ns}${d[0]}${d[1]}${d[2]}${d[3]}00000${d[4]}`;
  } else {
    upca = `${ns}${d[0]}${d[1]}${d[2]}${d[3]}${d[4]}0000${lastDigit}`;
  }

  return upca + check;
}

module.exports = { normalizeUpc };
