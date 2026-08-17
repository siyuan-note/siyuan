export const mergeEntryOrder = (defaultOrder: string[], savedOrder?: string[]) => {
    const defaultKeys = new Set(defaultOrder);
    const result = (savedOrder || []).filter((key, index, order) =>
        defaultKeys.has(key) && order.indexOf(key) === index);
    defaultOrder.forEach((key, defaultIndex) => {
        if (result.includes(key)) {
            return;
        }
        const previousKey = defaultOrder.slice(0, defaultIndex).reverse().find((item) => result.includes(item));
        if (previousKey) {
            result.splice(result.indexOf(previousKey) + 1, 0, key);
            return;
        }
        const nextKey = defaultOrder.slice(defaultIndex + 1).find((item) => result.includes(item));
        result.splice(nextKey ? result.indexOf(nextKey) : result.length, 0, key);
    });
    return result;
};

const findValidEntryOrderInterleave = (knownOrder: string[], unknownOrder: string[], slotKinds: boolean[],
                                       separatorKeys: Set<string>) => {
    const memo = new Map<string, string[] | null>();
    const visit = (knownIndex: number, unknownIndex: number, previousSeparator: boolean): string[] | undefined => {
        if (knownIndex === knownOrder.length && unknownIndex === unknownOrder.length) {
            return previousSeparator ? undefined : [];
        }
        const state = `${knownIndex}:${unknownIndex}:${previousSeparator ? 1 : 0}`;
        if (memo.has(state)) {
            return memo.get(state) || undefined;
        }
        const preferUnknown = slotKinds[knownIndex + unknownIndex] === true;
        const sources: Array<"known" | "unknown"> = preferUnknown ? ["unknown", "known"] : ["known", "unknown"];
        for (const source of sources) {
            const item = source === "known" ? knownOrder[knownIndex] : unknownOrder[unknownIndex];
            if (typeof item !== "string") {
                continue;
            }
            const separator = separatorKeys.has(item);
            if (separator && (knownIndex + unknownIndex === 0 || previousSeparator)) {
                continue;
            }
            const tail = source === "known"
                ? visit(knownIndex + 1, unknownIndex, separator)
                : visit(knownIndex, unknownIndex + 1, separator);
            if (tail) {
                const result = [item, ...tail];
                memo.set(state, result);
                return result;
            }
        }
        memo.set(state, null);
        return undefined;
    };
    return visit(0, 0, false);
};

export const mergeEntryOrderPreservingUnknown = (defaultOrder: string[], savedOrder?: string[],
                                                   knownOrder?: string[], separatorKeys?: Set<string>) => {
    const knownKeys = new Set(defaultOrder);
    const mergedKnownOrder = mergeEntryOrder(defaultOrder, knownOrder ?? savedOrder);
    let knownIndex = 0;
    const savedUniqueOrder = (savedOrder || []).filter((key, index, order) => order.indexOf(key) === index);
    const result = savedUniqueOrder
        .map((key) => {
            if (!knownKeys.has(key)) {
                return key;
            }
            return mergedKnownOrder[knownIndex++];
        })
        .filter((key): key is string => typeof key === "string");
    result.push(...mergedKnownOrder.slice(knownIndex));
    if (separatorKeys && !isValidEntryOrder(result, separatorKeys)) {
        const unknownOrder = savedUniqueOrder.filter((key) => !knownKeys.has(key));
        const slotKinds = savedUniqueOrder.map((key) => !knownKeys.has(key));
        return findValidEntryOrderInterleave(mergedKnownOrder, unknownOrder, slotKinds, separatorKeys) || result;
    }
    return result;
};

export const isValidEntryOrder = (order: string[], separatorKeys: Set<string>) => {
    if (order.length === 0 || separatorKeys.has(order[0]) || separatorKeys.has(order[order.length - 1])) {
        return false;
    }
    return !order.some((key, index) => separatorKeys.has(key) && separatorKeys.has(order[index - 1]));
};

export const resolveEntryOrder = (defaultOrder: string[], savedOrder: string[] | undefined,
                                  separatorKeys: Set<string>) => {
    const merged = mergeEntryOrder(defaultOrder, savedOrder);
    return isValidEntryOrder(merged, separatorKeys) ? merged : [...defaultOrder];
};

export const moveEntryOrder = (order: string[], sourceKey: string, targetKey: string, after: boolean,
                               separatorKeys: Set<string>) => {
    if (sourceKey === targetKey || !order.includes(sourceKey) || !order.includes(targetKey)) {
        return;
    }
    const result = order.filter((key) => key !== sourceKey);
    const targetIndex = result.indexOf(targetKey);
    result.splice(targetIndex + (after ? 1 : 0), 0, sourceKey);
    return isValidEntryOrder(result, separatorKeys) ? result : undefined;
};

export const reorderEntrySlots = <T>(items: T[], order: string[], getKey: (item: T) => string | undefined) => {
    const orderIndexes = new Map(order.map((key, index) => [key, index]));
    const configurableIndexes: number[] = [];
    const configurableItems: T[] = [];
    items.forEach((item, index) => {
        if (orderIndexes.has(getKey(item))) {
            configurableIndexes.push(index);
            configurableItems.push(item);
        }
    });
    configurableItems.sort((itemA, itemB) =>
        (orderIndexes.get(getKey(itemA)) ?? Number.MAX_SAFE_INTEGER) -
        (orderIndexes.get(getKey(itemB)) ?? Number.MAX_SAFE_INTEGER));
    const result = [...items];
    configurableIndexes.forEach((index, configurableIndex) => {
        result[index] = configurableItems[configurableIndex];
    });
    return result;
};
