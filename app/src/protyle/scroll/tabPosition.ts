const positions = new WeakMap<IProtyle, number>();

export const saveTabPosition = (protyle: IProtyle) => {
    positions.set(protyle, protyle.contentElement.scrollTop);
};

export const restoreTabPosition = (protyle: IProtyle) => {
    const top = positions.get(protyle);
    if (typeof top === "number") {
        protyle.contentElement.scrollTop = top;
        positions.delete(protyle);
    }
};
