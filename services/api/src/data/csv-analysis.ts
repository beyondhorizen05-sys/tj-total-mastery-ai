export const CSV_LIMITS = { maxBytes: 1024 * 1024, maxRows: 10_000, maxColumns: 100, maxFieldLength: 16_384 } as const;

export class CsvAnalysisError extends Error {
  constructor(message: string, public readonly statusCode = 400) { super(message); }
}

export type NumericStats = { count: number; sum: number; min: number; max: number; mean: number; median: number; standard_deviation: number };
export type ColumnAnalysis = {
  name: string;
  kind: 'number' | 'date' | 'text' | 'empty';
  nonempty_count: number;
  missing_count: number;
  unique_count: number;
  numeric?: NumericStats;
  top_values?: { value: string; count: number }[];
};
export type DataChart =
  | { kind: 'bar' | 'histogram'; title: string; x_label: string; y_label: string; points: { label: string; value: number }[] }
  | { kind: 'scatter'; title: string; x_label: string; y_label: string; points: { x: number; y: number }[] };
export type CsvAnalysis = {
  filename: string;
  row_count: number;
  column_count: number;
  columns: ColumnAnalysis[];
  preview: Record<string, string>[];
  charts: DataChart[];
  warnings: string[];
};

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function parseCsv(csv: string): string[][] {
  if (Buffer.byteLength(csv, 'utf8') > CSV_LIMITS.maxBytes) throw new CsvAnalysisError('CSV exceeds the 1 MB upload limit.', 413);
  if (csv.includes('\0')) throw new CsvAnalysisError('CSV contains a null byte. Upload a UTF-8 text file.');
  const text = csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let afterQuote = false;
  let fieldStarted = false;
  const pushField = () => {
    row.push(field);
    if (row.length > CSV_LIMITS.maxColumns) throw new CsvAnalysisError('CSV has more than 100 columns.');
    field = ''; afterQuote = false; fieldStarted = false;
  };
  const pushRow = () => {
    const explicitEmptyField = fieldStarted || afterQuote;
    pushField();
    if (row.length > 1 || row[0] !== '' || explicitEmptyField) rows.push(row);
    if (rows.length > CSV_LIMITS.maxRows + 1) throw new CsvAnalysisError('CSV has more than 10,000 data rows.', 413);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') { quoted = false; afterQuote = true; }
      else field += ch;
    } else if (afterQuote) {
      if (ch === ',') pushField();
      else if (ch === '\n' || ch === '\r') { pushRow(); if (ch === '\r' && text[i + 1] === '\n') i++; }
      else throw new CsvAnalysisError(`Unexpected text after a closing quote near row ${rows.length + 1}.`);
    } else if (ch === '"') {
      if (fieldStarted) throw new CsvAnalysisError(`Unexpected quote near row ${rows.length + 1}.`);
      quoted = true; fieldStarted = true;
    } else if (ch === ',') pushField();
    else if (ch === '\n' || ch === '\r') { pushRow(); if (ch === '\r' && text[i + 1] === '\n') i++; }
    else { field += ch; fieldStarted = true; }
    if (field.length > CSV_LIMITS.maxFieldLength) throw new CsvAnalysisError('A CSV field exceeds 16,384 characters.', 413);
  }
  if (quoted) throw new CsvAnalysisError('CSV has an unclosed quoted field.');
  if (fieldStarted || afterQuote || row.length) pushRow();
  if (!rows.length) throw new CsvAnalysisError('CSV is empty.');
  return rows;
}

function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function histogram(values: number[], name: string): DataChart {
  const min = Math.min(...values), max = Math.max(...values);
  if (min === max) return { kind: 'histogram', title: `${name} distribution`, x_label: name, y_label: 'Rows', points: [{ label: String(min), value: values.length }] };
  const bins = Math.min(10, Math.max(4, Math.ceil(Math.sqrt(values.length))));
  const counts = Array.from({ length: bins }, () => 0);
  for (const value of values) counts[Math.min(bins - 1, Math.floor((value - min) / (max - min) * bins))]++;
  const points = counts.map((count, index) => {
    const low = min + (max - min) * index / bins;
    const high = min + (max - min) * (index + 1) / bins;
    return { label: `${Number(low.toPrecision(4))}–${Number(high.toPrecision(4))}`, value: count };
  });
  return { kind: 'histogram', title: `${name} distribution`, x_label: name, y_label: 'Rows', points };
}

