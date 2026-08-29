const {
  MAX_MATCH_INPUT_LENGTH,
  MAX_MATCH_ITEMS,
  matchCatalogItem,
  normalizeShoppingText,
  parseShoppingText,
  scoreCatalogItem
} = require('./itemMatching');

const MAX_SUGGESTIONS = MAX_MATCH_ITEMS;
const MAX_NOTES_LENGTH = MAX_MATCH_INPUT_LENGTH;

function parseMealShoppingNotes(notes) {
  return parseShoppingText(notes, {
    maxItems: MAX_SUGGESTIONS,
    maxLength: MAX_NOTES_LENGTH
  });
}

function effectiveTrackingMode(inventory) {
  if (!inventory) return null;
  if (inventory.trackingMode === 'exact' || inventory.lowStockThreshold != null) return 'exact';
  return 'simple';
}

function pantryProjection(inventory, requestedQuantity) {
  const requested = Number(requestedQuantity) || 1;
  if (!inventory) {
    return {
      pantryTrackingMode: null,
      pantryStatus: 'not-tracked',
      pantryQuantity: 0,
      projectedQuantity: null,
      lowStockThreshold: null,
      shoppingNeeded: true,
      shoppingReason: 'not-tracked'
    };
  }

  const mode = effectiveTrackingMode(inventory);
  const quantity = Math.max(0, Number(inventory.quantity) || 0);

  if (mode === 'simple') {
    const status = ['have', 'low', 'out'].includes(inventory.stockStatus)
      ? inventory.stockStatus
      : (quantity <= 0 ? 'out' : 'have');
    return {
      pantryTrackingMode: 'simple',
      pantryStatus: status,
      pantryQuantity: quantity,
      projectedQuantity: null,
      lowStockThreshold: null,
      shoppingNeeded: status !== 'have',
      shoppingReason: status === 'have' ? 'covered' : status
    };
  }

  const threshold = inventory.lowStockThreshold == null
    ? null
    : Number(inventory.lowStockThreshold);
  const projectedRaw = quantity - requested;
  const projectedQuantity = Math.max(0, projectedRaw);
  const runsOut = projectedRaw <= 0;
  const crossesThreshold = Number.isFinite(threshold) && projectedRaw <= threshold;
  const currentLow = Number.isFinite(threshold) && quantity <= threshold;

  return {
    pantryTrackingMode: 'exact',
    pantryStatus: quantity <= 0 ? 'out' : (currentLow ? 'low' : 'have'),
    pantryQuantity: quantity,
    projectedQuantity,
    lowStockThreshold: Number.isFinite(threshold) ? threshold : null,
    shoppingNeeded: runsOut || crossesThreshold,
    shoppingReason: runsOut ? 'runs-out' : (crossesThreshold ? 'threshold' : 'covered')
  };
}

function publicItem(item, context, requestedQuantity) {
  const id = String(item._id);
  return {
    _id: id,
    name: item.name,
    brand: item.brand || '',
    category: item.category,
    unit: item.unit,
    onList: context.onListIds.has(id),
    ...pantryProjection(context.inventoryByItemId.get(id), requestedQuantity)
  };
}

function chooseCatalogMatch(parsed, items, context) {
  const match = matchCatalogItem(parsed, items, {
    usageByItemId: context.usageByItemId
  });
  const candidates = match.candidates.map(candidate =>
    publicItem(candidate.item, context, parsed.quantity)
  );

  return {
    matchStatus: match.matchStatus,
    confidenceScore: match.confidenceScore,
    confidenceGap: match.confidenceGap,
    item: match.matchStatus === 'matched' ? candidates[0] : null,
    candidates
  };
}

function buildMealShoppingSuggestions({ notes, items, listItems = [], inventoryItems = [], usageByItemId = new Map() }) {
  const parsedItems = parseMealShoppingNotes(notes);
  const onListIds = new Set(listItems.map(entry => String(entry.itemId?._id || entry.itemId)));
  const inventoryByItemId = new Map(inventoryItems.map(entry => [
    String(entry.itemId?._id || entry.itemId),
    entry
  ]));
  const context = { onListIds, inventoryByItemId, usageByItemId };
  const resolvedIds = new Set();

  const suggestions = parsedItems.map(parsed => {
    const match = chooseCatalogMatch(parsed, items, context);
    const duplicateInNotes = Boolean(match.item && resolvedIds.has(match.item._id));
    if (match.item) resolvedIds.add(match.item._id);
    return { ...parsed, ...match, duplicateInNotes };
  });

  return {
    parsedCount: parsedItems.length,
    matchedCount: suggestions.filter(suggestion => suggestion.matchStatus === 'matched').length,
    ambiguousCount: suggestions.filter(suggestion => suggestion.matchStatus === 'ambiguous').length,
    unmatchedCount: suggestions.filter(suggestion => suggestion.matchStatus === 'unmatched').length,
    shoppingNeededCount: suggestions.filter(suggestion =>
      suggestion.matchStatus === 'matched' && suggestion.item?.shoppingNeeded && !suggestion.item?.onList
    ).length,
    suggestions
  };
}

module.exports = {
  MAX_NOTES_LENGTH,
  MAX_SUGGESTIONS,
  buildMealShoppingSuggestions,
  normalizeShoppingText,
  parseMealShoppingNotes,
  pantryProjection,
  scoreCatalogItem
};
