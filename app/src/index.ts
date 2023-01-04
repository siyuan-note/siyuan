import {Constants} from "./constants";
import {Menus} from "./menus";
import {Model} from "./layout/Model";
import {onGetConfig} from "./util/onGetConfig";
import "./assets/scss/base.scss";
import {initBlockPopover} from "./block/popover";
import {account} from "./config/account";
import {addScript, addScriptSync} from "./protyle/util/addScript";
import {genUUID} from "./util/genID";
import {fetchGet, fetchPost} from "./util/fetch";
import {addBaseURL, setNoteBook} from "./util/pathName";
import {openFileById} from "./editor/util";
import {
    bootSync,
    downloadProgress,
    progressLoading,
    progressStatus,
    setTitle,
    transactionError
} from "./dialog/processSystem";
import {promiseTransactions} from "./protyle/wysiwyg/transaction";
import {initMessage} from "./dialog/message";
import {resizeDrag} from "./layout/util";
import {getAllTabs} from "./layout/getAll";
import {getLocalStorage} from "./protyle/util/compatibility";

class App {
    constructor() {
        addScriptSync(`${Constants.PROTYLE_CDN}/js/lute/lute.min.js?v=${Constants.SIYUAN_VERSION}`, "protyleLuteScript");
        addScript(`${Constants.PROTYLE_CDN}/js/protyle-html.js?v=${Constants.SIYUAN_VERSION}`, "protyleWcHtmlScript");
        addBaseURL();
        window.siyuan = {
            transactions: [],
            reqIds: {},
            backStack: [],
            layout: {},
            dialogs: [],
            blockPanels: [],
            ctrlIsPressed: false,
            altIsPressed: false,
            ws: new Model({
                id: genUUID(),
                type: "main",
                msgCallback: (data) => {
                    if (data) {
                        switch (data.cmd) {
                            case"progress":
                                progressLoading(data);
                                break;
                            case"setLocalStorageVal":
                                window.siyuan.storage[data.data.key] = data.data.val;
                                break;
                            case "rename":
                                getAllTabs().forEach((tab) => {
                                    if (tab.headElement) {
                                        const initTab = tab.headElement.getAttribute("data-initdata");
                                        if (initTab) {
                                            const initTabData = JSON.parse(initTab);
                                            if (initTabData.rootId === data.data.id) {
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
                                            if (data.data.box === initTabData.notebookId) {
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
                                            if (data.data.ids.includes(initTabData.rootId)) {
                                                tab.parent.removeTab(tab.id);
                                            }
                                        }
                                    }
                                });
                                break;
                            case"statusbar":
                                progressStatus(data);
                                break;
                            case"downloadProgress":
                                downloadProgress(data.data);
                                break;
                            case"txerr":
                                transactionError(data);
                                break;
                            case"syncing":
                                if (data.code === 0) {
                                    document.querySelector("#barSync").classList.add("toolbar__item--active");
                                } else {
                                    document.querySelector("#barSync").classList.remove("toolbar__item--active");
                                }
                                document.querySelector("#barSync").setAttribute("aria-label", data.msg);
                                break;
                            case "refreshtheme":
                                if (!window.siyuan.config.appearance.customCSS && data.data.theme.indexOf("custom.css") > -1) {
                                    return;
                                }
                                if ((window.siyuan.config.appearance.mode === 1 && window.siyuan.config.appearance.themeDark !== "midnight") || (window.siyuan.config.appearance.mode === 0 && window.siyuan.config.appearance.themeLight !== "daylight")) {
                                    (document.getElementById("themeStyle") as HTMLLinkElement).href = data.data.theme;
                                } else {
                                    (document.getElementById("themeDefaultStyle") as HTMLLinkElement).href = data.data.theme;
                                }
                                break;
                            case "createdailynote":
                                openFileById({id: data.data.id, action: [Constants.CB_GET_FOCUS]});
                                break;
                        }
                    }
                }
            }),
            menus: new Menus()
        };
        fetchPost("/api/system/getConf", {}, response => {
            window.siyuan.config = response.data.conf;
            getLocalStorage(() => {
                fetchGet(`/appearance/langs/${window.siyuan.config.appearance.lang}.json?v=${Constants.SIYUAN_VERSION}`, (lauguages) => {
                    window.siyuan.languages = lauguages;
                    bootSync();
                    fetchPost("/api/setting/getCloudUser", {}, userResponse => {
                        window.siyuan.user = userResponse.data;
                        onGetConfig(response.data.start);
                        account.onSetaccount();
                        resizeDrag();
                        setTitle(window.siyuan.languages.siyuanNote);
                        initMessage();
                    });
                });
            });
        });
        setNoteBook();
        initBlockPopover();
        promiseTransactions();
    }
}

new App();
