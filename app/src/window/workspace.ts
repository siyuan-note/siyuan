import {Constants} from "../constants";
import {getSearch, isBrowser, isWindow} from "../util/functions";
import {setStorageVal} from "../protyle/util/compatibility";
import {fetchSyncPost} from "../util/fetch";
import {layoutToJSON} from "../layout/util";
import {setTabPosition} from "../layout/tabUtil";
import {openInputDialog} from "../dialog/inputDialog";
import {confirmDialog} from "../dialog/confirmDialog";
import {showMessage} from "../dialog/message";
import {escapeHtml} from "../util/escape";
import {setWindowWorkspaceTitle} from "../util/processTitle";
import {openNewWindowByWorkspace} from "./openNewWindow";
import {
    isWindowWorkspace,
    isWindowWorkspaceID,
    isWindowWorkspaceSnapshot,
    WindowWorkspaceWriter,
} from "./workspaceCore";
import type {IWindowWorkspace, IWindowWorkspaceSnapshot} from "./workspaceCore";
/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif

const infoKey = (id: string) => Constants.LOCAL_WINDOW_WORKSPACE + id;
const layoutKey = (id: string) => infoKey(id) + "-layout";
let currentID: string | undefined;
let ready = false;
let initialized = false;
let saveTimer = 0;
let lastSaved = "";
let lastSaveOK = true;

export const getWindowWorkspace = (id: string) => {
    const value: unknown = window.siyuan.storage?.[infoKey(id)];
    return isWindowWorkspace(value) && value.id === id ? value : undefined;
};

export const getWindowWorkspaces = () => Object.keys(window.siyuan.storage || {})
    .filter(key => key.startsWith(Constants.LOCAL_WINDOW_WORKSPACE))
    .map(key => getWindowWorkspace(key.slice(Constants.LOCAL_WINDOW_WORKSPACE.length)))
    .filter((value): value is IWindowWorkspace => !!value)
    .map(value => {
        const snapshot: unknown = window.siyuan.storage[layoutKey(value.id)];
        return {...value, time: isWindowWorkspaceSnapshot(snapshot) ? snapshot.time : undefined};
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true}));

const persist = async (key: string, value: IWindowWorkspace | IWindowWorkspaceSnapshot) => {
    if (window.siyuan.config.readonly || window.siyuan.isPublish) {
        return false;
    }
    const previous = window.siyuan.storage[key];
    window.siyuan.storage[key] = value;
    let saved = false;
    try {
        await setStorageVal(key, value, () => saved = true, 10000);
    } catch (error) {
        console.error(error);
    }
    if (!saved && window.siyuan.storage[key] === value) {
        window.siyuan.storage[key] = previous;
    }
    if (saved) {
        onWindowWorkspaceStorageChanged(key);
    }
    return saved;
};

const removeSnapshot = async (id: string) => {
    const key = layoutKey(id);
    try {
        const response = await fetchSyncPost("/api/storage/removeLocalStorageVals", {
            app: Constants.SIYUAN_APPID,
            keys: [key],
        });
        if (response.code === 0) {
            delete window.siyuan.storage[key];
            return true;
        }
    } catch (error) {
        console.error(error);
    }
    return false;
};

const writer = new WindowWorkspaceWriter<{id: string, snapshot: IWindowWorkspaceSnapshot}>(async ({id, snapshot}) => {
    if (!getWindowWorkspace(id) || currentID !== id) {
        return true;
    }
    lastSaveOK = false;
    const saved = await persist(layoutKey(id), snapshot);
    if (currentID === id) {
        if (saved) {
            lastSaved = JSON.stringify(snapshot.layout);
        }
        lastSaveOK = saved;
    }
    return saved;
});

const capture = (): IWindowWorkspaceSnapshot | undefined => {
    if (!window.siyuan.layout?.layout) {
        return;
    }
    const layout: Config.TPersistedUILayoutItem = {instance: "Layout", children: []};
    const incomplete: IObject = {};
    layoutToJSON(window.siyuan.layout.layout, layout, incomplete);
    if (Object.keys(incomplete).length) {
        return;
    }
    const snapshot: IWindowWorkspaceSnapshot = {version: 1, time: Date.now(), layout};
    return isWindowWorkspaceSnapshot(snapshot) ? snapshot : undefined;
};

