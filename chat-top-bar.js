// Based on SillyTavern/Extension-TopInfoBar by Cohee1207, AGPL-3.0.
// Adapted for toolkit loading and initialization, 2026-11-05.
const {
    eventSource,
    event_types,
    getCurrentChatId,
    renameChat,
    getRequestHeaders,
    openGroupChat,
    openCharacterChat,
    executeSlashCommandsWithOptions,
    Popup,
} = SillyTavern.getContext();
import { addJQueryHighlight } from './jquery-highlight.js';
import { getGroupPastChats } from '../../../group-chats.js';
import { getPastCharacterChats, animation_duration, animation_easing, getGeneratingApi } from '../../../../script.js';
import { debounce, timestampToMoment, uuidv4, waitUntilCondition } from '../../../utils.js';
import { debounce_timeout } from '../../../constants.js';
import { t } from '../../../i18n.js';

const movingDivs = /** @type {HTMLDivElement} */ (document.getElementById('movingDivs'));
const sheld = /** @type {HTMLDivElement} */ (document.getElementById('sheld'));
const chat = /** @type {HTMLDivElement} */ (document.getElementById('chat'));
const draggableTemplate = /** @type {HTMLTemplateElement} */ (document.getElementById('generic_draggable_template'));
const apiBlock = /** @type {HTMLDivElement} */ (document.getElementById('rm_api_block'));

const topBar = document.createElement('div');
const chatName = document.createElement('select');
const searchInput = document.createElement('input');
const connectionProfiles = document.createElement('div');
const connectionProfilesStatus = document.createElement('div');
const connectionProfilesSelect = document.createElement('select');
const connectionProfilesIcon = document.createElement('img');

const icons = [
    {
        id: 'extensionTopBarToggleSidebar',
        icon: 'fa-fw fa-solid fa-box-archive',
        position: 'left',
        title: t`Toggle sidebar`,
        onClick: onToggleSidebarClick,
    },
    {
        id: 'extensionTopBarToggleConnectionProfiles',
        icon: 'fa-fw fa-solid fa-plug',
        position: 'left',
        title: t`Show connection profiles`,
        isTemporaryAllowed: true,
        onClick: onToggleConnectionProfilesClick,
    },
    {
        id: 'extensionTopBarChatManager',
        icon: 'fa-fw fa-solid fa-address-book',
        position: 'right',
        title: t`View chat files`,
        isTemporaryAllowed: true,
        onClick: onChatManagerClick,
    },
    {
        id: 'extensionTopBarNewChat',
        icon: 'fa-fw fa-solid fa-comments',
        position: 'right',
        title: t`New chat`,
        isTemporaryAllowed: true,
        onClick: onNewChatClick,
    },
    {
        id: 'extensionTopBarRenameChat',
        icon: 'fa-fw fa-solid fa-edit',
        position: 'right',
        title: t`Rename chat`,
        onClick: onRenameChatClick,
    },
    {
        id: 'extensionTopBarDeleteChat',
        icon: 'fa-fw fa-solid fa-trash',
        position: 'right',
        title: t`Delete chat`,
        onClick: async () => {
            const confirm = await Popup.show.confirm(t`Are you sure?`);
            if (confirm) {
                await executeSlashCommandsWithOptions('/delchat');
            }
        },
    },
    {
        id: 'extensionTopBarCloseChat',
        icon: 'fa-fw fa-solid fa-times',
        position: 'right',
        title: t`Close chat`,
        isTemporaryAllowed: true,
        onClick: onCloseChatClick,
    },
];

function onChatManagerClick() {
    document.getElementById('option_select_chat')?.click();
}

function onCloseChatClick() {
    document.getElementById('option_close_chat')?.click();
}

function onNewChatClick() {
    document.getElementById('option_start_new_chat')?.click();
}

async function onRenameChatClick() {
    const currentChatName = getCurrentChatId();

    if (!currentChatName) {
        return;
    }

    const newChatName = await Popup.show.input(t`Enter new chat name`, null, currentChatName);

    if (!newChatName || newChatName === currentChatName) {
        return;
    }

    await renameChat(currentChatName, String(newChatName));
}

