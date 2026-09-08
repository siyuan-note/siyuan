export const normalizeFontSizeInput = (value: string, relative: boolean) => {
    if (!value.trim()) {
        return;
    }
    const size = Number(value);
    if (!Number.isFinite(size) || size < (relative ? 56 : 9) || size > (relative ? 450 : 72)) {
        return;
    }
    return relative ? `${Math.round(size) / 100}em` : `${Math.round(size)}px`;
};

export const isMixedFontSize = (sizes: string[]) => new Set(sizes).size > 1;
