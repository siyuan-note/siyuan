import {Constants} from "./constants";
import {Menus} from "./menus";
import {Model} from "./layout/Model";
import {onGetConfig} from "./boot/onGetConfig";
import {initBlockPopover} from "./block/popover";
import {account} from "./config/account";
import {genUUID} from "./util/genID";
import {fetchPost} from "./util/fetch";
import {addBaseURL, addMetaAnchor, getIdFromSYProtocol, isSYProtocol} from "./util/pathName";
import {registerServiceWorker, unregisterServiceWorker} from "./util/serviceWorker";
import {openFileById} from "./editor/util";
import {
    bootSync,
    downloadProgress,
    processSync,
    progressBackgroundTask,
    progressLoading,
    progressStatus, reloadSync,
    transactionError
} from "./dialog/processSystem";
import {getAllTabs} from "./layout/getAll";
import {getSearch} from "./util/functions";
import {hideAllElements} from "./protyle/ui/hideElements";
import {PluginLoader} from "./plugin/loader";
import "./assets/scss/base.scss";
import {sendGlobalShortcut} from "./boot/globalEvent/keydown";
import {JSONToLayout, resetLayout} from "./layout/util";
import {initApp} from "./boot/initApp";
import {openChangelog} from "./boot/openChangelog";

export class App {
    public plugins: import("./plugin").Plugin[] = [];
    public appId: string;

    constructor() {
        addBaseURL();
        addMetaAnchor();

        this.appId = Constants.SIYUAN_APPID;
        window.siyuan = {
            zIndex: 10,
            transactions: [],
            reqIds: {},
            backStack: [],
            layout: {},
            dialogs: [],
            blockPanels: [],
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
                            case "syncMergeResult":
                                reloadSync(this, data.data);
                                break;
                            case "readonly":
                                window.siyuan.config.editor.readOnly = data.data;
                                hideAllElements(["util"]);
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
                            case "unmount":
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
                                transactionError();
                                break;
                            case "syncing":
                                processSync(data);
                                break;
                            case "backgroundtask":
                                progressBackgroundTask(data.data.tasks);
                                break;
                            case "refreshtheme":
                                if ((window.siyuan.config.appearance.mode === 1 && window.siyuan.config.appearance.themeDark !== "midnight") || (window.siyuan.config.appearance.mode === 0 && window.siyuan.config.appearance.themeLight !== "daylight")) {
                                    (document.getElementById(Constants.ELEMENT_ID_PROTYLE_THEME_STYLE) as HTMLLinkElement).href = data.data.theme;
                                } else {
                                    (document.getElementById(Constants.ELEMENT_ID_PROTYLE_THEME_DEFAULT_STYLE) as HTMLLinkElement).href = data.data.theme;
                                }
                                break;
                            case "openFileById":
                                openFileById({app: this, id: data.data.id, action: [Constants.CB_GET_FOCUS]});
                                break;
                        }
                    }
                }
            }),
        };

        fetchPost("/api/system/getConf", {}, async (response) => {
            window.siyuan.config = response.data.conf;
            // 历史数据兼容，202306后可删除
            if (window.siyuan.config.uiLayout.left && !window.siyuan.config.uiLayout.left.data) {
                window.siyuan.config.uiLayout.left = {
                    pin: true,
                    data: response.data.conf.uiLayout.left
                };
                window.siyuan.config.uiLayout.right = {
                    pin: true,
                    data: response.data.conf.uiLayout.right
                };
                window.siyuan.config.uiLayout.bottom = {
                    pin: true,
                    data: response.data.conf.uiLayout.bottom
                };
            }

            /// #if BROWSER
            await registerServiceWorker();
            /// #else
            await unregisterServiceWorker();
            /// #endif

            const pluginLoader = new PluginLoader(this);

            await initApp();

            window.siyuan.menus = new Menus(this);

            bootSync();
            initBlockPopover(this);

            onGetConfig(this);
            openChangelog();
            account.onSetaccount();

            try {
                JSONToLayout(this, response.data.start);
            } catch (e) {
                resetLayout();
            }

            await pluginLoader.register();

            sendGlobalShortcut(this);
        });
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
/// #endif
