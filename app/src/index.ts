import {Constants} from "./constants";
import {Menus} from "./menus";
import {Model} from "./layout/Model";
import {onGetConfig} from "./boot/onGetConfig";
import {initBlockPopover} from "./block/popover";
import {account} from "./config/account";
import {addScript, addScriptSync} from "./protyle/util/addScript";
import {genUUID} from "./util/genID";
import {fetchGet, fetchPost} from "./util/fetch";
import {addBaseURL, getIdFromSYProtocol, isSYProtocol, redirectToCheckAuth, setNoteBook} from "./util/pathName";
import {registerServiceWorker} from "./util/serviceWorker";
import {openFileById} from "./editor/util";
import {
    bootSync,
    downloadProgress,
    processSync,
    progressBackgroundTask,
    progressLoading,
    progressStatus,
    reloadSync,
    setDefRefCount,
    setRefDynamicText,
    setTitle,
    transactionError
} from "./dialog/processSystem";
import {initMessage, showMessage} from "./dialog/message";
import {getAllModels, getAllTabs} from "./layout/getAll";
import {getLocalStorage, isChromeBrowser, isInMobileApp} from "./protyle/util/compatibility";
import {getSearch, isBrowser} from "./util/functions";
import {checkPublishServiceClosed} from "./util/processMessage";
import {hideAllElements} from "./protyle/ui/hideElements";
import {loadPlugins, reloadPlugin} from "./plugin/loader";
import "./assets/scss/base.scss";
import {reloadEmoji} from "./emoji";
import {processIOSPurchaseResponse} from "./util/iOSPurchase";
/// #if BROWSER
import {setLocalShorthandCount} from "./util/noRelyPCFunction";
/// #else
import {ipcRenderer} from "electron";
/// #endif
import {getDockByType} from "./layout/tabUtil";
import {Tag} from "./layout/dock/Tag";
import {handleCrossPlatformKey} from "./protyle/util/hotKey";
import {updateAppearance} from "./config/util/updateAppearance";
import {renderSnippet} from "./config/util/snippets";

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
        window.siyuan = {
            zIndex: 10,
            transactions: [],
            reqIds: {},
            backStack: [],
            layout: {},
            dialogs: [],
            blockPanels: [],
            closedTabs: [],
            ctrlIsPressed: false,
            altIsPressed: false,
            ws: new Model({
                app: this,
                id: genUUID(),
                type: "main",
                msgCallback: (data) => {
                    this.plugins.forEach((plugin) => {
                        plugin.eventBus.emit("ws-main", data);
                    });
                    if (data) {
                        switch (data.cmd) {
                            case "logoutAuth":
                                redirectToCheckAuth();
                                break;
                            case "setAppearance":
                                updateAppearance(data.data);
                                break;
                            case "setSnippet":
                                window.siyuan.config.snippet = data.data;
                                renderSnippet();
                                break;
                            case "setDefRefCount":
                                setDefRefCount(data.data);
                                break;
                            case "reloadTag":
                                if (getDockByType("tag")?.data.tag instanceof Tag) {
                                    (getDockByType("tag").data.tag as Tag).update();
                                }
                                break;
                            /// #if BROWSER
                            case "setLocalShorthandCount":
                                setLocalShorthandCount();
                                break;
                            /// #endif
                            case "setRefDynamicText":
                                setRefDynamicText(data.data);
                                break;
                            case "reloadPlugin":
                                reloadPlugin(this, data.data);
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
                                handleCrossPlatformKey();
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
                                window.siyuan.storage[data.data.key] = data.data.val;
                                break;
                            case "rename":
                                getAllTabs().forEach((tab) => {
                                    if (tab.headElement) {
                                        const initTab = tab.headElement.getAttribute("data-initdata");
                                        if (initTab) {
                                            const initTabData = JSON.parse(initTab);
                                            if (initTabData.instance === "Editor" && initTabData.rootId === data.data.id) {
                                                tab.updateTitle(data.data.title);
                                            }
                                        }
                                    }
                                });
                                break;
                            case "closeBox":
                            case "removeBox":
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
                                processSync(data, this.plugins);
                                break;
                            case "backgroundtask":
                                progressBackgroundTask(data.data.tasks);
                                break;
                            case "refreshtheme":
                                if ((window.siyuan.config.appearance.mode === 1 && window.siyuan.config.appearance.themeDark !== "midnight") || (window.siyuan.config.appearance.mode === 0 && window.siyuan.config.appearance.themeLight !== "daylight")) {
                                    (document.getElementById("themeStyle") as HTMLLinkElement).href = data.data.theme;
                                } else {
                                    (document.getElementById("themeDefaultStyle") as HTMLLinkElement).href = data.data.theme;
                                }
                                break;
                            case "openFileById":
                                openFileById({app: this, id: data.data.id, action: [Constants.CB_GET_FOCUS]});
                                break;
                            case "exit":
                                if (isBrowser() && !isInMobileApp()) {
                                    window.location.href = "about:blank";
                                }
                        }
                    }
                }
            }),
        };

        fetchPost("/api/system/getConf", {}, async (response) => {
            addScriptSync(`${Constants.PROTYLE_CDN}/js/lute/lute.min.js?v=${Constants.SIYUAN_VERSION}`, "protyleLuteScript");
            addScript(`${Constants.PROTYLE_CDN}/js/protyle-html.js?v=${Constants.SIYUAN_VERSION}`, "protyleWcHtmlScript");
            window.siyuan.config = response.data.conf;
            handleCrossPlatformKey();
            window.siyuan.isPublish = response.data.isPublish;
            await loadPlugins(this);
            getLocalStorage(() => {
                fetchGet(`/appearance/langs/${window.siyuan.config.appearance.lang}.json?v=${Constants.SIYUAN_VERSION}`, (lauguages: IObject) => {
                    window.siyuan.languages = lauguages;
                    window.siyuan.menus = new Menus(this);
                    bootSync();
                    fetchPost("/api/setting/getCloudUser", {}, userResponse => {
                        window.siyuan.user = userResponse.data;
                        onGetConfig(response.data.start, this);
                        account.onSetaccount();
                        setTitle("", true);
                        initMessage();
                        /// #if BROWSER && !MOBILE
                        if (!isInMobileApp() && !window.siyuan.config.readonly && !window.siyuan.isPublish && !isChromeBrowser()) {
                            showMessage(window.siyuan.languages.useChrome, 0, "error");
                        }
                        /// #endif
                    });
                });
            });
        });
        setNoteBook();
        initBlockPopover(this);
    }
}

const siyuanApp = new App();

window.openFileByURL = (openURL) => {
    if (openURL && isSYProtocol(openURL)) {
        const isZoomIn = getSearch("focus", openURL) === "1";
        openFileById({
            app: siyuanApp,
            id: getIdFromSYProtocol(openURL),
            action: isZoomIn ? [Constants.CB_GET_ALL, Constants.CB_GET_FOCUS] : [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL],
            zoomIn: isZoomIn
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
/// #else
ipcRenderer.send(Constants.SIYUAN_READY_TO_SHOW);
/// #endif
