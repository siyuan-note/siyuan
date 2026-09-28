export interface RepoTimeRange {
    startTime?: number;
    endTime?: number;
}

export const repoDateRange = (start: string, end: string): RepoTimeRange => {
    const range: RepoTimeRange = {};
    if (start) {
        range.startTime = new Date(`${start}T00:00:00`).getTime();
    }
    if (end) {
        const nextDay = new Date(`${end}T00:00:00`);
        nextDay.setDate(nextDay.getDate() + 1);
        range.endTime = nextDay.getTime();
    }
    return range;
};

export const repoSnapshotInRange = (created: number, range: RepoTimeRange) =>
    (!range.startTime || created >= range.startTime) && (!range.endTime || created < range.endTime);
