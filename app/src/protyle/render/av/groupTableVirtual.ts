export const GROUP_TABLE_INITIAL_ROW_BUDGET = 100;
export const GROUP_TABLE_ESTIMATED_ROW_HEIGHT = 36;

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
}): IGroupTableViewportWindow | undefined => {
    if (options.dataEnd < options.dataStart) {
        return;
    }
    const rowHeight = Math.max(options.rowHeight, 1);
    const viewportHeight = Math.max(options.viewportBottom - options.viewportTop, rowHeight);
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
    budget = GROUP_TABLE_INITIAL_ROW_BUDGET,
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
    budget = GROUP_TABLE_INITIAL_ROW_BUDGET,
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
