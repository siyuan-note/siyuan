const groupFoldedStates = new WeakMap<HTMLElement, Record<string, boolean>>();

export const setGroupFoldedStates = (blockElement: HTMLElement, groups: IAVView[]) => {
    const states: Record<string, boolean> = {};
    groups.forEach((group) => {
        states[group.id] = !!group.groupFolded;
    });
    groupFoldedStates.set(blockElement, states);
};

export const getGroupFoldedStates = (blockElement: HTMLElement) => {
    return {...(groupFoldedStates.get(blockElement) || {})};
};

export const updateGroupFoldedStates = (blockElement: HTMLElement, states: Record<string, boolean>) => {
    const currentStates = groupFoldedStates.get(blockElement) || {};
    Object.assign(currentStates, states);
    groupFoldedStates.set(blockElement, currentStates);
};
