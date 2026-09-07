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

export const shouldDeferCodeBlockCaretRestore = (options: {
    isRangeBlock: boolean,
    isReplay: boolean,
    hasCaret: boolean,
    isCodeBlock: boolean,
    isRendered: boolean,
}) => options.isRangeBlock && options.isReplay && options.hasCaret && options.isCodeBlock && !options.isRendered;

export const shouldReloadForHeadingBatch = (
    rootID: string | undefined,
    operations: Array<{context?: {headingBatchRootID?: string}}>,
) => operations.some(operation => {
    const headingBatchRootID = operation.context?.headingBatchRootID;
    return Boolean(headingBatchRootID) && headingBatchRootID === rootID;
});
