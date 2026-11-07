export function decodeEditorText(text) {
    const escapes = { n: '\n', r: '\n', t: '\t', '\\': '\\' };
    return text.replace(/\\r\\n|\\([nrt\\])/g, (_, key) => key ? escapes[key] : '\n');
}

export function findMatches(text, query, matchCase) {
    if (!query) return [];
    const literal = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return Array.from(text.matchAll(new RegExp(literal, matchCase ? 'gu' : 'giu')), match => ({
        start: match.index,
        end: match.index + match[0].length,
    }));
}
