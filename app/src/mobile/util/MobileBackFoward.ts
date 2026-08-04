import {showMessage} from "../../dialog/message";
import {hideElements} from "../../protyle/ui/hideElements";
import {getCurrentEditor} from "../editor";
import {closePanel} from "./closePanel";
import {backModel, destroyModel} from "../menu/model";

export const clearMobileBackForward = (notebookId?: string) => {
    if (notebookId) {
        window.siyuan.mobile.tabs?.removeNotebook(notebookId);
    } else {
        window.siyuan.backStack = [];
    }
};

export const pushBack = () => {
    window.siyuan.mobile.tabs?.pushCurrent();
};

export const goForward = () => {
    void window.siyuan.mobile.tabs?.goForward();
};

export const goBack = () => {
    const editor = getCurrentEditor();
    if (window.siyuan.menus.menu.element.classList.contains("b3-menu--fullscreen") &&
        !window.siyuan.menus.menu.element.classList.contains("fn__none")) {
        window.siyuan.menus.menu.element.dispatchEvent(new CustomEvent("click", {detail: "back"}));
        return;
    } else if (window.siyuan.viewer && !window.siyuan.viewer.destroyed) {
        window.siyuan.viewer.destroy();
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
    } else if (document.getElementById("menu").style.transform === "translateX(0px)" ||
        document.getElementById("sidebar").style.transform === "translateX(0px)") {
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