export function analyzeCsv(csv: string, filename = 'uploaded.csv'): CsvAnalysis {
  const rows = parseCsv(csv);
  const headers = rows.shift()!.map((header) => header.trim());
  if (headers.some((header) => !header)) throw new CsvAnalysisError('Every CSV column needs a nonempty header.');
  if (new Set(headers.map((header) => header.toLowerCase())).size !== headers.length) throw new CsvAnalysisError('CSV headers must be unique.');
  if (!rows.length) throw new CsvAnalysisError('CSV has headers but no data rows.');
  rows.forEach((row, index) => {
    if (row.length !== headers.length) throw new CsvAnalysisError(`CSV row ${index + 2} has ${row.length} fields; expected ${headers.length}.`);
  });

  const columns: ColumnAnalysis[] = headers.map((name, index) => {
    const cells = rows.map((row) => row[index].trim());
    const nonempty = cells.filter(Boolean);
    const unique = new Set(nonempty);
    const base = { name, nonempty_count: nonempty.length, missing_count: cells.length - nonempty.length, unique_count: unique.size };
    if (!nonempty.length) return { ...base, kind: 'empty' };
    if (nonempty.every((value) => NUMBER.test(value) && Number.isFinite(Number(value)))) {
      const values = nonempty.map(Number);
      const sorted = [...values].sort((a, b) => a - b);
      const sum = values.reduce((a, b) => a + b, 0);
      const mean = sum / values.length;
      const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
      if (![sum, mean, variance].every(Number.isFinite)) throw new CsvAnalysisError(`Numeric values in column ${name} exceed the supported calculation range.`);
      return { ...base, kind: 'number', numeric: { count: values.length, sum, min: sorted[0], max: sorted.at(-1)!, mean, median: median(sorted), standard_deviation: Math.sqrt(variance) } };
    }
    const kind = nonempty.every((value) => DATE.test(value) && !Number.isNaN(Date.parse(value))) ? 'date' : 'text';
    const frequencies = new Map<string, number>();
    for (const value of nonempty) frequencies.set(value, (frequencies.get(value) ?? 0) + 1);
    const top_values = [...frequencies].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10).map(([value, count]) => ({ value, count }));
    return { ...base, kind, top_values };
  });

  const charts: DataChart[] = [];
  const numeric = columns.filter((column) => column.kind === 'number');
  const category = columns.find((column) => column.kind === 'text' && column.unique_count <= 50);
  if (category?.top_values?.length) charts.push({ kind: 'bar', title: `${category.name} frequency`, x_label: category.name, y_label: 'Rows', points: category.top_values.map((item) => ({ label: item.value, value: item.count })) });
  if (numeric.length) {
    const index = headers.indexOf(numeric[0].name);
    charts.push(histogram(rows.map((row) => row[index].trim()).filter((value) => NUMBER.test(value)).map(Number), numeric[0].name));
  }
  if (numeric.length >= 2) {
    const xIndex = headers.indexOf(numeric[0].name), yIndex = headers.indexOf(numeric[1].name);
    const pairs = rows.filter((row) => NUMBER.test(row[xIndex].trim()) && NUMBER.test(row[yIndex].trim()));
    const stride = Math.max(1, Math.ceil(pairs.length / 200));
    charts.push({ kind: 'scatter', title: `${numeric[0].name} vs ${numeric[1].name}`, x_label: numeric[0].name, y_label: numeric[1].name,
      points: pairs.filter((_, index) => index % stride === 0).slice(0, 200).map((row) => ({ x: Number(row[xIndex]), y: Number(row[yIndex]) })) });
  }
  const warnings: string[] = [];
  if (columns.some((column) => column.missing_count > 0)) warnings.push('Some cells are blank; numeric statistics exclude blank cells.');
  if (rows.length > 20) warnings.push('Preview is limited to the first 20 rows. Statistics cover all uploaded rows.');
  return {
    filename: filename.slice(0, 120), row_count: rows.length, column_count: headers.length, columns,
    preview: rows.slice(0, 20).map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index]]))),
    charts, warnings,
  };
}
