const quotePattern = /“[^“”\r\n]+”/g;
const excluded = 'q, .tuit-quote-repair, pre, code, details, summary, a, script, style, textarea, [contenteditable], [hidden]';

function affectedQuotes(raw) {
    if (typeof raw !== 'string') return;
    const plan = raw.match(/<konatan_planning~>([\s\S]*?)<\/konatan_planning~>/i);
    if (!plan || (plan[1].match(/`{3,}/g)?.length ?? 0) % 2 === 0) return;
    const body = raw.slice(plan.index + plan[0].length).match(/<content>([\s\S]*?)<\/content>/i);
    if (body) return new Set(body[1].match(quotePattern) ?? []);
}

function repairMessage(floor, messages) {
    const message = messages[Number(floor.getAttribute('mesid'))];
    if (!message || message.is_user || message.is_system) return;
    const text = floor.querySelector('.mes_text');
    if (!text) return;
    const quotes = affectedQuotes(message.mes);
    if (!quotes?.size) return;

    const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
    const pending = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement.closest(excluded)) continue;
        const matches = [...node.data.matchAll(quotePattern)].filter(match => quotes.has(match[0]));
        if (matches.length) pending.push([node, matches]);
    }
    for (const [node, matches] of pending) {
        const fragment = document.createDocumentFragment();
        let offset = 0;
        for (const match of matches) {
            fragment.append(node.data.slice(offset, match.index));
            const quote = document.createElement('span');
            quote.className = 'tuit-quote-repair';
            quote.textContent = match[0];
            fragment.append(quote);
            offset = match.index + match[0].length;
        }
        fragment.append(node.data.slice(offset));
        node.replaceWith(fragment);
    }
}

const context = () => SillyTavern.getContext();
const pendingFloors = new Set();
const floorSelector = '.mes[mesid]';
let root;
let frame = 0;
function schedule() {
    if (frame || !pendingFloors.size) return;
    frame = requestAnimationFrame(() => {
        frame = 0;
        const messages = context().chat ?? [];
        for (const floor of pendingFloors) {
            if (root?.contains(floor)) repairMessage(floor, messages);
        }
        pendingFloors.clear();
    });
}
const observer = new MutationObserver(records => {
    for (const record of records) {
        const target = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
        const floor = target?.closest(floorSelector);
        if (floor && !target.closest('.tuit-quote-repair')) pendingFloors.add(floor);
        for (const node of record.addedNodes) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            if (node.matches(floorSelector)) pendingFloors.add(node);
            for (const child of node.querySelectorAll(floorSelector)) pendingFloors.add(child);
        }
    }
    schedule();
});

function refresh() {
    const chat = document.getElementById('chat');
    if (chat !== root) {
        observer.disconnect();
        root = chat;
        if (root) observer.observe(root, { childList: true, subtree: true, characterData: true });
    }
    for (const floor of root?.querySelectorAll(floorSelector) ?? []) pendingFloors.add(floor);
    schedule();
}

const { eventSource, event_types: events } = context();
if (events?.CHAT_CHANGED) eventSource.on(events.CHAT_CHANGED, refresh);
refresh();
