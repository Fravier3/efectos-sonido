'use strict';
// Search public APIs directly; no private credentials or third-party proxy.
const FxProviders = (() => {
  const aliases = { lluvia: 'rain', trueno: 'thunder', truenos: 'thunder', explosion: 'explosion', risas: 'laugh', aplausos: 'applause', animales: 'animal', perro: 'dog', perros: 'dog', gato: 'cat', puertas: 'door', puerta: 'door', pasos: 'footsteps', alarma: 'alarm', campana: 'bell', magia: 'magic' };
  const normalize = q => aliases[q.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')] || q;
  let openverseUnavailableUntil = 0;
  async function json(url, timeout = 10000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const response = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      if (!response.ok) throw Object.assign(new Error('HTTP ' + response.status), { status: response.status });
      if (!(response.headers.get('content-type') || '').includes('json')) throw new Error('La API no devolvió JSON');
      return await response.json();
    } finally { clearTimeout(timer); }
  }
  function license(value) {
    const url = Array.isArray(value) ? value[0] : value;
    if (typeof url !== 'string') return null;
    const match = url.match(/^https?:\/\/creativecommons\.org\/(licenses|publicdomain)\/([a-z-]+)\/([\d.]+)\/?$/i);
    if (!match) return null;
    return { license: match[1] === 'publicdomain' ? (match[2] === 'zero' ? 'CC0' : 'Dominio público') : 'CC ' + match[2].toUpperCase(), license_version: match[3], license_url: url };
  }
  const scalar = value => Array.isArray(value) ? value.join(', ') : String(value || '');
  function archiveItems(data, id) {
    const meta = data.metadata || {};
    const lic = license(meta.licenseurl);
    if (!lic || meta.access_restricted === 'true' || meta.is_dark) return [];
    // MP3 is supported by iPhone/Safari as well as desktop browsers.
    const files = (data.files || []).filter(f => /\.mp3$/i.test(f.name) && f.private !== 'true');
    return files.slice(0, 3).map(f => {
      const title = scalar(f.title || meta.title || f.name);
      const creator = scalar(f.creator || meta.creator) || 'Autor no indicado';
      return { id: 'ia:' + id + ':' + f.name, title,
        url: 'https://archive.org/download/' + encodeURIComponent(id) + '/' + f.name.split('/').map(encodeURIComponent).join('/'),
        creator, duration: Number(f.length) * 1000 || 0, ...lic,
        foreign_landing_url: 'https://archive.org/details/' + encodeURIComponent(id),
        attribution: '"' + title + '" por ' + creator + ' · ' + lic.license + ' ' + lic.license_version + ' · ' + lic.license_url,
        source: 'Internet Archive' };
    });
  }
  async function archive(q, page) {
    const terms = q.match(/[\p{L}\p{N}]+/gu) || [];
    if (!terms.length) return { results: [], page_count: 1, provider: 'Internet Archive' };
    const query = '(' + terms.slice(0, 12).map(t => '"' + t + '"').join(' AND ') + ') AND mediatype:audio AND (subject:"sound effects" OR subject:field-recording OR collection:freesound) AND licenseurl:*';
    const params = new URLSearchParams({ q: query, output: 'json', rows: 8, page });
    for (const field of ['identifier']) params.append('fl[]', field);
    const data = await json('https://archive.org/advancedsearch.php?' + params, 15000);
    if (!data.response || !Array.isArray(data.response.docs)) throw new Error('Respuesta de búsqueda inválida');
    const docs = data.response.docs;
    const batches = [];
    // Limit concurrency and retain search order even if requests finish out of order.
    for (let i = 0; i < docs.length; i += 3) {
      const batch = await Promise.allSettled(docs.slice(i, i + 3).map(async doc => {
        if (!/^[a-zA-Z0-9_.-]+$/.test(doc.identifier)) return [];
        return archiveItems(await json('https://archive.org/metadata/' + encodeURIComponent(doc.identifier)), doc.identifier);
      }));
      batches.push(...batch);
    }
    if (docs.length && batches.every(b => b.status === 'rejected')) throw new Error('No se pudieron obtener los archivos de audio');
    return { results: batches.flatMap(b => b.status === 'fulfilled' ? b.value : []), page_count: Math.max(1, Math.ceil(data.response.numFound / 8)), provider: 'Internet Archive' };
  }
  async function search(q, page, provider) {
    q = normalize(q.trim());
    if (provider !== 'Internet Archive' && (provider === 'Openverse' || Date.now() >= openverseUnavailableUntil)) {
      try {
        const params = new URLSearchParams({ q, category: 'sound_effect', page_size: 20, page });
        const data = await json('https://api.openverse.org/v1/audio/?' + params, 7000);
        if (!Array.isArray(data.results)) throw new Error('Respuesta inválida de Openverse');
        if (data.results.length || provider === 'Openverse') return { ...data, provider: 'Openverse' };
      } catch (error) {
        // Do not repeatedly request a blocked or rate-limited service this session.
        openverseUnavailableUntil = Date.now() + 5 * 60 * 1000;
        if (provider === 'Openverse') throw error;
      }
    }
    return archive(q, page);
  }
  return { search, normalize, archiveItems };
})();
