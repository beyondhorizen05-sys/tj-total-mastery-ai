import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { analyzeCsv, CSV_LIMITS } from '../src/data/csv-analysis.js';
import { registerDataRoutes } from '../src/server/routes/data.js';
import { analyzeJson, JSON_LIMITS } from '../src/data/json-analysis.js';

describe('local CSV analysis', () => {
  it('counts an explicitly quoted empty value as a data row', () => {
    const result = analyzeCsv('value\n""\n\nfilled');
    expect(result.row_count).toBe(2);
    expect(result.preview).toEqual([{ value: '' }, { value: 'filled' }]);
    expect(result.columns[0]).toMatchObject({ missing_count: 1, nonempty_count: 1 });
  });

  it('parses quoted commas and newlines, computes numeric statistics, and creates chart data', () => {
    const result = analyzeCsv('\ufeffregion,amount,units,notes\r\n"North, East",10,2,"first\nline"\r\nSouth,20,4,ok\r\n"North, East",,6,', 'sales.csv');
    expect(result).toMatchObject({ filename: 'sales.csv', row_count: 3, column_count: 4 });
    expect(result.preview[0]).toMatchObject({ region: 'North, East', notes: 'first\nline' });
    expect(result.columns.find((column) => column.name === 'amount')).toMatchObject({ kind: 'number', missing_count: 1, numeric: { count: 2, min: 10, max: 20, mean: 15, median: 15, standard_deviation: 5 } });
    expect(result.columns.find((column) => column.name === 'region')?.top_values?.[0]).toEqual({ value: 'North, East', count: 2 });
    const bar = result.charts.find((chart) => chart.kind === 'bar');
    expect(bar?.points[0]).toEqual({ label: 'North, East', value: 2 });
    const histogram = result.charts.find((chart) => chart.kind === 'histogram');
    expect(histogram && histogram.kind !== 'scatter' ? histogram.points.reduce((total, point) => total + point.value, 0) : null).toBe(2);
    expect(result.charts.find((chart) => chart.kind === 'scatter')?.points).toHaveLength(2);
    expect(result.warnings).toContain('Some cells are blank; numeric statistics exclude blank cells.');
  });

  it('rejects malformed and ambiguous CSV instead of returning misleading statistics', () => {
    expect(() => analyzeCsv('a,b\n1')).toThrow(/row 2 has 1 fields/);
    expect(() => analyzeCsv('a,a\n1,2')).toThrow(/unique/);
    expect(() => analyzeCsv('a,b\n"unterminated,2')).toThrow(/unclosed/);
    expect(() => analyzeCsv('a,b\n1,2\n'.repeat(CSV_LIMITS.maxRows + 1))).toThrow();
    expect(() => analyzeCsv('value\n1e308\n1e308')).toThrow(/calculation range/);
  });

  it('keeps preview bounded while statistics cover every row', () => {
    const csv = `value\n${Array.from({ length: 30 }, (_, index) => index + 1).join('\n')}`;
    const result = analyzeCsv(csv);
    expect(result.row_count).toBe(30);
    expect(result.preview).toHaveLength(20);
    expect(result.columns[0].numeric?.sum).toBe(465);
    expect(result.warnings.some((warning) => warning.includes('Preview'))).toBe(true);
  });

  it('does not label impossible calendar dates as dates', () => {
    expect(analyzeCsv('date\n2024-02-29').columns[0].kind).toBe('date');
    expect(analyzeCsv('date\n2026-02-30').columns[0].kind).toBe('text');
    expect(analyzeCsv('date\n2026-13-01').columns[0].kind).toBe('text');
  });
});

describe('CSV analysis API', () => {
  it('returns local analysis for an explicit upload without an external provider', async () => {
    const app = Fastify();
    registerDataRoutes(app);
    const result = await app.inject({ method: 'POST', url: '/api/v1/data/analyze/csv', payload: { filename: 'sample.csv', csv: 'name,score\nAda,3\nLin,5' } });
    expect(result.statusCode).toBe(200);
    expect(result.json().analysis).toMatchObject({ row_count: 2, column_count: 2, columns: [{ name: 'name', kind: 'text' }, { name: 'score', kind: 'number' }] });
    await app.close();
  });

  it('rejects oversized upload and path-like filenames', async () => {
    const app = Fastify();
    registerDataRoutes(app);
    const tooLarge = await app.inject({ method: 'POST', url: '/api/v1/data/analyze/csv', payload: { csv: `value\n${'x'.repeat(CSV_LIMITS.maxBytes)}` } });
    expect(tooLarge.statusCode).toBe(413);
    const path = await app.inject({ method: 'POST', url: '/api/v1/data/analyze/csv', payload: { csv: 'x\n1', filename: '../private.csv' } });
    expect(path.statusCode).toBe(400);
    await app.close();
  });
});

