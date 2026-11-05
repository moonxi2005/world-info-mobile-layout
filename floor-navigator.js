// A local SillyTavern / TauriTavern extension. Message text is always rendered as text.
(() => {
    if (document.getElementById('floor-navigator')) return;
    const context = () => SillyTavern.getContext();
    const nav = document.createElement('nav');
    nav.id = 'floor-navigator';
    nav.setAttribute('aria-label', '聊天楼层快速导航');
    const toggle = document.createElement('button');
    toggle.className = 'fn-toggle';
    toggle.textContent = '楼层';
    toggle.title = '上下拖动调整位置；点击收起 / 展开（蓝色：用户，橙色：AI）';
    toggle.setAttribute('aria-expanded', 'true');
    const list = document.createElement('div');
    list.className = 'fn-list';
    nav.append(toggle, list);
    const preview = document.createElement('div');
    preview.id = 'fn-preview';
    preview.hidden = true;
    preview.setAttribute('role', 'tooltip');
    document.body.append(nav, preview);
    let chatElement, observer, frame, renderTimer, current = -1, jumping = false, sequence = 0;
    let fingerprint = '', buttons = [];
    const findMessage = id => chatElement?.querySelector(`.mes[mesid="${id}"]`);
    let previewSequence = 0, regexEnginePromise;
    const hidePreview = () => { ++previewSequence; preview.hidden = true; };
    const phoneQuery = '(max-width: 600px) and (max-device-width: 600px) and (pointer: coarse)';
    const positionKey = () => `floor-navigator-y-${matchMedia(phoneQuery).matches ? 'phone' : 'desktop'}`;
    const savedPositions = {};
    let drag, suppressClickUntil = 0;
    function savedY() {
        const key = positionKey();
        if (!(key in savedPositions)) {
            let value;
            try { value = localStorage.getItem(key); } catch { /* Optional persistence. */ }
            const number = value == null ? NaN : Number(value);
            savedPositions[key] = Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : null;
        }
        return savedPositions[key];
    }
    const clampTop = top => Math.max(4, Math.min(Math.max(4, innerHeight - 48), top));
    toggle.addEventListener('pointerdown', event => {
        if (!event.isPrimary || event.button !== 0) return;
        drag = { id: event.pointerId, startY: event.clientY, top: nav.getBoundingClientRect().top, moved: false, key: positionKey() };
        toggle.setPointerCapture(event.pointerId);
        hidePreview();
    });
    toggle.addEventListener('pointermove', event => {
        if (!drag || drag.id !== event.pointerId) return;
        const delta = event.clientY - drag.startY;
        if (!drag.moved && Math.abs(delta) < 5) return;
        drag.moved = true;
        nav.classList.add('fn-dragging');
        const top = clampTop(drag.top + delta);
        savedPositions[drag.key] = top / Math.max(4, innerHeight - 48);
        event.preventDefault();
        position();
    });
    function finishDrag(event) {
        if (!drag || drag.id !== event.pointerId) return;
        if (drag.moved) {
            suppressClickUntil = Date.now() + 500;
            try { localStorage.setItem(drag.key, String(savedPositions[drag.key])); } catch { /* Optional persistence. */ }
        }
        const id = drag.id;
        drag = undefined;
        nav.classList.remove('fn-dragging');
        if (toggle.hasPointerCapture(id)) toggle.releasePointerCapture(id);
    }
    toggle.addEventListener('pointerup', finishDrag);
    toggle.addEventListener('pointercancel', finishDrag);
    toggle.addEventListener('lostpointercapture', finishDrag);

    function existingSummary(message) {
        const stored = message.extra?.summary ?? message.summary;
        if (typeof stored === 'string' && stored.trim()) return stored.trim();
        const raw = String(message.mes || '');
        // A <summary> inside <details> is often only a disclosure heading.
        // For a disclosure explicitly named 摘要/summary, use its body instead.
        const withoutDetails = raw.replace(/<details\b[^>]*>([\s\S]*?)<\/details\s*>/gi, (_, body) => {
            const heading = body.match(/<summary\b[^>]*>([\s\S]*?)<\/summary\s*>/i);
            if (!heading || !/摘要|summary/i.test(heading[1])) return '';
            const content = body.replace(heading[0], '').trim();
            return `<summary>${content}</summary>`;
        });
        const matches = [...withoutDetails.matchAll(/<(summary|摘要)(?=\s|>)[^>]*>([\s\S]*?)<\/\1\s*>/gi)];
        for (const match of matches) {
            const template = document.createElement('template');
            template.innerHTML = match[2];
            template.content.querySelectorAll('script, style, iframe').forEach(el => el.remove());
            const text = template.content.textContent?.trim();
            if (text) return text;
        }
        return '';
    }

    async function previewText(id, message, chat) {
        if (message.is_user || message.is_system) return String(message.mes || '');
        const summary = existingSummary(message);
        if (summary) return summary;
        // Already rendered messages are the authoritative display result. Do not
        // apply regex twice: replacements need not be idempotent.
        const rendered = findMessage(id)?.querySelector('.mes_text');
        if (rendered && !findMessage(id)?.querySelector('textarea.edit_textarea')) return rendered.innerText;
        // Older messages may not exist in the DOM. Use the same display-only
        // regex placement and depth as the chat renderer, without loading floors.
        regexEnginePromise ??= import('../../regex/engine.js').catch(error => {
            regexEnginePromise = undefined;
            throw error;
        });
        const { getRegexedString, regex_placement } = await regexEnginePromise;
        const result = getRegexedString(String(message.mes || ''),
            message.is_user ? regex_placement.USER_INPUT : regex_placement.AI_OUTPUT,
            { isMarkdown: true, isPrompt: false, depth: chat.length - id - 1 });
        // An inert template decodes HTML entities without running replacement
        // scripts or mounting regex-generated HTML in the page.
        const template = document.createElement('template');
        template.innerHTML = result;
        template.content.querySelectorAll('script, style, iframe, template, [hidden], [style]').forEach(el => {
            if (el.matches('script, style, iframe, template, [hidden]') || /display\s*:\s*none|visibility\s*:\s*hidden/i.test(el.getAttribute('style') || '')) el.remove();
        });
        template.content.querySelectorAll('br').forEach(el => el.replaceWith(' '));
        return template.content.textContent || '';
    }

    function position() {
        if (!chatElement) { nav.hidden = true; return; }
        const r = chatElement.getBoundingClientRect();
        nav.hidden = !context().chat?.length || r.width === 0 || r.height === 0;
        const left = r.left >= 52 ? r.left - 50 : Math.max(2, r.left + 2);
        let top = Math.max(4, r.top + 12);
        let maxHeight = Math.max(30, Math.min(r.height - 24, innerHeight - r.top - 24));
        if (matchMedia(phoneQuery).matches) {
            top += 16;
            // Keep clear of both the two-row toolbar and its optional connection row.
            for (const id of ['extensionTopBar', 'extensionConnectionProfiles']) {
                const bar = document.getElementById(id);
                if (bar?.getClientRects().length) top = Math.max(top, bar.getBoundingClientRect().bottom + 12);
            }
            maxHeight = Math.max(30, Math.min(r.bottom, innerHeight) - top - 12);
        }
        const manualY = savedY();
        if (manualY !== null) {
            top = clampTop(manualY * Math.max(4, innerHeight - 48));
            maxHeight = Math.max(30, innerHeight - top - 8);
        }
        nav.style.left = `${left}px`;
        nav.style.top = `${top}px`;
        nav.style.maxHeight = `${maxHeight}px`;
    }

    async function showPreview(button) {
        const token = ++previewSequence;
        const id = Number(button.dataset.floor);
        const chat = context().chat;
        const message = chat?.[id];
        if (!message) return;
        preview.hidden = true;
        let text;
        try {
            text = String(await previewText(id, message, chat)).replace(/\s+/g, ' ').trim();
        } catch (error) {
            console.warn('[楼层导航] 显示正则处理失败', error);
            text = '暂时无法获取正则处理后的预览';
        }
        if (token !== previewSequence || context().chat !== chat || !button.isConnected) return;
        const heading = document.createElement('strong');
        heading.textContent = `#${id} · ${message.name || (message.is_user ? '用户' : 'AI')}`;
        preview.replaceChildren(heading, document.createTextNode(text ? text.slice(0, 180) + (text.length > 180 ? '……' : '') : '（空消息）'));
        preview.hidden = false;
        const r = button.getBoundingClientRect();
        preview.style.left = `${Math.max(4, Math.min(r.right + 10, innerWidth - preview.offsetWidth - 8))}px`;
        preview.style.top = `${Math.max(8, Math.min(r.top - 8, innerHeight - preview.offsetHeight - 8))}px`;
    }

    function updateCurrent() {
        if (!chatElement || jumping) return;
        const rect = chatElement.getBoundingClientRect();
        const messages = chatElement.querySelectorAll('.mes[mesid]');
        let active = -1;
        for (const el of messages) {
            const r = el.getBoundingClientRect();
            if (r.bottom > rect.top + 12 && r.top < rect.bottom) { active = Number(el.getAttribute('mesid')); break; }
        }
        if (active === current) return;
        buttons[current]?.removeAttribute('aria-current');
        current = active;
        const button = buttons[current];
        if (button) {
            button.setAttribute('aria-current', 'true');
            // Scroll only the rail, never the surrounding page.
            list.scrollTop = button.offsetTop - list.offsetTop - list.clientHeight / 2 + button.offsetHeight / 2;
        }
    }

    function scheduleCurrent() {
        if (!frame) frame = requestAnimationFrame(() => { frame = 0; updateCurrent(); });
    }

    async function jump(id) {
        const token = ++sequence;
        const chat = context().chat;
        jumping = true;
        hidePreview();
        try {
            let target = findMessage(id);
            if (!target) {
                const api = await import('../../../../script.js');
                if (token !== sequence || context().chat !== chat) return;
                const first = Number(chatElement?.querySelector('.mes[mesid]')?.getAttribute('mesid'));
                if (Number.isFinite(first) && first > id && typeof api.showMoreMessages === 'function') {
                    await api.showMoreMessages(first - id);
                }
                target = findMessage(id);
            }
            if (token !== sequence || context().chat !== chat) return;
            if (!target) throw new Error('目标消息尚未加载，请先加载更早的消息后重试');
            target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
            target.classList.remove('fn-jump-highlight');
            void target.offsetWidth;
            target.classList.add('fn-jump-highlight');
            setTimeout(() => target.classList.remove('fn-jump-highlight'), 1700);
        } catch (error) {
            console.warn('[楼层导航]', error);
            window.toastr?.warning(error.message || '楼层跳转失败');
        } finally {
            if (token === sequence) { jumping = false; setTimeout(scheduleCurrent, 450); }
        }
    }

    function render() {
        const chat = context().chat || [];
        // Content changes do not rebuild buttons; previews read the latest message on demand.
        const key = JSON.stringify([context().getCurrentChatId?.(), chat.map(m => m.is_system ? 2 : m.is_user ? 1 : 0)]);
        if (fingerprint !== key) {
            fingerprint = key;
            hidePreview();
            buttons = chat.map((m, id) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = `fn-floor ${m.is_system ? 'fn-system' : m.is_user ? 'fn-user' : 'fn-ai'}`;
                button.dataset.floor = id;
                button.setAttribute('aria-label', `跳转到 #${id} 楼，${m.is_user ? '用户' : m.is_system ? '系统' : 'AI'}`);
                const dot = document.createElement('span');
                dot.className = 'fn-dot';
                dot.setAttribute('aria-hidden', 'true');
                button.append(dot, document.createTextNode(String(id)));
                return button;
            });
            list.replaceChildren(...buttons);
            current = -1;
        }
        position();
        scheduleCurrent();
    }
    function scheduleRender() { clearTimeout(renderTimer); renderTimer = setTimeout(render, 120); }
    toggle.addEventListener('click', () => {
        if (Date.now() < suppressClickUntil) return;
        const collapsed = nav.classList.toggle('fn-collapsed');
        toggle.setAttribute('aria-expanded', String(!collapsed));
        hidePreview();
        if (!collapsed) { current = -1; scheduleCurrent(); }
    });
    list.addEventListener('click', event => { const b = event.target.closest('.fn-floor'); if (b) void jump(Number(b.dataset.floor)); });
    list.addEventListener('mouseover', event => { const b = event.target.closest('.fn-floor'); if (b) showPreview(b); });
    list.addEventListener('focusin', event => { const b = event.target.closest('.fn-floor'); if (b) showPreview(b); });
    list.addEventListener('mouseleave', hidePreview);
    list.addEventListener('focusout', hidePreview);
    list.addEventListener('scroll', hidePreview, { passive: true });
    list.addEventListener('keydown', event => { if (event.key === 'Escape') hidePreview(); });
    window.addEventListener('resize', () => { position(); hidePreview(); });

    function bindChat() {
        const element = document.getElementById('chat');
        if (element === chatElement) return;
        observer?.disconnect();
        chatElement?.removeEventListener('scroll', scheduleCurrent);
        chatElement = element;
        if (element) {
            element.addEventListener('scroll', scheduleCurrent, { passive: true });
            observer = new MutationObserver(scheduleRender);
            observer.observe(element, { childList: true, subtree: true, characterData: true });
        }
        fingerprint = '';
        render();
    }
    const ctx = context();
    for (const name of ['CHAT_CHANGED', 'MESSAGE_RECEIVED', 'MESSAGE_SENT', 'MESSAGE_DELETED', 'MESSAGE_UPDATED', 'MESSAGE_SWIPED', 'MORE_MESSAGES_LOADED']) {
        if (ctx.event_types?.[name]) ctx.eventSource.on(ctx.event_types[name], () => { bindChat(); scheduleRender(); });
    }
    document.addEventListener('tavern-ui-toolkit:reset-floor-position', () => {
        const key = positionKey();
        savedPositions[key] = null;
        try { localStorage.removeItem(key); } catch { /* Optional persistence. */ }
        position();
    });
    bindChat();
    // Also tracks chat panel resizing and replacement by layout extensions.
    setInterval(() => { bindChat(); position(); }, 1200);
})();
