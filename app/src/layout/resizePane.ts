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
    resizedSizes[previousIndex] += delta;
    resizedSizes[nextIndex] -= delta;
    if (resizedSizes[previousIndex] < minSize || resizedSizes[nextIndex] < minSize) {
        return;
    }
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
