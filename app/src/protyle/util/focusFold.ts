const SOURCE_FOLD = "data-view-fold-source";

interface IFocusFoldState {
    id: string,
    rootID: string,
    manual: boolean,
    element?: Element,
    generation?: number,
    headingLoaded?: boolean,
    headingFailed?: boolean,
    headingRequest?: Promise<void>,
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

export const applyFocusFold = (protyle: IProtyle,
                               loadHeading?: (element: Element, isValid: () => boolean) => Promise<boolean>) => {
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
    const element = protyle.wysiwyg.element.querySelector(`[data-node-id="${id}"]`);
    const type = element?.getAttribute("data-type");
    if (!["NodeListItem", "NodeBlockquote", "NodeCallout", "NodeSuperBlock"].includes(type) &&
        (type !== "NodeHeading" || !loadHeading)) {
        return;
    }
    if (!state) {
        state = {id, rootID, manual: false};
        states.set(protyle, state);
    }
    if (state.element !== element) {
        restoreElement(state.element);
        state.element = element;
        state.generation = (state.generation || 0) + 1;
        state.headingLoaded = false;
        state.headingFailed = false;
        state.headingRequest = undefined;
    }
    if (state.headingFailed) {
        return;
    }
    // 复用视图折叠的源属性标记，编辑内容序列化时仍保留文档中的折叠状态。
    if (!element.hasAttribute(SOURCE_FOLD)) {
        element.setAttribute(SOURCE_FOLD, element.getAttribute("fold") === "1" ? "1" : "0");
    }
    element.removeAttribute("fold");
    if (type !== "NodeHeading" || state.headingLoaded) {
        return;
    }
    if (state.headingRequest) {
        return state.headingRequest;
    }
    const currentState = state;
    const generation = state.generation;
    const isValid = () => states.get(protyle) === currentState && !currentState.manual &&
        currentState.generation === generation && currentState.element === element && element.isConnected &&
        protyle.wysiwyg.element.contains(element) && protyle.block.showAll &&
        protyle.block.id === id && protyle.block.rootID === rootID;
    // 加载期间发生编辑、切换聚焦或手动折叠时，丢弃该次请求，避免插入过期内容。
    const request = Promise.resolve().then(() => isValid() ? loadHeading(element, isValid) : false)
        .then(loaded => {
            if (!isValid()) {
                return;
            }
            currentState.headingLoaded = loaded;
            currentState.headingFailed = !loaded;
            if (!loaded) {
                restoreElement(element);
            }
        }).catch(error => {
            console.error(error);
            if (isValid()) {
                currentState.headingFailed = true;
                restoreElement(element);
            }
        }).finally(() => {
            if (currentState.headingRequest === request) {
                currentState.headingRequest = undefined;
            }
        });
    state.headingRequest = request;
    return request;
};

export const invalidateFocusFoldRequests = (protyle: IProtyle) => {
    const state = states.get(protyle);
    if (state) {
        state.generation = (state.generation || 0) + 1;
        state.headingRequest = undefined;
    }
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
        state.headingLoaded = false;
        state.headingFailed = false;
    }
};
