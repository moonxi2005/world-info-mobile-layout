import { defaults, snapshot, selectRows, matches } from './preset-entry-filter-core.js';
import { donutProfile } from './preset-entry-filter-profiles.js';

const SLOT = '__presetEntryFilter_v1';
const ROOT_ID = 'pef-toolbar';
const ROW_HIDDEN = 'pef-hidden-row';
let filter = { ...defaults };
let keepHeadings = true;
let enabled = true;
let root, manager, observer, timer, dialog;
let stopped = false;
let importPending = null;
let schemeId = 'all';
const genericSchemes = [
    { id: 'all', label: '自定义 / 全部条目', filter: {} },
    { id: 'on', label: '当前已开启', filter: { status: 'on' } },
    { id: 'off', label: '当前已关闭', filter: { status: 'off' } },
    { id: 'donut', label: '多娜 · 全部条目', filter: { source: 'donut' } },
    { id: 'izumi-off', label: 'Izumi · 关闭的备用条目', filter: { source: 'izumi', status: 'off' } },
    { id: 'unlisted', label: '未加入排序', filter: { status: 'unlisted' } },
    { id: 'headings', label: '空白分类标题', filter: { kind: 'divider' } },
];
const disposers = [];

function el(tag, attrs = {}, text) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
        if (key === 'class') node.className = value;
        else node.setAttribute(key, value);
    }
    if (text !== undefined) node.textContent = text;
    return node;
}

async function getManager() {
    if (manager) return manager;
    // Native module is the read-only adapter; no generation/chat API is used.
    if (!importPending) importPending = import('/scripts/openai.js').then(m => {
        manager = m.promptManager;
        importPending = null;
        return manager;
    }).catch(error => { importPending = null; console.warn('[PresetFilter] native adapter unavailable', error); return null; });
    return importPending;
}

function readRows() {
    if (!manager?.serviceSettings || !manager?.getPromptOrderForCharacter) return null;
    return snapshot(manager.serviceSettings.prompts ?? [], manager.getPromptOrderForCharacter(manager.activeCharacter) ?? []);
}

function select(label, key, options) {
    const wrap = el('label', { class: 'pef-select' });
    wrap.append(el('span', {}, label));
    const input = el('select', { 'data-key': key, 'aria-label': label });
    for (const [value, name] of options) input.append(el('option', { value }, name));
    input.value = filter[key];
    input.addEventListener('change', () => { filter[key] = input.value; apply(); });
    wrap.append(input);
    return wrap;
}

function button(text, action) {
    const b = el('button', { type: 'button', class: 'menu_button pef-button' }, text);
    b.addEventListener('click', action);
    return b;
}

function mount(list) {
    if (root?.isConnected) return;
    root = el('section', { id: ROOT_ID, 'aria-label': '预设条目筛选器' });
    const top = el('div', { class: 'pef-top' });
    top.append(el('strong', {}, '预设条目筛选'));
    const toggle = button(enabled ? '筛选：开' : '筛选：关', () => { enabled = !enabled; toggle.textContent = enabled ? '筛选：开' : '筛选：关'; toggle.setAttribute('aria-pressed', String(enabled)); apply(); });
    toggle.setAttribute('aria-pressed', String(enabled));
    top.append(toggle, button('清除条件', reset), button('查看全部条目', openAll));
    const query = el('input', { type: 'search', class: 'text_pole pef-query', placeholder: '关键词；空格表示同时包含；-词 排除；"短语" 精确连续匹配', 'aria-label': '搜索预设条目', 'data-key': 'query' });
    query.value = filter.query;
    query.addEventListener('input', () => { filter.query = query.value; schedule(120); });
    const fields = el('div', { class: 'pef-fields' });
    const quickWrap = el('label', { class: 'pef-select' });
    quickWrap.append(el('span', {}, '快捷筛选方案'));
    const quick = el('select', { 'data-scheme': '', 'aria-label': '快捷筛选方案' });
    quick.addEventListener('change', () => {
        schemeId = quick.value;
        const generic = genericSchemes.find(s => s.id === schemeId);
        const specific = donutProfile.schemes.find(s => s.id === schemeId);
        filter = { ...defaults, ...(generic?.filter ?? {}), ...(specific ? { allowedIds: specific.ids } : {}) };
        for (const node of root.querySelectorAll('[data-key]')) node.value = filter[node.dataset.key];
        apply();
    });
    quickWrap.append(quick);
    fields.append(quickWrap);
    fields.append(
        select('搜索范围', 'field', [['all', '名称＋正文＋ID'], ['name', '仅名称'], ['content', '仅正文']]),
        select('状态', 'status', [['all', '全部状态'], ['on', '已开启'], ['off', '已关闭'], ['unlisted', '未加入排序']]),
        select('角色', 'role', [['all', '全部角色'], ['system', 'System'], ['user', 'User'], ['assistant', 'Assistant']]),
        select('来源', 'source', [['all', '全部来源'], ['donut', '多娜'], ['izumi', 'Izumi'], ['other', '其他']]),
        select('类型', 'kind', [['all', '全部类型'], ['text', '内容条目'], ['divider', '空白分隔'], ['marker', '内置占位']]),
        select('分区', 'section', [['all', '全部分区']]),
    );
    const keep = el('label', { class: 'pef-keep' });
    const checkbox = el('input', { type: 'checkbox' });
    checkbox.checked = keepHeadings;
    checkbox.addEventListener('change', () => { keepHeadings = checkbox.checked; apply(); });
    keep.append(checkbox, document.createTextNode('保留命中条目的分类标题'));
    root.append(top, query, fields, keep, el('div', { class: 'pef-status', 'aria-live': 'polite' }));
    list.before(root);
}

