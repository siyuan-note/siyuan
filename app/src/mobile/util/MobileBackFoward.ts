import {showMessage} from "../../dialog/message";
import {hideElements} from "../../protyle/ui/hideElements";
import {getCurrentEditor} from "../editor";
import {closePanel} from "./closePanel";
import {backModel, destroyModel} from "../menu/model";
import {destroyAVRichTextEditor} from "../../protyle/render/av/richTextEditor";
import {isAbove} from "../../util/zIndex";
import {getMobileSelectMenuElement} from "./nativeSelect";
import {closeAnchoredInput, getAnchoredInputMask} from "../../dialog/anchoredInput";
import {closeAVCellEditor} from "../../protyle/render/av/cellEditor";

export const pushBack = () => {
    window.siyuan.mobile.tabs?.pushCurrent();
};

export const goForward = () => {
    void window.siyuan.mobile.tabs?.goForward();
};

export const goBack = () => {
    const editor = getCurrentEditor();
    const menuElement = document.getElementById("menu");
    const richTextElement = document.querySelector<HTMLElement>(".av__richtext-mask");
    const avPanelElement = document.querySelector<HTMLElement>(".av__panel");
    const avCellElement = document.querySelector<HTMLElement>(".av__mask:not(.av__richtext-mask)");
    const topDialog = window.siyuan.dialogs[window.siyuan.dialogs.length - 1];
    const selectMenuElement = getMobileSelectMenuElement();
    const inputMask = getAnchoredInputMask();
    const activeMenu = window.siyuan.menus.menu.element;
    const isAboveAVEditors = (element: HTMLElement) => [avPanelElement, avCellElement]
        .every(overlay => !overlay || !isAbove(overlay, element));
    if (inputMask && (!topDialog || isAbove(inputMask, topDialog.element.querySelector(".b3-dialog"))) &&
        (!selectMenuElement || isAbove(inputMask, selectMenuElement)) &&
        (activeMenu.classList.contains("fn__none") || isAbove(inputMask, activeMenu)) && isAboveAVEditors(inputMask)) {
        closeAnchoredInput(true);
        return;
    } else if (selectMenuElement && (!topDialog ||
        isAbove(selectMenuElement, topDialog.element.querySelector(".b3-dialog"))) && isAboveAVEditors(selectMenuElement)) {
        selectMenuElement.dispatchEvent(new CustomEvent("click", {detail: "back"}));
        return;
    } else if (window.siyuan.menus.menu.element.classList.contains("b3-menu--fullscreen") &&
        !window.siyuan.menus.menu.element.classList.contains("fn__none") && isAboveAVEditors(activeMenu) &&
        (!richTextElement || !isAbove(richTextElement, activeMenu))) {
        window.siyuan.menus.menu.element.dispatchEvent(new CustomEvent("click", {detail: "back"}));
        return;
    } else if (window.siyuan.viewer && !window.siyuan.viewer.destroyed) {
        window.siyuan.viewer.destroy();
        return;
    } else if (richTextElement && (!topDialog ||
        isAbove(richTextElement, topDialog.element.querySelector(".b3-dialog"))) && isAboveAVEditors(richTextElement)) {
        destroyAVRichTextEditor(true);
        return;
    } else if (avCellElement && (!topDialog ||
        isAbove(avCellElement, topDialog.element.querySelector(".b3-dialog"))) &&
        (!avPanelElement || isAbove(avCellElement, avPanelElement))) {
        closeAVCellEditor();
        return;
    } else if (avPanelElement && (!topDialog ||
        isAbove(avPanelElement, topDialog.element.querySelector(".b3-dialog")))) {
        avPanelElement.dispatchEvent(new CustomEvent("click", {detail: "back"}));
        return;
    } else if (window.siyuan.dialogs.length !== 0) {
        window.siyuan.dialogs[window.siyuan.dialogs.length - 1].destroy();
        return;
    } else if (window.siyuan.mobile.agentChatController?.handleBack()) {
        return;
    } else if (document.getElementById("model").style.transform === "translateX(0px)") {
        const searchAssetsPanelElement = document.getElementById("searchAssetsPanel");
        if (!searchAssetsPanelElement || searchAssetsPanelElement.classList.contains("fn__none")) {
            if (backModel()) {
                return;
            }
            destroyModel();
            document.getElementById("model").style.transform = "";
        } else {
            searchAssetsPanelElement.classList.add("fn__none");
        }
        return;
    } else if (menuElement?.style.transform === "translateX(0px)" ||
        document.getElementById("sidebar")?.style.transform === "translateX(0px)" ||
        document.getElementById("sidebarRight")?.style.transform === "translateX(0px)") {
        closePanel();
        return;
    } else if (editor && !editor.protyle.toolbar.subElement.classList.contains("fn__none")) {
        hideElements(["util"], editor.protyle);
        closePanel();
        return;
    }
    const tabs = window.siyuan.mobile.tabs;
    if (!tabs) {
        return;
    }
    void tabs.goBack().then((handled) => {
        if (handled || !(window.JSAndroid || window.JSHarmony)) {
            return;
        }
        if (document.querySelector('#message [data-id="exitTip"]')) {
            if (window.JSAndroid) {
                window.JSAndroid.returnDesktop();
            } else {
                window.JSHarmony.returnDesktop();
            }
        } else {
            showMessage(window.siyuan.languages.returnDesktop, 3000, "info", "exitTip");
        }
    });
};
