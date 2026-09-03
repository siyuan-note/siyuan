import {Constants} from "./constants";
import {Menus} from "./menus";
import {Model} from "./layout/Model";
import {onGetConfig} from "./boot/onGetConfig";
import {initBlockPopover} from "./block/popover";
import {applyCloudUserState, onSetaccount} from "./config/tabs/accountUi";
import {addScript, addScriptSync} from "./protyle/util/addScript";
import {genUUID} from "./util/genID";
import {fetchGet, fetchPost} from "./util/fetch";
import {
    addBaseURL,
    getDocDisplayName,
    parseSiYuanUriInfo,
    redirectToCheckAuth,
    setNoteBook
} from "./util/pathName";
import {registerServiceWorker} from "./util/serviceWorker";
import {activateQueuedAVLocate, queueAVLocateRequest} from "./protyle/render/av/locate";
import {openFileById} from "./editor/util";
import {activateOnboarding, ensureOnboarding} from "./onboarding";
import {
    bootSync,
    downloadProgress,
    processSync,
    progressBackgroundTask,
    progressLoading,
    progressStatus,
    processBacklinkIndexCommit,
    setDefRefCount,
    setRefDynamicText,
    transactionError
} from "./dialog/processSystem";
import {initMessage, showMessage} from "./dialog/message";
import {getAllModels, getAllTabs} from "./layout/getAll";
import {getLocalStorage, isChromeBrowser, isInMobileApp, isIOSDevice} from "./protyle/util/compatibility";
import {isBrowser} from "./util/functions";
import {checkPublishServiceClosed} from "./util/processMessage";
import {hideAllElements} from "./protyle/ui/hideElements";
import {loadPlugins} from "./plugin/loader";
import {applyPluginReload, syncGlobalPluginConfig} from "./plugin/globalState";
import "./assets/scss/base.scss";
import {reloadEmoji} from "./emoji";
import {processIOSPurchaseResponse} from "./util/iOSPurchase";
import {updateServerAddresses} from "./config/tabs/accessRuntime";
import {emitToPlugins} from "./plugin/EventBusCore";
/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif
import {getDockByType} from "./layout/tabUtil";
import {Files} from "./layout/dock/Files";
import {Tag} from "./layout/dock/Tag";
import {appearanceConfigApi} from "./config/tabs/appearanceRuntime";
import {renderSnippet} from "./config/util/snippets";
import {refreshThemeStyle, reloadInlineStyles, setBodyHighlight} from "./util/assets";
import {reloadSync} from "./util/reloadSync";
import {setTitle} from "./util/processTitle";
import {ensureUILayout} from "./util/ensureUILayout";
import {applyEntryVisibility} from "./config/entryVisibility/runtime";
import {removeBlockPanelEditors} from "./block/panelRemoval";
import {initializeEnglishCommandTranslations} from "./command/english";

export class App {
    public plugins: import("./plugin").Plugin[] = [];
    public appId: string;

