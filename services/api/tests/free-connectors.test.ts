import { describe, expect, it, vi, afterEach } from 'vitest';
import { localSearxngUrl, openMeteo, searxng, wikipedia } from '../src/connectors/free.js';
afterEach(() => vi.unstubAllGlobals());
describe('Free/keyless connectors', () => {
  it('only accepts a local SearXNG origin', () => {
    expect(localSearxngUrl('http://127.0.0.1:8080/')).toBe('http://127.0.0.1:8080');
    expect(() => localSearxngUrl('https://evil.com/')).toThrow(/localhost/);
    expect(() => localSearxngUrl('http://localhost:8080/secret')).toThrow(/localhost/);
    expect(() => localSearxngUrl('http://localhost:8080/?key=secret')).toThrow(/localhost/);
  });
  it('returns linked encyclopedia results without an API key', async () => {
    const fn = vi.fn(async () => new Response(JSON.stringify({ pages: [{ title:'Test Article',key:'Test_Article',excerpt:'<span>Hello</span>' }] }),{status:200}));
    vi.stubGlobal('fetch',fn);
    const result: any = await wikipedia.actions.search({}, { query:'test' });
    expect(result.results[0]).toMatchObject({ title:'Test Article',url:'https://en.wikipedia.org/wiki/Test_Article',snippet:'Hello' });
    expect(String((fn as any).mock.calls[0][0])).toContain('en.wikipedia.org');
  });
  it('returns weather from geocoding plus forecast with non-commercial notice', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(++calls === 1 ?
      {results:[{name:'Dubai',country:'UAE',latitude:25.2,longitude:55.3}]} :
      {current:{temperature_2m:30},current_units:{temperature_2m:'°C'}}),{status:200})));
    const result: any = await openMeteo.actions.current({}, {city:'Dubai'});
    expect(result.current.temperature_2m).toBe(30);
    expect(result.license_notice).toContain('non-commercial');
    expect(calls).toBe(2);
  });
  it('limits locally hosted search result count', async () => {
    vi.stubGlobal('fetch',vi.fn(async () => new Response(JSON.stringify({
      results:Array.from({length:20},(_,i)=>({title:'t'+i,url:'https://example.com/'+i,content:'ok'}))
    }),{status:200})));
    const result: any = await searxng.actions.search({url:'http://localhost:8080'}, {query:'test',max_results:2});
    expect(result.results).toHaveLength(2);
  });
});
