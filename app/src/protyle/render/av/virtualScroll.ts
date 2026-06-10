import {Constants} from "../../../constants";
import {getRowHTML} from "./row";

const BUFFER_RATIO = 3;

interface IBodyState {
    renderedStart: number;
    renderedEnd: number;
    view: IAVView;
    pinIndex: number;
}

const dataStore = new Map<string, {
    protyle: IProtyle;
    data: IAV;
}>();
const bodyStates = new WeakMap<HTMLElement, IBodyState>();
const trimPending = new WeakSet<HTMLElement>();
let lastScrollTop: number;

const doTrim = (blockElement: HTMLElement, elementRect: DOMRect): void => {
    const viewportHeight = elementRect.bottom - elementRect.top;
    const buffer = viewportHeight * BUFFER_RATIO;
    const topLimit = elementRect.top - buffer;
    const bottomLimit = elementRect.bottom + buffer;
    const blockRect = blockElement.getBoundingClientRect();

    const protyle = dataStore.get(blockElement.getAttribute("data-av-id") + blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW)).protyle;
    const isScrollingUp = lastScrollTop && lastScrollTop > protyle.contentElement.scrollTop;
    lastScrollTop = protyle.contentElement.scrollTop;

    if ((blockRect.bottom < elementRect.top && !isScrollingUp) || (blockRect.top > elementRect.bottom && isScrollingUp)) {
        return;
    }

    const bodies = blockElement.querySelectorAll(".av__body:not(.fn__none)") as NodeListOf<HTMLElement>;
    bodies.forEach((bodyEl: HTMLElement) => {
        const state = bodyStates.get(bodyEl);
        const dataRows = (state.view as IAVTable).rows;
        const currentRows = bodyEl.querySelectorAll(".av__row:not(.av__row--header):not(.av__row--footer):not(.av__row--util)") as NodeListOf<HTMLElement>;

        let firstVisibleIndex: number;
        let lastVisibleIndex: number;
        const toRemoveAbove: HTMLElement[] = [];
        const toRemoveBelow: HTMLElement[] = [];

        for (let i = 0; i < currentRows.length; i++) {
            const rect = currentRows[i].getBoundingClientRect();
            if (rect.top > topLimit) {
                if (typeof firstVisibleIndex === "undefined") {
                    firstVisibleIndex = parseInt(currentRows[i].getAttribute("data-index"));
                }
            } else {
                if (!isScrollingUp) {
                    toRemoveAbove.push(currentRows[i]);
                }
            }
            if (rect.bottom < bottomLimit) {
                lastVisibleIndex = parseInt(currentRows[i].getAttribute("data-index"));
            } else {
                if (isScrollingUp) {
                    toRemoveBelow.push(currentRows[i]);
                }
            }
            if (i === currentRows.length - 1 && !isScrollingUp && rect.bottom < bottomLimit) {
                lastVisibleIndex = Math.min(state.renderedEnd + Math.ceil((bottomLimit - rect.bottom) / 36), dataRows.length - 1);
            }
            if (i === 0 && isScrollingUp && rect.top > topLimit) {
                firstVisibleIndex = Math.max(0, state.renderedStart - Math.ceil((rect.top - topLimit) / 36));
            }
        }

        if (!isScrollingUp) {
            if (toRemoveAbove.length > 0) {
                toRemoveAbove.forEach(row => row.remove());
                state.renderedStart = state.renderedStart + toRemoveAbove.length;
            }
            if (lastVisibleIndex > state.renderedEnd) {
                let rowsHTML = "";
                for (let i = state.renderedEnd; i < lastVisibleIndex; i++) {
                    rowsHTML += getRowHTML(state.view, dataRows[i], i, state.pinIndex);
                }
                bodyEl.querySelector(".av__row--util").insertAdjacentHTML("beforebegin", rowsHTML);
                state.renderedEnd = lastVisibleIndex;
            }
        } else {
            if (toRemoveBelow.length > 0) {
                toRemoveBelow.forEach(row => row.remove());
                state.renderedEnd = state.renderedEnd - toRemoveBelow.length;
            }
            if (firstVisibleIndex < state.renderedStart) {
                let rowsHTML = "";
                for (let i = firstVisibleIndex; i < state.renderedStart; i++) {
                    rowsHTML += getRowHTML(state.view, dataRows[i], i, state.pinIndex);
                }
                bodyEl.querySelector(".av__row--header").insertAdjacentHTML("afterend", rowsHTML);
                state.renderedStart = firstVisibleIndex;
            }
        }
        bodyStates.set(bodyEl, state);
    });
};

const getBodyData = (bodyEl: HTMLElement) => {
    const avEl = bodyEl.closest(".av") as HTMLElement;
    if (!avEl) return null;
    const stored = dataStore.get(avEl.getAttribute("data-av-id") + avEl.getAttribute(Constants.CUSTOM_SY_AV_VIEW));
    if (!stored) return null;

    const groupId = bodyEl.dataset.groupId;
    return groupId ? stored.data.view.groups.find((g: IAVView) => g.id === groupId) : stored.data.view;
};

export const trimAVRows = (blockElement: HTMLElement, elementRect: DOMRect): void => {
    if (blockElement.getAttribute(Constants.ATTRIBUTE_V_SCROLL) !== "true" || trimPending.has(blockElement)) {
        return;
    }
    trimPending.add(blockElement);
    requestAnimationFrame(() => {
        trimPending.delete(blockElement);
        doTrim(blockElement, elementRect);
    });
};

export const initVirtualScroll = (options: {
    protyle: IProtyle,
    blockElement: HTMLElement,
    data: IAV,
}): void => {
    dataStore.set(options.blockElement.getAttribute("data-av-id") +
        options.blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW), {
        protyle: options.protyle,
        data: options.data,
    });

    options.blockElement.querySelectorAll(".av__body").forEach((bodyEl: HTMLElement) => {
        const state: IBodyState = {
            renderedStart: 0,
            pinIndex: parseInt(bodyEl.querySelector(".av__row--header > .block__icons")?.getAttribute("data-pinindex")),
            renderedEnd: bodyEl.querySelectorAll(".av__row:not(.av__row--header):not(.av__row--footer):not(.av__row--util)").length - 1,
            view: getBodyData(bodyEl),
        };
        bodyStates.set(bodyEl, state);
    });
};
