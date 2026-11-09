import { callGenericPopup, POPUP_TYPE } from '../../../popup.js';

const key = 'tuit.remote-sync-address';
let connecting = false;
document.addEventListener('tavern-ui-toolkit:remote-sync', async () => {
    if (connecting) return;
    const invoke = window.__TAURI__?.core?.invoke;
    if (!invoke) { toastr.info('请在 TauriTavern 客户端使用远程同步'); return; }
    connecting = true;
    try {
        const box = document.createElement('div');
        const help = document.createElement('p');
        help.textContent = '支持私有组网或 TCP 隧道。对端在 TT 同步页开启服务，下面填写对端的组网地址和同步端口，或 TCP 隧道的公网域名和远程端口。在对端确认配对后，回 TT 同步页选择同步范围。';
        const input = document.createElement('input');
        input.className = 'text_pole';
        input.placeholder = '域名或 IPv4:端口';
        input.setAttribute('aria-label', '对端域名或 IPv4 和端口');
        input.value = localStorage.getItem(key) || '';
        box.append(help, input);
        if (await callGenericPopup(box, POPUP_TYPE.CONFIRM, '', { okButton: '连接', cancelButton: '取消' }) !== 1) return;
        const address = input.value.trim();
        const match = address.match(/^([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?):([0-9]{1,5})$/i);
        if (!match || (/^[0-9.]+$/.test(match[1]) && !/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(match[1])) || match[1].split('.').some(part => !part || (/^[0-9.]+$/.test(match[1]) && Number(part) > 255)) || Number(match[2]) < 1 || Number(match[2]) > 65535) {
            toastr.warning('请输入 域名:端口 或 IPv4:端口，端口范围为 1–65535'); return;
        }
        localStorage.setItem(key, address);
        toastr.info('正在连接，请留意对端配对提示');
        await invoke('lan_sync_connect_address', { address });
        toastr.success('连接请求已完成，请在 TT 同步页查看设备');
    } catch (error) { toastr.error('远程连接失败：' + (error?.message || String(error))); }
    finally { connecting = false; }
});
