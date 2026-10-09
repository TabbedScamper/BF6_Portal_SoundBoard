/* Shared by the browser and dependency-free Node checks. */
(function (root) {
  'use strict';
  const key = clip => clip.assetPath || clip.name;
  function tree(data) {
    if (!Array.isArray(data)) throw new Error('Invalid category tree');
    const ids = new Set();
    function visit(nodes) {
      return nodes.map(n => {
        if (!n || !['string', 'number'].includes(typeof n.id) || typeof n.name !== 'string' || ids.has(String(n.id))) throw new Error('Invalid category');
        ids.add(String(n.id));
        return { ...n, id: String(n.id), children: visit(n.children || []) };
      });
    }
    return visit(data);
  }
  function page(data) {
    if (!data || !Array.isArray(data.clips) || !Number.isInteger(data.page) || !Number.isInteger(data.pages) || data.pages < 1 || data.page < 0 || data.page > data.pages) throw new Error('Invalid category page');
    for (const c of data.clips) {
      if (!c || typeof c.name !== 'string' || typeof c.file !== 'string' || !c.file || !Number.isFinite(c.duration) || c.duration < 0) throw new Error('Invalid clip');
      relativePath(c.file);
    }
    return data;
  }
  function relativePath(path) {
    if (typeof path !== 'string' || /^(?:[a-z]+:|[\\/])/i.test(path) || /[\\?#]/.test(path) || path.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('Invalid relative path');
    return path.split('/').map(encodeURIComponent).join('/');
  }
  function pagePath(category, number, first = 0) {
    return 'index/' + encodeURIComponent(category) + (number === first ? '' : '.' + number) + '.json';
  }
  function groups(clips, term = '', lang = '') {
    term = term.trim().toLowerCase();
    const out = new Map();
    for (const clip of clips) {
      if (lang && clip.lang !== lang) continue;
      if (term && ![clip.name, clip.assetPath, clip.portalName].some(s => String(s || '').toLowerCase().includes(term))) continue;
      const id = key(clip);
      if (!out.has(id)) out.set(id, { id, name: clip.name, takes: [] });
      out.get(id).takes.push(clip);
    }
    for (const group of out.values()) group.takes.sort((a, b) => (Number(a.variant) || 0) - (Number(b.variant) || 0));
    return [...out.values()];
  }
  function cycle(takes, next = 0) {
    if (!takes.length) throw new Error('No variants');
    return { clip: takes[next % takes.length], next: (next + 1) % takes.length };
  }
  // Optional index: [{name, category, page?, assetPath?, id?}], or {sounds:[...]}/{entries:[...]}.
  function searchIndex(data) {
    const entries = Array.isArray(data) ? data : data && (data.sounds || data.entries);
    if (!Array.isArray(entries)) throw new Error('Invalid search index');
    return entries.filter(e => e && typeof e.name === 'string' && ['string', 'number'].includes(typeof e.category) && (e.page == null || Number.isInteger(e.page)));
  }
  function search(entries, term, limit = 100) {
    term = term.trim().toLowerCase();
    return term ? entries.filter(e => [e.name, e.assetPath].some(s => String(s || '').toLowerCase().includes(term))).slice(0, limit) : [];
  }
  function windowRange(count, top, height, row = 260) {
    const start = Math.max(0, Math.floor(top / row) - 2);
    return { start: Math.min(count, start), end: Math.min(count, Math.ceil((top + height) / row) + 2) };
  }
  class PageStore {
    constructor(fetcher, base, capacity = 4) { this.fetcher = fetcher; this.base = base.replace(/\/$/, ''); this.cache = new Map(); this.capacity = capacity; }
    async load(path, signal) {
      let raw = this.cache.get(path);
      if (raw === undefined) {
        const response = await this.fetcher(this.base + '/' + path, { signal });
        if (!response.ok) throw new Error('Index request failed (' + response.status + ')');
        raw = await response.text();
        const parsed = page(JSON.parse(raw));
        this.cache.set(path, raw);
        if (this.cache.size > this.capacity) this.cache.delete(this.cache.keys().next().value);
        return parsed;
      } else { this.cache.delete(path); this.cache.set(path, raw); }
      return page(JSON.parse(raw));
    }
  }
  const api = { tree, page, relativePath, pagePath, groups, cycle, searchIndex, search, windowRange, PageStore };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GameLibraryCore = api;
})(typeof window === 'undefined' ? globalThis : window);
