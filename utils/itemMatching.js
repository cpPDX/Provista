const MAX_MATCH_ITEMS = 25;
const MAX_MATCH_INPUT_LENGTH = 2000;

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
  let text = String(fragment || '');
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

function cleanShoppingFragment(value) {
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

function parseShoppingText(input, options = {}) {
  if (typeof input !== 'string') return [];

  const maxLength = Number(options.maxLength) > 0
    ? Math.min(Number(options.maxLength), MAX_MATCH_INPUT_LENGTH)
    : MAX_MATCH_INPUT_LENGTH;
  const maxItems = Number(options.maxItems) > 0
    ? Math.min(Number(options.maxItems), MAX_MATCH_ITEMS)
    : MAX_MATCH_ITEMS;
  const limited = input.slice(0, maxLength);
  const byKey = new Map();

  for (const fragment of limited.split(/[\n,;]+/)) {
    const parsed = cleanShoppingFragment(fragment);
    if (!parsed) continue;
    const key = stemShoppingText(parsed.text);
    if (!key || key.length < 2) continue;

    const existing = byKey.get(key);
    if (existing) {
      existing.quantity = Math.max(existing.quantity, parsed.quantity);
      continue;
    }

    byKey.set(key, {
      sourceText: parsed.text,
      quantity: parsed.quantity,
      normalized: key
    });
    if (byKey.size >= maxItems) break;
  }

  return [...byKey.values()];
}

function scoreCatalogItem(query, item) {
  const queryRaw = normalizeShoppingText(query);
  const queryStem = stemShoppingText(query);
  const itemRaw = normalizeShoppingText(item?.name);
  const itemStem = stemShoppingText(item?.name);
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

function rankCatalogMatches(query, items, options = {}) {
  const sourceText = typeof query === 'string' ? query : query?.sourceText;
  const minScore = Number.isFinite(options.minScore) ? options.minScore : 74;
  const maxCandidates = Number.isFinite(options.maxCandidates) ? options.maxCandidates : 6;
  const usageByItemId = options.usageByItemId instanceof Map ? options.usageByItemId : new Map();

  return (Array.isArray(items) ? items : [])
    .map(item => ({
      item,
      score: scoreCatalogItem(sourceText, item),
      usage: usageByItemId.get(String(item?._id)) || 0
    }))
    .filter(candidate => candidate.score >= minScore)
    .sort((a, b) =>
      b.score - a.score ||
      b.usage - a.usage ||
      String(a.item?.name || '').localeCompare(String(b.item?.name || ''))
    )
    .slice(0, Math.max(1, maxCandidates));
}

function matchCatalogItem(query, items, options = {}) {
  const ranked = rankCatalogMatches(query, items, options);
  if (!ranked.length) {
    return {
      matchStatus: 'unmatched',
      confidenceScore: 0,
      confidenceGap: 0,
      item: null,
      candidates: []
    };
  }

  const first = ranked[0];
  const second = ranked[1];
  const exactMatches = ranked.filter(candidate => candidate.score === 120);
  const hasClearWinner = !second ||
    exactMatches.length === 1 ||
    first.score - second.score >= 12 ||
    (first.usage > 0 && first.usage > second.usage && first.score >= second.score);

  return {
    matchStatus: hasClearWinner ? 'matched' : 'ambiguous',
    confidenceScore: first.score,
    confidenceGap: second ? first.score - second.score : first.score,
    item: hasClearWinner ? first.item : null,
    candidates: ranked
  };
}

module.exports = {
  MAX_MATCH_INPUT_LENGTH,
  MAX_MATCH_ITEMS,
  cleanShoppingFragment,
  matchCatalogItem,
  normalizeShoppingText,
  parseQuantity,
  parseShoppingText,
  rankCatalogMatches,
  scoreCatalogItem,
  singularizeToken,
  stemShoppingText
};
