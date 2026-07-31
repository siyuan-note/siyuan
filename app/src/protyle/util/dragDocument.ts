export const isSameDragEditor = (targetEditor: Pick<Element, "contains">, sourceElement: Element) => {
    return targetEditor.contains(sourceElement);
};

export const uniqueDragIds = (ids: string[]) => {
    return Array.from(new Set(ids.filter(Boolean)));
};

export const isSameSiblingMove = <T>(siblings: T[], sources: T[], target: T, isBottom: boolean) => {
    if (sources.length === 0 || sources.includes(target)) {
        return sources.includes(target);
    }
    const sourceSet = new Set(sources);
    if (!siblings.includes(target) || sources.some(item => !siblings.includes(item))) {
        return false;
    }
    const orderedSources = siblings.filter(item => sourceSet.has(item));
    const reordered = siblings.filter(item => !sourceSet.has(item));
    const targetIndex = reordered.indexOf(target);
    reordered.splice(targetIndex + (isBottom ? 1 : 0), 0, ...orderedSources);
    return reordered.every((item, index) => item === siblings[index]);
};

export const replaceDragUndoOperation = <T>(operations: T[], operation: T, replacements: T[]) => {
    const index = operations.indexOf(operation);
    if (index < 0) {
        return false;
    }
    operations.splice(index, 1, ...replacements);
    return true;
};
