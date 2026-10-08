import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { analyzeCsv, CSV_LIMITS } from '../src/data/csv-analysis.js';
import { registerDataRoutes } from '../src/server/routes/data.js';

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
