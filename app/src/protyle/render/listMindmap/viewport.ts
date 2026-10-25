import {Constants} from "../../../constants";
import {isEncryptedBox} from "../../../util/pathName";
import {setStorageVal} from "../../util/compatibility";

export interface ListMindmapViewport {
    scale: number;
    center: {x: number, y: number};
}

const sessionViewports = new WeakMap<object, Record<string, ListMindmapViewport>>();
let saveTimer: number;

const isViewport = (value: unknown): value is ListMindmapViewport => {
    if (!value || typeof value !== "object") {
        return false;
    }
    const state = value as ListMindmapViewport;
    return Number.isFinite(state.scale) && state.scale >= .15 && state.scale <= 2.5 &&
        !!state.center && [state.center.x, state.center.y].every(value =>
            Number.isFinite(value) && Math.abs(value) <= 1000000);
};

const canRemember = (owner: IProtyle, list: HTMLElement) => !!list.dataset.nodeId && !owner.lite &&
    !owner.options.action.includes(Constants.CB_GET_HISTORY) &&
    !list.closest(".protyle-wysiwyg__embed, .mindmap-view__preview-block") &&
    list.closest(".protyle-wysiwyg") === owner.wysiwyg.element;

// 与文档阅读位置一致，加密笔记本和无写权限场景仅使用工作空间会话内存。
const isSessionOnly = (owner: IProtyle) => window.siyuan.config.readonly || window.siyuan.isPublish ||
    isEncryptedBox(owner.notebookId);

const getViewports = (owner: IProtyle): Record<string, ListMindmapViewport> => {
    const storage = window.siyuan.storage;
    if (!storage) {
        return {};
    }
    const saved = isSessionOnly(owner) ? sessionViewports.get(storage) : storage[Constants.LOCAL_MINDMAP_VIEWPORTS];
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
};

export const getListMindmapViewport = (owner: IProtyle, list: HTMLElement): ListMindmapViewport | undefined => {
    if (canRemember(owner, list)) {
        const state = getViewports(owner)[list.dataset.nodeId];
        if (isViewport(state)) {
            return {scale: state.scale, center: {...state.center}};
        }
    }
};

export const flushListMindmapViewports = () => {
    if (saveTimer === undefined) {
        return;
    }
    window.clearTimeout(saveTimer);
    saveTimer = undefined;
    void setStorageVal(Constants.LOCAL_MINDMAP_VIEWPORTS, window.siyuan.storage[Constants.LOCAL_MINDMAP_VIEWPORTS]);
};

export const saveListMindmapViewport = (owner: IProtyle, list: HTMLElement, state: ListMindmapViewport) => {
    if (!canRemember(owner, list) || !window.siyuan.storage || !isViewport(state)) {
        return;
    }
    const saved = getViewports(owner);
    const key = list.dataset.nodeId;
    const previous = saved[key];
    if (isViewport(previous) && previous.scale === state.scale &&
        previous.center.x === state.center.x && previous.center.y === state.center.y) {
        return;
    }
    const entries = Object.entries(saved).filter(([id, value]) => id !== key && isViewport(value));
    entries.push([key, {scale: state.scale, center: {...state.center}}]);
    const viewports = Object.fromEntries(entries.slice(-1000));
    if (isSessionOnly(owner)) {
        sessionViewports.set(window.siyuan.storage, viewports);
    } else {
        window.siyuan.storage[Constants.LOCAL_MINDMAP_VIEWPORTS] = viewports;
        window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(flushListMindmapViewports, 300);
    }
};
