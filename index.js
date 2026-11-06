// Each feature loads its own script and stylesheet after its switch is read.
async function startToolkit() {
    if (window.__tavernUiToolkit) return;
    const context = SillyTavern.getContext();
    window.__tavernUiToolkit = true;
    const settings = context.extensionSettings.tavernUiToolkit ??= {};
    const enabled = settings.modules ??= {};
    const features = [
        { id: 'floor-navigator', name: '楼层快速导航', description: '聊天左侧的楼层列表、摘要预览和拖动定位。', action: '重置楼层位置', event: 'reset-floor-position' },
        { id: 'topbar-enhancements', name: '顶栏增强与聊天总结', description: '聊天记录下拉和侧栏、改名快捷词、总结与悬停预览。', action: '快捷词与总结设置', event: 'topbar-settings' },
        { id: 'prompt-itemization-wide', name: '提示词拆分双栏', description: '在电脑窗口内并排查看统计和提示词正文。' },
        { id: 'preset-entry-filter', name: '预设条目筛选', description: '在聊天补全的提示词管理器中搜索条目，按状态、角色和分区筛选。' },
        { id: 'world-info-mobile-layout', name: '手机世界书布局', description: '紧凑总控、页内选书和条目编辑排版。' },
        { id: 'editor-find-replace', name: '编辑器查找替换', description: '在正文编辑器中直接展开查找和替换。' },
        { id: 'local-notebooks', name: '本地记事夹', description: '从屏幕边缘展开多个自动保存的本地记事本。' },
    ];
    // Carry forward the previous standalone floor switch on the first upgrade.
    if (enabled['floor-navigator'] === undefined) {
        try { enabled['floor-navigator'] = localStorage.getItem('floor-navigator-enabled') !== 'false'; }
        catch { enabled['floor-navigator'] = true; }
    }
    const initial = new Map(features.map(feature => [feature.id, enabled[feature.id] !== false]));
    const loaded = new Set();
    const actions = new Map();

    function mountSettings() {
        const host = document.getElementById('extensions_settings');
        if (!host) return false;
        if (document.getElementById('tavern-ui-toolkit-settings')) return true;
        const panel = document.createElement('details');
        panel.id = 'tavern-ui-toolkit-settings';
        const heading = document.createElement('summary');
        heading.textContent = '酒馆界面优化合集';
        const status = document.createElement('p');
        status.setAttribute('aria-live', 'polite');
        status.textContent = '各项开关独立保存，刷新酒馆后生效。';
        panel.append(heading, status);
        for (const feature of features) {
            const row = document.createElement('div');
            row.className = 'tuit-settings-row';
            const label = document.createElement('label');
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = enabled[feature.id] !== false;
            checkbox.addEventListener('change', () => {
                enabled[feature.id] = checkbox.checked;
                context.saveSettingsDebounced();
                const pending = features.some(item => (enabled[item.id] !== false) !== initial.get(item.id));
                status.textContent = pending ? '开关已保存，请刷新酒馆以应用改动。' : '各项开关独立保存，刷新酒馆后生效。';
            });
            label.append(checkbox, document.createTextNode(feature.name));
            const description = document.createElement('small');
            description.textContent = feature.description;
            row.append(label, description);
            if (feature.action) {
                const action = document.createElement('button');
                action.type = 'button';
                action.className = 'menu_button';
                action.textContent = feature.action;
                action.disabled = !loaded.has(feature.id);
                action.addEventListener('click', () => document.dispatchEvent(new Event(`tavern-ui-toolkit:${feature.event}`)));
                actions.set(feature.id, action);
                row.append(action);
            }
            panel.append(row);
        }
        host.append(panel);
        return true;
    }

    if (!mountSettings()) {
        const observer = new MutationObserver(() => { if (mountSettings()) observer.disconnect(); });
        observer.observe(document.body, { childList: true, subtree: true });
    }
    for (const feature of features) {
        if (!initial.get(feature.id)) continue;
        const stylesheet = document.createElement('link');
        stylesheet.rel = 'stylesheet';
        stylesheet.href = new URL(`./${feature.id}.css`, import.meta.url).href;
        try {
            await new Promise((resolve, reject) => {
                stylesheet.addEventListener('load', resolve, { once: true });
                stylesheet.addEventListener('error', reject, { once: true });
                document.head.append(stylesheet);
            });
            if (feature.id === 'topbar-enhancements') await import('./chat-top-bar.js');
            await import(`./${feature.id}.js`);
            loaded.add(feature.id);
            const action = actions.get(feature.id);
            if (action) action.disabled = false;
        } catch (error) {
            stylesheet.remove();
            console.error(`[酒馆界面优化合集] ${feature.name} 加载失败`, error);
        }
    }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startToolkit, { once: true });
else void startToolkit();