function patchSheldIfNeeded() {
    // Fun fact: sheld is a typo. It should be shell.
    // It was fixed in OG TAI long ago, but we still have it here.
    if (!sheld) {
        console.error('Sheld not found. Did you finally rename it?');
        return;
    }

    const computedStyle = getComputedStyle(sheld);
    // Alert: We're not in a version that switched sheld to flex yet.
    if (computedStyle.display === 'grid') {
        sheld.classList.add('flexPatch');
    }
}

// Cache names by character and share requests while a list is loading.
const chatNamesCache = new Map();
let chatListRevision = 0;
let switchingChat = false;
let listOwner;
let sidebarSnapshot;

async function setChatName(name) {
    const revision = ++chatListRevision;
    const context = SillyTavern.getContext();
    const avatar = context.characters?.[context.characterId]?.avatar;
    const groupId = context.groupId;
    const owner = groupId ? `group:${groupId}` : `character:${avatar ?? ''}`;
    if (owner !== listOwner) {
        listOwner = owner;
        chatName.replaceChildren();
    }
    for (const icon of icons) {
        if (!icon.isTemporaryAllowed) document.getElementById(icon.id)?.classList.toggle('not-in-chat', !name);
    }
    if (!name) {
        const placeholder = new Option(t`No chat selected`, '');
        chatName.replaceChildren(placeholder);
        chatName.disabled = true;
        void populateSideBar();
        return;
    }
    if (![...chatName.options].some(option => option.value === name)) {
        sidebarSnapshot = undefined;
        chatName.add(new Option(name, name));
    }
    chatName.value = name;
    chatName.disabled = false;

    let names = [];
    if (groupId) {
        names = context.groups?.find(group => String(group.id) === String(groupId))?.chats ?? [];
    } else if (avatar) {
        let cached = chatNamesCache.get(avatar);
        if (!cached || (!cached.pending && (Date.now() - cached.time > 60000 || !cached.names.includes(name)))) {
            const record = { pending: true, time: Date.now(), names: [] };
            record.promise = getListOfCharacterChats(avatar).then(result => {
                record.pending = false;
                record.names = result;
                return result;
            });
            chatNamesCache.set(avatar, record);
            cached = record;
        }
        names = await cached.promise;
    }
    const active = SillyTavern.getContext();
    if (revision !== chatListRevision || getCurrentChatId() !== name
        || active.groupId !== groupId || active.characters?.[active.characterId]?.avatar !== avatar) return;
    const sorted = [...new Set([...names, name])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const previous = [...chatName.options];
    if (previous.length !== sorted.length || sorted.some((id, index) => previous[index].value !== id)) {
        chatName.replaceChildren(...sorted.map(id => new Option(id, id)));
    }
    chatName.value = name;
    void populateSideBar();
}

/**
 * Get list of chat names for a character.
 * @param {string} avatar Avatar name of the character
 * @returns {Promise<string[]>} List of chat names
 */
async function getListOfCharacterChats(avatar) {
    try {
        const result = await fetch('/api/characters/chats', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ avatar_url: avatar, simple: true }),
        });

        if (!result.ok) {
            return [];
        }

        const data = await result.json();
        return data.map(x => String(x.file_name).replace(/\.jsonl$/i, ''));
    } catch (error) {
        console.error('Failed to get list of character chats', error);
        return [];
    }
}

async function getChatFiles() {
    const context = SillyTavern.getContext();
    const chatId = getCurrentChatId();

    if (!chatId) {
        return [];
    }

    if (context.groupId) {
        return await getGroupPastChats(context.groupId);
    }

    if (context.characterId !== undefined) {
        return await getPastCharacterChats(context.characterId);
    }

    return [];
}

/**
 * Highlight search query in chat messages
 * @param {string} query Search query
 * @returns {void}
 */
function searchInChat(query) {
    const options = { element: 'mark', className: 'highlight' };
    const messages = jQuery(chat).find('.mes_text');
    messages.unhighlight(options);
    if (!query) {
        return;
    }
    const splitQuery = [...new Set(query.split(/\s+/u).filter(Boolean))];
    messages.highlight(splitQuery, options);
}

