import {Constants} from "../../constants";
import {isEncryptedBox} from "../../util/pathName";
import {setStorageVal} from "../util/compatibility";

const sessionSelections = new WeakMap<object, Record<string, string>>();

const canRemember = (protyle: IProtyle, tabs: HTMLElement) => !!tabs.dataset.nodeId && !protyle.lite &&
    !protyle.options.action.includes(Constants.CB_GET_HISTORY) &&
    !tabs.closest(".protyle-wysiwyg__embed, .mindmap-view__preview-block") &&
    tabs.closest(".protyle-wysiwyg") === protyle.wysiwyg.element;

// 无写权限及加密笔记本的阅读位置仅保留在当前工作空间会话中。
const isSessionOnly = (protyle: IProtyle) => window.siyuan.config.readonly || window.siyuan.isPublish ||
    isEncryptedBox(protyle.notebookId);

const getSelections = (protyle: IProtyle): Record<string, string> => {
    const storage = window.siyuan.storage;
    if (!storage) {
        return {};
    }
    if (isSessionOnly(protyle)) {
        return sessionSelections.get(storage) || {};
    }
    const saved = storage[Constants.LOCAL_TABS_READING];
    return saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
};

export const getTabReadingID = (protyle: IProtyle, tabs: HTMLElement): string => {
    if (!protyle.disabled || !canRemember(protyle, tabs)) {
        return undefined;
    }
    const id = getSelections(protyle)[tabs.dataset.nodeId];
    return typeof id === "string" ? id : undefined;
};

export const saveTabReadingID = (protyle: IProtyle, tabs: HTMLElement, id: string) => {
    if (!canRemember(protyle, tabs) || !window.siyuan.storage) {
        return;
    }
    const saved = getSelections(protyle);
    const key = tabs.dataset.nodeId;
    if ((protyle.disabled && saved[key] === id) || (!protyle.disabled && !saved[key])) {
        return;
    }
    // 最近选择移到末尾，限制记录数量；编辑时清除旧阅读位置，沿用文档的默认激活项。
    const entries = Object.entries(saved).filter(([blockID, activeID]) => blockID !== key && typeof activeID === "string");
    if (protyle.disabled) {
        entries.push([key, id]);
    }
    const selections = Object.fromEntries(entries.slice(-1000));
    if (isSessionOnly(protyle)) {
        sessionSelections.set(window.siyuan.storage, selections);
    } else {
        window.siyuan.storage[Constants.LOCAL_TABS_READING] = selections;
        void setStorageVal(Constants.LOCAL_TABS_READING, selections);
    }
};