function reset() {
    schemeId = 'all';
    filter = { ...defaults };
    const quick = root?.querySelector('[data-scheme]');
    if (quick) quick.value = 'all';
    if (root) for (const node of root.querySelectorAll('[data-key]')) node.value = filter[node.dataset.key];
    apply();
}

function updateSchemes(rows) {
    const input = root?.querySelector('[data-scheme]');
    if (!input) return;
    const ids = new Set(rows.map(r => r.id));
    const supported = donutProfile.anchors.filter(id => ids.has(id)).length >= 3
        && rows.some(r => r.name.startsWith('多娜｜'));
    const signature = String(supported);
    if (input.dataset.profile !== signature) {
        input.replaceChildren(...genericSchemes.map(s => el('option', { value: s.id }, s.label)));
        if (supported) {
            const group = el('optgroup', { label: '多娜 v1 · 已内置的功能分区' });
            for (const s of donutProfile.schemes) group.append(el('option', { value: s.id }, s.label));
            input.append(group);
        }
        input.dataset.profile = signature;
    }
    if (!supported && donutProfile.schemes.some(s => s.id === schemeId)) {
        schemeId = 'all';
        delete filter.allowedIds;
    }
    input.value = schemeId;
}

function sections(rows) {
    const input = root?.querySelector('[data-key="section"]');
    if (!input) return;
    const options = [['all', '全部分区'], ...rows.filter(r => r.divider && r.ordered).map(r => [r.id, r.name])];
    const signature = JSON.stringify(options);
    if (input.dataset.signature === signature) return;
    input.replaceChildren(...options.map(([value, name]) => el('option', { value }, name)));
    input.dataset.signature = signature;
    if (!options.some(([id]) => id === filter.section)) filter.section = 'all';
    input.value = filter.section;
}

async function apply() {
    if (stopped) return;
    const list = document.getElementById('completion_prompt_manager_list');
    if (!list) return;
    mount(list);
    await getManager();
    if (stopped || !list.isConnected || !root?.isConnected) return;
    const rows = readRows();
    const status = root.querySelector('.pef-status');
    if (!rows) {
        for (const node of list.children) node.classList.remove(ROW_HIDDEN);
        status.textContent = '尚未读到原生预设接口。请切换到聊天补全，并打开预设条目列表。';
        return;
    }
    updateSchemes(rows);
    sections(rows);
    const selected = selectRows(rows, filter, keepHeadings);
    let shown = 0, total = 0;
    for (const node of list.children) {
        const id = node.dataset.pmIdentifier;
        if (!id) continue;
        total++;
        const hide = enabled && !selected.visible.has(id);
        node.classList.toggle(ROW_HIDDEN, hide);
        if (!hide) shown++;
    }
    const active = enabled && (filter.allowedIds || filter.query.trim() || Object.keys(defaults).some(k => k !== 'query' && filter[k] !== defaults[k]));
    list.classList.toggle('pef-filter-active', Boolean(active));
    const unlisted = rows.filter(r => !r.ordered).length;
    status.textContent = `列表显示 ${shown} / ${total}；预设另有 ${unlisted} 个未排序条目，可在“查看全部条目”中搜索。${active ? ' 筛选期间拖动排序暂停，编辑和开关仍可用。' : ''}`;
    if (dialog?.open) renderAll(rows);
}

