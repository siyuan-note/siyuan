/**
 * Overlap packing for the calendar grid. Pure: exact minutes and day indexes in,
 * percentages and lanes out - no DOM globals, no date library, no pixels.
 *
 * This replaces computeTimedEventColumns from render.ts, which had three flaws
 * that all showed up as "the week view looks wrong":
 *
 *  1. its cluster end was a running maximum that was never reset, so once one
 *     long event had been seen a later gap could no longer close the cluster and
 *     unrelated events kept being squeezed into its column count;
 *  2. every member of a cluster got exactly 1/N of the width even when the
 *     columns to its right were free for its whole duration, so two events that
 *     merely touched shrank the entire morning to half width;
 *  3. nothing enforced a minimum width, so a five-way overlap produced 20% wide
 *     slivers and a six-way overlap produced chips too narrow to hit.
 *
 * The all-day packer is here for the same reason: a Tue-Thu event used to be
 * three separate chips because each day header owned its own box. Lanes make it
 * one bar spanning three columns.
 */

/** Below this the chip stops being a click target, so columns start overlapping instead. */
export const CALENDAR_MINIMUM_EVENT_WIDTH_PERCENT = 20;

export interface ITimedLayoutItem {
    /** Stable identity, also the tie-breaker that keeps packing deterministic. */
    key: string;
    /** Minutes since the day column's first minute. */
    startMinute: number;
    endMinute: number;
}

export interface ITimedLayoutBox extends ITimedLayoutItem {
    /** Index of the column this event was greedily assigned to. */
    column: number;
    /** How many columns its cluster needed. */
    columnCount: number;
    /** How many columns it expanded into (>= 1). */
    columnSpan: number;
    leftPercent: number;
    widthPercent: number;
    /** Index of the overlap cluster; useful for debugging and for tests. */
    cluster: number;
}

export interface ITimedLayoutOptions {
    minimumWidthPercent?: number;
}

const overlaps = (a: ITimedLayoutItem, b: ITimedLayoutItem) => a.startMinute < b.endMinute && b.startMinute < a.endMinute;

const roundPercent = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Partition a day's timed events into overlap clusters, give each one a column,
 * then let it expand into the free space to its right.
 */
export const packTimedEventColumns = (items: ITimedLayoutItem[], options: ITimedLayoutOptions = {}): ITimedLayoutBox[] => {
    const minimumWidthPercent = Math.min(Math.max(options.minimumWidthPercent ?? CALENDAR_MINIMUM_EVENT_WIDTH_PERCENT, 1), 100);
    const sorted = items.slice().sort((a, b) =>
        a.startMinute - b.startMinute ||
        b.endMinute - a.endMinute ||
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

    // Split into clusters first. A cluster ends the moment an event starts at or
    // after every event seen so far has ended - and clusterEnd is reset with the
    // cluster, which is precisely what the old implementation forgot.
    const clusters: ITimedLayoutItem[][] = [];
    let current: ITimedLayoutItem[] = [];
    let clusterEnd = Number.NEGATIVE_INFINITY;
    sorted.forEach(item => {
        if (current.length > 0 && item.startMinute >= clusterEnd) {
            clusters.push(current);
            current = [];
            clusterEnd = Number.NEGATIVE_INFINITY;
        }
        current.push(item);
        clusterEnd = Math.max(clusterEnd, item.endMinute);
    });
    if (current.length > 0) {
        clusters.push(current);
    }

    const boxes: ITimedLayoutBox[] = [];
    clusters.forEach((cluster, clusterIndex) => {
        const columns: ITimedLayoutItem[][] = [];
        const columnOf = new Map<string, number>();
        cluster.forEach(item => {
            let target = columns.findIndex(column => column.every(placed => !overlaps(placed, item)));
            if (target === -1) {
                target = columns.length;
                columns.push([]);
            }
            columns[target].push(item);
            columnOf.set(item.key, target);
        });
        const columnCount = Math.max(columns.length, 1);
        cluster.forEach(item => {
            const column = columnOf.get(item.key) || 0;
            // Expand right while the next column has nothing overlapping us: a
            // 09:00-10:00 event next to a 09:30-10:30 one keeps half the width,
            // but a lone 14:00 event in a cluster that only overlaps in the
            // morning gets the whole column back.
            let columnSpan = 1;
            while (column + columnSpan < columnCount &&
                columns[column + columnSpan].every(placed => !overlaps(placed, item))) {
                columnSpan++;
            }
            const rawWidth = (columnSpan / columnCount) * 100;
            const widthPercent = Math.min(Math.max(rawWidth, minimumWidthPercent), 100);
            const rawLeft = (column / columnCount) * 100;
            const leftPercent = Math.min(Math.max(rawLeft, 0), Math.max(100 - widthPercent, 0));
            boxes.push({
                ...item,
                cluster: clusterIndex,
                column,
                columnCount,
                columnSpan,
                leftPercent: roundPercent(leftPercent),
                widthPercent: roundPercent(widthPercent),
            });
        });
    });
    return boxes;
};

export interface IAllDayLaneItem {
    key: string;
    /** First visible day column the bar covers (inclusive, 0 based). */
    startIndex: number;
    /** Last visible day column the bar covers (inclusive). */
    endIndex: number;
}

export interface IAllDayLaneBar extends IAllDayLaneItem {
    lane: number;
    spanCount: number;
}

/**
 * Pack multi-day all-day events into lanes so a Tue-Thu event is ONE bar three
 * columns wide, stacked under any bar it would otherwise sit on top of.
 */
export const packAllDayLanes = (items: IAllDayLaneItem[]): { bars: IAllDayLaneBar[], laneCount: number } => {
    const sorted = items.slice().sort((a, b) =>
        a.startIndex - b.startIndex ||
        (b.endIndex - b.startIndex) - (a.endIndex - a.startIndex) ||
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    // laneLastIndex[lane] is the last day column that lane is already occupying.
    const laneLastIndex: number[] = [];
    const bars = sorted.map(item => {
        const startIndex = Math.min(item.startIndex, item.endIndex);
        const endIndex = Math.max(item.startIndex, item.endIndex);
        let lane = laneLastIndex.findIndex(last => last < startIndex);
        if (lane === -1) {
            lane = laneLastIndex.length;
        }
        laneLastIndex[lane] = endIndex;
        return {...item, startIndex, endIndex, lane, spanCount: endIndex - startIndex + 1};
    });
    return {bars, laneCount: laneLastIndex.length};
};
