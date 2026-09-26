export const clampMindmapPanOffset = (offset: number, start: number, end: number, scale: number, viewport: number) => {
    if (![offset, start, end, scale, viewport].every(Number.isFinite) || scale <= 0 || viewport <= 0) {
        return offset;
    }
    const extent = Math.max(0, (end - start) * scale);
    const visible = Math.min(64, viewport / 2, extent);
    const minimum = visible - end * scale;
    const maximum = viewport - visible - start * scale;
    return Math.min(maximum, Math.max(minimum, offset));
};