function schedule(delay = 70) {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => { void apply().catch(console.error); }, delay);
}

function openAll() {
    const rows = readRows();
    if (!rows) return;
    if (!dialog?.isConnected) {
        dialog = el('dialog', { id: 'pef-dialog', 'aria-label': '全部预设条目' });
        const header = el('div', { class: 'pef-top' });
        header.append(el('strong', {}, '全部预设条目 · 按当前筛选条件'), button('关闭', () => dialog.close()));
        dialog.append(header, el('p', { class: 'pef-note' }, '只读预览；来源按名称识别。编辑与开关请使用原生预设列表。'), el('div', { class: 'pef-results' }));
        dialog.addEventListener('click', e => { if (e.target === dialog) { const rect = dialog.getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) dialog.close(); } });
        document.body.append(dialog);
    }
    renderAll(rows);
    if (!dialog.open) dialog.showModal();
}

function renderAll(rows) {
    const target = dialog.querySelector('.pef-results');
    const hits = rows.filter(r => matches(r, filter));
    target.replaceChildren(el('p', {}, `命中 ${hits.length} / ${rows.length} 个条目`));
    for (const row of hits) {
        const card = el('details', { class: 'pef-card' });
        card.append(el('summary', {}, `${row.enabled === null ? '未排序' : row.enabled ? '已开启' : '已关闭'} · ${row.role} · ${row.name}`));
        card.append(el('small', {}, `ID：${row.id}`), el('pre', {}, row.content || (row.marker ? '内置占位，内容由酒馆注入。' : '空白分隔条目。')));
        if (row.ordered) card.append(button('定位原生条目', () => {
            reset();
            enabled = false;
            root?.querySelector('.pef-top button')?.setAttribute('aria-pressed', 'false');
            const toggle = root?.querySelector('.pef-top button');
            if (toggle) toggle.textContent = '筛选：关';
            dialog.close();
            void apply().then(() => {
                const node = [...(document.getElementById('completion_prompt_manager_list')?.children ?? [])].find(n => n.dataset.pmIdentifier === row.id);
                node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                node?.classList.add('pef-highlight');
                setTimeout(() => node?.classList.remove('pef-highlight'), 2200);
            });
        }));
        target.append(card);
    }
}

export function dispose() {
    stopped = true;
    clearTimeout(timer);
    observer?.disconnect();
    for (const fn of disposers.splice(0)) fn();
    root?.remove();
    dialog?.remove();
    for (const node of document.querySelectorAll(`.${ROW_HIDDEN}`)) node.classList.remove(ROW_HIDDEN);
    document.getElementById('completion_prompt_manager_list')?.classList.remove('pef-filter-active');
}

function init() {
    window[SLOT]?.dispose?.();
    window[SLOT] = { dispose };
    const dragGuard = event => {
        if (event.target.closest?.('#completion_prompt_manager_list.pef-filter-active .drag-handle')) {
            event.preventDefault(); event.stopImmediatePropagation();
        }
    };
    document.addEventListener('pointerdown', dragGuard, true);
    document.addEventListener('mousedown', dragGuard, true);
    document.addEventListener('touchstart', dragGuard, { capture: true, passive: false });
    disposers.push(() => document.removeEventListener('pointerdown', dragGuard, true));
    disposers.push(() => document.removeEventListener('mousedown', dragGuard, true));
    disposers.push(() => document.removeEventListener('touchstart', dragGuard, true));
    observer = new MutationObserver(records => {
        const relevant = records.some(record => {
            const target = record.target;
            if (target.closest?.('#pef-toolbar, #pef-dialog')) return false;
            if (target.closest?.('#completion_prompt_manager')) return true;
            return [...record.addedNodes].some(n => n.nodeType === 1 && (n.matches?.('#completion_prompt_manager, #completion_prompt_manager_list') || n.querySelector?.('#completion_prompt_manager_list')));
        });
        if (relevant) schedule();
    });
    observer.observe(document.body, { subtree: true, childList: true });
    const ctx = window.SillyTavern?.getContext?.();
    for (const name of ['OAI_PRESET_CHANGED_AFTER', 'CHAT_CHANGED']) {
        const type = ctx?.eventTypes?.[name] ?? ctx?.event_types?.[name];
        if (type && ctx?.eventSource?.on) {
            const handler = () => schedule();
            ctx.eventSource.on(type, handler);
            disposers.push(() => ctx.eventSource.removeListener?.(type, handler));
        }
    }
    schedule(0);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
