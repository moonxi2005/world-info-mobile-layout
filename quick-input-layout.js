const marked = new Set();
function layout() {
    const groups = [...document.querySelectorAll('#send_form [id^="script_container_"]')];
    const input = groups.find(group => [...group.children].some(button => button.textContent.trim() === '【元】'));
    if (!input) return;
    const host = input.parentElement;
    host.classList.add('th-quick-layout');
    marked.add(host);
    for (const child of host.children) {
        const tool = child !== input && /创世回廊|防截断/.test(child.textContent);
        child.classList.remove('th-quick-input', 'th-quick-tool', 'th-quick-other');
        child.classList.add(child === input ? 'th-quick-input' : tool ? 'th-quick-tool' : 'th-quick-other');
        marked.add(child);
    }
}
let frame = 0;
const observer = new MutationObserver(() => {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; layout(); });
});
const form = document.getElementById('send_form');
if (form) observer.observe(form, { childList: true, subtree: true });
layout();
window.addEventListener('pagehide', () => {
    observer.disconnect();
    cancelAnimationFrame(frame);
    for (const node of marked) node.classList.remove('th-quick-layout', 'th-quick-input', 'th-quick-tool', 'th-quick-other');
}, { once: true });
