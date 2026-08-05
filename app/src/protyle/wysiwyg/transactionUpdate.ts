export const getPartialUpdateCleanupElements = <T>(
    rootElements: T[],
    updateRootElement: T | undefined,
    isBacklink: boolean,
) => {
    if (isBacklink || !updateRootElement) {
        return [];
    }
    return rootElements.filter(item => item !== updateRootElement);
};
