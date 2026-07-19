import {Constants} from "../../../constants";
import {getRowHTML} from "./row";

const BUFFER_RATIO = 1;

interface IBodyState {
    renderedStart: number;
    renderedEnd: number;
    dataOffset: number;
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

// 测量 DOM 变更前后容器 scrollHeight 的差值，用于精确计算 gallery 多列网格中行移除/回填的实际高度（含 gap）
const measureHeightDiff = (el: HTMLElement, mutate: () => void): number => {
    const before = el?.scrollHeight || 0;
    mutate();
    return Math.abs((el?.scrollHeight || 0) - before);
};

const doTrim = (blockElement: HTMLElement, elementRect: DOMRect): void => {
    const viewportHeight = elementRect.bottom - elementRect.top;
    const buffer = viewportHeight * BUFFER_RATIO;
    const topLimit = elementRect.top - buffer;
    const bottomLimit = elementRect.bottom + buffer;
    const blockRect = blockElement.getBoundingClientRect();

    // AV 重渲/新增分组/局部更新未走完整 initVirtualScroll 时 dataStore 可能缺失，跳过本次 trim，
    // 等下次 initVirtualScroll 重新登记后再处理，避免解引用 undefined.protyle
    const stored = dataStore.get(blockElement.getAttribute("data-av-id") + blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW));
    if (!stored) {
        return;
    }
    const protyle = stored.protyle;
    const isScrollingUp = lastScrollTop && lastScrollTop > protyle.contentElement.scrollTop;
    lastScrollTop = protyle.contentElement.scrollTop;

    if ((blockRect.bottom < elementRect.top && !isScrollingUp) || (blockRect.top > elementRect.bottom && isScrollingUp)) {
        return;
    }

