const MAX_SUGGESTIONS = 25;
const MAX_NOTES_LENGTH = 2000;

const LEADING_INSTRUCTIONS = /^(?:(?:please|we)\s+)?(?:need(?:\s+to\s+(?:buy|get))?|buy|get|grab|pick\s*up|add|restock|check\s+(?:the\s+)?pantry\s+for)\s+/i;
const LEADING_MEASURE = /^(?:bags?|bottles?|boxes?|bunch(?:es)?|cans?|cartons?|dozen|heads?|jars?|loaves?|packs?|packages?|pounds?|lbs?|ounces?|oz)\s+(?:of\s+)?/i;

function normalizeShoppingText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function singularizeToken(token) {
  if (token.length <= 3 || token.endsWith('ss')) return token;
  if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`;
  if (/(?:ches|shes|xes|zes)$/.test(token)) return token.slice(0, -2);
  if (token.endsWith('oes') && token.length > 4) return token.slice(0, -2);
  if (token.endsWith('s')) return token.slice(0, -1);
  return token;
}

function stemShoppingText(value) {
  return normalizeShoppingText(value)
    .split(' ')
    .filter(Boolean)
    .map(singularizeToken)
    .join(' ');
}

function parseQuantity(fragment) {
  let text = fragment;
  let quantity = 1;
  let match = text.match(/\s+(?:x|×)\s*(\d+(?:\.\d+)?)\s*$/i);
  if (match) {
    quantity = Number(match[1]);
    text = text.slice(0, match.index);
  } else {
    match = text.match(/^(\d+(?:\.\d+)?)\s*(?:x|×)\s+(.+)$/i);
    if (match) {
      quantity = Number(match[1]);
      text = match[2];
    } else {
      match = text.match(/^(\d+(?:\.\d+)?)\s+(?!%)(.+)$/);
      if (match) {
        quantity = Number(match[1]);
        text = match[2];
      }
    }
  }

  if (!Number.isFinite(quantity) || quantity <= 0) quantity = 1;
  return { text, quantity: Math.min(quantity, 99) };
}

function cleanFragment(value) {
  let text = String(value || '')
    .replace(/^\s*(?:[-*•]+|\d+[.)])\s*/, '')
    .replace(/^\s*(?:and|&)\s+/i, '')
    .trim();
  text = text.replace(LEADING_INSTRUCTIONS, '').trim();
  const parsed = parseQuantity(text);
  text = parsed.text
    .replace(/^(?:a|an|some)\s+/i, '')
    .replace(LEADING_MEASURE, '')
    .replace(/[.!?]+$/g, '')
    .trim();
  if (!text || text.length > 120) return null;
  return { text, quantity: parsed.quantity };
}

function parseMealShoppingNotes(notes) {
  if (typeof notes !== 'string') return [];
  const limited = notes.slice(0, MAX_NOTES_LENGTH);
  const byKey = new Map();

  for (const fragment of limited.split(/[\n,;]+/)) {
    const parsed = cleanFragment(fragment);
    if (!parsed) continue;
    const key = stemShoppingText(parsed.text);
    if (!key || key.length < 2) continue;
    const existing = byKey.get(key);
    if (existing) {
      existing.quantity = Math.max(existing.quantity, parsed.quantity);
      continue;
    }
    byKey.set(key, { sourceText: parsed.text, quantity: parsed.quantity, normalized: key });
    if (byKey.size >= MAX_SUGGESTIONS) break;
  }

  return [...byKey.values()];
}

function scoreCatalogItem(query, item) {
  const queryRaw = normalizeShoppingText(query);
  const queryStem = stemShoppingText(query);
  const itemRaw = normalizeShoppingText(item.name);
  const itemStem = stemShoppingText(item.name);
  if (!queryStem || !itemStem) return 0;
  if (queryRaw === itemRaw || queryStem === itemStem) return 120;

  const queryTokens = queryStem.split(' ');
  const itemTokens = itemStem.split(' ');
  const querySet = new Set(queryTokens);
  const itemSet = new Set(itemTokens);
  const queryInsideItem = queryTokens.every(token => itemSet.has(token));
  const itemInsideQuery = itemTokens.every(token => querySet.has(token));
  if (queryInsideItem) return 92 - Math.min(12, (itemTokens.length - queryTokens.length) * 3);
  if (itemInsideQuery) return 88 - Math.min(12, (queryTokens.length - itemTokens.length) * 3);

  const overlap = queryTokens.filter(token => itemSet.has(token)).length;
  const coverage = overlap / Math.max(queryTokens.length, itemTokens.length);
  return coverage >= 0.66 ? Math.round(70 + coverage * 10) : 0;
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
  const ranked = items
    .map(item => ({
      item,
      score: scoreCatalogItem(parsed.sourceText, item),
      usage: context.usageByItemId.get(String(item._id)) || 0
    }))
    .filter(candidate => candidate.score >= 74)
    .sort((a, b) => b.score - a.score || b.usage - a.usage || a.item.name.localeCompare(b.item.name))
    .slice(0, 6);

  if (!ranked.length) return { matchStatus: 'unmatched', item: null, candidates: [] };

  const first = ranked[0];
  const second = ranked[1];
  const exactMatches = ranked.filter(candidate => candidate.score === 120);
  const hasClearWinner = !second ||
    exactMatches.length === 1 ||
    first.score - second.score >= 12 ||
    (first.usage > 0 && first.usage > second.usage && first.score >= second.score);
  const candidates = ranked.map(candidate => publicItem(candidate.item, context, parsed.quantity));

  return {
    matchStatus: hasClearWinner ? 'matched' : 'ambiguous',
    item: hasClearWinner ? candidates[0] : null,
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