export const flushWindowWorkspace = async () => {
    window.clearTimeout(saveTimer);
    if (!currentID || !ready || window.siyuan.config.readonly || !getWindowWorkspace(currentID)) {
        return true;
    }
    const snapshot = capture();
    if (!snapshot) {
        return false;
    }
    if (lastSaveOK && JSON.stringify(snapshot.layout) === lastSaved) {
        return true;
    }
    lastSaveOK = false;
    return writer.save({id: currentID, snapshot});
};

const scheduleSave = () => {
    if (!currentID || !ready) {
        return;
    }
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
        void flushWindowWorkspace();
    }, 800);
};

const associate = async (id?: string) => {
    /// #if !BROWSER
    if (!await ipcRenderer.invoke(Constants.SIYUAN_GET, {cmd: Constants.SIYUAN_WINDOW_WORKSPACE_SET, id: id || ""})) {
        return false;
    }
    /// #endif
    currentID = id;
    const url = new URL(window.location.href);
    if (id) {
        url.searchParams.set("windowWorkspace", id);
    } else {
        url.searchParams.delete("windowWorkspace");
    }
    window.history.replaceState(window.history.state, "", url);
    updateWindowWorkspaceButton();
    return true;
};

export const getWindowWorkspaceLayout = () => {
    const id = getSearch("windowWorkspace");
    if (!isWindowWorkspaceID(id)) {
        return;
    }
    const snapshot: unknown = window.siyuan.storage[layoutKey(id)];
    if (!getWindowWorkspace(id) || !isWindowWorkspaceSnapshot(snapshot)) {
        showMessage(window.siyuan.languages.windowWorkspaceUnavailable, 6000, "error");
        void associate();
        return;
    }
    currentID = id;
    lastSaved = JSON.stringify(snapshot.layout);
    return JSON.parse(JSON.stringify(snapshot.layout)) as Config.TPersistedUILayoutItem;
};

export const activateWindowWorkspace = () => {
    ready = true;
    updateWindowWorkspaceButton();
};

export const openWindowWorkspace = async (id: string) => {
    if (isBrowser()) {
        return;
    }
    /// #if !BROWSER
    if (await ipcRenderer.invoke(Constants.SIYUAN_GET, {cmd: Constants.SIYUAN_WINDOW_WORKSPACE_FOCUS, id})) {
        return;
    }
    /// #endif
    if (!getWindowWorkspace(id) || !isWindowWorkspaceSnapshot(window.siyuan.storage[layoutKey(id)])) {
        showMessage(window.siyuan.languages.windowWorkspaceUnavailable, 6000, "error");
        return;
    }
    openNewWindowByWorkspace(id);
};

const removeWorkspace = async (id: string) => {
    const workspace = getWindowWorkspace(id);
    if (!workspace) {
        return;
    }
    // 保留移除标记，使在途的布局写入无法重新创建列表项。
    if (!await persist(infoKey(id), {...workspace, deleted: true})) {
        showMessage(window.siyuan.languages.windowWorkspaceSaveError, 6000, "error");
        return;
    }
    if (!await removeSnapshot(id)) {
        showMessage(window.siyuan.languages.windowWorkspaceSaveError, 6000, "error");
    }
};

export const removeWindowWorkspace = (id: string) => {
    if (window.siyuan.config.readonly || window.siyuan.isPublish) {
        return;
    }
    const workspace = getWindowWorkspace(id);
    if (workspace) {
        confirmDialog(window.siyuan.languages.delete, window.siyuan.languages.windowWorkspaceRemoveTip
            .replace("${x}", escapeHtml(workspace.name)), () => {
            void removeWorkspace(id);
        });
    }
};

