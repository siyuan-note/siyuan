import {AVTableRowHeights} from "./tableRowHeights";

export const GROUP_TABLE_INITIAL_ROW_BUDGET = 100;
export const GROUP_TABLE_ESTIMATED_ROW_HEIGHT = 36;
const TABLE_INITIAL_CELL_BUDGET = 900;

export const getTablePinIndex = (table: IAVTable) => (table.columns || []).reduce((index, column, current) =>
    !column.hidden && column.pin ? current : index, -1);

export const hasTableCellBudgetOverflow = (table: IAVTable) => {
    const count = (view: IAVTable): number => view.groups?.length ?
        (view.groups as IAVTable[]).filter(group => group.groupHidden === 0 && !group.groupFolded)
            .reduce((total, group) => total + count(group), 0) :
        (view.rows?.length || 0) * (view.columns?.filter(column => !column.hidden).length || 0);
    return count(table) > TABLE_INITIAL_CELL_BUDGET;
};

export const getTableRowBudget = (table: IAVTable) => Math.max(1, Math.min(GROUP_TABLE_INITIAL_ROW_BUDGET,
    Math.floor(TABLE_INITIAL_CELL_BUDGET / Math.max(1, table.columns?.filter(column => !column.hidden).length || 0))));

export const getGroupedTableRowBudget = (groups: IAVTable[]) => groups.reduce((budget, group) =>
    group.groupHidden === 0 && !group.groupFolded ? Math.min(budget, getTableRowBudget(group)) : budget,
GROUP_TABLE_INITIAL_ROW_BUDGET);

export const getTableBufferRatio = (table: IAVTable) =>
    getTableRowBudget(table) < GROUP_TABLE_INITIAL_ROW_BUDGET && table.rows.length > getTableRowBudget(table) ? 0.25 : 1;

export interface IGroupTableRenderPlan {
    virtualized: boolean;
    virtualData: Record<string, IAVVirtualData>;
    renderedRowCounts: Record<string, number>;
}

export interface IGroupTableViewportWindow {
    renderedStart: number;
    renderedEnd: number;
    topSpacerHeight: number;
    targetIndex: number;
}

export const getGroupTableViewportWindow = (options: {
    dataStart: number;
    dataEnd: number;
    bodyTop: number;
    headerHeight: number;
    viewportTop: number;
    viewportBottom: number;
    rowHeight: number;
    bufferRatio?: number;
    rowHeights?: AVTableRowHeights;
}): IGroupTableViewportWindow | undefined => {
    if (options.dataEnd < options.dataStart) {
        return;
    }
    const rowHeight = Math.max(options.rowHeight, 1);
    const viewportHeight = Math.max(options.viewportBottom - options.viewportTop, rowHeight);
    if (options.rowHeights || options.bufferRatio !== undefined) {
        const relativeTop = options.viewportTop - options.bodyTop - options.headerHeight;
        const relativeBottom = options.viewportBottom - options.bodyTop - options.headerHeight;
        const buffer = viewportHeight * (options.bufferRatio ?? 1);
        const indexAt = (offset: number) => Math.max(options.dataStart, Math.min(options.dataEnd,
            options.dataStart + (options.rowHeights ? options.rowHeights.indexAt(offset) : Math.floor(offset / rowHeight))));
        const renderedStart = indexAt(relativeTop - buffer);
        const renderedEnd = Math.max(renderedStart, indexAt(relativeBottom + buffer));
        return {
            renderedStart,
            renderedEnd,
            topSpacerHeight: options.rowHeights ? options.rowHeights.offset(renderedStart - options.dataStart) :
                (renderedStart - options.dataStart) * rowHeight,
            targetIndex: indexAt(relativeTop + viewportHeight / 2),
        };
    }
    const viewportCenter = options.viewportTop + viewportHeight / 2;
    const targetIndex = Math.max(options.dataStart, Math.min(options.dataEnd,
        options.dataStart + Math.floor((viewportCenter - options.bodyTop - options.headerHeight) / rowHeight)));
    const rowsPerViewport = Math.max(1, Math.ceil(viewportHeight / rowHeight));
    const windowSize = Math.min(options.dataEnd - options.dataStart + 1, rowsPerViewport * 3);
    const latestStart = options.dataEnd - windowSize + 1;
    const renderedStart = Math.max(options.dataStart, Math.min(latestStart, targetIndex - rowsPerViewport));
    return {
        renderedStart,
        renderedEnd: renderedStart + windowSize - 1,
        topSpacerHeight: (renderedStart - options.dataStart) * rowHeight,
        targetIndex,
    };
};

