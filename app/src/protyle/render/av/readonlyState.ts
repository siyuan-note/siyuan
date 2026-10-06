import {Constants} from "../../../constants";

// 锁定编辑时的阅读状态随数据库载体保留在内存中，解除锁定后恢复文档默认状态。
const states = new WeakMap<HTMLElement, {
    originalView: string | null,
    viewID?: string,
    folds: Map<string, Record<string, boolean>>,
}>();

const getState = (element: HTMLElement) => {
    let state = states.get(element);
    if (!state) {
        state = {originalView: element.getAttribute(Constants.CUSTOM_SY_AV_VIEW), folds: new Map()};
        states.set(element, state);
    }
    return state;
};

export const getReadonlyAVView = (element: HTMLElement) => states.get(element)?.viewID || "";

export const setReadonlyAVView = (element: HTMLElement, viewID: string) => {
    getState(element).viewID = viewID;
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
