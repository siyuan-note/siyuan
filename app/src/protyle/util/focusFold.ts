const SOURCE_FOLD = "data-view-fold-source";

interface IFocusFoldState {
    id: string,
    rootID: string,
    manual: boolean,
    element?: Element,
}

const states = new WeakMap<IProtyle, IFocusFoldState>();

const restoreElement = (element?: Element) => {
    const source = element?.getAttribute(SOURCE_FOLD);
    if (source === "1") {
        element.setAttribute("fold", "1");
    } else if (source === "0") {
        element.removeAttribute("fold");
    }
    element?.removeAttribute(SOURCE_FOLD);
};

export const applyFocusFold = (protyle: IProtyle) => {
    let state = states.get(protyle);
    const {id, rootID, showAll} = protyle.block;
    const focused = showAll && id !== rootID && !protyle.options.backlinkData && !protyle.lite;
    if (state && (!focused || state.id !== id || state.rootID !== rootID)) {
        restoreElement(state.element);
        states.delete(protyle);
        state = undefined;
    }
    if (!focused || state?.manual) {
        return;
    }
    const element = protyle.wysiwyg.element.querySelector(`[data-node-id="${id}"][data-type="NodeListItem"]`);
    if (!element) {
        return;
    }
    if (!state) {
        state = {id, rootID, manual: false};
        states.set(protyle, state);
    }
    if (state.element !== element) {
        restoreElement(state.element);
        state.element = element;
    }
    // 复用视图折叠的源属性标记，编辑内容序列化时仍保留文档中的折叠状态。
    if (!element.hasAttribute(SOURCE_FOLD)) {
        element.setAttribute(SOURCE_FOLD, element.getAttribute("fold") === "1" ? "1" : "0");
    }
    element.removeAttribute("fold");
};

export const stopFocusFold = (protyle: IProtyle, id: string) => {
    const state = states.get(protyle);
    if (!state || state.id !== id) {
        return;
    }
    // 主动折叠从当前可见状态开始，后续刷新不再自动展开，直到重新进入聚焦。
    state.manual = true;
    state.element?.removeAttribute(SOURCE_FOLD);
};

export const updateFocusFoldSource = (protyle: IProtyle, id: string, folded: boolean) => {
    const state = states.get(protyle);
    if (state?.id === id && !state.manual) {
        state.element?.setAttribute(SOURCE_FOLD, folded ? "1" : "0");
    }
};
