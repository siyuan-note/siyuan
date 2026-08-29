import {Constants} from "../constants";
import {hideMessage, showMessage} from "../dialog/message";
import {getAllEditor} from "../layout/getAll";
import {lineNumberRender} from "../protyle/render/highlightRender";
import {editorConfigApi} from "../config/tabs/editorRuntime";
import {refreshHeadingNumberMeasurements, setInlineStyle} from "./assets";
import {
    normalizeEditorFontSize,
    resolveEditorFontSize,
    type TEditorFontSizeAction,
} from "./editorFontSizeCore";

export {type TEditorFontSizeAction} from "./editorFontSizeCore";

export interface IEditorFontSizeOptions {
    notify?: boolean;
}

const MESSAGE_ID = "editorFontSize";
let saveTimeout: number;

const syncEditorFontSizeControls = (fontSize: number) => {
    const settingElement = document.getElementById("editor.fontSize") as HTMLInputElement | null;
    if (settingElement) {
        settingElement.value = fontSize.toString();
        settingElement.parentElement?.setAttribute("aria-label", settingElement.value);
    }
    document.querySelectorAll<HTMLElement>("[data-editor-font-size-value]").forEach((element) => {
        element.textContent = fontSize + " px";
    });
    document.querySelectorAll<HTMLButtonElement>("[data-editor-font-size-action]").forEach((element) => {
        const action = element.dataset.editorFontSizeAction;
        element.disabled = (action === "decrease" && fontSize <= Constants.EDITOR_FONT_SIZE_MIN) ||
            (action === "increase" && fontSize >= Constants.EDITOR_FONT_SIZE_MAX) ||
            (action === "reset" && fontSize === Constants.EDITOR_FONT_SIZE_DEFAULT) ||
            window.siyuan.config.readonly;
    });
};

const refreshEditorFontSize = async () => {
    await setInlineStyle();
    refreshHeadingNumberMeasurements();
    getAllEditor().forEach((editor) => {
        editor.protyle.wysiwyg.element.querySelectorAll<HTMLElement>(".code-block .protyle-linenumber__rows")
            .forEach((element) => lineNumberRender(element.parentElement));
    });
};

const showEditorFontSizeMessage = (fontSize: number) => {
    showMessage(window.siyuan.languages.editorFontSize + " " + fontSize + "px<span class=\"fn__space\"></span>" +
        "<button class=\"b3-button b3-button--white\">" + window.siyuan.languages.resetEditorFontSize + "</button>",
    undefined, undefined, MESSAGE_ID);
    document.querySelector<HTMLButtonElement>("#message [data-id=\"" + MESSAGE_ID + "\"] button")
        ?.addEventListener("click", () => {
            setEditorFontSize(Constants.EDITOR_FONT_SIZE_DEFAULT);
            hideMessage(MESSAGE_ID);
        });
};

export const setEditorFontSize = (fontSize: number, options: IEditorFontSizeOptions = {}) => {
    if (window.siyuan.config.readonly || !Number.isFinite(fontSize)) {
        return window.siyuan.config.editor.fontSize;
    }
    const nextFontSize = normalizeEditorFontSize(fontSize);
    if (nextFontSize === window.siyuan.config.editor.fontSize) {
        syncEditorFontSizeControls(nextFontSize);
        return nextFontSize;
    }
    window.siyuan.config.editor.fontSize = nextFontSize;
    syncEditorFontSizeControls(nextFontSize);
    void refreshEditorFontSize();
    window.clearTimeout(saveTimeout);
    saveTimeout = window.setTimeout(() => {
        editorConfigApi.patch("editor.fontSize", window.siyuan.config.editor.fontSize);
    }, Constants.TIMEOUT_LOAD);
    if (options.notify) {
        showEditorFontSizeMessage(nextFontSize);
    }
    return nextFontSize;
};

export const adjustEditorFontSize = (action: TEditorFontSizeAction, options: IEditorFontSizeOptions = {}) =>
    setEditorFontSize(resolveEditorFontSize(window.siyuan.config.editor.fontSize, action), {
        notify: options.notify ?? true,
    });
