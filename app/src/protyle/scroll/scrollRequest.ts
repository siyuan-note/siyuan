export const getSavedScrollRange = (startId?: string | null, endId?: string | null): {
    startId?: string,
    endId?: string,
} => {
    if (!startId || !endId) {
        return {};
    }
    return {startId, endId};
};

export const getScrollRequestParams = (size: number, startID?: string | null, endID?: string | null): {
    size: number,
    startID?: string,
    endID?: string,
} => {
    if (!startID || !endID) {
        return {size};
    }
    return {size, startID, endID};
};
