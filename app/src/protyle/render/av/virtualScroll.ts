import {Constants} from "../../../constants";
import {getRowHTML} from "./row";

const BUFFER_RATIO = 1;

interface IBodyState {
    renderedStart: number;
    renderedEnd: number;
    view: IAVView;
    topSpacerHeight: number;
    pinIndex?: number;
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

    const type = blockElement.getAttribute("data-av-type") as TAVView;
    const bodies = blockElement.querySelectorAll(".av__body:not(.fn__none)") as NodeListOf<HTMLElement>;
    bodies.forEach((bodyEl: HTMLElement) => {
        const state = bodyStates.get(bodyEl);
        const dataRows = type === "table" ? (state.view as IAVTable).rows : (state.view as IAVKanban).cards;
        let currentRows;
        let bottomElement;
        if (type === "table") {
            currentRows = bodyEl.querySelectorAll(".av__row:not(.av__row--header):not(.av__row--footer):not(.av__row--util)") as NodeListOf<HTMLElement>;
            bottomElement = bodyEl.querySelector(".av__row--util");
        } else {
            currentRows = bodyEl.querySelectorAll(".av__gallery-item") as NodeListOf<HTMLElement>;
            bottomElement = bodyEl.querySelector(".av__gallery-add");
        }
        if (currentRows.length === 0) {
            return;
        }
        let topElement = currentRows[0];
        const spacerElement = bodyEl.querySelector(".av__spacer") as HTMLElement;
        let firstVisibleIndex: number;
        let lastVisibleIndex: number;
        const toRemoveAbove: HTMLElement[] = [];
        const toRemoveBelow: HTMLElement[] = [];
        let galleryColumn = type === "gallery" ? 0 : 1;
        const rowHeight = currentRows[0].offsetHeight;
        const firstTop = currentRows[0].getBoundingClientRect().top;
        for (let i = 0; i < currentRows.length; i++) {
            const rect = currentRows[i].getBoundingClientRect();
            if (rect.top === firstTop) {
                galleryColumn++;
            }
            if (rect.top > topLimit) {
                if (typeof firstVisibleIndex === "undefined") {
                    firstVisibleIndex = parseInt(currentRows[i].getAttribute("data-index"));
                }
            } else {
                if (!isScrollingUp && toRemoveAbove.length + 10 < currentRows.length) {
                    toRemoveAbove.push(currentRows[i]);
                }
            }
            if (rect.bottom < bottomLimit) {
                lastVisibleIndex = parseInt(currentRows[i].getAttribute("data-index"));
            } else {
                if (isScrollingUp && toRemoveBelow.length + 10 < currentRows.length) {
                    toRemoveBelow.push(currentRows[i]);
                }
            }
            if (i === currentRows.length - 1 && !isScrollingUp && rect.bottom < bottomLimit) {
                lastVisibleIndex = Math.min(state.renderedEnd + Math.ceil((bottomLimit - rect.bottom) / rowHeight) * galleryColumn, dataRows.length - 1);
            }
        }
        // 需等待 galleryColumn 计算完成
        if (isScrollingUp && firstTop > topLimit) {
            firstVisibleIndex = Math.max(0, state.renderedStart - Math.ceil((firstTop - topLimit) / rowHeight) * galleryColumn);
        }
        if (!isScrollingUp) {
            if (toRemoveAbove.length > 0) {
                // 先在移除前批量读取几何信息（读到的是稳定布局），避免与 row.remove() 交替
                // 触发 N 次强制重排。gallery 分支沿用原「相邻行 offsetTop 比较」语义。
                const removeHeights: number[] = [];
                let galleryAccumulated = 0;
                toRemoveAbove.forEach((row, index) => {
                    // nextElementSibling 是纯 DOM 树属性，不触发重排，可每轮读取。
                    // 循环结束后 topElement 指向最后一个被移除行的下一个兄弟（首个未移除行），
                    // 作为后续 spacer 插入/insertAdjacentHTML 的锚点。
                    topElement = row.nextElementSibling as HTMLElement;
                    if (type === "table") {
                        removeHeights.push(row.offsetHeight);
                    } else if (type === "gallery") {
                        if (galleryAccumulated === 0 || topElement.offsetTop !== row.offsetTop) {
                            let h = row.offsetHeight;
                            if (state.topSpacerHeight !== 0 && index !== 0) {
                                h += 16; // .av__kanban-group gap: 16px;
                            }
                            galleryAccumulated += h;
                            removeHeights.push(h);
                        } else {
                            removeHeights.push(0);
                        }
                    } else if (type === "kanban") {
                        let h = row.offsetHeight;
                        if (state.topSpacerHeight !== 0 && index !== 0) {
                            h += 16; // .av__kanban-group gap: 16px;
                        }
                        removeHeights.push(h);
                    }
                });
                // 再统一移除，此时不再读取布局，仅触发一次重排
                let removeHeight = 0;
                toRemoveAbove.forEach((row, index) => {
                    removeHeight += removeHeights[index];
                    row.remove();
                });
                state.topSpacerHeight += removeHeight;
                state.renderedStart = state.renderedStart + toRemoveAbove.length;

                if (spacerElement) {
                    spacerElement.style.height = state.topSpacerHeight + "px";
                } else if (state.topSpacerHeight > 0) {
                    topElement.insertAdjacentHTML("beforebegin", `<div class="av__spacer" style="height:${state.topSpacerHeight}px"></div>`);
                }
                protyle.contentElement.scrollTop = lastScrollTop;
            }

            if (lastVisibleIndex > state.renderedEnd) {
                let rowsHTML = "";
                for (let i = state.renderedEnd + 1; i <= lastVisibleIndex; i++) {
                    rowsHTML += getRowHTML({
                        data: state.view,
                        row: dataRows[i],
                        rowIndex: i,
                        pinIndex: state.pinIndex,
                        type: blockElement.getAttribute("data-av-type") as TAVView
                    });
                }
                bottomElement.insertAdjacentHTML("beforebegin", rowsHTML);
                state.renderedEnd = lastVisibleIndex;
            }
        } else {
            if (toRemoveBelow.length > 0) {
                toRemoveBelow.forEach(row => row.remove());
                state.renderedEnd = state.renderedEnd - toRemoveBelow.length;
            }

            if (typeof firstVisibleIndex === "number" && firstVisibleIndex < state.renderedStart) {
                let rowsHTML = "";
                for (let i = firstVisibleIndex; i < state.renderedStart; i++) {
                    rowsHTML += getRowHTML({
                        data: state.view,
                        row: dataRows[i],
                        rowIndex: i,
                        pinIndex: state.pinIndex,
                        type: blockElement.getAttribute("data-av-type") as TAVView
                    });
                }
                topElement.insertAdjacentHTML("beforebegin", rowsHTML);

                let renderedHeight = 0;
                let newRowElement = topElement.previousElementSibling as HTMLElement;
                while (newRowElement) {
                    if (type === "table") {
                        renderedHeight += newRowElement.offsetHeight;
                    } else if (type === "gallery") {
                        if (renderedHeight === 0 || (topElement.previousElementSibling as HTMLElement).offsetTop !== newRowElement.offsetTop) {
                            renderedHeight += newRowElement.offsetHeight + 16;
                        }
                    } else if (type === "kanban") {
                        renderedHeight += newRowElement.offsetHeight + 16;
                    }
                    newRowElement = newRowElement.previousElementSibling as HTMLElement;
                    if (!newRowElement || newRowElement.classList.contains("av__spacer") ||
                        newRowElement.classList.contains("av__row--header")) {
                        break;
                    }
                }
                state.topSpacerHeight = Math.max(0, state.topSpacerHeight - renderedHeight);
                if (state.topSpacerHeight === 0) {
                    spacerElement?.remove();
                } else if (spacerElement) {
                    spacerElement.style.height = state.topSpacerHeight + "px";
                }
                state.renderedStart = firstVisibleIndex;
                protyle.contentElement.scrollTop = lastScrollTop;
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
    if (options.blockElement.getAttribute(Constants.ATTRIBUTE_V_SCROLL) !== "true") {
        return;
    }
    dataStore.set(options.blockElement.getAttribute("data-av-id") +
        options.blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW), {
        protyle: options.protyle,
        data: options.data,
    });

    options.blockElement.querySelectorAll(".av__body").forEach((item: HTMLElement) => {
        if (options.data.viewType === "table") {
            bodyStates.set(item, {
                renderedStart: parseInt(item.querySelectorAll(".av__row")[1].getAttribute("data-index")),
                pinIndex: parseInt(item.querySelector(".av__row--header > .block__icons")?.getAttribute("data-pinindex")),
                renderedEnd: parseInt(item.querySelector(".av__row--util").previousElementSibling.getAttribute("data-index")),
                view: getBodyData(item),
                topSpacerHeight: item.querySelector(".av__spacer")?.clientHeight || 0,
            });
        } else {
            bodyStates.set(item, {
                renderedStart: parseInt(item.querySelector(".av__gallery-item").getAttribute("data-index")),
                renderedEnd: parseInt(item.querySelector(".av__gallery-add").previousElementSibling.getAttribute("data-index")),
                view: getBodyData(item),
                topSpacerHeight: item.querySelector(".av__spacer")?.clientHeight || 0,
            });
        }
    });
};