describe('local JSON and NDJSON analysis', () => {
  it('flattens nested object records and reports useful structure and field types', () => {
    const result = analyzeJson(JSON.stringify([{ id: 1, user: { city: 'Dubai' }, active: true }, { id: 2, user: { city: 'Lahore' }, active: false }]), 'people.json');
    expect(result).toMatchObject({ format: 'json', row_count: 2, structure: { root_kind: 'array', document_count: 2, object_count: 4, array_count: 0, max_depth: 3 } });
    expect(result.columns.find((column) => column.name === 'id')).toMatchObject({ kind: 'number', numeric: { sum: 3, mean: 1.5 } });
    expect(result.structure.field_paths).toContainEqual({ path: 'user.city', count: 2, types: ['string'] });
  });

  it('analyzes NDJSON object records and rejects malformed or non-object lines', () => {
    const result = analyzeJson('{"score":3}\n{"score":5,"tag":"ok"}', 'scores.ndjson', 'ndjson');
    expect(result).toMatchObject({ format: 'ndjson', row_count: 2, structure: { root_kind: 'array', document_count: 2 } });
    expect(result.columns.find((column) => column.name === 'score')?.numeric?.mean).toBe(4);
    expect(() => analyzeJson('{"a":1}\nnope', 'x.ndjson', 'ndjson')).toThrow(/line 2/);
    expect(() => analyzeJson('1\n{"a":2}', 'x.ndjson', 'ndjson')).toThrow(/must contain a JSON object/);
  });

  it('keeps dotted and prototype-named source keys safe and unambiguous', () => {
    const result = analyzeJson('{"a.b":1,"a":{"b":2},"__proto__":{"safe":true}}');
    expect(result.columns.map((column) => column.name)).toContain('a~2b');
    expect(result.columns.map((column) => column.name)).toContain('a.b');
    expect(result.columns.map((column) => column.name)).toContain('__proto__.safe');
    expect(result.preview[0]['__proto__.safe']).toBe('true');
  });

  it('uses JSON types instead of inferring numbers from numeric strings or booleans', () => {
    const result = analyzeJson('[{"numeric":2,"numericText":"3","flag":true,"nullable":4},{"numeric":5,"numericText":"03","flag":false,"nullable":null}]');
    expect(result.columns.find((column) => column.name === 'numeric')).toMatchObject({ kind: 'number', numeric: { sum: 7 } });
    expect(result.columns.find((column) => column.name === 'nullable')).toMatchObject({ kind: 'number', missing_count: 1, numeric: { sum: 4 } });
    expect(result.columns.find((column) => column.name === 'numericText')).toMatchObject({ kind: 'text', top_values: [{ value: '03', count: 1 }, { value: '3', count: 1 }] });
    expect(result.columns.find((column) => column.name === 'flag')).toMatchObject({ kind: 'text', top_values: [{ value: 'false', count: 1 }, { value: 'true', count: 1 }] });
    expect(result.charts.some((chart) => chart.kind === 'histogram' && chart.x_label === 'numericText')).toBe(false);
  });

  it('rejects excessive bytes, records, depth, and flattened fields', () => {
    expect(() => analyzeJson(' '.repeat(JSON_LIMITS.maxBytes + 1))).toThrow(/1 MB/);
    expect(() => analyzeJson(`[${Array.from({ length: JSON_LIMITS.maxRows + 1 }, () => '{}').join(',')}]`)).toThrow(/records/);
    expect(() => analyzeJson(`${'{"x":'.repeat(JSON_LIMITS.maxDepth + 1)}0${'}'.repeat(JSON_LIMITS.maxDepth + 1)}`)).toThrow(/depth/);
    const wide = Object.fromEntries(Array.from({ length: JSON_LIMITS.maxFields + 1 }, (_, index) => [`f${index}`, index]));
    expect(() => analyzeJson(JSON.stringify(wide))).toThrow(/flattened fields/);
  });
});

describe('JSON analysis API', () => {
  it('serves local JSON/NDJSON analysis and validates the filename and format', async () => {
    const app = Fastify();
    registerDataRoutes(app);
    const json = await app.inject({ method: 'POST', url: '/api/v1/data/analyze/json', payload: { filename: 'sample.json', content: '[{"name":"Ada"}]' } });
    expect(json.statusCode).toBe(200);
    expect(json.json().analysis).toMatchObject({ format: 'json', row_count: 1, columns: [{ name: 'name', kind: 'text' }] });
    const ndjson = await app.inject({ method: 'POST', url: '/api/v1/data/analyze/json', payload: { filename: 'sample.ndjson', format: 'ndjson', content: '{"x":2}' } });
    expect(ndjson.statusCode).toBe(200);
    expect(ndjson.json().analysis.format).toBe('ndjson');
    const badName = await app.inject({ method: 'POST', url: '/api/v1/data/analyze/json', payload: { filename: '../sample.json', content: '{}' } });
    expect(badName.statusCode).toBe(400);
    const badFormat = await app.inject({ method: 'POST', url: '/api/v1/data/analyze/json', payload: { filename: 'sample.json', format: 'yaml', content: '{}' } });
    expect(badFormat.statusCode).toBe(400);
    await app.close();
  });
});
