import { analyzeCsv, CsvAnalysisError, type CsvAnalysis } from './csv-analysis.js';

export const JSON_LIMITS = { maxBytes: 1024 * 1024, maxRows: 10_000, maxDepth: 20, maxFields: 100, maxLineBytes: 64 * 1024 } as const;
export class JsonAnalysisError extends CsvAnalysisError {}
export type JsonAnalysis = CsvAnalysis & {
  format: 'json' | 'ndjson';
  structure: { root_kind: 'object' | 'array' | 'scalar'; document_count: number; object_count: number; array_count: number; max_depth: number; field_paths: { path: string; count: number; types: string[] }[] };
};

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function parseDocument(source: string, label: string): JsonValue {
  try { return JSON.parse(source) as JsonValue; }
  catch (error) { throw new JsonAnalysisError(`${label}: ${(error as Error).message}`); }
}
function kind(value: JsonValue): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value === 'object' ? 'object' : typeof value;
}
function inspect(value: JsonValue, depth: number, state: { objects: number; arrays: number; maxDepth: number }): void {
  state.maxDepth = Math.max(state.maxDepth, depth);
  if (depth > JSON_LIMITS.maxDepth) throw new JsonAnalysisError(`JSON nesting exceeds the maximum depth of ${JSON_LIMITS.maxDepth}.`, 413);
  if (Array.isArray(value)) { state.arrays++; for (const item of value) inspect(item, depth + 1, state); }
  else if (value !== null && typeof value === 'object') { state.objects++; for (const item of Object.values(value)) inspect(item, depth + 1, state); }
}
function flatten(value: JsonValue, prefix = '', output: Record<string, string> = Object.create(null) as Record<string, string>): Record<string, string> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      const escapedKey = key.replaceAll('~', '~0').replaceAll('.', '~2');
      const path = prefix ? `${prefix}.${escapedKey}` : escapedKey;
      if (child !== null && typeof child === 'object' && !Array.isArray(child)) flatten(child, path, output);
      else output[path] = child === null ? '' : Array.isArray(child) ? JSON.stringify(child) : String(child);
    }
  } else if (prefix) output[prefix] = value === null ? '' : Array.isArray(value) ? JSON.stringify(value) : String(value);
  return output;
}
function csvCell(value: string): string { return `"${value.replaceAll('"', '""')}"`; }

export function analyzeJson(source: string, filename = 'uploaded.json', format: 'json' | 'ndjson' = 'json'): JsonAnalysis {
  if (Buffer.byteLength(source, 'utf8') > JSON_LIMITS.maxBytes) throw new JsonAnalysisError('JSON upload exceeds the 1 MB limit.', 413);
  if (source.includes('\0')) throw new JsonAnalysisError('JSON contains a null byte. Upload a UTF-8 text file.');
  const text = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  let docs: JsonValue[];
  if (format === 'ndjson') {
    const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (!lines.length) throw new JsonAnalysisError('NDJSON is empty.');
    if (lines.length > JSON_LIMITS.maxRows) throw new JsonAnalysisError(`NDJSON has more than ${JSON_LIMITS.maxRows.toLocaleString()} records.`, 413);
    docs = lines.map((line, index) => {
      if (Buffer.byteLength(line, 'utf8') > JSON_LIMITS.maxLineBytes) throw new JsonAnalysisError(`NDJSON line ${index + 1} exceeds 64 KB.`, 413);
      const value = parseDocument(line, `NDJSON line ${index + 1}`);
      if (value === null || Array.isArray(value) || typeof value !== 'object') throw new JsonAnalysisError(`NDJSON line ${index + 1} must contain a JSON object.`);
      return value;
    });
  } else {
    const value = parseDocument(text, 'JSON');
    docs = Array.isArray(value) ? value : [value];
    if (!docs.length) throw new JsonAnalysisError('JSON array is empty.');
    if (docs.length > JSON_LIMITS.maxRows) throw new JsonAnalysisError(`JSON has more than ${JSON_LIMITS.maxRows.toLocaleString()} records.`, 413);
  }
  const state = { objects: 0, arrays: 0, maxDepth: 0 };
  for (const doc of docs) inspect(doc, 1, state);
  const rows = docs.map((doc) => flatten(doc));
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))].sort((a, b) => a.localeCompare(b));
  if (!headers.length) throw new JsonAnalysisError('JSON records contain no fields to analyze.');
  if (headers.length > JSON_LIMITS.maxFields) throw new JsonAnalysisError(`JSON has more than ${JSON_LIMITS.maxFields} flattened fields.`, 413);
  const normalized = [headers, ...rows.map((row) => headers.map((header) => row[header] ?? ''))].map((row) => row.map(csvCell).join(',')).join('\n');
  const pathTypes = new Map<string, { count: number; types: Set<string> }>();
  docs.forEach((doc) => {
    const row = flatten(doc);
    for (const path of Object.keys(row)) {
      const existing = pathTypes.get(path) ?? { count: 0, types: new Set<string>() };
      existing.count++;
      // Recover field type from the original value when possible; arrays are summarized as a single field.
      const parts = path.split('.').map((part) => part.replaceAll('~2', '.').replaceAll('~0', '~')); let current: JsonValue = doc;
      for (const part of parts) current = current !== null && typeof current === 'object' && !Array.isArray(current) ? current[part] : null;
      existing.types.add(kind(current)); pathTypes.set(path, existing);
    }
  });
  const analysis = analyzeCsv(normalized, filename);
  for (const column of analysis.columns) {
    const types = pathTypes.get(column.name)?.types ?? new Set<string>();
    if (types.has('number') && [...types].every((type) => type === 'number' || type === 'null')) continue;
    column.numeric = undefined;
    column.kind = types.size && [...types].every((type) => type === 'null') ? 'empty' : 'text';
    const frequencies = new Map<string, number>();
    for (const row of rows) {
      const value = row[column.name];
      if (value) frequencies.set(value, (frequencies.get(value) ?? 0) + 1);
    }
    column.top_values = [...frequencies].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10).map(([value, count]) => ({ value, count }));
  }
  const numericNames = new Set(analysis.columns.filter((column) => column.kind === 'number').map((column) => column.name));
  analysis.charts = analysis.charts.filter((chart) => chart.kind === 'bar' || (chart.kind === 'histogram' ? numericNames.has(chart.x_label) : numericNames.has(chart.x_label) && numericNames.has(chart.y_label)));
  if (!analysis.charts.some((chart) => chart.kind === 'bar')) {
    const category = analysis.columns.find((column) => column.kind === 'text' && column.unique_count <= 50 && column.top_values?.length);
    if (category?.top_values?.length) analysis.charts.unshift({ kind: 'bar', title: `${category.name} frequency`, x_label: category.name, y_label: 'Rows', points: category.top_values.map((item) => ({ label: item.value, value: item.count })) });
  }
  return {
    ...analysis, filename: filename.slice(0, 120), format,
    structure: {
      root_kind: format === 'ndjson' ? 'array' : Array.isArray(parseDocument(text, 'JSON')) ? 'array' : kind(parseDocument(text, 'JSON')) as 'object' | 'scalar',
      document_count: docs.length, object_count: state.objects, array_count: state.arrays, max_depth: state.maxDepth,
      field_paths: [...pathTypes].map(([path, data]) => ({ path, count: data.count, types: [...data.types].sort() })),
    },
  };
}
