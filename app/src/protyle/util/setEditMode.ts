import {hideElements} from "../ui/hideElements";
import {getAllModels} from "../../layout/getAll";
import {updateOutline} from "../../editor/util";
import {resize} from "./resize";
import {forEachPluginSubscriber} from "../../plugin/EventBusCore";
import {areProtylePluginExtensionsEnabled} from "../runtimeCapabilities";

/// #if MOBILE
export const updateMobileTitleReadonly = (protyle: IProtyle) => {
    if (window.siyuan.mobile.editor?.protyle !== protyle) {
        return;
    }
    const inputElement = document.getElementById("toolbarName") as HTMLInputElement;
    const readonlyElement = document.getElementById("toolbarNameReadonly");
    if (!inputElement || !readonlyElement) {
        return;
    }
    const readonly = protyle.disabled || !protyle.preview.element.classList.contains("fn__none");
    if (readonly && !inputElement.readOnly && document.activeElement === inputElement) {
        inputElement.blur();
    }
    const documentTitle = protyle.block.rootID !== protyle.notebookId;
    const inlineEditor = readonlyElement.querySelector(".mobile-document-title-editor");
    if (inlineEditor) {
        if (readonly && inlineEditor.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
        protyle.title?.setReadonly(readonly);
    }
    inputElement.readOnly = readonly || documentTitle;
    if (!documentTitle) readonlyElement.textContent = inputElement.value;
    if (documentTitle && !readonly && !inlineEditor) {
        readonlyElement.tabIndex = 0;
    } else {
        if (document.activeElement === readonlyElement) readonlyElement.blur();
        readonlyElement.removeAttribute("tabindex");
    }
    if (documentTitle && !inlineEditor) readonlyElement.setAttribute("role", "button");
    else readonlyElement.removeAttribute("role");
    readonlyElement.setAttribute("aria-disabled", String(readonly));
    inputElement.classList.toggle("fn__none", readonly || documentTitle);
    readonlyElement.classList.toggle("fn__none", !readonly && !documentTitle);
};
/// #endif

export const setEditMode = (protyle: IProtyle, type: TEditorMode) => {
    if (type === "preview") {
        if (!protyle.preview.element.classList.contains("fn__none")) {
            return;
        }
        protyle.preview.element.classList.remove("fn__none");
        protyle.contentElement.classList.add("fn__none");
        protyle.scroll?.update(protyle);
        if (protyle.options.render.breadcrumb) {
            protyle.breadcrumb?.element.classList.add("fn__none");
            protyle.breadcrumb.toggleExit(true);
        }
        protyle.preview.render(protyle);
        /// #if !MOBILE
        updateOutline(getAllModels(), protyle, true);
        /// #endif
    } else if (type === "wysiwyg") {
        if (!protyle.contentElement.classList.contains("fn__none")) {
            return;
        }
        protyle.preview.element.classList.add("fn__none");
        protyle.contentElement.classList.remove("fn__none");
        protyle.scroll?.update(protyle);
        if (protyle.options.render.breadcrumb) {
            protyle.breadcrumb?.element.classList.remove("fn__none");
            protyle.breadcrumb.toggleExit(!protyle.block.showAll);
        }
        /// #if !MOBILE
        updateOutline(getAllModels(), protyle, true);
        /// #endif
        resize(protyle);
    }
    /// #if MOBILE
    updateMobileTitleReadonly(protyle);
    /// #endif
    hideElements(["gutterOnly", "toolbar", "select", "hint", "util"], protyle);
    if (areProtylePluginExtensionsEnabled(protyle)) {
        forEachPluginSubscriber("switch-protyle-mode", eventBus => {
            eventBus.emit("switch-protyle-mode", {protyle});
        });
    }
};
