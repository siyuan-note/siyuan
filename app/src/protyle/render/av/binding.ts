// 条目 ID 在换绑前后保持不变，绑定块 ID 只用于指定目标。
export const getAVBindingOperations = (avID: string, itemID: string, nextID: string, blockID: string,
                                       previousValue: IAVCellValue, context?: Record<string, string>) => {
    const base = {action: "replaceAttrViewBlock" as const, avID, previousID: itemID, blockID, context};
    const isDetached = previousValue.isDetached === true || !previousValue.block?.id;
    return {
        doOperations: [{...base, nextID, isDetached: false}] as IOperation[],
        undoOperations: [{...base, nextID: isDetached ? "" : previousValue.block.id, isDetached}] as IOperation[],
    };
};

// 表格单元格和数据库面板共用绑定候选，使用原始字段作为定位与事务目标。
export const getAVBindingCell = (range: Range): HTMLElement | null => {
    if (!range) {
        return null;
    }
    const node = range.startContainer;
    const element = node.nodeType === 1 ? node as HTMLElement : node.parentElement;
    return element?.closest<HTMLElement>('.av__cell, [data-row-id][data-col-id][data-type="block"]') || null;
};

// 属性保存会重绘面板，将正在使用的绑定候选重新定位到同一条目的字段。
export const preserveAVBindingRange = (protyle: IProtyle, element: HTMLElement) => {
    const range = protyle.toolbar.range;
    const cell = getAVBindingCell(range);
    if (!cell?.dataset.rowId || !element.contains(cell) || protyle.hint.element.classList.contains("fn__none")) {
        return () => {};
    }
    const selector = `[data-av-id="${cell.dataset.avId}"][data-row-id="${cell.dataset.rowId}"][data-col-id="${cell.dataset.colId}"]`;
    const boundID = cell.querySelector("input")?.dataset.id;
    return (nextElement: HTMLElement) => {
        const nextCell = nextElement.querySelector<HTMLElement>(selector);
        if (nextCell && nextCell.querySelector("input")?.dataset.id === boundID) {
            range.selectNodeContents(nextCell);
        } else {
            protyle.hint.element.classList.add("fn__none");
        }
    };
};
