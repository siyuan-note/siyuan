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
