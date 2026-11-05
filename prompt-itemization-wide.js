// Reuse the built-in prompt viewer and its copy/diff controls; no prompt mutation.
(() => {
    if (window.__promptItemizationWide) return;
    window.__promptItemizationWide = true;
    let requestedMessage;
    const rememberMessage = event => {
        const trigger = event.target.closest('.mes_prompt');
        if (trigger) requestedMessage = Number(trigger.closest('.mes')?.getAttribute('mesid'));
    };
    document.addEventListener('pointerup', rememberMessage, true);
    document.addEventListener('click', rememberMessage, true);
    const enabled = () => innerWidth >= 480 && !matchMedia('(pointer: coarse) and (max-device-width: 600px)').matches;
    const enhance = () => {
        if (!enabled()) return;
        for (const raw of document.querySelectorAll('#rawPromptPopup')) {
            const dialog = raw.closest('.popup, #dialogue_popup, dialog');
            const content = raw.closest('.popup-content, #dialogue_popup_text');
            if (!dialog || !content || content.querySelector('.piw-layout')) continue;
            const show = content.querySelector('#showRawPrompt');
            const wrapper = raw.querySelector('#rawPromptWrapper');
            if (!show || !wrapper) continue;
            const stats = document.createElement('section');
            const messageId = requestedMessage;
            stats.className = 'piw-stats'; stats.setAttribute('aria-label', '提示词拆分统计');
            const layout = document.createElement('div'); layout.className = 'piw-layout';
            const rawParent = raw.parentElement, rawNext = raw.nextSibling;
            // Both current and legacy templates put this panel at the end.
            raw.remove();
            stats.append(...content.childNodes);
            layout.append(stats, raw); content.append(layout);
            dialog.classList.add('piw-dialog');
            raw.classList.add('piw-raw'); raw.setAttribute('aria-label', '提示词正文');
            const restore = () => {
                if (!layout.isConnected) return;
                content.append(...stats.childNodes);
                if (rawParent === content) content.insertBefore(raw, rawNext?.parentNode === content ? rawNext : null);
                else rawParent.append(raw);
                layout.remove(); dialog.classList.remove('piw-dialog'); raw.classList.remove('piw-raw');
            };
            const resize = () => { if (!enabled()) { restore(); window.removeEventListener('resize', resize); } };
            window.addEventListener('resize', resize);
            dialog.addEventListener('close', () => window.removeEventListener('resize', resize), { once: true });
            // Native listener resolves the correct selected message and renders
            // raw text safely. Wait until the popup is attached and initialized.
            setTimeout(async () => {
                if (!layout.isConnected || !enabled()) return;
                if (wrapper.textContent.trim()) return;
                // Render the selected message directly: the native button may
                // classify a narrow desktop window as mobile and open a second dialog.
                if (Number.isInteger(messageId)) {
                    try {
                        let source;
                        try { source = await import('../../../itemized-prompts.js'); }
                        catch { source = await import('../../../../script.js'); }
                        const item = source.itemizedPrompts?.find(p => Number(p.mesId) === messageId);
                        if (item?.rawPrompt != null && layout.isConnected) {
                            const rawText = Array.isArray(item.rawPrompt) ? item.rawPrompt.map(p => typeof p.content === 'string' ? p.content : JSON.stringify(p.content)).join('\n') : String(item.rawPrompt);
                            wrapper.textContent = rawText;
                            show.addEventListener('click', event => {
                                event.stopImmediatePropagation();
                                wrapper.textContent = rawText;
                            }, true);
                            return;
                        }
                    } catch (error) { console.debug('[提示词宽屏] 使用原生正文显示', error); }
                }
                if (layout.isConnected) show.click();
            }, 0);
        }
    };
    let pending = false;
    new MutationObserver(records => {
        if (!records.some(r => [...r.addedNodes].some(n => n.nodeType === 1))) return;
        if (!pending) { pending = true; queueMicrotask(() => { pending = false; enhance(); }); }
    }).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('resize', enhance);
    enhance();
})();
