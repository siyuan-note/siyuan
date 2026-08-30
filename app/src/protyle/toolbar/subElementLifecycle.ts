export interface ISubElementLifecycleState {
    subElement?: HTMLElement;
    subElementCloseCB?: (() => void) | null;
    subElementResizeCB?: (() => void) | null;
}

export const SELECTION_TOOLBAR_SUB_ELEMENT_SOURCE = "selection-toolbar";

export const setSubElementSource = (state: ISubElementLifecycleState, source?: string) => {
    if (!state.subElement) {
        return;
    }
    if (source) {
        state.subElement.dataset.subElementSource = source;
    } else {
        delete state.subElement.dataset.subElementSource;
    }
};

export const closeSubElement = (state: ISubElementLifecycleState) => {
    const closeCallback = state.subElementCloseCB;
    state.subElementCloseCB = undefined;
    state.subElementResizeCB = undefined;
    setSubElementSource(state);
    closeCallback?.();
};
