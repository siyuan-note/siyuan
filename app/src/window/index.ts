import {App} from "..";
import {Constants} from "../constants";
import {Menus} from "../menus";
import {Model} from "../layout/Model";
import "../assets/scss/base.scss";
import {initBlockPopover} from "../block/popover";
import {genUUID} from "../util/genID";
import {fetchSyncPost} from "../util/fetch";
import {openFileById} from "../editor/util";
import {
    processSync, progressBackgroundTask,
    progressLoading,
    progressStatus, reloadSync,
    transactionError
} from "../dialog/processSystem";
import {getAllTabs} from "../layout/getAll";
import {init, initLayout} from "../window/init";
import {initApp} from "../boot/initApp";
import {PluginLoader} from "../plugin/loader";
import {unregisterServiceWorker} from "../util/serviceWorker";

class SiyuanApp extends App {
    protected async init(): Promise<void> {
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

        const response = await fetchSyncPost("/api/system/getConf", {});
        window.siyuan.config = response.data.conf;

        await unregisterServiceWorker();

        const pluginLoader = new PluginLoader(this);

        await initApp();

        window.siyuan.menus = new Menus(this);

        initBlockPopover(this);

        init(this);
        initLayout(this);

        await pluginLoader.register();
    }
}

const siyuanApp = new SiyuanApp();
