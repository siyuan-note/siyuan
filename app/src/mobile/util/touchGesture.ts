export type TouchAxis = "x" | "y";

export const getTouchAxis = (xDiff: number, yDiff: number, threshold: number): TouchAxis | undefined => {
    if (Math.max(Math.abs(xDiff), Math.abs(yDiff)) < threshold) {
        return;
    }
    return Math.abs(xDiff) > Math.abs(yDiff) ? "x" : "y";
};