const searchDebounced = debounce((x) => searchInChat(x), 180);
const updateStatusDebounced = debounce(onOnlineStatusChange, 1000);

function addTopBar() {
    chatName.id = 'extensionTopBarChatName';
    topBar.id = 'extensionTopBar';
    searchInput.id = 'extensionTopBarSearchInput';
    searchInput.placeholder = 'Search...';
    searchInput.classList.add('text_pole');
    searchInput.type = 'search';
    searchInput.addEventListener('input', () => searchDebounced(searchInput.value.trim()));
    topBar.append(chatName, searchInput);
    sheld.insertBefore(topBar, chat);
}

function addIcons() {
    icons.forEach(icon => {
        const iconElement = document.createElement('i');
        iconElement.id = icon.id;
        iconElement.className = icon.icon;
        iconElement.title = icon.title;
        iconElement.tabIndex = 0;
        iconElement.classList.add('right_menu_button');
        iconElement.addEventListener('click', () => {
            if (iconElement.classList.contains('not-in-chat')) {
                return;
            }
            icon.onClick();
        });
        if (icon.position === 'left') {
            topBar.insertBefore(iconElement, chatName);
            return;
        }
        if (icon.position === 'right') {
            topBar.appendChild(iconElement);
            return;
        }
        if (icon.position === 'middle') {
            topBar.insertBefore(iconElement, searchInput);
            return;
        }
        if (icon.id === 'extensionTopBarRenameChat' && typeof renameChat !== 'function') {
            iconElement.classList.add('displayNone');
        }
    });
}

function addSideBar() {
    if (!draggableTemplate) {
        console.warn(t`Draggable template not found. Side bar will not be added.`);
        return;
    }

    const fragment = /** @type {DocumentFragment} */ (draggableTemplate.content.cloneNode(true));
    const draggable = fragment.querySelector('.draggable');
    const closeButton = fragment.querySelector('.dragClose');

    if (!draggable || !closeButton) {
        console.warn(t`Failed to find draggable or close button. Side bar will not be added.`);
        return;
    }

    draggable.id = 'extensionSideBar';
    closeButton.addEventListener('click', onToggleSidebarClick);

    const scrollContainer = document.createElement('div');
    scrollContainer.id = 'extensionSideBarContainer';
    draggable.appendChild(scrollContainer);

    const loaderContainer = document.createElement('div');
    loaderContainer.id = 'extensionSideBarLoader';
    draggable.appendChild(loaderContainer);

    const loaderIcon = document.createElement('i');
    loaderIcon.className = 'fa-2x fa-solid fa-gear fa-spin';
    loaderContainer.appendChild(loaderIcon);

    movingDivs.appendChild(draggable);
}

function addConnectionProfiles() {
    connectionProfiles.id = 'extensionConnectionProfiles';
    connectionProfilesStatus.id = 'extensionConnectionProfilesStatus';
    connectionProfilesSelect.id = 'extensionConnectionProfilesSelect';
    connectionProfilesSelect.title = t`Switch connection profile`;

    const connectionProfilesServerIcon = document.createElement('i');
    connectionProfilesServerIcon.id = 'extensionConnectionProfilesIcon';
    connectionProfilesServerIcon.className = 'fa-fw fa-solid fa-network-wired';

    connectionProfiles.append(connectionProfilesServerIcon, connectionProfilesSelect, connectionProfilesStatus, connectionProfilesIcon);
    sheld.insertBefore(connectionProfiles, chat);

    apiBlock.querySelectorAll('select').forEach(select => {
        select.addEventListener('input', () => updateStatusDebounced());
    });
}

