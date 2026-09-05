export const resolveTabID = (ids: string[], activeID: string) => ids.includes(activeID) ? activeID : ids[0] || "";

export const adjacentTabID = (ids: string[], removedID: string) => {
    const index = ids.indexOf(removedID);
    return ids[index + 1] || ids[index - 1] || "";
};

export const tabKeyboardTarget = (ids: string[], activeID: string, key: string, vertical: boolean) => {
    if (ids.length === 0) {
        return "";
    }
    if (key === "Home") {
        return ids[0];
    }
    if (key === "End") {
        return ids[ids.length - 1];
    }
    const previous = vertical ? "ArrowUp" : "ArrowLeft";
    const next = vertical ? "ArrowDown" : "ArrowRight";
    if (key !== previous && key !== next) {
        return "";
    }
    const index = Math.max(0, ids.indexOf(activeID));
    return ids[(index + (key === previous ? -1 : 1) + ids.length) % ids.length];
};
