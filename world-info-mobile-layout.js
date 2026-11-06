// Inline phone picker delegates selection to the native world-info control.
(() => {
    if (window.__worldInfoMobilePicker) return;
    window.__worldInfoMobilePicker = true;
    const phone = matchMedia('(max-width: 600px) and (max-device-width: 600px) and (pointer: coarse)');
    let select, button, panel, search, list, optionsObserver;
    function close() {
        if (!panel) return;
        panel.hidden = true;
        button.setAttribute('aria-expanded', 'false');
    }
    function render() {
        list.replaceChildren();
        const query = search.value.trim().toLocaleLowerCase();
        for (const option of select.options) {
            if (!option.value || option.hidden || !option.textContent.toLocaleLowerCase().includes(query)) continue;
            const item = document.createElement('button');
            item.type = 'button'; item.className = 'wim-book-option';
            item.textContent = option.textContent;
            item.disabled = option.disabled;
            item.setAttribute('aria-pressed', String(option.selected));
            item.addEventListener('click', () => {
                if (!phone.matches || option.disabled) return;
                const changed = select.value !== option.value;
                select.value = option.value;
                close();
                if (changed) {
                    if (window.jQuery) window.jQuery(select).trigger('change');
                    else select.dispatchEvent(new Event('change', { bubbles: true }));
                }
                sync(); button.focus({ preventScroll: true });
            });
            list.append(item);
        }
        if (!list.children.length) { const empty = document.createElement('div'); empty.className = 'wim-book-empty'; empty.textContent = '没有匹配的世界书'; list.append(empty); }
    }
    function sync() {
        button.textContent = `${select.selectedOptions[0]?.textContent || '选择以编辑'} ▾`;
        button.disabled = select.disabled;
        button.title = select.selectedOptions[0]?.textContent || '选择以编辑';
        if (!panel.hidden) render();
    }
    // This control only changes the editor's list view in TauriTavern 2.3.
    let sortControl;
    function restoreSortControl() {
        if (sortControl?.disabled && select?.value && !select.disabled && sortControl.options.length > 1) {
            sortControl.disabled = false;
        }
    }

    const sortObserver = new MutationObserver(restoreSortControl);
    function bind() {
        const currentSort = document.querySelector('#world_popup select#world_info_sort_order');
        if (currentSort !== sortControl) {
            sortObserver.disconnect();
            sortControl = currentSort;
            if (sortControl) sortObserver.observe(sortControl, { attributes: true, attributeFilter: ['disabled'] });
        }
        restoreSortControl();
        const current = document.getElementById('world_editor_select');
        if (!current || current === select) return;
        optionsObserver?.disconnect(); button?.remove(); panel?.remove();
        select = current;
        select.parentElement.classList.add('wim-inline-picker-ready');
        button = document.createElement('button'); button.type = 'button'; button.id = 'wim-book-select';
        button.className = 'text_pole'; button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', 'wim-book-picker');
        panel = document.createElement('div'); panel.id = 'wim-book-picker'; panel.hidden = true;
        search = document.createElement('input'); search.type = 'search'; search.placeholder = '搜索世界书…'; search.className = 'text_pole'; search.setAttribute('aria-label', '搜索世界书');
        list = document.createElement('div'); list.className = 'wim-book-list';
        panel.append(search, list);
        const sibling = select.nextElementSibling;
        const anchor = sibling?.classList.contains('select2-container') ? sibling : select;
        anchor.insertAdjacentElement('afterend', button); button.insertAdjacentElement('afterend', panel);
        button.addEventListener('click', () => {
            if (!phone.matches) return;
            panel.hidden = !panel.hidden; button.setAttribute('aria-expanded', String(!panel.hidden));
            if (!panel.hidden) { search.value = ''; render(); }
        });
        search.addEventListener('input', render);
        panel.addEventListener('keydown', event => { if (event.key === 'Escape') { close(); button.focus(); } });
        select.addEventListener('change', sync);
        select.addEventListener('change', restoreSortControl);
        optionsObserver = new MutationObserver(sync);
        optionsObserver.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['value', 'selected', 'disabled', 'label'] });
        sync();
        restoreSortControl();
    }
    phone.addEventListener('change', () => { close(); bind(); });
    let queued = false;
    new MutationObserver(() => { if (!queued) { queued = true; queueMicrotask(() => { queued = false; bind(); }); } }).observe(document.body, { childList: true, subtree: true });
    bind();
})();
