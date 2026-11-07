export const defaults = Object.freeze({ query: '', field: 'all', status: 'all', role: 'all', source: 'all', section: 'all', kind: 'all' });

export function sourceOf(name = '') {
    if (/^\s*Izumi\s*[｜|]|泉此方|小此/i.test(name)) return 'izumi';
    if (/^\s*多娜\s*[｜|]|Donut/i.test(name)) return 'donut';
    return 'other';
}

export function isDivider(p) {
    return !p.marker && p.role === 'system' && !String(p.content ?? '').trim() && Boolean(p.name);
}

// Read native order state, not prompt.enabled (which can be stale in exports).
export function snapshot(prompts = [], order = []) {
    const byId = new Map(prompts.filter(Boolean).map(p => [String(p.identifier), p]));
    const seen = new Set();
    const rows = [];
    let section = '';
    const add = (p, entry) => {
        const id = String(p.identifier);
        if (seen.has(id)) return;
        seen.add(id);
        const divider = isDivider(p);
        if (entry && divider) section = id;
        rows.push({ id, name: String(p.name ?? id), content: String(p.content ?? ''), role: p.role ?? 'system',
            source: sourceOf(p.name), marker: Boolean(p.marker), divider,
            ordered: Boolean(entry), enabled: entry ? entry.enabled !== false : null,
            section: entry ? section : '', kind: p.marker ? 'marker' : divider ? 'divider' : 'text' });
    };
    for (const entry of order) {
        const p = byId.get(String(entry.identifier));
        if (p) add(p, entry);
    }
    for (const p of prompts) if (p) add(p, null);
    return rows;
}

export function tokens(query) {
    return [...String(query).matchAll(/(-?)(?:"([^"]+)"|(\S+))/g)]
        .map(m => ({ exclude: m[1] === '-', value: (m[2] ?? m[3]).toLocaleLowerCase() }));
}

export function matches(row, filter, queryTokens = tokens(filter.query ?? defaults.query)) {
    const f = { ...defaults, ...filter };
    if (Array.isArray(f.allowedIds) && !f.allowedIds.includes(row.id)) return false;
    if (f.status === 'on' && row.enabled !== true) return false;
    if (f.status === 'off' && row.enabled !== false) return false;
    if (f.status === 'unlisted' && row.ordered) return false;
    if (f.role !== 'all' && row.role !== f.role) return false;
    if (f.source !== 'all' && row.source !== f.source) return false;
    if (f.kind !== 'all' && row.kind !== f.kind) return false;
    if (f.section !== 'all' && row.section !== f.section) return false;
    if (!queryTokens.length) return true;
    const hay = (f.field === 'name' ? row.name : f.field === 'content' ? row.content : `${row.name}\n${row.content}\n${row.id}`).toLocaleLowerCase();
    return queryTokens.every(t => t.exclude ? !hay.includes(t.value) : hay.includes(t.value));
}

export function selectRows(rows, filter, keepHeadings = true) {
    const queryTokens = tokens(filter.query ?? defaults.query);
    const direct = new Set(rows.filter(r => matches(r, filter, queryTokens)).map(r => r.id));
    const visible = new Set(direct);
    if (keepHeadings && filter.kind !== 'text' && filter.kind !== 'marker') {
        for (const row of rows) if (direct.has(row.id) && row.section) visible.add(row.section);
    }
    return { direct, visible };
}
