export const MIN_VERTICAL_PANE_SIZE = 200;
export const MIN_HORIZONTAL_PANE_SIZE = 240;

export const resizePanePercentages = (
    sizes: number[],
    previousIndex: number,
    nextIndex: number,
    delta: number,
    minSize = 8,
) => {
    if (previousIndex < 0 || nextIndex < 0 || previousIndex === nextIndex) {
        return;
    }
    const resizedSizes = sizes.slice();
    // 已小于最小尺寸的分屏允许恢复，但不能继续缩小；越界拖动停在边界。
    const previousMinimum = Math.min(minSize, sizes[previousIndex]);
    const nextMinimum = Math.min(minSize, sizes[nextIndex]);
    const boundedDelta = Math.max(previousMinimum - sizes[previousIndex],
        Math.min(delta, sizes[nextIndex] - nextMinimum));
    resizedSizes[previousIndex] += boundedDelta;
    resizedSizes[nextIndex] -= boundedDelta;
    return panePercentages(resizedSizes);
};

export const panePercentages = (sizes: number[]) => {
    const totalSize = sizes.reduce((total, size) => total + size, 0);
    if (totalSize <= 0) {
        return;
    }
    return sizes.map((size) => size / totalSize * 100);
};

export const splitPanePercentages = (sizes: number[], index: number, after: boolean) => {
    const percentages = panePercentages(sizes);
    if (!percentages || index < 0 || index >= percentages.length) {
        return;
    }
    const splitPercentage = percentages[index] / 2;
    percentages[index] = splitPercentage;
    percentages.splice(after ? index + 1 : index, 0, splitPercentage);
    return percentages;
};