    const type = blockElement.getAttribute("data-av-type") as TAVView;
    const bodies = blockElement.querySelectorAll(".av__body:not(.fn__none)") as NodeListOf<HTMLElement>;
    bodies.forEach((bodyEl: HTMLElement) => {
        const state = bodyStates.get(bodyEl);
        // body 尚未在 initVirtualScroll 中登记（重渲/新增分组/局部更新未走完整流程），
        // WeakMap 查不到则跳过本次 trim，避免解引用 undefined.view
        if (!state) {
            return;
        }
        const dataRows = type === "table" ? (state.view as IAVTable).rows : (state.view as IAVKanban).cards;
        const dataStart = state.dataOffset;
        const dataEnd = dataStart + dataRows.length - 1;
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
        // 数据行数不超过 trim 有效范围（视口 + 上下 buffer）时不 trim（如看板中较短的分组），
        // 全部渲染即可，避免短列因 trim 导致 spacer 抖动或全部移除后无法回填
        const trimRange = viewportHeight + buffer * 2;
        if (bodyEl.dataset.avLocateWindow !== "true" &&
            dataRows.length <= Math.ceil(trimRange / Math.max(state.rowHeight || currentRows[0].offsetHeight, 1))) {
            // 清理可能残留的 spacer 和状态，恢复全部渲染
            const spacerEl = bodyEl.querySelector(".av__spacer") as HTMLElement;
            if (spacerEl) {
                spacerEl.remove();
                state.topSpacerHeight = 0;
                state.renderedStart = dataStart;
                state.renderedEnd = dataEnd;
                bodyStates.set(bodyEl, state);
            }
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
        let galleryColumn = type === "table" ? 1 : 0;
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
                const newEnd = Math.min(dataStart + rowsPerViewport - 1, dataEnd);
                let rowsHTML = "";
                const viewType = blockElement.getAttribute("data-av-type") as TAVView;
                for (let i = dataStart; i <= newEnd; i++) {
                    rowsHTML += getRowHTML({
                        data: state.view,
                        row: dataRows[i - dataStart],
                        rowIndex: i,
                        pinIndex: state.pinIndex,
                        type: viewType
                    });
                }
                if (bottomElement && bottomElement.isConnected) {
                    bottomElement.insertAdjacentHTML("beforebegin", rowsHTML);
                }
                restoreSelect();
                state.renderedStart = dataStart;
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
                lastVisibleIndex = Math.min(state.renderedEnd + Math.ceil((bottomLimit - rect.bottom) / rowHeight) * galleryColumn, dataEnd);
            }
        }
        // gallery 多列布局需按视觉行整体移除，不能拆分同一行的卡片，否则 grid 重排导致列跳动。
        // 若最后一个被收集卡片和首个保留卡片在同一视觉行，说明该行被拆分，需将该行从 toRemoveAbove 中移除
        if (type === "gallery" && toRemoveAbove.length > 0 && !isScrollingUp) {
            const lastRemoved = toRemoveAbove[toRemoveAbove.length - 1];
            const firstKept = lastRemoved.nextElementSibling as HTMLElement;
            if (firstKept && firstKept.offsetTop === lastRemoved.offsetTop) {
                const incompleteTop = lastRemoved.offsetTop;
                while (toRemoveAbove.length > 0 &&
                    (toRemoveAbove[toRemoveAbove.length - 1] as HTMLElement).offsetTop === incompleteTop) {
                    toRemoveAbove.pop();
                }
            }
        }
        // 需等待 galleryColumn 计算完成
        if (isScrollingUp && firstTop > topLimit) {
            firstVisibleIndex = Math.max(dataStart, state.renderedStart - Math.ceil((firstTop - topLimit) / rowHeight) * galleryColumn);
        }
        if (!isScrollingUp) {
            if (toRemoveAbove.length > 0) {
                // 计算被移除行的总高度并累加到 topSpacerHeight，保持文档总高度不变、视口不跳
                topElement = toRemoveAbove[toRemoveAbove.length - 1].nextElementSibling as HTMLElement;
                let removeHeight = 0;
                if (type === "gallery") {
                    // gallery 多列网格：用容器 scrollHeight 差值精确计算（含 gap，避免逐行估算不准）
                    const galleryEl = bodyEl.querySelector(".av__gallery") as HTMLElement;
                    removeHeight = measureHeightDiff(galleryEl, () => {
                        toRemoveAbove.forEach((row) => {
                            row.remove();
                        });
                    });
                } else if (type === "table" && topElement) {
                    const removeStartTop = toRemoveAbove[0].getBoundingClientRect().top;
                    const removeEndTop = topElement.getBoundingClientRect().top;
                    removeHeight = Math.round(removeEndTop - removeStartTop);
                    toRemoveAbove.forEach((row) => {
                        row.remove();
                    });
                } else { // kanban
                    // grid 布局中 spacer 与行、行与行之间均有 16px gap，每行都需计入
                    removeHeight = toRemoveAbove.reduce((sum, row) => sum + row.offsetHeight + 16, 0);
                    toRemoveAbove.forEach((row) => {
                        row.remove();
                    });
                }
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
                        row: dataRows[i - dataStart],
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
                        row: dataRows[i - dataStart],
                        rowIndex: i,
                        pinIndex: state.pinIndex,
                        type: viewType
                    });
                }
                if (!topElement.isConnected) {
                    return;
                }
                let renderedHeight = 0;
                if (type === "gallery") {
                    // gallery 多列网格：用容器 scrollHeight 差值精确计算（含 gap，避免逐行估算不准）
                    const galleryEl = bodyEl.querySelector(".av__gallery") as HTMLElement;
                    renderedHeight = measureHeightDiff(galleryEl, () => {
                        topElement.insertAdjacentHTML("beforebegin", rowsHTML);
                    });
                } else {
                    topElement.insertAdjacentHTML("beforebegin", rowsHTML);
                    let newRowElement = topElement.previousElementSibling as HTMLElement;
                    while (newRowElement) {
                        if (type === "table") {
                            renderedHeight += newRowElement.offsetHeight;
                        } else { // kanban
                            // grid 布局中行与行之间均有 16px gap，每行都需计入
                            renderedHeight += newRowElement.offsetHeight + 16;
                        }
                        newRowElement = newRowElement.previousElementSibling as HTMLElement;
                        if (!newRowElement || newRowElement.classList.contains("av__spacer") ||
                            newRowElement.classList.contains("av__row--header")) {
                            break;
                        }
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

// 读取虚拟滚动渲染窗口。insertAttrViewBlockAnimation/insertGalleryItemAnimation 插入的 ghost 占位行
// 没有 data-index，会污染 renderedEnd，需跳过；同时内核按 previousID 决定新行在数据中的位置，
// 需据此扩展渲染窗口让新行立即可见，否则虚拟滚动下新行会落在窗口外不渲染。
export const getBodyVirtualData = (bodyEl: HTMLElement, endSelector: string, firstRowIndex: number): IAVVirtualData => {
    // 末尾标记前可能存在连续 ghost 行，向前回溯找到真实末行
    // 末尾标记（.av__row--util / .av__gallery-add）缺失时（重渲竞态）直接回退到 firstRowIndex，
    // 避免解引用 null.previousElementSibling
    const endMarker = bodyEl.querySelector(endSelector);
    let lastRow = endMarker ? endMarker.previousElementSibling as HTMLElement : null;
    while (lastRow && !lastRow.getAttribute("data-index")) {
        lastRow = lastRow.previousElementSibling as HTMLElement;
    }
    let renderedStart = firstRowIndex;
    let renderedEnd = parseInt(lastRow?.getAttribute("data-index") || "");
    const ghostElements = bodyEl.querySelectorAll('[data-type="ghost"]');
    if (ghostElements.length > 0) {
        // 连续 ghost 行紧跟同一 previousElement，取首个 ghost 前最近的非 ghost 元素确定新行插入点
        let prev = (ghostElements[0] as HTMLElement).previousElementSibling as HTMLElement;
        while (prev && prev.getAttribute("data-type") === "ghost") {
            prev = prev.previousElementSibling as HTMLElement;
        }
        const prevIndex = prev?.getAttribute("data-index");
        if (prevIndex) {
            renderedEnd = Math.max(renderedEnd, parseInt(prevIndex) + ghostElements.length);
        } else {
            // previousElement 为表头（previousID 为空），新行插在数据最前面
            renderedStart = 0;
            renderedEnd = Math.max(renderedEnd, ghostElements.length - 1);
        }
    }
    return {
        renderedStart,
        renderedEnd,
        topSpacerHeight: bodyEl.querySelector(".av__spacer")?.clientHeight || 0,
    };
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
        const dataOffset = item.dataset.avLocateWindow === "true" ? options.data.target?.offset || 0 : 0;
        const view = getBodyData(item);
        if (!view) {
            return;
        }
        // 从现存 DOM 初始化选中行 ID 快照，重渲后保留选中态
        const selectedRowIds = new Set<string>();
        item.querySelectorAll(options.data.viewType === "table" ? ".av__row--select" : ".av__gallery-item--select").forEach((row: HTMLElement) => {
            const id = row.getAttribute("data-id");
            if (id) {
                selectedRowIds.add(id);
            }
        });
        if (options.data.viewType === "table") {
            const firstRow = item.querySelector(".av__row[data-id]") as HTMLElement;
            let lastRow = item.querySelector(".av__row--util")?.previousElementSibling as HTMLElement;
            while (lastRow && !lastRow.dataset.index) {
                lastRow = lastRow.previousElementSibling as HTMLElement;
            }
            if (!firstRow || !lastRow) {
                return;
            }
            bodyStates.set(item, {
                renderedStart: parseInt(firstRow.dataset.index),
                pinIndex: parseInt(item.querySelector(".av__row--header > .block__icons")?.getAttribute("data-pinindex")),
                renderedEnd: parseInt(lastRow.dataset.index),
                dataOffset,
                view,
                topSpacerHeight: item.querySelector(".av__spacer")?.clientHeight || 0,
                selectedRowIds,
            });
        } else {
            const firstItem = item.querySelector(".av__gallery-item") as HTMLElement;
            let lastItem = item.querySelector(".av__gallery-add")?.previousElementSibling as HTMLElement;
            while (lastItem && !lastItem.dataset.index) {
                lastItem = lastItem.previousElementSibling as HTMLElement;
            }
            if (!firstItem || !lastItem) {
                return;
            }
            bodyStates.set(item, {
                renderedStart: parseInt(firstItem.dataset.index),
                renderedEnd: parseInt(lastItem.dataset.index),
                dataOffset,
                view,
                topSpacerHeight: item.querySelector(".av__spacer")?.clientHeight || 0,
                selectedRowIds,
            });
        }
    });
};
