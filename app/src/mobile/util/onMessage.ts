import {openMobileFileById} from "../editor";
import {
    forceQuit,
    processSync,
    progressLoading,
    setDefRefCount,
    setRefDynamicText,
    transactionError
} from "../../dialog/processSystem";
import type {App} from "../../index";
import {applyPluginReload, syncGlobalPluginConfig} from "../../plugin/globalState";
import {reloadEmoji} from "../../emoji";
import {renderSnippet} from "../../config/util/snippets";
import {redirectToCheckAuth} from "../../util/pathName";
import {reloadSync} from "../../util/reloadSync";
import {activateOnboarding} from "../../onboarding";
import {updateServerAddresses} from "../../config/tabs/accessRuntime";
import {reloadInlineStyles} from "../../util/assets";
import {renderMobileBottomBar} from "./mobileBottomBar";
import {Constants} from "../../constants";
import {MOBILE_SIDE_PANEL_CONFIG_CHANGE_EVENT} from "./mobileSidePanelConfig";
import {appearanceConfigApi} from "../../config/tabs/appearanceRuntime";
import {applyCloudUserState} from "../../config/tabs/accountUi";
import {isInMobileApp} from "../../protyle/util/compatibility";
import {handleMobileKernelExit} from "./kernelExit";

let statusTimeout: number;
const statusElement = document.querySelector("#status") as HTMLElement;

const dispatchMobileSidePanelConfigChange = () => {
    window.dispatchEvent(new CustomEvent(MOBILE_SIDE_PANEL_CONFIG_CHANGE_EVENT));
};

