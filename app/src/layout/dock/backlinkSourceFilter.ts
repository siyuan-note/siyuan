export type TBacklinkDailyNoteFilter = "all" | "only" | "exclude";

export interface IBacklinkSourceFilter {
    dailyNote: TBacklinkDailyNoteFilter;
    excludedNotebookIDs: string[];
    excludeSelf: boolean;
    excludedBlockTypes?: string[];
}

export const createBacklinkSourceFilter = (): IBacklinkSourceFilter => ({
    dailyNote: "all",
    excludedNotebookIDs: [],
    excludeSelf: false,
    excludedBlockTypes: [],
});

export const normalizeBacklinkSourceFilter = (filter: IBacklinkSourceFilter): IBacklinkSourceFilter => ({
    dailyNote: ["only", "exclude"].includes(filter.dailyNote) ? filter.dailyNote : "all",
    excludedNotebookIDs: Array.from(new Set(filter.excludedNotebookIDs.filter(Boolean))).sort(),
    excludeSelf: Boolean(filter.excludeSelf),
    excludedBlockTypes: Array.from(new Set((filter.excludedBlockTypes || []).filter(Boolean))).sort(),
});

export const getBacklinkSourceFilterParam = (filter: IBacklinkSourceFilter) => {
    const normalized = normalizeBacklinkSourceFilter(filter);
    if (normalized.dailyNote === "all" && normalized.excludedNotebookIDs.length === 0 && !normalized.excludeSelf &&
        normalized.excludedBlockTypes.length === 0) {
        return;
    }
    return normalized;
};
