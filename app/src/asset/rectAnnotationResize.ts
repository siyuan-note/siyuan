export type RectResizeDirection = "nw" | "ne" | "sw" | "se";

export interface RectBounds {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export const resizeRectBounds = (initial: RectBounds, boundary: RectBounds, direction: RectResizeDirection,
                                 x: number, y: number, minSize: number) => {
    const result = {...initial};
    const minWidth = Math.min(minSize, initial.right - initial.left);
    const minHeight = Math.min(minSize, initial.bottom - initial.top);
    if (direction.includes("w")) {
        result.left = clamp(x, boundary.left, initial.right - minWidth);
    } else {
        result.right = clamp(x, initial.left + minWidth, boundary.right);
    }
    if (direction.includes("n")) {
        result.top = clamp(y, boundary.top, initial.bottom - minHeight);
    } else {
        result.bottom = clamp(y, initial.top + minHeight, boundary.bottom);
    }
    return result;
};
