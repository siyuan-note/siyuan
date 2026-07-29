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
