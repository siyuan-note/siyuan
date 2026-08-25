export interface IMobileBarsScrollOptions {
    maxOffset: number,
}

export interface IMobileBarsState {
    readingBarsOffset: number,
    editing: boolean,
    selecting: boolean,
    panelOpen: boolean,
    programmaticScrolling: boolean,
    scrollTop: number,
}

export interface IMobileBarsVisibility {
    topbarVisible: boolean,
    bottomBarVisible: boolean,
    editingBarVisible: boolean,
    scrollPaused: boolean,
}

export type MobileBarsAction = {
    type: "scroll",
    scrollTop: number,
} | {
    type: "set-reading-bars",
    visible: boolean,
} | {
    type: "set-editing",
    active: boolean,
    scrollTop?: number,
} | {
    type: "set-selecting",
    active: boolean,
    scrollTop?: number,
} | {
    type: "set-panel-open",
    open: boolean,
    scrollTop?: number,
} | {
    type: "set-programmatic-scrolling",
    active: boolean,
    scrollTop?: number,
} | {
    type: "document-changed",
    scrollTop?: number,
};

export const MOBILE_BARS_SCROLL_OPTIONS: Readonly<IMobileBarsScrollOptions> = {
    maxOffset: 48,
};

const normalizeScrollTop = (scrollTop: number, fallback = 0) => {
    return Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : fallback;
};

const getScrollOptions = (options: Partial<IMobileBarsScrollOptions>) => ({
    maxOffset: Number.isFinite(options.maxOffset) ?
        Math.max(0, options.maxOffset) : MOBILE_BARS_SCROLL_OPTIONS.maxOffset,
});

const resetScrollTracking = (state: IMobileBarsState, scrollTop = state.scrollTop): IMobileBarsState => ({
    ...state,
    scrollTop: normalizeScrollTop(scrollTop, state.scrollTop),
});

export const createMobileBarsState = (scrollTop = 0): IMobileBarsState => ({
    readingBarsOffset: 0,
    editing: false,
    selecting: false,
    panelOpen: false,
    programmaticScrolling: false,
    scrollTop: normalizeScrollTop(scrollTop),
});

export const isMobileBarsScrollPaused = (state: IMobileBarsState) => {
    return state.editing || state.selecting || state.panelOpen || state.programmaticScrolling;
};

export const getMobileBarsVisibility = (
    state: IMobileBarsState,
    options: Partial<IMobileBarsScrollOptions> = {},
): IMobileBarsVisibility => {
    const readingBarsVisible = state.readingBarsOffset < getScrollOptions(options).maxOffset;
    return {
        topbarVisible: readingBarsVisible,
        bottomBarVisible: readingBarsVisible && !state.editing && !state.selecting,
        editingBarVisible: state.editing,
        scrollPaused: isMobileBarsScrollPaused(state),
    };
};

export const reduceMobileBarsState = (
    state: IMobileBarsState,
    action: MobileBarsAction,
    options: Partial<IMobileBarsScrollOptions> = {},
): IMobileBarsState => {
    const scrollOptions = getScrollOptions(options);

    if (action.type === "document-changed") {
        return createMobileBarsState(action.scrollTop);
    }

    if (action.type === "set-reading-bars") {
        return {
            ...resetScrollTracking(state),
            readingBarsOffset: action.visible ? 0 : scrollOptions.maxOffset,
        };
    }

    if (action.type === "set-editing") {
        return {
            ...resetScrollTracking(state, action.scrollTop),
            editing: action.active,
        };
    }

    if (action.type === "set-selecting") {
        return {
            ...resetScrollTracking(state, action.scrollTop),
            selecting: action.active,
        };
    }

    if (action.type === "set-panel-open") {
        return {
            ...resetScrollTracking(state, action.scrollTop),
            panelOpen: action.open,
        };
    }

    if (action.type === "set-programmatic-scrolling") {
        const nextState = {
            ...resetScrollTracking(state, action.scrollTop),
            programmaticScrolling: action.active,
        };
        if (!action.active && !nextState.editing && !nextState.panelOpen && nextState.scrollTop === 0) {
            nextState.readingBarsOffset = 0;
        }
        return nextState;
    }

    const scrollTop = normalizeScrollTop(action.scrollTop, state.scrollTop);
    const nextState = resetScrollTracking(state, scrollTop);
    if (isMobileBarsScrollPaused(state)) {
        return nextState;
    }

    const maxOffset = Math.min(scrollOptions.maxOffset, scrollTop);
    nextState.readingBarsOffset = Math.min(maxOffset, Math.max(0,
        state.readingBarsOffset + scrollTop - state.scrollTop));
    return nextState;
};
