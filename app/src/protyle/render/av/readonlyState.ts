import {Constants} from "../../../constants";
import {getAVCurrentViewID} from "./viewVisibility";

// 锁定编辑时的阅读状态随数据库载体保留在内存中，解除锁定后恢复文档默认状态。
const states = new WeakMap<HTMLElement, {
    originalView: string | null,
    viewID?: string,
    folds: Map<string, Record<string, boolean>>,
    sorts: Map<string, IAVSort>,
}>();

const getState = (element: HTMLElement) => {
    let state = states.get(element);
    if (!state) {
        state = {originalView: element.getAttribute(Constants.CUSTOM_SY_AV_VIEW), folds: new Map(), sorts: new Map()};
        states.set(element, state);
    }
    return state;
};

export const getReadonlyAVView = (element: HTMLElement) => states.get(element)?.viewID || "";

export const setReadonlyAVView = (element: HTMLElement, viewID: string) => {
    getState(element).viewID = viewID;
};

export const getReadonlyAVSort = (element: HTMLElement, viewID: string) => {
    const sort = states.get(element)?.sorts.get(viewID);
    return sort ? {...sort} : undefined;
};

export const setReadonlyAVSort = (element: HTMLElement, viewID: string, sort?: IAVSort) => {
    if (sort) {
        getState(element).sorts.set(viewID, {...sort});
    } else {
        states.get(element)?.sorts.delete(viewID);
    }
};

export const canUseReadonlyAVSort = (protyle: IProtyle) => protyle.disabled && !window.siyuan.isPublish &&
    !protyle.options.history?.created && !protyle.options.history?.snapshot &&
    !protyle.options.action.includes(Constants.CB_GET_HISTORY);

export const getReadonlyAVSortRequest = (element: HTMLElement, protyle: IProtyle, viewID?: string) => {
    const enabled = canUseReadonlyAVSort(protyle);
    element.toggleAttribute("data-readonly-sort", enabled);
    return enabled ? getReadonlyAVSort(element, viewID || getAVCurrentViewID(element)) : undefined;
};

export const reconcileReadonlyAVSort = (element: HTMLElement, data: IAV) => {
    const sort = getReadonlyAVSort(element, data.viewID);
    if (sort && !data.view.sorts.some(value => value.column === sort.column && value.order === sort.order)) {
        setReadonlyAVSort(element, data.viewID);
    }
};

export const setReadonlyAVFolds = (element: HTMLElement, viewID: string, folds: Record<string, boolean>) => {
    const state = getState(element);
    state.folds.set(viewID, {...state.folds.get(viewID), ...folds});
};

export const applyReadonlyAVFolds = (element: HTMLElement, data: IAV) => {
    const folds = states.get(element)?.folds.get(data.viewID);
    data.view.groups?.forEach(group => {
        if (typeof folds?.[group.id] === "boolean") {
            group.groupFolded = folds[group.id];
        }
    });
};

export const clearReadonlyAVState = (element: HTMLElement) => {
    const state = states.get(element);
    if (!state) {
        return false;
    }
    states.delete(element);
    if (state.originalView === null) {
        element.removeAttribute(Constants.CUSTOM_SY_AV_VIEW);
    } else {
        element.setAttribute(Constants.CUSTOM_SY_AV_VIEW, state.originalView);
    }
    element.removeAttribute("data-render");
    return true;
};
