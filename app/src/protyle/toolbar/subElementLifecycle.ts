export interface ISubElementLifecycleState {
    subElementCloseCB?: (() => void) | null;
    subElementResizeCB?: (() => void) | null;
}

export const closeSubElement = (state: ISubElementLifecycleState) => {
    const closeCallback = state.subElementCloseCB;
    state.subElementCloseCB = undefined;
    state.subElementResizeCB = undefined;
    closeCallback?.();
};