export const clampGroupTableVirtualData = (virtualData: IAVVirtualData | undefined, rowCount: number) => {
    if (!virtualData || rowCount === 0) {
        return;
    }
    const oldCount = Math.max(1, virtualData.renderedEnd - virtualData.renderedStart + 1);
    if (virtualData.renderedStart >= rowCount || virtualData.renderedEnd < 0) {
        return {
            ...virtualData,
            renderedStart: 0,
            renderedEnd: Math.min(rowCount, oldCount) - 1,
            topSpacerHeight: 0,
        };
    }
    const renderedStart = Math.max(0, virtualData.renderedStart);
    return {
        ...virtualData,
        renderedStart,
        renderedEnd: Math.max(renderedStart, Math.min(virtualData.renderedEnd, rowCount - 1)),
        topSpacerHeight: renderedStart === virtualData.renderedStart ? virtualData.topSpacerHeight : 0,
    };
};

export const getGroupTableRenderPlan = (
    groups: IAVTable[],
    restoredVirtualData: Record<string, IAVVirtualData> = {},
    budget = getGroupedTableRowBudget(groups),
): IGroupTableRenderPlan => {
    const renderableGroups = groups.filter(group =>
        group.groupHidden === 0 && (!group.groupFolded || restoredVirtualData[group.id]?.locate) && group.rows.length > 0);
    const totalRows = renderableGroups.reduce((count, group) => count + group.rows.length, 0);
    const hasRestoredWindow = renderableGroups.some(group => restoredVirtualData[group.id]);
    if (totalRows <= budget && !hasRestoredWindow) {
        return {
            virtualized: false,
            virtualData: {},
            renderedRowCounts: Object.fromEntries(renderableGroups.map(group => [group.id, group.rows.length])),
        };
    }

    const virtualData: Record<string, IAVVirtualData> = {};
    const renderedRowCounts: Record<string, number> = {};
    let remaining = Math.max(0, budget);

    renderableGroups.forEach(group => {
        const restored = clampGroupTableVirtualData(restoredVirtualData[group.id], group.rows.length);
        if (!restored) {
            return;
        }
        virtualData[group.id] = restored;
        const count = restored.renderedEnd - restored.renderedStart + 1;
        renderedRowCounts[group.id] = count;
        remaining = Math.max(0, remaining - count);
    });

    // 每个展开的非空分组至少渲染一行，确保 virtualScroll 能登记该 body。
    renderableGroups.forEach(group => {
        if (typeof renderedRowCounts[group.id] === "number") {
            return;
        }
        renderedRowCounts[group.id] = 1;
        remaining = Math.max(0, remaining - 1);
    });

    // 页面顶部的分组最接近初始视口，优先使用剩余预算。
    renderableGroups.forEach(group => {
        if (restoredVirtualData[group.id] || remaining === 0) {
            return;
        }
        const allocated = renderedRowCounts[group.id] || 0;
        const addition = Math.min(group.rows.length - allocated, remaining);
        renderedRowCounts[group.id] = allocated + addition;
        remaining -= addition;
    });

    renderableGroups.forEach(group => {
        if (restoredVirtualData[group.id]) {
            return;
        }
        const count = renderedRowCounts[group.id] || 0;
        if (count < group.rows.length) {
            virtualData[group.id] = {
                renderedStart: 0,
                renderedEnd: count - 1,
                topSpacerHeight: 0,
            };
        }
    });
    return {virtualized: true, virtualData, renderedRowCounts};
};

export const getUninitializedGroupRowCounts = (
    groups: IAVTable[],
    initializedRowCount: number,
    budget = getGroupedTableRowBudget(groups),
) => {
    const counts: Record<string, number> = {};
    const nonemptyGroups = groups.filter(group => group.rows.length > 0);
    const totalRows = nonemptyGroups.reduce((count, group) => count + group.rows.length, 0) + initializedRowCount;
    if (totalRows <= budget) {
        nonemptyGroups.forEach(group => {
            counts[group.id] = group.rows.length;
        });
        return counts;
    }

    let remaining = Math.max(0, budget - initializedRowCount);
    nonemptyGroups.forEach(group => {
        counts[group.id] = 1;
        remaining = Math.max(0, remaining - 1);
    });
    nonemptyGroups.forEach(group => {
        if (remaining === 0) {
            return;
        }
        const addition = Math.min(group.rows.length - counts[group.id], remaining);
        counts[group.id] += addition;
        remaining -= addition;
    });
    return counts;
};
