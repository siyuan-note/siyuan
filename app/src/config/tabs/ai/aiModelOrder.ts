export const moveModelItem = <T>(items: T[], sourceIndex: number, targetIndex: number, after: boolean) => {
    if (!Number.isInteger(sourceIndex) || !Number.isInteger(targetIndex) ||
        sourceIndex < 0 || sourceIndex >= items.length || targetIndex < 0 || targetIndex >= items.length ||
        sourceIndex === targetIndex) {
        return;
    }
    const result = [...items];
    const [source] = result.splice(sourceIndex, 1);
    const adjustedTargetIndex = targetIndex - (sourceIndex < targetIndex ? 1 : 0);
    const insertIndex = adjustedTargetIndex + (after ? 1 : 0);
    if (insertIndex === sourceIndex) {
        return;
    }
    result.splice(insertIndex, 0, source);
    return result;
};
