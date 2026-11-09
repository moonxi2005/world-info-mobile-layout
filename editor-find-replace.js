import { decodeEditorText, findMatches } from './editor-find-replace-matches.js';

const selector = [
    '#ln-panel textarea',
    'textarea.edit_textarea',
    'dialog textarea',
    '#dialogue_popup textarea',
    '.completion_prompt_manager_popup textarea',
    '#completion_prompt_manager_popup textarea',
].join(',');
const controls = new WeakMap();

function button(label) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'menu_button';
    element.textContent = label;
    return element;
}

function input(label) {
    const element = document.createElement('input');
    element.type = 'text';
    element.className = 'text_pole';
    element.placeholder = label;
    element.setAttribute('aria-label', label);
    return element;
}

function attach(editor) {
    // World Info mounts its native editor asynchronously after creating the textarea.
    if (editor.matches('.world_entry_edit textarea[name="content"]')) return;
    if (controls.has(editor)) return controls.get(editor);

    const toolbar = document.createElement('div');
    toolbar.className = 'efr-toolbar';
    const toggle = button('查找替换');
    toggle.setAttribute('aria-expanded', 'false');
    const panel = document.createElement('div');
    panel.className = 'efr-panel';
    panel.hidden = true;
    const query = input('查找文本');
    const replacement = input('替换为（留空则删除）');
    const previous = button('上一个');
    const next = button('下一个');
    const replace = button('替换');
    const replaceAll = button('全部替换');
    const matchCase = document.createElement('input');
    matchCase.type = 'checkbox';
    const caseLabel = document.createElement('label');
    caseLabel.append(matchCase, '区分大小写');
    const status = document.createElement('span');
    status.setAttribute('role', 'status');
    const actions = document.createElement('div');
    actions.className = 'efr-actions';
    actions.append(previous, next, replace, replaceAll, caseLabel, status);
    panel.append(query, replacement, actions);
    toolbar.append(toggle, panel);
    editor.before(toolbar);

    const matches = () => findMatches(editor.value, decodeEditorText(query.value), matchCase.checked);
    function update() {
        const count = matches().length;
        status.textContent = query.value ? `共 ${count} 处` : '';
        previous.disabled = next.disabled = replace.disabled = replaceAll.disabled = count === 0;
    }

    function select(backward) {
        const found = matches();
        if (!found.length) return;
        const index = backward
            ? found.findLastIndex(match => match.end <= editor.selectionStart)
            : found.findIndex(match => match.start >= editor.selectionEnd);
        const current = found[index < 0 ? (backward ? found.length - 1 : 0) : index];
        editor.focus();
        editor.setSelectionRange(current.start, current.end);
        status.textContent = `${found.indexOf(current) + 1} / ${found.length}`;
    }

    function edit(start, end, value) {
        editor.focus();
        editor.setSelectionRange(start, end);
        const original = editor.value;
        // Chromium preserves native undo when the edit command is available.
        if (value ? !document.execCommand('insertText', false, value) : !document.execCommand('delete')) {
            editor.setRangeText(value, start, end, 'end');
            if (editor.value !== original) editor.dispatchEvent(new Event('input', { bubbles: true }));
        }
        update();
    }

    function open() {
        if (panel.hidden) {
            const selected = editor.value.slice(editor.selectionStart, editor.selectionEnd);
            if (selected) query.value = selected.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('\t', '\\t');
            panel.hidden = false;
            toggle.setAttribute('aria-expanded', 'true');
            update();
        }
        query.focus();
        query.select();
    }

    function close() {
        panel.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
        editor.focus();
    }

    toggle.addEventListener('click', () => panel.hidden ? open() : close());
    previous.addEventListener('click', () => select(true));
    next.addEventListener('click', () => select(false));
    replace.addEventListener('click', () => {
        const found = matches();
        const selected = found.find(match => match.start === editor.selectionStart && match.end === editor.selectionEnd);
        const match = selected ?? found.find(match => match.start >= editor.selectionStart) ?? found[0];
        if (!match) return;
        edit(match.start, match.end, decodeEditorText(replacement.value));
        select(false);
    });
    replaceAll.addEventListener('click', () => {
        const found = matches();
        if (!found.length) return;
        const value = decodeEditorText(replacement.value);
        const pieces = [];
        let offset = 0;
        for (const match of found) {
            pieces.push(editor.value.slice(offset, match.start), value);
            offset = match.end;
        }
        pieces.push(editor.value.slice(offset));
        edit(0, editor.value.length, pieces.join(''));
        status.textContent = `已替换 ${found.length} 处`;
    });
    query.addEventListener('input', update);
    matchCase.addEventListener('change', update);
    editor.addEventListener('input', () => { if (!panel.hidden) update(); });
    panel.addEventListener('keydown', event => {
        if (event.isComposing || !['Enter', 'Escape'].includes(event.key)) return;
        if (event.key === 'Enter' && event.target !== query && event.target !== replacement) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === 'Escape') close();
        else if (event.target === query) select(event.shiftKey);
        else replace.click();
    });

    controls.set(editor, open);
    return open;
}

function addNativeReplaceButtons() {
    for (const toolbar of document.querySelectorAll('.tt-codemirror-editor .cm-editor-tools')) {
        if (toolbar.querySelector('.efr-native')) continue;
        const search = toolbar.querySelector('button:has(.fa-magnifying-glass)');
        const editor = toolbar.closest('.tt-codemirror-editor');
        if (!search || !editor) continue;
        const entry = button('查找替换');
        entry.className = 'efr-native';
        entry.addEventListener('mousedown', event => event.preventDefault());
        entry.addEventListener('click', () => {
            if (!editor.querySelector('.cm-editor-search')) search.click();
            const expand = editor.querySelector('.cm-search-expand:not([hidden])[aria-expanded="false"]');
            expand?.click();
            editor.querySelector('.cm-editor-search input[main-field]')?.focus();
        });
        search.before(entry);
    }
}

function scan() {
    addNativeReplaceButtons();
    for (const editor of document.querySelectorAll(selector)) {
        if (!editor.readOnly && !editor.disabled && editor.getClientRects().length) attach(editor);
    }
}

function relevantEditorMutation(record) {
    const candidate = 'textarea, dialog, .popup, .cm-editor-tools';
    if (record.type === 'attributes') {
        return record.target.matches(candidate) || Boolean(record.target.querySelector(candidate));
    }
    return [...record.addedNodes].some(node => node.nodeType === Node.ELEMENT_NODE
        && (node.matches(candidate) || node.querySelector(candidate)));
}

function init() {
    let frame = 0;
    new MutationObserver(records => {
        if (frame || !records.some(relevantEditorMutation)) return;
        frame = requestAnimationFrame(() => {
            frame = 0;
            scan();
        });
    }).observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['open', 'hidden'],
    });
    document.addEventListener('focusin', event => {
        if (event.target.matches?.(selector) && !event.target.readOnly && !event.target.disabled) attach(event.target);
    });
    document.addEventListener('keydown', event => {
        const open = controls.get(event.target);
        if (!open || !(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'h') return;
        event.preventDefault();
        event.stopPropagation();
        open();
    }, true);
    scan();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
