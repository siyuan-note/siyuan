export type DocVersionType = "current" | "history" | "snapshot";

export interface IDocVersionRef {
    type: DocVersionType;
    id?: string;
    path?: string;
    snapshot?: string;
    label: string;
    created: number;
}

export type DocVersionDiffStatus = "left-only" | "right-only" | "modified" | "moved";
export type DocVersionDiffFilter = "all" | "added" | "removed" | "modified";

export interface IDocVersionDifference {
    id: string;
    statuses: DocVersionDiffStatus[];
}

export const orderDocVersionRefs = (left: IDocVersionRef, right: IDocVersionRef):
    [IDocVersionRef, IDocVersionRef] => {
    return left.created <= right.created ? [left, right] : [right, left];
};

export const matchesDocVersionDiffFilter = (difference: IDocVersionDifference, filter: DocVersionDiffFilter) => {
    if (filter === "all") {
        return true;
    }
    if (filter === "added") {
        return difference.statuses.includes("right-only");
    }
    if (filter === "removed") {
        return difference.statuses.includes("left-only");
    }
    return difference.statuses.includes("modified") || difference.statuses.includes("moved");
};

export const countDocVersionDifferences = (differences: IDocVersionDifference[]) => {
    return {
        all: differences.length,
        added: differences.filter((item) => matchesDocVersionDiffFilter(item, "added")).length,
        removed: differences.filter((item) => matchesDocVersionDiffFilter(item, "removed")).length,
        modified: differences.filter((item) => matchesDocVersionDiffFilter(item, "modified")).length,
    };
};

/** Locate the next strictly older history group, independent of the visible page or filter. */
export const findPreviousHistoryTime = async (selected: string, readPage: (page: number) =>
    Promise<{histories: string[], pageCount: number}>, isCurrent: () => boolean) => {
    const selectedTime = Number(selected);
    let min = 1;
    let max: number | undefined;
    let candidate: string | undefined;
    while (isCurrent() && (max === undefined || min <= max)) {
        const page = max === undefined ? 1 : Math.floor((min + max) / 2);
        const result = await readPage(page);
        if (!isCurrent()) {
            return;
        }
        max = Math.min(max ?? result.pageCount, result.pageCount);
        const older = result.histories.findIndex((time) => Number(time) < selectedTime);
        if (older > 0 || (older === 0 && page === 1)) {
            return result.histories[older];
        }
        if (older === 0) {
            candidate = result.histories[older];
            max = page - 1;
        } else if (result.histories.length === 0) {
            max = Math.min(max, page - 1);
        } else {
            min = page + 1;
        }
    }
    return isCurrent() ? candidate : undefined;
};
