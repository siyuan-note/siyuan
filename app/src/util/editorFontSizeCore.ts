import {Constants} from "../constants";

export type TEditorFontSizeAction = "increase" | "decrease" | "reset";

export const normalizeEditorFontSize = (fontSize: number) => Math.min(
    Constants.EDITOR_FONT_SIZE_MAX,
    Math.max(Constants.EDITOR_FONT_SIZE_MIN, Math.round(fontSize)),
);

export const resolveEditorFontSize = (fontSize: number, action: TEditorFontSizeAction) => {
    if (action === "increase") {
        return normalizeEditorFontSize(fontSize + 1);
    }
    if (action === "decrease") {
        return normalizeEditorFontSize(fontSize - 1);
    }
    return Constants.EDITOR_FONT_SIZE_DEFAULT;
};