export const onMessage = (app: App, data: IWebSocketData) => {
    if (data) {
        switch (data.cmd) {
            case "logoutAuth":
                redirectToCheckAuth();
                break;
            case "backgroundtask":
                if (!document.querySelector("#keyboardToolbar").classList.contains("fn__none") ||
                    window.siyuan.config.appearance.hideStatusBar) {
                    return;
                }
                if (data.data.tasks.length === 0) {
                    statusElement.style.bottom = "";
                } else {
                    clearTimeout(statusTimeout);
                    statusElement.innerHTML = `<div class="fn__flex">${data.data.tasks[0].action}<div class="fn__progress"><div></div></div>`;
                    statusElement.style.bottom = "0";
                }
                break;
            case "setAppearance":
                appearanceConfigApi.apply(data.data);
                break;
            case "reloadInlineStyles":
                void reloadInlineStyles();
                break;
            case "setSnippet":
                window.siyuan.config.snippet = data.data;
                renderSnippet();
                break;
            case "setDefRefCount":
                setDefRefCount(data.data);
                break;
            case "reloadTag":
                window.siyuan.mobile.docks.tag?.update();
                break;
            case "setRefDynamicText":
                setRefDynamicText(data.data);
                break;
            case "reloadPlugin":
                void applyPluginReload(app, data.data).catch((error) => console.error(error));
                break;
            case "reloadEmojiConf":
                reloadEmoji();
                break;
            case "syncMergeResult":
                reloadSync(app, data.data);
                break;
            case "setConf":
                window.siyuan.config = data.data;
                syncGlobalPluginConfig(app, data.data.bazaar.petalDisabled);
                break;
            case "setCloudUser":
                applyCloudUserState(data.data.user, data.data.userName);
                break;
            case "setServerAddrs":
                updateServerAddresses(data.data);
                break;
            case "setPublish":
                window.siyuan.config.publish = data.data;
                setPublish();
                break;
            case "reloaddoc":
                reloadSync(this, {upsertRootIDs: [data.data], removeRootIDs: []}, false, false, true);
                break;
            case "readonly":
                window.siyuan.config.editor.readOnly = data.data;
                break;
            case "closeBox":
            case "removeBox": {
                window.siyuan.mobile.tabs?.removeNotebook(data.data.box);
                break;
            }
            case "onboarding":
                void activateOnboarding(app, data.data);
                break;
            case "removeDoc":
                window.siyuan.mobile.tabs?.removeRoots(data.data.ids);
                if (window.siyuan.config.onboarding?.newUser && !window.siyuan.config.onboarding.dismissed &&
                    data.data.ids.includes(window.siyuan.config.onboarding.documentID)) {
                    void activateOnboarding(app, window.siyuan.config.onboarding);
                }
                break;
            case "setLocalStorageVal":
                window.siyuan.storage[data.data.key] = data.data.val;
                if (data.data.key === Constants.LOCAL_MOBILE_BOTTOM_BAR) {
                    renderMobileBottomBar();
                }
                if (data.data.key === Constants.LOCAL_MOBILE_SIDE_PANEL) {
                    dispatchMobileSidePanelConfigChange();
                }
                break;
            case "setLocalStorageVals":
                Object.keys(data.data.keyVals).forEach((k) => {
                    window.siyuan.storage[k] = data.data.keyVals[k];
                });
                if (Object.prototype.hasOwnProperty.call(data.data.keyVals, Constants.LOCAL_MOBILE_BOTTOM_BAR)) {
                    renderMobileBottomBar();
                }
                if (Object.prototype.hasOwnProperty.call(data.data.keyVals, Constants.LOCAL_MOBILE_SIDE_PANEL)) {
                    dispatchMobileSidePanelConfigChange();
                }
                break;
            case "removeLocalStorageVal":
                delete window.siyuan.storage[data.data.key];
                if (data.data.key === Constants.LOCAL_MOBILE_BOTTOM_BAR) {
                    renderMobileBottomBar();
                }
                if (data.data.key === Constants.LOCAL_MOBILE_SIDE_PANEL) {
                    dispatchMobileSidePanelConfigChange();
                }
                break;
            case "removeLocalStorageVals":
                data.data.keys.forEach((k: string) => {
                    delete window.siyuan.storage[k];
                });
                if (data.data.keys.includes(Constants.LOCAL_MOBILE_BOTTOM_BAR)) {
                    renderMobileBottomBar();
                }
                if (data.data.keys.includes(Constants.LOCAL_MOBILE_SIDE_PANEL)) {
                    dispatchMobileSidePanelConfigChange();
                }
                break;
            case"progress":
                progressLoading(data);
                break;
            case"syncing":
                processSync(data);
                if (data.code === 1) {
                    document.getElementById("toolbarSync").classList.add("fn__none");
                }
                break;
            case "openFileById":
                openMobileFileById(app, data.data.id);
                break;
            case "exit":
                handleMobileKernelExit({
                    inMobileApp: isInMobileApp(),
                    forceQuit,
                    redirectBrowser: () => {
                        window.location.href = "about:blank";
                    },
                });
                break;
            case "filetreeSortChanged":
                window.siyuan.mobile.docks.file?.onFiletreeSortChanged(data.data);
                break;
            case "docsImported":
                window.siyuan.mobile.docks.file?.onDocsImported(data.data);
                break;
            case "docSortModeChanged":
                window.siyuan.mobile.docks.file?.onDocSortModeChanged(data.data);
                break;
            case "notebookSortChanged":
                window.siyuan.mobile.docks.file?.onNotebookSortChanged();
                break;
            case"txerr":
                transactionError(data.msg);
                break;
            case"statusbar":
                if (!document.querySelector("#keyboardToolbar").classList.contains("fn__none") ||
                    window.siyuan.config.appearance.hideStatusBar) {
                    return;
                }
                clearTimeout(statusTimeout);
                statusElement.innerHTML = data.msg;
                statusElement.style.bottom = "var(--mobile-bottom-bar-safe-area)";
                statusTimeout = window.setTimeout(() => {
                    statusElement.style.bottom = "";
                }, 12000);
                break;
        }
    }
};

const setPublish = () => {
    const accessElement = window.siyuan.mobile.docks.file.element.previousElementSibling.querySelector('[data-type="publish-access"]');
    if (!window.siyuan.config.publish.enable) {
        accessElement.classList.remove("block__icon--active");
        accessElement.classList.add("fn__none");
        window.siyuan.mobile.docks.file.element.querySelectorAll(".b3-list-item__icon").forEach(item => {
            item.classList.remove("fn__none");
            item.nextElementSibling.classList.add("fn__none");
        });
    } else {
        accessElement.classList.remove("fn__none");
    }

};