function bindConnectionProfilesSelect() {
    waitUntilCondition(() => document.getElementById('connection_profiles') !== null).then(() => {
        const connectionProfilesMainSelect = /** @type {HTMLSelectElement} */ (document.getElementById('connection_profiles'));
        if (!connectionProfilesMainSelect) {
            return;
        }
        connectionProfilesSelect.addEventListener('change', async () => {
            connectionProfilesMainSelect.value = connectionProfilesSelect.value;
            connectionProfilesMainSelect.dispatchEvent(new Event('change'));
        });
        connectionProfilesMainSelect.addEventListener('change', async () => {
            connectionProfilesSelect.value = connectionProfilesMainSelect.value;
        });
        const observer = new MutationObserver(() => {
            connectionProfilesSelect.innerHTML = connectionProfilesMainSelect.innerHTML;
            connectionProfilesSelect.value = connectionProfilesMainSelect.value;
        });
        observer.observe(connectionProfilesMainSelect, { childList: true, subtree: true });
        connectionProfilesSelect.innerHTML = connectionProfilesMainSelect.innerHTML;
        connectionProfilesSelect.value = connectionProfilesMainSelect.value;
    }).catch(error => console.debug('[Chat Top Bar] Connection profiles unavailable', error));
}

async function onToggleSidebarClick() {
    const sidebar = document.getElementById('extensionSideBar');
    const toggle = document.getElementById('extensionTopBarToggleSidebar');

    if (!sidebar || !toggle) {
        console.warn(t`Sidebar or toggle button not found`);
        return;
    }

    toggle.classList.toggle('active');
    const alreadyVisible = sidebar.classList.contains('visible');

    const keyframes = [
        { opacity: alreadyVisible ? 1 : 0 },
        { opacity: alreadyVisible ? 0 : 1 },
    ];
    const options = {
        duration: animation_duration,
        easing: animation_easing,
    };

    const animation = sidebar.animate(keyframes, options);

    if (alreadyVisible) {
        await animation.finished;
        sidebar.classList.toggle('visible');
        await populateSideBar();
    } else {
        sidebar.classList.toggle('visible');
        await populateSideBar();
        await animation.finished;
    }

    savePanelsState();
}

export function getHistorySort() {
    return SillyTavern.getContext().extensionSettings.topInfoBarMobileFix?.historySort ?? 'newest';
}

const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function sizeInBytes(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    const match = String(value ?? '').trim().match(/^(\d+(?:[.,]\d+)?)\s*(B|Bytes?|[KMGT]i?B)?$/i);
    if (!match) return undefined;
    const power = 'KMGT'.indexOf((match[2] ?? '').charAt(0).toUpperCase());
    return Number(match[1].replace(',', '.')) * (match[2] && power >= 0 ? 1024 ** (power + 1) : 1);
}

function sortValue(row, sort, bySize) {
    if (bySize) return sizeInBytes(row?.file_size);
    return sort.startsWith('created-') ? row?.createdTime : row?.last_mes.valueOf();
}

