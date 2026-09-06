export const CSV_PRICE_COLUMNS = [
  'item_name',
  'brand',
  'category',
  'unit',
  'size',
  'store_name',
  'final_price',
  'is_sale',
  'quantity',
  'date',
  'notes',
  'is_organic'
] as const;

export interface CsvPriceRow {
  _rowNum: number;
  item_name: string;
  brand: string;
  category: string;
  unit: string;
  size: string;
  store_name: string;
  final_price: string;
  is_sale: string;
  quantity: string;
  date: string;
  notes: string;
  is_organic: string;
}

const CATEGORY_NORMALIZE: Record<string, string> = {
  dry: 'Pantry',
  'dry goods': 'Pantry',
  'dried goods': 'Pantry',
  'pantry dry': 'Pantry',
  'shelf stable': 'Pantry',
  canned: 'Pantry',
  'canned goods': 'Pantry'
};

function localDateValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseLine(line: string) {
  const fields: string[] = [];
  let current = '';
  let inQuote = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (inQuote) {
      if (character === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else if (character === '"') {
        inQuote = false;
      } else {
        current += character;
      }
    } else if (character === '"') {
      inQuote = true;
    } else if (character === ',') {
      fields.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }

  fields.push(current.trim());
  return fields;
}

export function parseCsvPrices(text: string): CsvPriceRow[] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  if (lines.length < 2) return [];

  const headers = parseLine(lines[0]).map(header => header.toLowerCase().replace(/\s+/g, '_'));
  return lines.slice(1).flatMap((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return [];
    const fields = parseLine(line);
    const values = new Map<string, string>();
    headers.forEach((header, fieldIndex) => values.set(header, fields[fieldIndex] || ''));

    return [{
      _rowNum: index + 2,
      item_name: values.get('item_name') || '',
      brand: values.get('brand') || '',
      category: values.get('category') || '',
      unit: values.get('unit') || '',
      size: values.get('size') || '',
      store_name: values.get('store_name') || '',
      final_price: values.get('final_price') || '',
      is_sale: values.get('is_sale') || '',
      quantity: values.get('quantity') || '',
      date: values.get('date') || '',
      notes: values.get('notes') || '',
      is_organic: values.get('is_organic') || ''
    }];
  });
}

export function normalizeCsvCategory(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  return CATEGORY_NORMALIZE[trimmed.toLowerCase()] || trimmed;
}

export function parseCsvBoolean(raw: string) {
  return ['true', '1', 'yes'].includes(raw.trim().toLowerCase());
}

export function normalizeCsvDate(raw: string) {
  const value = raw.trim();
  if (!value) return localDateValue();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(value)) {
    const [month, day, year] = value.split('/');
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return localDateValue();
}

export function levenshteinDistance(a: string, b: string) {
  const rows = a.length + 1;
  const columns = b.length + 1;
  const matrix = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: columns }, (_, column) => row === 0 ? column : column === 0 ? row : 0)
  );

  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      matrix[row][column] = a[row - 1] === b[column - 1]
        ? matrix[row - 1][column - 1]
        : 1 + Math.min(
          matrix[row - 1][column],
          matrix[row][column - 1],
          matrix[row - 1][column - 1]
        );
    }
  }

  return matrix[a.length][b.length];
}

function quoteCsvField(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildCsvPriceTemplate() {
  const today = localDateValue();
  const rows = [
    ['Whole Milk', 'Kirkland', 'Dairy', 'gal', '', 'Costco', '4.99', 'false', '1', today, '', 'false'],
    ['Avocado', '', 'Produce', 'each', '', 'Trader Joes', '1.77', 'true', '3', today, '3 for $1.77 sale', 'false'],
    ['Black Beans', "Bush's Best", 'Pantry', 'oz', '28', 'Fred Meyer', '1.89', 'false', '1', today, '', 'false']
  ];
  return [CSV_PRICE_COLUMNS, ...rows].map(row => row.map(value => quoteCsvField(String(value))).join(',')).join('\n');
}
