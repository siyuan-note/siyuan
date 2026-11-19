export const isNodeID = (value: unknown): value is string => {
    if (typeof value !== "string" || value.length !== 22 || value[14] !== "-") {
        return false;
    }
    for (let index = 0; index < 14; index++) {
        if (value[index] < "0" || value[index] > "9") {
            return false;
        }
    }
    for (let index = 15; index < 22; index++) {
        const character = value[index];
        if ((character < "a" || character > "z") && (character < "0" || character > "9")) {
            return false;
        }
    }
    return true;
};

export const getBlockLinkID = (value: unknown) => {
    const prefix = "siyuan://blocks/";
    if (typeof value !== "string" || !value.startsWith(prefix)) {
        return;
    }
    const id = value.slice(prefix.length);
    return isNodeID(id) ? id : undefined;
};
