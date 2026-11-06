export function findMatches(text, query, matchCase) {
    if (!query) return [];
    const literal = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return Array.from(text.matchAll(new RegExp(literal, matchCase ? 'gu' : 'giu')), match => ({
        start: match.index,
        end: match.index + match[0].length,
    }));
}
