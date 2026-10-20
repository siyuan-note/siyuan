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

export interface MindmapPanRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

// 平移位置必须保留实际节点或文字，避免停在整体包围盒内的空白区域。
export const clampMindmapPanPosition = (x: number, y: number, rectangles: MindmapPanRect[],
                                       scale: number, width: number, height: number, axis?: "x" | "y") => {
    if (![x, y, scale, width, height].every(Number.isFinite) || scale <= 0 || width <= 0 || height <= 0) {
        return {x, y};
    }
    let closest: {x: number, y: number};
    let distance = Infinity;
    let fallback: {x: number, y: number};
    let fallbackDistance = Infinity;
    for (const rectangle of rectangles) {
        if (rectangle.width <= 0 || rectangle.height <= 0 ||
            ![rectangle.x, rectangle.y, rectangle.width, rectangle.height].every(Number.isFinite)) {
            continue;
        }
        const nextX = clampMindmapPanOffset(x, rectangle.x, rectangle.x + rectangle.width, scale, width);
        const nextY = clampMindmapPanOffset(y, rectangle.y, rectangle.y + rectangle.height, scale, height);
        const nextDistance = (nextX - x) ** 2 + (nextY - y) ** 2;
        if (nextDistance < fallbackDistance) {
            fallback = {x: nextX, y: nextY};
            fallbackDistance = nextDistance;
        }
        // 单轴平移沿用另一轴的位置，只在该轴仍与可视区域相交的内容中寻找边界。
        if (axis === "y" && (rectangle.x * scale + x >= width || (rectangle.x + rectangle.width) * scale + x <= 0) ||
            axis === "x" && (rectangle.y * scale + y >= height || (rectangle.y + rectangle.height) * scale + y <= 0)) {
            continue;
        }
        const candidate = {x: axis === "y" ? x : nextX, y: axis === "x" ? y : nextY};
        const candidateDistance = (candidate.x - x) ** 2 + (candidate.y - y) ** 2;
        if (candidateDistance === 0) {
            return candidate;
        }
        if (candidateDistance < distance) {
            closest = candidate;
            distance = candidateDistance;
        }
    }
    return closest || fallback || {x, y};
};
