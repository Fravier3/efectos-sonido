const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const assert = require('node:assert/strict');
const code = readFileSync(require('node:path').join(__dirname, '../providers.js'), 'utf8') + '\nFxProviders;';
const item = { metadata: { title: 'Rain', creator: 'Recorder', licenseurl: 'https://creativecommons.org/licenses/by/4.0/' }, files: [{ name: 'rain sample.mp3', length: '12.5' }] };
const response = data => ({ ok: true, headers: { get: () => 'application/json' }, json: async () => data });
function provider(fetch) { return runInNewContext(code, { fetch, AbortController, URLSearchParams, setTimeout, clearTimeout }); }
(async () => {
  const calls = [];
  const fx = provider(async url => {
    calls.push(url);
    if (url.includes('api.openverse.org')) return { ok: false, status: 403 };
    if (url.includes('advancedsearch.php')) return response({ response: { numFound: 9, docs: [{ identifier: 'rain-test' }] } });
    return response(item);
  });
  const first = await fx.search('lluvia', 1);
  assert.equal(first.provider, 'Internet Archive');
  assert.equal(first.results[0].duration, 12500);
  assert.equal(first.results[0].license, 'CC BY');
  assert.match(first.results[0].url, /rain%20sample.mp3$/);
  assert.equal(first.page_count, 2);
  assert.match(new URL(calls[1]).searchParams.get('q'), /"rain"/);
  await fx.search('dog', 1);
  assert.equal(calls.filter(url => url.includes('api.openverse.org')).length, 1, 'blocked API has a cooldown');
  const before = calls.length;
  await fx.search('rain', 2, 'Internet Archive');
  assert.ok(calls.slice(before).every(url => !url.includes('api.openverse.org')), 'pagination keeps its source');
  assert.equal(fx.archiveItems({ ...item, metadata: { title: 'No license' } }, 'test').length, 0);
  const ok = provider(async () => response({ results: [{ id: 'ov', url: 'https://example.org/rain.mp3' }], page_count: 1 }));
  assert.equal((await ok.search('rain', 1)).provider, 'Openverse');
  const failed = provider(async () => { throw new TypeError('network'); });
  await assert.rejects(failed.search('rain', 1));
  console.log('PASS: fallback, cooldown, pagination, licensing, metadata, query translation and total failure');
})().catch(error => { console.error(error); process.exitCode = 1; });
