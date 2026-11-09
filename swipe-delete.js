import { deleteSwipe, isGenerating } from '../../../../script.js';

const context = () => SillyTavern.getContext();
let deleting = false;

function refresh() {
    const chat = document.getElementById('chat');
    if (!chat) return;
    const messages = context().chat ?? [];
    for (const floor of chat.querySelectorAll('.mes[mesid]')) {
        const message = messages[Number(floor.getAttribute('mesid'))];
        const anchor = floor.querySelector('.mes_buttons .extraMesButtonsHint');
        if (!anchor || !message || message.is_user || message.is_system) continue;
        let button = floor.querySelector('.tuit-delete-swipe');
        if (!button) {
            button = document.createElement('button');
            button.type = 'button';
            button.className = 'mes_button tuit-delete-swipe';
            button.textContent = '×';
            button.setAttribute('aria-label', '删除当前候选回复');
            anchor.before(button);
        }
        const count = message.swipes?.length ?? 1;
        button.disabled = deleting || isGenerating() || count <= 1;
        button.title = count <= 1 ? '仅剩一个候选回复' : '直接删除当前候选回复';
    }
}

async function removeCurrent(event) {
    const button = event.target.closest?.('.tuit-delete-swipe');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const floor = button.closest('.mes[mesid]');
    const id = Number(floor?.getAttribute('mesid'));
    const message = context().chat?.[id];
    if (deleting || button.disabled || isGenerating() || !message || message.is_user || message.is_system) return;
    if (floor.querySelector('textarea.edit_textarea')) {
        window.toastr?.info('请先结束当前消息的编辑');
        return;
    }
    const swipe = Number(message.swipe_id ?? 0);
    if (!Array.isArray(message.swipes) || message.swipes.length <= 1
        || !Number.isInteger(swipe) || swipe < 0 || swipe >= message.swipes.length) return;
    deleting = true;
    refresh();
    try {
        await deleteSwipe(swipe, id);
    } catch (error) {
        console.error('[酒馆界面优化合集] 删除候选回复失败', error);
        window.toastr?.error('删除候选回复失败，请检查当前聊天');
    } finally {
        deleting = false;
        refresh();
    }
}

let frame = 0;
function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; refresh(); });
}

document.addEventListener('click', removeCurrent);
let chatRoot;
const messageObserver = new MutationObserver(records => {
    if (records.some(record => [...record.addedNodes].some(node =>
        node.nodeType === Node.ELEMENT_NODE && (
            node.matches('.mes[mesid], .mes_buttons, .extraMesButtonsHint')
            || node.querySelector('.mes[mesid], .mes_buttons, .extraMesButtonsHint')
        )))) schedule();
});
function bindChat() {
    const current = document.getElementById('chat');
    if (current !== chatRoot) {
        messageObserver.disconnect();
        chatRoot = current;
        if (chatRoot) messageObserver.observe(chatRoot, { childList: true, subtree: true });
        schedule();
    }
}
new MutationObserver(bindChat).observe(document.body, { childList: true, subtree: true });
bindChat();

const ctx = context();
for (const name of ['CHAT_CHANGED', 'MESSAGE_RECEIVED', 'MESSAGE_SWIPED', 'MESSAGE_SWIPE_DELETED',
    'MESSAGE_DELETED', 'MORE_MESSAGES_LOADED', 'GENERATION_STARTED', 'GENERATION_ENDED', 'GENERATION_STOPPED']) {
    const type = ctx.event_types?.[name] ?? ctx.eventTypes?.[name];
    if (type) ctx.eventSource.on(type, () => { bindChat(); schedule(); });
}
refresh();
