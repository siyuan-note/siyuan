export const GLOBAL_BACKLINK_PAGE_SIZE = 50;
export const GLOBAL_BACKLINK_PAGE_WINDOW = 5;

export const globalBacklinkPageOffset = (index: number) =>
    Math.floor(Math.max(0, index) / GLOBAL_BACKLINK_PAGE_SIZE) * GLOBAL_BACKLINK_PAGE_SIZE;

export const globalBacklinkPageWindow = (center: number, total: number) => {
    const last = globalBacklinkPageOffset(Math.max(0, total - 1));
    const start = Math.max(0, Math.min(center - 2 * GLOBAL_BACKLINK_PAGE_SIZE,
        last - (GLOBAL_BACKLINK_PAGE_WINDOW - 1) * GLOBAL_BACKLINK_PAGE_SIZE));
    return {start, end: Math.min(total, start + GLOBAL_BACKLINK_PAGE_WINDOW * GLOBAL_BACKLINK_PAGE_SIZE)};
};
