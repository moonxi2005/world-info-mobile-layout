// Modules remain in the extension root to preserve native relative imports.
(async () => {
    if (window.__tavernUiToolkit) return;
    window.__tavernUiToolkit = true;
    for (const module of ['floor-navigator', 'topbar-enhancements', 'prompt-itemization-wide', 'world-info-mobile-layout']) {
        try { await import(`./${module}.js`); }
        catch (error) { console.error(`[酒馆界面优化合集] ${module} 加载失败`, error); }
    }
})();
