const { deriveQuantity } = require('../../utils/inventoryLedger');
const {
  localDateKey,
  mealSourceIdentity,
  resolveMealNeedsForReconciliation
} = require('../../utils/mealReconciliation');

describe('inventory ledger quantity derivation', () => {
  it('applies chronological deltas with fractional precision', () => {
    const quantity = deriveQuantity([
      { effectiveAt: '2026-09-01T12:00:00.000Z', recordedAt: '2026-09-01T12:01:00.000Z', quantityDelta: -0.25 },
      { effectiveAt: '2026-09-02T12:00:00.000Z', recordedAt: '2026-09-02T12:01:00.000Z', quantityDelta: -0.5 }
    ], 1);
    expect(quantity).toBe(0.25);
  });

  it('lets a newer-effective absolute count supersede an older meal recorded later', () => {
    const quantity = deriveQuantity([
      {
        effectiveAt: '2026-09-01T12:00:00.000Z',
        recordedAt: '2026-09-02T20:00:00.000Z',
        quantityDelta: -2
      },
      {
        effectiveAt: '2026-09-02T08:00:00.000Z',
        recordedAt: '2026-09-02T08:00:00.000Z',
        absoluteQuantity: 3
      }
    ], 4);
    expect(quantity).toBe(3);
  });

  it('applies a correction after the consumption it corrects', () => {
    const quantity = deriveQuantity([
      { effectiveAt: '2026-09-01T12:00:00.000Z', recordedAt: '2026-09-01T12:00:00.000Z', quantityDelta: -0.5 },
      { effectiveAt: '2026-09-01T13:00:00.000Z', recordedAt: '2026-09-01T13:00:00.000Z', quantityDelta: 0.25 }
    ], 1);
    expect(quantity).toBe(0.75);
  });
});

describe('meal reconciliation identity and boundaries', () => {
  it('uses household-local calendar dates at timezone boundaries', () => {
    const instant = new Date('2026-09-03T06:30:00.000Z');
    expect(localDateKey(instant, 'America/Los_Angeles')).toBe('2026-09-02');
    expect(localDateKey(instant, 'America/New_York')).toBe('2026-09-03');
  });

  it('keeps source identity stable for the same meal need', () => {
    const input = {
      householdId: 'household',
      planId: 'plan',
      meal: { dateKey: '2026-09-01', dayIndex: 1, mealIndex: 2 },
      itemId: 'chicken'
    };
    expect(mealSourceIdentity(input)).toBe(mealSourceIdentity(input));
    expect(mealSourceIdentity(input)).toContain('meal-consumption:v1:');
  });

  it('does not guess when a meal need is ambiguous', () => {
    const resolved = resolveMealNeedsForReconciliation({
      dateKey: '2026-09-01',
      dayIndex: 0,
      mealIndex: 0,
      mealName: 'Tacos',
      notes: 'Tortillas x2'
    }, [
      { _id: 'corn', name: 'Corn Tortillas', unit: 'pack' },
      { _id: 'flour', name: 'Flour Tortillas', unit: 'pack' }
    ]);

    expect(resolved.needs).toEqual([]);
    expect(resolved.unresolved).toEqual([
      expect.objectContaining({ sourceText: 'Tortillas', quantity: 2, matchStatus: 'ambiguous' })
    ]);
  });
});
