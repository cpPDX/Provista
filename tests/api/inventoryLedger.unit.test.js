const mongoose = require('mongoose');
const {
  deriveQuantity,
  roundQuantity
} = require('../../utils/inventoryLedger');
const {
  localDateKey,
  mealSourceIdentity,
  resolveMealNeedsForReconciliation
} = require('../../utils/mealReconciliation');

function id() {
  return new mongoose.Types.ObjectId();
}

describe('inventory ledger derivation', () => {
  it('applies fractional deltas chronologically', () => {
    const events = [
      { _id: '2', effectiveAt: new Date('2026-09-02T12:00:00Z'), recordedAt: new Date('2026-09-02T13:00:00Z'), quantityDelta: -0.5 },
      { _id: '1', effectiveAt: new Date('2026-09-01T12:00:00Z'), recordedAt: new Date('2026-09-01T13:00:00Z'), absoluteQuantity: 1.25 },
      { _id: '3', effectiveAt: new Date('2026-09-03T12:00:00Z'), recordedAt: new Date('2026-09-03T13:00:00Z'), quantityDelta: -0.5 }
    ];
    expect(deriveQuantity(events)).toBe(0.25);
  });

  it('keeps a newer absolute count authoritative when an older-effective meal event is recorded later', () => {
    const events = [
      { _id: 'baseline', effectiveAt: new Date('2026-09-01T08:00:00Z'), recordedAt: new Date('2026-09-01T08:00:00Z'), absoluteQuantity: 4 },
      { _id: 'meal', effectiveAt: new Date('2026-09-01T18:00:00Z'), recordedAt: new Date('2026-09-03T12:00:00Z'), quantityDelta: -2 },
      { _id: 'count', effectiveAt: new Date('2026-09-02T18:00:00Z'), recordedAt: new Date('2026-09-02T18:00:00Z'), absoluteQuantity: 3 }
    ];
    expect(deriveQuantity(events)).toBe(3);
  });

  it('composes shopping replenishment and meal consumption', () => {
    const events = [
      { _id: 'baseline', effectiveAt: new Date('2026-09-01T08:00:00Z'), recordedAt: new Date('2026-09-01T08:00:00Z'), absoluteQuantity: 1 },
      { _id: 'shop', effectiveAt: new Date('2026-09-01T10:00:00Z'), recordedAt: new Date('2026-09-01T10:00:00Z'), quantityDelta: 4 },
      { _id: 'meal', effectiveAt: new Date('2026-09-02T12:00:00Z'), recordedAt: new Date('2026-09-03T09:00:00Z'), quantityDelta: -2 }
    ];
    expect(deriveQuantity(events)).toBe(3);
  });

  it('treats zero-delta simple usage signals as non-mutating history', () => {
    const events = [
      { _id: 'baseline', effectiveAt: new Date('2026-09-01T08:00:00Z'), recordedAt: new Date('2026-09-01T08:00:00Z'), absoluteQuantity: 1 },
      { _id: 'usage', effectiveAt: new Date('2026-09-02T12:00:00Z'), recordedAt: new Date('2026-09-03T09:00:00Z'), quantityDelta: 0 }
    ];
    expect(deriveQuantity(events)).toBe(1);
  });

  it('applies corrections as appended deltas', () => {
    const events = [
      { _id: 'baseline', effectiveAt: new Date('2026-09-01T08:00:00Z'), recordedAt: new Date('2026-09-01T08:00:00Z'), absoluteQuantity: 4 },
      { _id: 'meal', effectiveAt: new Date('2026-09-01T18:00:00Z'), recordedAt: new Date('2026-09-02T08:00:00Z'), quantityDelta: -2 },
      { _id: 'correction', effectiveAt: new Date('2026-09-01T18:00:00Z'), recordedAt: new Date('2026-09-02T09:00:00Z'), quantityDelta: 1 }
    ];
    expect(deriveQuantity(events)).toBe(3);
  });
});

describe('meal reconciliation identity and matching', () => {
  it('uses household-local dates at timezone boundaries', () => {
    const now = new Date('2026-09-03T06:30:00.000Z');
    expect(localDateKey(now, 'America/Los_Angeles')).toBe('2026-09-02');
    expect(localDateKey(now, 'America/New_York')).toBe('2026-09-03');
  });

  it('creates a stable versioned source identity', () => {
    const source = mealSourceIdentity({
      householdId: 'household',
      planId: 'plan',
      meal: { dateKey: '2026-09-01', dayIndex: 1, mealIndex: 2 },
      itemId: 'item'
    });
    expect(source).toBe('meal-consumption:v1:household:plan:2026-09-01:1:2:item');
  });

  it('keeps ambiguous catalog needs unresolved instead of guessing', () => {
    const items = [
      { _id: id(), name: 'Corn Tortillas', category: 'Pantry', unit: 'each' },
      { _id: id(), name: 'Flour Tortillas', category: 'Pantry', unit: 'each' }
    ];
    const meal = {
      dateKey: '2026-09-01',
      dayIndex: 0,
      mealIndex: 2,
      mealName: 'Tacos',
      notes: '2 tortillas'
    };
    const resolved = resolveMealNeedsForReconciliation(meal, items, new Map());
    expect(resolved.needs).toHaveLength(0);
    expect(resolved.unresolved).toHaveLength(1);
  });

  it('rounds repeated fractional needs deterministically', () => {
    expect(roundQuantity(0.1 + 0.2)).toBe(0.3);
  });
});