export async function fetchHistoryChat(owner, name) {
    const group = owner.startsWith('group:');
    const avatar = group ? undefined : owner.slice('character:'.length);
    const response = await fetch(group ? '/api/chats/group/get' : '/api/chats/get', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify(group ? { id: name } : { avatar_url: avatar, file_name: name }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const messages = Array.isArray(data) ? data : data?.chat;
    if (!Array.isArray(messages)) throw new Error('聊天数据格式无效');
    return messages;
}

export function prepareCreationTimes(snapshot) {
    return snapshot.creationPromise ??= (async () => {
        const files = await snapshot.promise;
        let index = 0;
        async function loadNext() {
            while (index < files.length && snapshot.owner === listOwner) {
                const row = files[index++];
                try {
                    const listed = timestampToMoment(row.create_date ?? row.created_at).valueOf();
                    if (Number.isFinite(listed)) {
                        row.createdTime = listed;
                        continue;
                    }
                    const messages = await fetchHistoryChat(snapshot.owner, row.file_name);
                    const header = messages[0];
                    const explicit = timestampToMoment(header?.create_date ?? header?.chat_metadata?.create_date).valueOf();
                    if (Number.isFinite(explicit)) {
                        row.createdTime = explicit;
                        continue;
                    }
                    for (const message of messages) {
                        const time = timestampToMoment(message.send_date).valueOf();
                        if (!Number.isFinite(time)) continue;
                        row.createdTime = time;
                        break;
                    }
                } catch (error) {
                    console.warn('[Chat Top Bar] 无法读取创建时间', error);
                }
            }
        }
        await Promise.all(Array.from({ length: Math.min(4, files.length) }, loadNext));
        if (snapshot.owner !== listOwner) snapshot.creationPromise = undefined;
    })();
}

export function compareHistory(a, b, metadata, sort) {
    const names = byName.compare(a, b);
    if (sort === 'az' || sort === 'za') return sort === 'az' ? names : -names;
    const first = metadata.get(a);
    const second = metadata.get(b);
    const bySize = sort === 'largest' || sort === 'smallest';
    const x = sortValue(first, sort, bySize);
    const y = sortValue(second, sort, bySize);
    if (!Number.isFinite(x)) return Number.isFinite(y) ? 1 : names;
    if (!Number.isFinite(y)) return -1;
    return (sort === 'oldest' || sort === 'created-oldest' || sort === 'smallest' ? x - y : y - x) || names;
}

export function getHistorySnapshot() {
    const owner = listOwner;
    if (sidebarSnapshot && sidebarSnapshot.owner === owner && Date.now() - sidebarSnapshot.time <= 30000) return sidebarSnapshot;
    const snapshot = { owner, time: Date.now(), metadata: new Map() };
    sidebarSnapshot = snapshot;
    snapshot.promise = getChatFiles().then(files => files.map(file => {
        const row = { ...file, last_mes: timestampToMoment(file.last_mes), file_name: String(file.file_name).replace(/\.jsonl$/i, '') };
        snapshot.metadata.set(row.file_name, row);
        return row;
    })).catch(error => {
        if (sidebarSnapshot === snapshot) sidebarSnapshot = undefined;
        console.warn('[Chat Top Bar] 历史列表加载失败', error);
        return [];
    });
    return snapshot;
}

export async function populateSideBar() {
    const sidebar = document.getElementById('extensionSideBar');
    const loader = document.getElementById('extensionSideBarLoader');
    const container = document.getElementById('extensionSideBarContainer');

    if (!loader || !container || !sidebar) {
        return;
    }

    if (!sidebar.classList.contains('visible')) {
        container.innerHTML = '';
        return;
    }

    loader.classList.add('displayNone');
    const processId = uuidv4();
    const scrollTop = container.scrollTop;
    container.dataset.processId = processId;
    const chatId = getCurrentChatId();
    const owner = listOwner;
    const snapshot = getHistorySnapshot();
    const files = await snapshot.promise;
    const sort = getHistorySort();
    if (sort.startsWith('created-')) await prepareCreationTimes(snapshot);
    const chats = [...files].sort((a, b) => compareHistory(a.file_name, b.file_name, snapshot.metadata, sort));

    if (!sidebar.classList.contains('visible') || container.dataset.processId !== processId || chatId !== getCurrentChatId() || owner !== listOwner) {
        console.log(t`Aborting populateSideBar due to process id mismatch`);
        return;
    }

    if (container.dataset.snapshot === snapshot.id && container.dataset.sort === sort && container.childElementCount) {
        for (const item of container.children) item.classList.toggle('selected', item.dataset.chatId === chatId);
        return;
    }
    snapshot.id ??= processId;
    container.dataset.snapshot = snapshot.id;
    container.dataset.sort = sort;
    container.replaceChildren();

    for (const chat of chats) {
        const sideBarItem = document.createElement('div');
        sideBarItem.classList.add('sideBarItem');
        sideBarItem.dataset.chatId = chat.file_name;

        sideBarItem.addEventListener('click', async () => {
            await openChatById(chat.file_name);
        });

        const isSelected = chat.file_name === chatId;
        sideBarItem.classList.toggle('selected', isSelected);

        const chatName = document.createElement('div');
        chatName.classList.add('chatName');
        chatName.textContent = chat.file_name;
        chatName.title = chat.file_name;

        const chatDate = document.createElement('small');
        chatDate.classList.add('chatDate');
        chatDate.textContent = chat.last_mes.format('l');
        chatDate.title = chat.last_mes.format('LL LT');

        const chatNameContainer = document.createElement('div');
        chatNameContainer.classList.add('chatNameContainer');
        chatNameContainer.append(chatName, chatDate);

        const chatMessage = document.createElement('div');
        chatMessage.classList.add('chatMessage');
        chatMessage.textContent = chat.mes;
        chatMessage.title = chat.mes;

        const chatStats = document.createElement('div');
        chatStats.classList.add('chatStats');

        const counterBlock = document.createElement('div');
        counterBlock.classList.add('counterBlock');

        const counterIcon = document.createElement('i');
        counterIcon.classList.add('fa-solid', 'fa-comment', 'fa-xs');

        const counterText = document.createElement('small');
        counterText.textContent = chat.chat_items;

        counterBlock.append(counterIcon, counterText);

        const fileSizeText = document.createElement('small');
        fileSizeText.classList.add('fileSize');
        fileSizeText.textContent = chat.file_size;

        chatStats.append(counterBlock, fileSizeText);

        const chatMessageContainer = document.createElement('div');
        chatMessageContainer.classList.add('chatMessageContainer');
        chatMessageContainer.append(chatMessage, chatStats);

        sideBarItem.append(chatNameContainer, chatMessageContainer);
        container.appendChild(sideBarItem);
    }

    container.scrollTop = scrollTop;

    /** @type {HTMLElement} */
    const selectedElement = container.querySelector('.selected');
    const isSelectedElementVisible = selectedElement && selectedElement.offsetTop >= container.scrollTop && selectedElement.offsetTop <= container.scrollTop + container.clientHeight;
    if (selectedElement && !isSelectedElementVisible) {
        container.scrollTop = selectedElement.offsetTop - container.clientHeight / 2;
    }

    loader.classList.add('displayNone');
}

async function openChatById(chatId) {
    if (!chatId || switchingChat || chatId === getCurrentChatId()) {
        chatName.value = getCurrentChatId() ?? '';
        return;
    }
    const context = SillyTavern.getContext();
    switchingChat = true;
    try {
        if (typeof openGroupChat === 'function' && context.groupId) {
            await openGroupChat(context.groupId, chatId);
        } else if (typeof openCharacterChat === 'function' && context.characterId !== undefined) {
            await openCharacterChat(chatId);
        }
    } catch (error) {
        console.warn('[Chat Top Bar] 打开聊天失败', error);
        window.toastr?.error('打开聊天失败');
    } finally {
        switchingChat = false;
        chatName.value = getCurrentChatId() ?? '';
    }
}

async function onChatNameChange() {
    const chatId = chatName.value;
    await openChatById(chatId);
}

async function onToggleConnectionProfilesClick() {
    const button = document.getElementById('extensionTopBarToggleConnectionProfiles');

    if (!button) {
        console.warn('Connection profiles button not found');
        return;
    }

    button.classList.toggle('active');
    connectionProfiles.classList.toggle('visible');
    savePanelsState();
    await onOnlineStatusChange();
}

async function onOnlineStatusChange() {
    if (!connectionProfiles.classList.contains('visible')) {
        return;
    }

    const connectionProfilesMainSelect = /** @type {HTMLSelectElement} */ (document.getElementById('connection_profiles'));
    if (connectionProfilesMainSelect) {
        connectionProfilesSelect.innerHTML = connectionProfilesMainSelect.innerHTML;
        connectionProfilesSelect.value = connectionProfilesMainSelect.value;
    } else {
        connectionProfilesSelect.classList.add('displayNone');
    }

    if (connectionProfilesStatus.nextElementSibling?.classList?.contains('icon-svg')) {
        connectionProfilesStatus.nextElementSibling.remove();
    }

    const { SlashCommandParser, onlineStatus, mainApi } = SillyTavern.getContext();

    if (onlineStatus === 'no_connection') {
        connectionProfilesStatus.classList.add('offline');
        connectionProfilesStatus.textContent = t`No connection...`;

        const nullIcon = new Image();
        nullIcon.classList.add('icon-svg', 'null-icon');
        connectionProfilesStatus.insertAdjacentElement('afterend', nullIcon);
        return;
    }

    async function getCurrentAPI() {
        let currentAPI = mainApi;
        try {
            const commandResult = await SlashCommandParser.commands['api'].callback({ quiet: 'true' }, '');
            if (commandResult) {
                currentAPI = commandResult;
            }
        } catch (error) {
            console.error(t`Failed to get current API`, error);
        }
        const fancyNameOption = apiBlock.querySelector(`select:not(#main_api) option[value="${currentAPI}"]`) ?? apiBlock.querySelector(`select#main_api option[value="${currentAPI}"]`);
        if (fancyNameOption) {
            // Remove text in parentheses or brackets
            return fancyNameOption.textContent.replace(/[[(].*[\])]/, '').trim();
        }
        return currentAPI;
    }

    async function getCurrentModel() {
        let currentModel = onlineStatus;
        try {
            const commandResult = await SlashCommandParser.commands['model'].callback({ quiet: 'true' }, '');
            if (commandResult && typeof commandResult === 'string') {
                currentModel = commandResult;
            }
        } catch (error) {
            console.error(t`Failed to get current model`, error);
        }
        const fancyNameOption = apiBlock.querySelector(`option[value="${currentModel}"]`);
        if (fancyNameOption) {
            return fancyNameOption.textContent.trim();
        }
        return currentModel;
    }

    const [currentAPI, currentModel] = await Promise.all([getCurrentAPI(), getCurrentModel()]);
    await addConnectionProfileIcon();
    connectionProfilesStatus.classList.remove('offline');
    connectionProfilesStatus.textContent = `${currentAPI} – ${currentModel}`;
}

async function addConnectionProfileIcon() {
    return new Promise((resolve) => {
        const modelName = getGeneratingApi();
        const image = new Image();
        image.classList.add('icon-svg');
        image.src = `/img/${modelName}.svg`;

        image.onload = async function () {
            connectionProfilesStatus.insertAdjacentElement('afterend', image);
            await SVGInject(image);
            resolve();
        };

        image.onerror = function () {
            resolve();
        };

        // Prevent infinite waiting
        setTimeout(() => resolve(), 500);
    });
}

function savePanelsState() {
    localStorage.setItem('topBarPanelsState', JSON.stringify({
        sidebarVisible: document.getElementById('extensionSideBar')?.classList.contains('visible'),
        connectionProfilesVisible: document.getElementById('extensionConnectionProfiles')?.classList.contains('visible'),
    }));
}

function restorePanelsState() {
    let state;
    try { state = JSON.parse(localStorage.getItem('topBarPanelsState')); }
    catch { return; }

    if (!state) {
        return;
    }

    if (state.sidebarVisible) {
        document.getElementById('extensionTopBarToggleSidebar')?.click();
    }

    if (state.connectionProfilesVisible) {
        document.getElementById('extensionTopBarToggleConnectionProfiles')?.click();
    }
}

// Init extension on load
(function () {
    if (!sheld || !chat || document.getElementById('extensionTopBar')) return;
    addJQueryHighlight();
    patchSheldIfNeeded();
    addTopBar();
    addIcons();
    addSideBar();
    addConnectionProfiles();
    setChatName(getCurrentChatId());
    chatName.addEventListener('change', onChatNameChange);
    if (event_types.CHAT_CHANGED) eventSource.on(event_types.CHAT_CHANGED, () => void setChatName(getCurrentChatId()));
    for (const eventName of ['CHAT_DELETED', 'GROUP_CHAT_DELETED', 'CHAT_RENAMED']) {
        if (event_types[eventName]) eventSource.on(event_types[eventName], () => {
            chatNamesCache.clear();
            sidebarSnapshot = undefined;
            void setChatName(getCurrentChatId());
        });
    }
    bindConnectionProfilesSelect();
    restorePanelsState();
    updateStatusDebounced();
    eventSource.on(event_types.ONLINE_STATUS_CHANGED, updateStatusDebounced);
})();
