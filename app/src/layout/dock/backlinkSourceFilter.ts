export type TBacklinkDailyNoteFilter = "all" | "only" | "exclude";

export interface IBacklinkSourceFilter {
    dailyNote: TBacklinkDailyNoteFilter;
    excludedNotebookIDs: string[];
    excludeSelf: boolean;
    excludedRefDefIDs?: string[];
}

export const createBacklinkSourceFilter = (): IBacklinkSourceFilter => ({
    dailyNote: "all",
    excludedNotebookIDs: [],
    excludeSelf: false,
    excludedRefDefIDs: [],
});

export const normalizeExcludedRefDefIDs = (ids: unknown): string[] => Array.isArray(ids) ?
    Array.from(new Set(ids.filter((id): id is string => typeof id === "string" && /^\d{14}-[a-z0-9]{7}$/.test(id)))).sort() : [];

export const normalizeBacklinkSourceFilter = (filter: IBacklinkSourceFilter): IBacklinkSourceFilter => ({
    dailyNote: ["only", "exclude"].includes(filter.dailyNote) ? filter.dailyNote : "all",
    excludedNotebookIDs: Array.from(new Set(filter.excludedNotebookIDs.filter(Boolean))).sort(),
    excludeSelf: Boolean(filter.excludeSelf),
    excludedRefDefIDs: normalizeExcludedRefDefIDs(filter.excludedRefDefIDs),
});

export const getBacklinkSourceFilterParam = (filter: IBacklinkSourceFilter) => {
    const normalized = normalizeBacklinkSourceFilter(filter);
    if (normalized.dailyNote === "all" && normalized.excludedNotebookIDs.length === 0 && !normalized.excludeSelf &&
        normalized.excludedRefDefIDs.length === 0) {
        return;
    }
    return normalized;
};
