export type TouchAxis = "x" | "y";

export const getTouchAxis = (xDiff: number, yDiff: number, threshold: number): TouchAxis | undefined => {
    if (Math.max(Math.abs(xDiff), Math.abs(yDiff)) < threshold) {
        return;
    }
    return Math.abs(xDiff) > Math.abs(yDiff) ? "x" : "y";
};

export const shouldStartLongPressMultiSelect = (
    tagName: string,
    dataType: string | undefined,
    insideInlineMath: boolean,
    imageMenuTarget: boolean,
) => !(tagName === "SPAN" && (dataType || "").split(" ").some(type =>
    ["block-ref", "file-annotation-ref", "tag", "inline-memo", "a"].includes(type))) &&
    !insideInlineMath && !imageMenuTarget;
