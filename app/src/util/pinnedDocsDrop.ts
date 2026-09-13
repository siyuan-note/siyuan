export const getPinnedDropPosition = (root: boolean, ratio: number) => {
    if (ratio < .25) {
        return root ? "pin-before" : "before";
    }
    if (ratio > .75) {
        return root ? "pin-after" : "after";
    }
    return "inside";
};
