export const isTableCellContentEmpty = (text: string, hasNonTextContent: boolean) => {
    return !hasNonTextContent && text.replace(/[\u200B-\u200D\uFEFF]/g, "").trim() === "";
};

export const getTableResizeCount = (startCount: number, delta: number, addedItemSize: number,
                                    existingItemSizes: number[]) => {
    if (delta >= 0) {
        return startCount + Math.max(0, Math.round(delta / Math.max(1, addedItemSize)));
    }
    let count = startCount;
    let boundary = 0;
    let distance = Math.abs(delta);
    for (let index = startCount - 1; index > 0; index--) {
        boundary -= Math.max(1, existingItemSizes[index] || addedItemSize);
        const currentDistance = Math.abs(delta - boundary);
        if (currentDistance >= distance) {
            break;
        }
        distance = currentDistance;
        count = index;
    }
    return count;
};

export const constrainTableResizeCount = (requestedCount: number, startCount: number, minCount: number,
                                          invalidCounts: Set<number>) => {
    if (requestedCount >= startCount) {
        return requestedCount;
    }
    for (let count = Math.max(minCount, requestedCount); count < startCount; count++) {
        if (!invalidCounts.has(count)) {
            return count;
        }
    }
    return startCount;
};
