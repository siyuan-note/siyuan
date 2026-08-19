export type TBacklinkDailyNoteFilter = "all" | "only" | "exclude";

export interface IBacklinkSourceFilter {
    dailyNote: TBacklinkDailyNoteFilter;
    excludedNotebookIDs: string[];
    excludeSelf: boolean;
}

export const createBacklinkSourceFilter = (): IBacklinkSourceFilter => ({
    dailyNote: "all",
    excludedNotebookIDs: [],
    excludeSelf: false,
});

export const normalizeBacklinkSourceFilter = (filter: IBacklinkSourceFilter): IBacklinkSourceFilter => ({
    dailyNote: ["only", "exclude"].includes(filter.dailyNote) ? filter.dailyNote : "all",
    excludedNotebookIDs: Array.from(new Set(filter.excludedNotebookIDs.filter(Boolean))).sort(),
    excludeSelf: Boolean(filter.excludeSelf),
});

export const getBacklinkSourceFilterParam = (filter: IBacklinkSourceFilter) => {
    const normalized = normalizeBacklinkSourceFilter(filter);
    if (normalized.dailyNote === "all" && normalized.excludedNotebookIDs.length === 0 && !normalized.excludeSelf) {
        return;
    }
    return normalized;
};
