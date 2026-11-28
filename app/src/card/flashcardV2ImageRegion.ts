export interface IFlashcardV2ImageRegion {
    x: number;
    y: number;
    width: number;
    height: number;
}

const coordinateTolerance = 1e-9;

export const isFlashcardV2ImageRegion = (value: unknown): value is IFlashcardV2ImageRegion => {
    if (!value || typeof value !== "object" || !("x" in value) || !("y" in value) ||
        !("width" in value) || !("height" in value)) {
        return false;
    }
    const {x, y, width, height} = value;
    return typeof x === "number" && x >= 0 && x <= 1 && typeof y === "number" && y >= 0 && y <= 1 &&
        typeof width === "number" && width > 0 && width <= 1 &&
        typeof height === "number" && height > 0 && height <= 1 &&
        x + width <= 1 + coordinateTolerance && y + height <= 1 + coordinateTolerance;
};

export const flashcardV2ImageRegionContains = (region: IFlashcardV2ImageRegion, bounds: IFlashcardV2ImageRegion) =>
    bounds.x >= region.x - coordinateTolerance && bounds.y >= region.y - coordinateTolerance &&
    bounds.x + bounds.width <= region.x + region.width + coordinateTolerance &&
    bounds.y + bounds.height <= region.y + region.height + coordinateTolerance;

export const extendFlashcardV2ImageRegion = (region: IFlashcardV2ImageRegion, bounds: IFlashcardV2ImageRegion) => {
    if (flashcardV2ImageRegionContains(region, bounds)) {
        return region;
    }
    const x = Math.min(region.x, bounds.x);
    const y = Math.min(region.y, bounds.y);
    return {x, y, width: Math.max(region.x + region.width, bounds.x + bounds.width) - x,
        height: Math.max(region.y + region.height, bounds.y + bounds.height) - y};
};