    constructor() {
        if (checkPublishServiceClosed()) {
            return;
        }
        registerServiceWorker(`${Constants.SERVICE_WORKER_PATH}?v=${Constants.SIYUAN_VERSION}`);
        addBaseURL();

        this.appId = Constants.SIYUAN_APPID;

        const mainWs = new Model({app: this});
        mainWs.connect({
            id: genUUID(),
            type: "main",
            msgCallback: (data) => {
                emitToPlugins("ws-main", data);
                if (data) {
                    switch (data.cmd) {
                        case "logoutAuth":
                            redirectToCheckAuth();
                            break;
                        case "setAppearance":
                            appearanceConfigApi.apply(data.data);
                            break;
                        case "reloadInlineStyles":
                            void reloadInlineStyles();
                            break;
                        case "setEntryVisibility":
                            applyEntryVisibility(data.data);
                            break;
                        case "setSnippet":
                            window.siyuan.config.snippet = data.data;
                            renderSnippet();
                            break;
                        case "setDefRefCount":
                            setDefRefCount(data.data);
                            break;
                        case "databaseIndexCommit":
                            processBacklinkIndexCommit(data.data);
                            break;
                        case "reloadTag":
                            if (getDockByType("tag")?.data.tag instanceof Tag) {
                                (getDockByType("tag").data.tag as Tag).update();
                            }
                            break;
                        case "setRefDynamicText":
                            setRefDynamicText(data.data);
                            break;
                        case "reloadPlugin":
                            void applyPluginReload(this, data.data).catch((error) => console.error(error));
                            break;
                        case "reloadEmojiConf":
                            reloadEmoji();
                            break;
                        case "syncMergeResult":
                            reloadSync(this, data.data);
                            break;
                        case "reloaddoc":
                            reloadSync(this, {upsertRootIDs: [data.data], removeRootIDs: []}, false, false, true);
                            break;
                        case "readonly":
                            window.siyuan.config.editor.readOnly = data.data;
                            hideAllElements(["util"]);
                            break;
                        case "setConf":
                            window.siyuan.config = data.data;
                            syncGlobalPluginConfig(this, data.data.bazaar.petalDisabled);
                            break;
                        case "setCloudUser":
                            applyCloudUserState(data.data.user, data.data.userName);
                            break;
                        case "setServerAddrs":
                            updateServerAddresses(data.data);
                            break;
                        case "setPublish":
                            window.siyuan.config.publish = data.data;
                            if (!window.siyuan.config.publish.enable) {
                                getAllModels().files.forEach(item => {
                                    item.element.classList.remove("file-tree__publish-access--active");
                                    item.element.querySelectorAll(".b3-list-item__icon").forEach(iconItem => {
                                        iconItem.classList.remove("fn__none");
                                        iconItem.nextElementSibling.classList.add("fn__none");
                                    });
                                });
                            }
                            break;
                        case "progress":
                            progressLoading(data);
                            break;
                        case "setLocalStorageVal":
                            if (window.siyuan.storage) {
                                window.siyuan.storage[data.data.key] = data.data.val;
                            }
                            break;
                        case "setLocalStorageVals":
                            Object.keys(data.data.keyVals).forEach((k) => {
                                window.siyuan.storage[k] = data.data.keyVals[k];
                            });
                            break;
                        case "removeLocalStorageVal":
                            delete window.siyuan.storage[data.data.key];
                            break;
                        case "removeLocalStorageVals":
                            data.data.keys.forEach((k: string) => {
                                delete window.siyuan.storage[k];
                            });
                            break;
                        case "rename":
                            getAllTabs().forEach((tab) => {
                                if (tab.headElement) {
                                    const initTab = tab.headElement.getAttribute("data-initdata");
                                    if (initTab) {
                                        const initTabData = JSON.parse(initTab);
                                        if (initTabData.instance === "Editor" && initTabData.rootId === data.data.id) {
                                            tab.updateTitle(getDocDisplayName(data.data.title, data.data.empty));
                                        }
                                    }
                                }
                            });
                            break;
                        case "closeBox":
                        case "removeBox":
                            removeBlockPanelEditors({notebookId: data.data.box});
                            getAllTabs().forEach((tab) => {
                                if (tab.headElement) {
                                    const initTab = tab.headElement.getAttribute("data-initdata");
                                    if (initTab) {
                                        const initTabData = JSON.parse(initTab);
                                        if (initTabData.instance === "Editor" && data.data.box === initTabData.notebookId) {
                                            tab.parent.removeTab(tab.id);
                                        }
                                    }
                                }
                            });
                            break;
                        case "removeDoc":
                            removeBlockPanelEditors({rootIDs: data.data.ids});
                            getAllTabs().forEach((tab) => {
                                if (tab.headElement) {
                                    const initTab = tab.headElement.getAttribute("data-initdata");
                                    if (initTab) {
                                        const initTabData = JSON.parse(initTab);
                                        if (initTabData.instance === "Editor" && data.data.ids.includes(initTabData.rootId)) {
                                            tab.parent.removeTab(tab.id);
                                        }
                                    }
                                }
                            });
                            if (window.siyuan.config.onboarding?.newUser && !window.siyuan.config.onboarding.dismissed &&
                                data.data.ids.includes(window.siyuan.config.onboarding.documentID)) {
                                void activateOnboarding(this, window.siyuan.config.onboarding);
                            }
                            break;
                        case "onboarding":
                            void activateOnboarding(this, data.data);
                            break;
                        case "statusbar":
                            progressStatus(data);
                            break;
                        case "downloadProgress":
                            downloadProgress(data.data);
                            break;
                        case "txerr":
                            transactionError(data.msg);
                            break;
                        case "syncing":
                            processSync(data);
                            break;
                        case "backgroundtask":
                            progressBackgroundTask(data.data.tasks);
                            break;
                        case "refreshtheme":
                            refreshThemeStyle(data.data.theme);
                            break;
                        case "openFileById":
                            openFileById({app: this, id: data.data.id, action: [Constants.CB_GET_FOCUS]});
                            break;
                        case "filetreeSortChanged": {
                            const fileDock = getDockByType("file");
                            if (fileDock) {
                                (fileDock.data.file as Files).onFiletreeSortChanged(data.data);
                            }
                            break;
                        }
                        case "docsImported": {
                            const fileDock = getDockByType("file");
                            if (fileDock) {
                                (fileDock.data.file as Files).onDocsImported(data.data);
                            }
                            break;
                        }
                        case "docSortModeChanged": {
                            const fileDock = getDockByType("file");
                            if (fileDock) {
                                (fileDock.data.file as Files).onDocSortModeChanged(data.data);
                            }
                            break;
                        }
                        case "notebookSortChanged": {
                            const fileDock = getDockByType("file");
                            if (fileDock) {
                                (fileDock.data.file as Files).onNotebookSortChanged();
                            }
                            break;
                        }
                        case "exit":
                            if (isBrowser() && !isInMobileApp()) {
                                window.location.href = "about:blank";
                            }
                            break;
                        case "updateKernelPluginState": {
                            const {name, state} = data.data as { name: string, state: TKernelPluginState };
                            const plugin = this.plugins.find(p => p.name === name);
                            if (plugin) {
                                plugin.kernel.state.code = state;
                            }
                            break;
                        }
                    }
                }
            }
        });

        window.siyuan = {
            zIndex: 10,
            isReady: false,
            notebooks: [],
            reqIds: {},
            backStack: [],
            layout: {},
            dialogs: [],
            blockPanels: [],
            closedTabs: [],
            ctrlIsPressed: false,
            altIsPressed: false,
            ws: mainWs,
        };
        const notebookPromise = setNoteBook();
        fetchPost("/api/system/getConf", {}, async (response) => {
            addScriptSync(`${Constants.PROTYLE_CDN}/js/lute/lute.min.js?v=${Constants.SIYUAN_VERSION}`, "protyleLuteScript");
            addScript(`${Constants.PROTYLE_CDN}/js/protyle-html.js?v=${Constants.SIYUAN_VERSION}`, "protyleWcHtmlScript");
            window.siyuan.config = response.data.conf;
            ensureUILayout();
            window.siyuan.isPublish = response.data.isPublish;
            setBodyHighlight();
            await notebookPromise;
            await loadPlugins(this);
            getLocalStorage(() => {
                fetchGet(`/appearance/langs/${window.siyuan.config.appearance.lang}.json?v=${Constants.SIYUAN_VERSION}`, (lauguages: IObject) => {
                    window.siyuan.languages = lauguages;
                    void initializeEnglishCommandTranslations(
                        window.siyuan.config.appearance.lang,
                        lauguages as Record<string, string>,
                        Constants.SIYUAN_VERSION,
                    );
                    window.siyuan.menus = new Menus(this);
                    bootSync();
                    fetchPost("/api/setting/getCloudUser", {}, async userResponse => {
                        window.siyuan.user = userResponse.data;
                        await ensureOnboarding();
                        await setNoteBook();
                        await onGetConfig(response.data.start, this);
                        onSetaccount();
                        setTitle("", true);
                        initMessage();
                        /// #if BROWSER && !MOBILE
                        if (!isInMobileApp() && !isIOSDevice() && !window.siyuan.config.readonly &&
                            !window.siyuan.isPublish && !isChromeBrowser()
                            && window.siyuan.config.appearance.notifications?.browserCompatibility !== false) {
                            showMessage(window.siyuan.languages.useChrome, 0, "error");
                        }
                        /// #endif
                        window.siyuan.isReady = true;
                        mainWs.flushMainMessages();
                    });
                });
            });
        });
        initBlockPopover(this);
    }
}

