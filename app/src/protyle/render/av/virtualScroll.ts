import {Constants} from "../../../constants";
import {getRowHTML} from "./row";

const BUFFER_RATIO = 1;

interface IBodyState {
    renderedStart: number;
    renderedEnd: number;
    view: IAVView;
    topSpacerHeight: number;
    pinIndex?: number;
    // 缓存的行高，避免每帧读 currentRows[0].offsetHeight（强制重排来源）。
    // 表格行高在渲染后基本稳定，用缓存值做外推/分页计算即可，少量偏差不影响正确性。
    rowHeight?: number;
    // 选中行 ID 快照。trim 会移除/回填行 DOM，而选中高亮（av__row--select）是纯运行时状态、
    // getRowHTML 不携带，故在每次 trim 处理前从现存 DOM 同步，回填后据此恢复。
    selectedRowIds?: Set<string>;
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
        // body 在本次 trim 期间被并发重渲（如 avRender）时 currentRows 为过期快照，需跳过
        if (!topElement.isConnected) {
            return;
        }
        try {
            const spacerElement = bodyEl.querySelector(".av__spacer") as HTMLElement;
        // 选中高亮是纯 DOM 运行时状态、getRowHTML 不携带。selectedRowIds 由 selectRow 等变更点
        // 维护（见 updateAVRowSelect），trim 回填行后据此恢复，避免虚拟滚动丢失选中态。
        if (!state.selectedRowIds) {
            state.selectedRowIds = new Set();
        }
        // 给回填的行恢复选中态：遍历 body 内现存数据行，命中 selectedRowIds 的补回高亮类与选中图标。
        const restoreSelect = () => {
            if (state.selectedRowIds.size === 0) {
                return;
            }
            bodyEl.querySelectorAll(type === "table" ? ".av__row[data-id]" : ".av__gallery-item[data-id]").forEach((row: HTMLElement) => {
                if (state.selectedRowIds.has(row.getAttribute("data-id"))) {
                    row.classList.add(type === "table" ? "av__row--select" : "av__gallery-item--select");
                    const use = row.querySelector(".av__firstcol use") as SVGUseElement;
                    if (use) {
                        use.setAttribute("xlink:href", "#iconCheck");
                    }
                }
            });
        };
        let firstVisibleIndex: number;
        let lastVisibleIndex: number;
        const toRemoveAbove: HTMLElement[] = [];
        const toRemoveBelow: HTMLElement[] = [];
        let galleryColumn = type === "gallery" ? 0 : 1;
        // 行高缓存，避免每帧读 offsetHeight 触发布局
        const rowHeight = state.rowHeight || currentRows[0].offsetHeight;
        state.rowHeight = rowHeight;
        const firstTop = currentRows[0].getBoundingClientRect().top;
        // 大跨度跳转（如 Ctrl+Home）后渲染窗口与视口脱钩：spacer 把现存行整体顶出视口，
        // 渐进式 trim 无法回填（firstVisibleIndex 取不到、回填分支依赖连续滚动方向）。
        // 此处用 spacer 下沿（即 renderedStart 行的实际位置）反推视口应显示的起始行，
        // 与 renderedStart 偏差超过一屏时整体重置渲染窗口，不依赖滚动方向与连续性。
        if (spacerElement && state.renderedStart > 0) {
            const viewportStartTop = Math.max(elementRect.top, blockRect.top);
            const renderedStartTop = spacerElement.getBoundingClientRect().bottom;
            const rowsPerViewport = Math.ceil(viewportHeight / Math.max(rowHeight, 1));
            // renderedStartTop 远在视口下方，说明视口正落在 spacer 空白区，顶部行未渲染
            if (renderedStartTop - viewportStartTop > rowHeight * rowsPerViewport) {
                currentRows.forEach(row => row.remove());
                spacerElement.remove();
                const newEnd = Math.min(rowsPerViewport - 1, dataRows.length - 1);
                let rowsHTML = "";
                const viewType = blockElement.getAttribute("data-av-type") as TAVView;
                for (let i = 0; i <= newEnd; i++) {
                    rowsHTML += getRowHTML({
                        data: state.view,
                        row: dataRows[i],
                        rowIndex: i,
                        pinIndex: state.pinIndex,
                        type: viewType
                    });
                }
                if (bottomElement && bottomElement.isConnected) {
                    bottomElement.insertAdjacentHTML("beforebegin", rowsHTML);
                }
                restoreSelect();
                state.renderedStart = 0;
                state.renderedEnd = newEnd;
                state.topSpacerHeight = 0;
                return;
            }
        }
        let foundFirstVisible = false;
        for (let i = 0; i < currentRows.length; i++) {
            const rect = currentRows[i].getBoundingClientRect();
            if (rect.top === firstTop) {
                galleryColumn++;
            }
            if (rect.top > topLimit) {
                if (!foundFirstVisible) {
                    foundFirstVisible = true;
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
                // 表格下滚时 top 单调递增，后续行必然都在下方，可提前结束扫描
                if (type === "table" && !isScrollingUp) {
                    break;
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
                // 计算被移除行的总高度并累加到 topSpacerHeight，保持文档总高度不变、视口不跳。
                // table 为连续前缀，用首行 top 与首个保留行 top 之差求得精确总高度；
                // gallery/kanban 多列布局需逐行读取以判断换行。
                let removeHeight = 0;
                topElement = toRemoveAbove[toRemoveAbove.length - 1].nextElementSibling as HTMLElement;
                if (type === "table" && topElement) {
                    const removeStartTop = toRemoveAbove[0].getBoundingClientRect().top;
                    const removeEndTop = topElement.getBoundingClientRect().top;
                    removeHeight = Math.round(removeEndTop - removeStartTop);
                } else {
                    const removeHeights: number[] = [];
                    let galleryAccumulated = 0;
                    toRemoveAbove.forEach((row, index) => {
                        topElement = row.nextElementSibling as HTMLElement;
                        if (type === "gallery") {
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
                        } else { // kanban
                            let h = row.offsetHeight;
                            if (state.topSpacerHeight !== 0 && index !== 0) {
                                h += 16; // .av__kanban-group gap: 16px;
                            }
                            removeHeights.push(h);
                        }
                    });
                    removeHeight = removeHeights.reduce((sum, h) => sum + h, 0);
                }
                // 统一移除，此时不再读取布局，仅触发一次重排
                toRemoveAbove.forEach((row) => {
                    row.remove();
                });
                state.topSpacerHeight += removeHeight;
                state.renderedStart = state.renderedStart + toRemoveAbove.length;

                if (spacerElement) {
                    spacerElement.style.height = state.topSpacerHeight + "px";
                } else if (state.topSpacerHeight > 0 && topElement.isConnected) {
                    topElement.insertAdjacentHTML("beforebegin", `<div class="av__spacer" style="height:${state.topSpacerHeight}px"></div>`);
                }
            }

            if (lastVisibleIndex > state.renderedEnd) {
                // 限制单帧渲染的新行数为一个视口，避免快速下滚时一次性拼出/插入大量 HTML，
                // 超出部分由后续滚动帧补齐
                const rowsPerViewport = Math.ceil(viewportHeight / Math.max(rowHeight, 1));
                const maxRowsPerFrame = rowsPerViewport * (galleryColumn || 1);
                if (lastVisibleIndex > state.renderedEnd + maxRowsPerFrame) {
                    lastVisibleIndex = state.renderedEnd + maxRowsPerFrame;
                }
                let rowsHTML = "";
                const viewType = blockElement.getAttribute("data-av-type") as TAVView;
                for (let i = state.renderedEnd + 1; i <= lastVisibleIndex; i++) {
                    rowsHTML += getRowHTML({
                        data: state.view,
                        row: dataRows[i],
                        rowIndex: i,
                        pinIndex: state.pinIndex,
                        type: viewType
                    });
                }
                if (bottomElement && bottomElement.isConnected) {
                    bottomElement.insertAdjacentHTML("beforebegin", rowsHTML);
                }
                restoreSelect();
                state.renderedEnd = lastVisibleIndex;
            }
        } else {
            if (toRemoveBelow.length > 0) {
                toRemoveBelow.forEach(row => row.remove());
                state.renderedEnd = state.renderedEnd - toRemoveBelow.length;
            }

            if (typeof firstVisibleIndex === "number" && firstVisibleIndex < state.renderedStart) {
                let rowsHTML = "";
                const viewType = blockElement.getAttribute("data-av-type") as TAVView;
                for (let i = firstVisibleIndex; i < state.renderedStart; i++) {
                    rowsHTML += getRowHTML({
                        data: state.view,
                        row: dataRows[i],
                        rowIndex: i,
                        pinIndex: state.pinIndex,
                        type: viewType
                    });
                }
                if (!topElement.isConnected) {
                    return;
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
                restoreSelect();
            }
        }
        } finally {
            bodyStates.set(bodyEl, state);
        }
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

// 对外暴露 body 数据源，供虚拟滚动状态下写入/粘贴未渲染行时生成占位行 HTML
export const getAvBodyData = (bodyEl: HTMLElement): IAVView | null => {
    return getBodyData(bodyEl);
};

// 同步选中行 ID 到虚拟滚动状态。选中高亮是纯 DOM 运行时状态，trim 会移除/回填行 DOM，
// 若不在变更点维护一份 ID 快照，被 trim 掉的选中行回填后将永久丢失选中态。
// selectRow 等所有变更选中态的入口在改完 DOM 后需调用：selected=true 记入、false 移除。
export const updateAVRowSelect = (bodyEl: HTMLElement, rowId: string, selected: boolean): void => {
    const state = bodyStates.get(bodyEl);
    if (!state) {
        return;
    }
    if (!state.selectedRowIds) {
        state.selectedRowIds = new Set();
    }
    if (selected) {
        state.selectedRowIds.add(rowId);
    } else {
        state.selectedRowIds.delete(rowId);
    }
};

// 全量重置某 body 的选中行 ID 快照（全选/全不选/avRender 重渲后调用）。
export const resetAVRowSelect = (bodyEl: HTMLElement, rowIds: string[]): void => {
    const state = bodyStates.get(bodyEl);
    if (!state) {
        return;
    }
    state.selectedRowIds = new Set(rowIds);
};

// 返回某 body 的选中统计，供虚拟滚动场景下 updateHeader 显示真实计数。
// 虚拟滚动时 DOM 内只有渲染窗口的行，直接查 DOM 会低估选中数；此处改用 selectedRowIds 快照与
// 已加载分页行总数（state.view.rows）计算。非虚拟滚动（无 state）时返回 null 表示回退到 DOM 计数。
export const getAVSelectStat = (bodyEl: HTMLElement): { selectCount: number, loadedCount: number } | null => {
    const state = bodyStates.get(bodyEl);
    if (!state || !state.selectedRowIds) {
        return null;
    }
    const dataRows = state.view ? ((state.view as IAVTable).rows || (state.view as IAVKanban).cards || []) : [];
    return {
        selectCount: state.selectedRowIds.size,
        loadedCount: dataRows.length,
    };
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

// 同步执行 doTrim（不另起 rAF），供已处于 rAF 回调中的调用方使用，例如 scroll 事件中
// 与 stickyRow 合并到同一 rAF。调用方负责保证不在同一帧重复调用（外部已有 avScrollPending 去重）。
export const trimAVRowsSync = (blockElement: HTMLElement, elementRect: DOMRect): void => {
    if (blockElement.getAttribute(Constants.ATTRIBUTE_V_SCROLL) !== "true") {
        return;
    }
    doTrim(blockElement, elementRect);
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
        // 从现存 DOM 初始化选中行 ID 快照，重渲后保留选中态
        const selectedRowIds = new Set<string>();
        item.querySelectorAll(options.data.viewType === "table" ? ".av__row--select" : ".av__gallery-item--select").forEach((row: HTMLElement) => {
            const id = row.getAttribute("data-id");
            if (id) {
                selectedRowIds.add(id);
            }
        });
        if (options.data.viewType === "table") {
            bodyStates.set(item, {
                renderedStart: parseInt(item.querySelectorAll(".av__row")[1].getAttribute("data-index")),
                pinIndex: parseInt(item.querySelector(".av__row--header > .block__icons")?.getAttribute("data-pinindex")),
                renderedEnd: parseInt(item.querySelector(".av__row--util").previousElementSibling.getAttribute("data-index")),
                view: getBodyData(item),
                topSpacerHeight: item.querySelector(".av__spacer")?.clientHeight || 0,
                selectedRowIds,
            });
        } else {
            bodyStates.set(item, {
                renderedStart: parseInt(item.querySelector(".av__gallery-item").getAttribute("data-index")),
                renderedEnd: parseInt(item.querySelector(".av__gallery-add").previousElementSibling.getAttribute("data-index")),
                view: getBodyData(item),
                topSpacerHeight: item.querySelector(".av__spacer")?.clientHeight || 0,
                selectedRowIds,
            });
        }
    });
};
