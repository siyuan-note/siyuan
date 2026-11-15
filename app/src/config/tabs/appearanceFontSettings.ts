export type FontFamiliesConfigKey = "globalFontFamilies" | "fontFamilies" | "codeFontFamilies";

const fontInputUpdaters = new WeakMap<HTMLElement, () => void>();

export const bindAppearanceFontInput = (element: HTMLElement, update: () => void) => {
    fontInputUpdaters.set(element, update);
};

export const syncAppearanceFontInputs = (key: FontFamiliesConfigKey) => {
    document.querySelectorAll<HTMLElement>(`[data-font-config-key="${key}"]`).forEach(element => {
        fontInputUpdaters.get(element)?.();
    });
};