const siyuanApp = new App();

window.openFileByURL = (openURL) => {
    const blockInfo = parseSiYuanUriInfo(openURL);
    if (blockInfo != null) {
        if (blockInfo.avItemID) {
            queueAVLocateRequest(blockInfo.id, {
                itemID: blockInfo.avItemID,
                viewID: blockInfo.avViewID,
                groupID: blockInfo.avGroupID,
            });
        }
        openFileById({
            app: siyuanApp,
            id: blockInfo.id,
            action: blockInfo.avItemID ? [Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL] :
                (blockInfo.focus ? [Constants.CB_GET_ALL, Constants.CB_GET_FOCUS] : [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL]),
            zoomIn: blockInfo.avItemID ? false : blockInfo.focus,
            afterOpen: (model) => {
                const protyle = (model as { editor?: { protyle?: IProtyle } })?.editor?.protyle;
                if (protyle) {
                    activateQueuedAVLocate(protyle, blockInfo.id);
                }
            },
        });
        return true;
    }
    return false;
};

/// #if BROWSER
window.showKeyboardToolbar = () => {
    // 防止 Pad 端报错
};
window.processIOSPurchaseResponse = processIOSPurchaseResponse;
// 移动端容器（Android/鸿蒙）启用桌面模式时，原生壳默认禁用 WebView 自身键盘行为、等待 JS 调用
// showKeyboard 弹键盘，而桌面 bundle 不会调用它，导致键盘无法弹出。这里把键盘控制权交还给
// WebView 自身管理（与平板走桌面 bundle 时的行为一致）
// On-screen keyboard pops up when using desktop mode on HarmonyOS and Android https://github.com/siyuan-note/siyuan/issues/18028
if (window.JSAndroid?.setWebViewFocusable) {
    window.JSAndroid.setWebViewFocusable(true);
} else if (window.JSHarmony?.setWebViewFocusable) {
    window.JSHarmony.setWebViewFocusable(true);
}
/// #else
ipcRenderer.send(Constants.SIYUAN_READY_TO_SHOW);
/// #endif
