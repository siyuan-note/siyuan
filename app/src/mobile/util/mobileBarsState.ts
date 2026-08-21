export type MobileBarsScrollDirection = "up" | "down";

export interface IMobileBarsScrollOptions {
    hideThreshold: number,
    showThreshold: number,
    topThreshold: number,
}

export interface IMobileBarsState {
    readingBarsVisible: boolean,
    editing: boolean,
    selecting: boolean,
    panelOpen: boolean,
    programmaticScrolling: boolean,
    barsTransitioning: boolean,
    scrollTop: number,
    scrollDirection?: MobileBarsScrollDirection,
    scrollDistance: number,
}

export interface IMobileBarsVisibility {
    readingBarsVisible: boolean,
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
    type: "set-bars-transitioning",
    active: boolean,
    scrollTop?: number,
} | {
    type: "document-changed",
    scrollTop?: number,
};

export const MOBILE_BARS_SCROLL_OPTIONS: Readonly<IMobileBarsScrollOptions> = {
    hideThreshold: 64,
    showThreshold: 32,
    topThreshold: 8,
};

const normalizeScrollTop = (scrollTop: number, fallback = 0) => {
    return Number.isFinite(scrollTop) ? Math.max(0, scrollTop) : fallback;
};

const getScrollOptions = (options: Partial<IMobileBarsScrollOptions>) => ({
    hideThreshold: Number.isFinite(options.hideThreshold) ?
        Math.max(0, options.hideThreshold) : MOBILE_BARS_SCROLL_OPTIONS.hideThreshold,
    showThreshold: Number.isFinite(options.showThreshold) ?
        Math.max(0, options.showThreshold) : MOBILE_BARS_SCROLL_OPTIONS.showThreshold,
    topThreshold: Number.isFinite(options.topThreshold) ?
        Math.max(0, options.topThreshold) : MOBILE_BARS_SCROLL_OPTIONS.topThreshold,
});

const resetScrollTracking = (state: IMobileBarsState, scrollTop = state.scrollTop): IMobileBarsState => ({
    ...state,
    scrollTop: normalizeScrollTop(scrollTop, state.scrollTop),
    scrollDirection: undefined,
    scrollDistance: 0,
});

export const createMobileBarsState = (scrollTop = 0): IMobileBarsState => ({
    readingBarsVisible: true,
    editing: false,
    selecting: false,
    panelOpen: false,
    programmaticScrolling: false,
    barsTransitioning: false,
    scrollTop: normalizeScrollTop(scrollTop),
    scrollDistance: 0,
});

export const isMobileBarsScrollPaused = (state: IMobileBarsState) => {
    return state.editing || state.selecting || state.panelOpen || state.programmaticScrolling || state.barsTransitioning;
};

export const getMobileBarsVisibility = (state: IMobileBarsState): IMobileBarsVisibility => ({
    readingBarsVisible: state.readingBarsVisible && !state.editing && !state.selecting,
    editingBarVisible: state.editing,
    scrollPaused: isMobileBarsScrollPaused(state),
});

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
            readingBarsVisible: state.editing ? false : action.visible,
        };
    }

    if (action.type === "set-editing") {
        return {
            ...resetScrollTracking(state, action.scrollTop),
            readingBarsVisible: action.active ? false : state.editing ? true : state.readingBarsVisible,
            editing: action.active,
        };
    }

    if (action.type === "set-selecting") {
        return {
            ...resetScrollTracking(state, action.scrollTop),
            readingBarsVisible: action.active ? state.readingBarsVisible : true,
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
        if (!action.active && !nextState.editing && !nextState.panelOpen &&
            nextState.scrollTop <= scrollOptions.topThreshold) {
            nextState.readingBarsVisible = true;
        }
        return nextState;
    }

    if (action.type === "set-bars-transitioning") {
        return {
            ...resetScrollTracking(state, action.scrollTop),
            barsTransitioning: action.active,
        };
    }

    const scrollTop = normalizeScrollTop(action.scrollTop, state.scrollTop);
    const nextState = resetScrollTracking(state, scrollTop);
    if (isMobileBarsScrollPaused(state)) {
        return nextState;
    }
    if (scrollTop <= scrollOptions.topThreshold) {
        nextState.readingBarsVisible = true;
        return nextState;
    }

    const scrollDelta = scrollTop - state.scrollTop;
    if (scrollDelta === 0) {
        return state;
    }

    const scrollDirection: MobileBarsScrollDirection = scrollDelta > 0 ? "down" : "up";
    const canChangeVisibility = scrollDirection === "down" ? state.readingBarsVisible : !state.readingBarsVisible;
    if (!canChangeVisibility) {
        return nextState;
    }

    const scrollDistance = Math.abs(scrollDelta) +
        (state.scrollDirection === scrollDirection ? state.scrollDistance : 0);
    const threshold = scrollDirection === "down" ? scrollOptions.hideThreshold : scrollOptions.showThreshold;
    if (scrollDistance >= threshold) {
        nextState.readingBarsVisible = scrollDirection === "up";
        return nextState;
    }

    nextState.scrollDirection = scrollDirection;
    nextState.scrollDistance = scrollDistance;
    return nextState;
};
