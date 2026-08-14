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

export const moveRectBounds = (initial: RectBounds, boundary: RectBounds, deltaX: number, deltaY: number) => {
    const width = initial.right - initial.left;
    const height = initial.bottom - initial.top;
    const left = clamp(initial.left + deltaX, boundary.left, boundary.right - width);
    const top = clamp(initial.top + deltaY, boundary.top, boundary.bottom - height);
    return {
        left,
        top,
        right: left + width,
        bottom: top + height,
    };
};

export const getRectImageName = (content: string, rotation: number, positionHash: string, captureProfile: string) => {
    const annotationID = content.substring(content.length - 22);
    const imageID = positionHash ? annotationID.substring(0, 15) + positionHash.substring(0, 7) : annotationID;
    return content.substring(0, content.length - 22) + (rotation ? `${rotation}-` : "") +
        `${captureProfile}-${imageID}.png`;
};

export const hideRectResizeHandles = (element: ParentNode) => {
    element.querySelectorAll(".pdf__rect--selected").forEach(item => {
        item.classList.remove("pdf__rect--selected");
        item.querySelectorAll(".pdf__rect-resize").forEach(handle => handle.remove());
    });
};
