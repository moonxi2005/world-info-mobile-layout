const storageKey = 'tauritavern.local-notebooks.v1';

function element(tag, text = '') {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
}

function button(text) {
    const node = element('button', text);
    node.type = 'button';
    node.className = 'menu_button';
    return node;
}

function createNotebookPanel(onClose) {
    const panel = element('aside');
    panel.id = 'ln-panel';
    panel.className = 'ln-panel';
    panel.hidden = true;
    panel.setAttribute('aria-labelledby', 'ln-heading');

    const header = element('header');
    const heading = element('h3', '本地记事夹');
    heading.id = 'ln-heading';
    const close = button('关闭');
    close.addEventListener('click', onClose);
    header.append(heading, close);

    const toolbar = element('div');
    toolbar.className = 'ln-toolbar';
    const picker = element('select');
    picker.setAttribute('aria-label', '选择记事本');
    picker.className = 'text_pole';
    const add = button('新建');
    const remove = button('删除');
    toolbar.append(picker, add, remove);

    const title = element('input');
    title.type = 'text';
    title.className = 'text_pole';
    title.placeholder = '记事本名称';
    title.setAttribute('aria-label', '记事本名称');

    const content = element('textarea');
    content.className = 'text_pole';
    content.setAttribute('aria-label', '笔记正文');

    const status = element('small');
    status.setAttribute('role', 'status');
    panel.append(header, toolbar, title, content, status);


    let notes = [];
    let active = null;
    let readable = true;

    function save() {
        try {
            localStorage.setItem(storageKey, JSON.stringify({ notes, active }));
            status.textContent = '已保存到本机';
            return true;
        } catch (error) {
            status.textContent = '保存失败。请先复制正文，刷新或重启可能丢失本次修改。';
            console.error('[本地记事夹] 保存失败', error);
            return false;
        }
    }

    function render() {
        picker.replaceChildren();
        for (const note of notes) picker.add(new Option(note.title.trim() || '未命名', note.id));
        const note = notes.find(item => item.id === active);
        picker.value = active ?? '';
        picker.disabled = !notes.length;
        add.disabled = !readable;
        title.disabled = content.disabled = remove.disabled = !note;
        title.value = note?.title ?? '';
        content.value = note?.content ?? '';
        content.placeholder = note ? '在这里写笔记…' : '点击「新建」开始记笔记';
    }

    function load() {
        try {
            const raw = localStorage.getItem(storageKey);
            const stored = raw === null ? { notes: [], active: null } : JSON.parse(raw);
            if (!Array.isArray(stored.notes) || stored.notes.some(note =>
                typeof note?.id !== 'string' || typeof note.title !== 'string' || typeof note.content !== 'string')) {
                throw new Error('Invalid notebook data');
            }
            notes = stored.notes;
            active = notes.find(note => note.id === stored.active)?.id ?? notes[0]?.id ?? null;
            status.textContent = '笔记存放在本机';
        } catch (error) {
            readable = false;
            status.textContent = '无法读取本地笔记。原数据已保留。';
            console.error('[本地记事夹] 读取失败', error);
        }
        render();
    }

    picker.addEventListener('change', () => {
        active = picker.value;
        render();
        save();
    });
    add.addEventListener('click', () => {
        active = Array.from(crypto.getRandomValues(new Uint32Array(4)), value => value.toString(16)).join('-');
        notes.push({ id: active, title: '新记事本', content: '' });
        render();
        save();
        title.focus();
        title.select();
    });
    remove.addEventListener('click', () => {
        const index = notes.findIndex(note => note.id === active);
        if (index < 0 || !window.confirm('删除这个记事本？')) return;
        const previousActive = active;
        const [removed] = notes.splice(index, 1);
        active = notes[Math.min(index, notes.length - 1)]?.id ?? null;
        if (!save()) {
            notes.splice(index, 0, removed);
            active = previousActive;
        }
        render();
    });
    title.addEventListener('input', () => {
        const note = notes.find(item => item.id === active);
        if (!note) return;
        note.title = title.value;
        picker.selectedOptions[0].text = title.value.trim() || '未命名';
        save();
    });
    content.addEventListener('input', () => {
        const note = notes.find(item => item.id === active);
        if (!note) return;
        note.content = content.value;
        save();
    });
    load();
    return panel;
}

function init() {
    const dock = element('div');
    dock.className = 'ln-dock';
    const toggle = button('›');
    toggle.className = 'ln-tab';
    toggle.setAttribute('aria-label', '展开本地记事夹');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-controls', 'ln-panel');

    function setOpen(open) {
        panel.hidden = !open;
        toggle.textContent = open ? '‹' : '›';
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', open ? '收起本地记事夹' : '展开本地记事夹');
    }

    const panel = createNotebookPanel(() => {
        setOpen(false);
        toggle.focus();
    });
    const positionKey = 'tauritavern.local-notebooks.tab-position.v1';
    let position = 0.68;
    try {
        const saved = localStorage.getItem(positionKey);
        if (saved !== null && Number.isFinite(Number(saved))) {
            position = Math.max(0, Math.min(1, Number(saved)));
        }
    } catch { /* The tab remains draggable when storage is unavailable. */ }

    const travel = () => Math.max(0, window.innerHeight - toggle.offsetHeight - 16);
    function placeTab() {
        dock.style.setProperty('--ln-top', `${8 + travel() * position}px`);
    }

    let drag = null;
    let suppressClick = false;
    toggle.addEventListener('pointerdown', event => {
        if (!event.isPrimary || event.button !== 0) return;
        suppressClick = false;
        drag = { id: event.pointerId, startY: event.clientY, top: dock.getBoundingClientRect().top, moved: false };
        toggle.setPointerCapture(event.pointerId);
    });
    toggle.addEventListener('pointermove', event => {
        if (drag?.id !== event.pointerId) return;
        const distance = event.clientY - drag.startY;
        if (!drag.moved && Math.abs(distance) < 5) return;
        drag.moved = true;
        const available = travel();
        if (available > 0) position = Math.max(0, Math.min(1, (drag.top + distance - 8) / available));
        placeTab();
    });
    function finishDrag(event) {
        if (drag?.id !== event.pointerId) return;
        suppressClick = drag.moved;
        drag = null;
        if (suppressClick) {
            try { localStorage.setItem(positionKey, String(position)); }
            catch { /* Keep the current position for this session. */ }
        }
    }
    toggle.addEventListener('pointerup', finishDrag);
    toggle.addEventListener('pointercancel', finishDrag);
    toggle.addEventListener('lostpointercapture', finishDrag);
    toggle.addEventListener('click', event => {
        if (suppressClick && event.detail > 0) {
            suppressClick = false;
            return;
        }
        setOpen(panel.hidden);
    });
    window.addEventListener('resize', placeTab);
    dock.append(toggle, panel);
    document.body.append(dock);
    placeTab();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
