import {ipcRenderer} from "electron";
import {Constants} from "../constants";
import {Editor} from "../editor";
import {Tab} from "../layout/Tab";
import {getWndByLayout, layoutToJSON, newModelByInitData} from "../layout/util";
import {isWindow} from "../util/functions";
import {fetchSyncPost} from "../util/fetch";
import {showMessage} from "../dialog/message";

interface DocumentTabTransfer {
    id: string;
    title: string;
    icon?: string;
    docIcon?: string;
    pin?: boolean;
    children?: Config.IUILayoutTabEditor;
}

const receiving = new Map<string, Tab>();
const sending = new Set<string>();

export const canMoveTabToMainWindow = (tab: Tab) => {
    if (!isWindow()) {
        return false;
    }
    if (tab.model instanceof Editor) {
        return true;
    }
    try {
        return JSON.parse(tab.headElement?.getAttribute("data-initdata") || "{}").instance === "Editor";
    } catch {
        return false;
    }
};

export const moveTabToMainWindow = async (tab: Tab) => {
    if (!canMoveTabToMainWindow(tab) || sending.has(tab.id)) {
        return;
    }
    sending.add(tab.id);
    try {
        if (tab.model instanceof Editor) {
            await tab.model.editor.flushPendingTransactions();
        }
        if (!tab.parent.children.includes(tab)) {
            return;
        }
        const data: DocumentTabTransfer = {id: tab.id, title: tab.title};
        layoutToJSON(tab, data);
        ipcRenderer.send(Constants.SIYUAN_SEND_WINDOWS, {cmd: "moveTabToMainWindow", data});
    } finally {
        sending.delete(tab.id);
    }
};

export const receiveTabInMainWindow = async (data: DocumentTabTransfer) => {
    if (isWindow() || !data?.id || data.children?.instance !== "Editor") {
        return;
    }
    const previous = receiving.get(data.id);
    if (receiving.has(data.id) && (!previous || previous.parent.children.includes(previous))) {
        return;
    }
    receiving.set(data.id, undefined);
    let tab: Tab;
    try {
        // 通过内核确认文档仍可访问，已解锁的加密笔记本沿用正常编辑器读取流程。
        const response = await fetchSyncPost("/api/block/getBlockInfo", {
            id: data.children.blockId, notebook: data.children.notebookId,
        });
        if (response.code !== 0) {
            if (response.msg) {
                showMessage(response.msg);
            }
            receiving.delete(data.id);
            return;
        }
        const wnd = getWndByLayout(window.siyuan.layout.centerLayout);
        if (!wnd) {
            receiving.delete(data.id);
            return;
        }
        tab = new Tab({title: response.data.rootTitle || data.title, icon: data.icon, docIcon: data.docIcon});
        if (data.pin) {
            tab.headElement.classList.add("item--pin");
            if (data.icon || data.docIcon) {
                tab.headElement.querySelector(".item__text").classList.add("fn__none");
            }
        }
        wnd.addTab(tab, false, false);
        receiving.set(data.id, tab);
        tab.addModel(newModelByInitData(window.siyuan.ws.app, tab, {
            ...data.children, rootId: response.data.rootID, notebookId: response.data.box,
        }, () => {
            // 目标文档完成加载后才关闭来源页签，加载失败时保留来源窗口中的内容。
            if (!wnd.children.includes(tab)) {
                receiving.delete(data.id);
                return;
            }
            wnd.switchTab(tab.headElement);
            receiving.set(data.id, undefined);
            ipcRenderer.send(Constants.SIYUAN_SEND_WINDOWS, {cmd: "closetab", data: data.id});
            ipcRenderer.send(Constants.SIYUAN_CMD, "focus");
        }));
        tab.headElement.classList.remove("item--unupdate");
    } catch (error) {
        receiving.delete(data.id);
        if (tab) {
            tab.parent.removeTab(tab.id);
        }
        throw error;
    }
};
