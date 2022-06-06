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
import {repos} from "./config/repos";
import {openFileById} from "./editor/util";
import {bootSync, downloadProgress, progressLoading, setTitle, transactionError} from "./dialog/processSystem";
import {promiseTransactions} from "./protyle/wysiwyg/transaction";
import {initMessage} from "./dialog/message";

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
                            case"downloadProgress":
                                downloadProgress(data.data);
                                break;
                            case"txerr":
                                transactionError(data);
                                break;
                            case"syncing":
                                if (data.code === 0) {
                                    document.querySelector("#barSync svg").classList.add("fn__rotate");
                                    document.querySelector("#barSync").classList.add("toolbar__item--active");
                                    repos.element?.querySelector('[data-type="sync"] svg')?.classList.add("fn__rotate");
                                } else {
                                    document.querySelector("#barSync svg").classList.remove("fn__rotate");
                                    document.querySelector("#barSync").classList.remove("toolbar__item--active");
                                    repos.element?.querySelector('[data-type="sync"] svg')?.classList.remove("fn__rotate");
                                }
                                document.querySelector("#barSync").setAttribute("aria-label", data.msg);
                                break;
                            case "refreshtheme":
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
            window.siyuan.config = response.data;
            fetchGet(`/appearance/langs/${window.siyuan.config.appearance.lang}.json?v=${Constants.SIYUAN_VERSION}`, (lauguages) => {
                window.siyuan.languages = lauguages;
                bootSync();
                fetchPost("/api/setting/getCloudUser", {}, userResponse => {
                    window.siyuan.user = userResponse.data;
                    onGetConfig();
                    account.onSetaccount();
                    const dragElement = document.getElementById("drag");
                    if ("windows" !== window.siyuan.config.system.os && "linux" !== window.siyuan.config.system.os) {
                        dragElement.style.paddingRight = dragElement.getBoundingClientRect().left + "px";
                    } else {
                        dragElement.style.paddingRight = (dragElement.getBoundingClientRect().left - document.querySelector("#windowControls").clientWidth) + "px";
                    }
                    setTitle(window.siyuan.languages.siyuanNote);
                    initMessage();
                });
            });
        });
        setNoteBook();
        initBlockPopover();
        promiseTransactions();
    }
}

new App();