export const editWindowWorkspace = (id?: string) => {
    if (window.siyuan.config.readonly || window.siyuan.isPublish) {
        return;
    }
    const workspace = id ? getWindowWorkspace(id) : undefined;
    if (id && !workspace) {
        showMessage(window.siyuan.languages.windowWorkspaceUnavailable, 6000, "error");
        return;
    }
    let saving = false;
    openInputDialog({
        title: workspace ? window.siyuan.languages.windowWorkspaces :
            window.siyuan.languages.windowWorkspaceSave,
        value: workspace?.name || "",
        maxLength: 100,
        confirmText: window.siyuan.languages[workspace ? "confirm" : "save"],
        onConfirm: async (value, dialog) => {
            const name = value.trim();
            if (!name || saving) {
                if (!name) {
                    showMessage(window.siyuan.languages._kernel[142]);
                }
                return;
            }
            saving = true;
            try {
                if (workspace) {
                    const latest = getWindowWorkspace(id);
                    if (!latest || !await persist(infoKey(id), {...latest, name})) {
                        throw new Error("Window workspace rename failed");
                    }
                } else {
                    const snapshot = capture();
                    if (!snapshot) {
                        throw new Error("Window layout is not ready");
                    }
                    const newID = Lute.NewNodeID();
                    if (!await persist(layoutKey(newID), snapshot) ||
                        !await persist(infoKey(newID), {version: 1, id: newID, name})) {
                        void removeSnapshot(newID);
                        throw new Error("Window workspace save failed");
                    }
                    if (!await associate(newID)) {
                        throw new Error("Window workspace association failed");
                    }
                    lastSaved = JSON.stringify(snapshot.layout);
                    lastSaveOK = true;
                }
                dialog.destroy();
            } catch (error) {
                console.error(error);
                showMessage(window.siyuan.languages.windowWorkspaceSaveError, 6000, "error");
            } finally {
                saving = false;
            }
        },
    });
};

const updateWindowWorkspaceButton = () => {
    const button = document.getElementById("windowWorkspace");
    if (!button) {
        return;
    }
    const workspace = currentID ? getWindowWorkspace(currentID) : undefined;
    button.setAttribute("aria-label", workspace?.name || window.siyuan.languages.windowWorkspaceSave);
    setWindowWorkspaceTitle(workspace?.name || "");
    const disabled = window.siyuan.config.readonly || !!window.siyuan.isPublish;
    button.toggleAttribute("disabled", disabled);
    button.classList.toggle("toolbar__item--disabled", disabled);
    setTabPosition(true);
};

export const onWindowWorkspaceStorageChanged = (key: string) => {
    if (!key.startsWith(Constants.LOCAL_WINDOW_WORKSPACE)) {
        return;
    }
    if (!currentID || key !== infoKey(currentID)) {
        return;
    }
    if (getWindowWorkspace(currentID)) {
        updateWindowWorkspaceButton();
    } else {
        const id = currentID;
        currentID = undefined;
        window.clearTimeout(saveTimer);
        void writer.stop().then(() => removeSnapshot(id)).catch(console.error);
        void associate();
    }
};

export const initWindowWorkspace = () => {
    if (initialized || !isWindow()) {
        return;
    }
    const toolbar = document.querySelector(".toolbar__window");
    if (!toolbar) {
        return;
    }
    initialized = true;
    const button = document.createElement("button");
    button.id = "windowWorkspace";
    button.className = "toolbar__item ariaLabel window-workspace__button";
    button.innerHTML = '<svg><use xlink:href="#iconLayout"></use></svg>';
    toolbar.insertBefore(button, document.getElementById("pinWindow"));
    button.addEventListener("click", () => editWindowWorkspace(currentID));
    window.addEventListener("siyuan-window-layout", scheduleSave);
    document.addEventListener("scroll", scheduleSave, true);
    window.addEventListener("blur", () => void flushWindowWorkspace());
    // PDF 页码由嵌入页面更新，定期比较快照，仅在布局或阅读位置改变时写入。
    window.setInterval(() => {
        if (currentID && document.visibilityState === "visible") {
            void flushWindowWorkspace();
        }
    }, 3000);
    updateWindowWorkspaceButton();
};
