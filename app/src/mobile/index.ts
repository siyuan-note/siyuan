import {addScript, addScriptSync} from "../protyle/util/addScript";
import {Constants} from "../constants";
import {onMessage} from "./util/onMessage";
import {genUUID} from "../util/genID";
import {hasClosestByAttribute, hasTopClosestByClassName} from "../protyle/util/hasClosest";
import {Model} from "../layout/Model";
import "../assets/scss/mobile.scss";
import {Menus} from "../menus";
import {addBaseURL, getIdFromSYProtocol, isSYProtocol, setNoteBook} from "../util/pathName";
import {handleTouchEnd, handleTouchMove, handleTouchStart} from "./util/touch";
import {fetchGet, fetchPost} from "../util/fetch";
import {initFramework} from "./util/initFramework";
import {addGA, initAssets, loadAssets} from "../util/assets";
import {bootSync} from "../dialog/processSystem";
import {initMessage, showMessage} from "../dialog/message";
import {goBack} from "./util/MobileBackFoward";
import {hideKeyboardToolbar, showKeyboardToolbar} from "./util/keyboardToolbar";
import {getLocalStorage, writeText} from "../protyle/util/compatibility";
import {openMobileFileById} from "./editor";
import {getSearch} from "../util/functions";
import {initRightMenu} from "./menu";
import {openChangelog} from "../boot/openChangelog";
import {registerServiceWorker} from "../util/serviceWorker";
import {afterLoadPlugin, loadPlugins} from "../plugin/loader";
import {saveScroll} from "../protyle/scroll/saveScroll";

class App {
    public plugins: import("../plugin").Plugin[] = [];

    constructor() {
        if (!window.webkit?.messageHandlers && !window.JSAndroid) {
            registerServiceWorker(`${Constants.SERVICE_WORKER_PATH}?v=${Constants.SIYUAN_VERSION}`);
        }
        addScriptSync(`${Constants.PROTYLE_CDN}/js/lute/lute.min.js?v=${Constants.SIYUAN_VERSION}`, "protyleLuteScript");
        addScript(`${Constants.PROTYLE_CDN}/js/protyle-html.js?v=${Constants.SIYUAN_VERSION}`, "protyleWcHtmlScript");
        addBaseURL();
        window.siyuan = {
            zIndex: 10,
            notebooks: [],
            transactions: [],
            reqIds: {},
            backStack: [],
            dialogs: [],
            blockPanels: [],
            mobile: {},
            ws: new Model({
                app: this,
                id: genUUID(),
                type: "main",
                msgCallback: (data) => {
                    this.plugins.forEach((plugin) => {
                        plugin.eventBus.emit("ws-main", data);
                    });
                    onMessage(this, data);
                }
            })
        };
        // 不能使用 touchstart，否则会被 event.stopImmediatePropagation() 阻塞
        window.addEventListener("click", (event: MouseEvent & { target: HTMLElement }) => {
            if (!window.siyuan.menus.menu.element.contains(event.target) && !hasClosestByAttribute(event.target, "data-menu", "true")) {
                window.siyuan.menus.menu.remove();
            }
            const copyElement = hasTopClosestByClassName(event.target, "protyle-action__copy");
            if (copyElement) {
                writeText(copyElement.parentElement.nextElementSibling.textContent.trimEnd());
                showMessage(window.siyuan.languages.copied, 2000);
                event.preventDefault();
            }
        });
        window.addEventListener("beforeunload", () => {
           saveScroll(window.siyuan.mobile.editor.protyle);
        }, false);
        window.addEventListener("pagehide", () => {
            saveScroll(window.siyuan.mobile.editor.protyle);
        }, false);
        fetchPost("/api/system/getConf", {}, async (confResponse) => {
            confResponse.data.conf.keymap = Constants.SIYUAN_KEYMAP;
            window.siyuan.config = confResponse.data.conf;
            await loadPlugins(this);
            getLocalStorage(() => {
                fetchGet(`/appearance/langs/${window.siyuan.config.appearance.lang}.json?v=${Constants.SIYUAN_VERSION}`, (lauguages) => {
                    window.siyuan.languages = lauguages;
                    window.siyuan.menus = new Menus(this);
                    document.title = window.siyuan.languages.siyuanNote;
                    bootSync();
                    loadAssets(confResponse.data.conf.appearance);
                    initMessage();
                    initAssets();
                    fetchPost("/api/setting/getCloudUser", {}, userResponse => {
                        window.siyuan.user = userResponse.data;
                        fetchPost("/api/system/getEmojiConf", {}, emojiResponse => {
                            window.siyuan.emojis = emojiResponse.data as IEmoji[];
                            setNoteBook(() => {
                                initFramework(this);
                                initRightMenu(this);
                                openChangelog();
                                this.plugins.forEach(item => {
                                    afterLoadPlugin(item);
                                });
                            });
                        });
                    });
                    addGA();
                });
            });
            document.addEventListener("touchstart", handleTouchStart, false);
            document.addEventListener("touchmove", handleTouchMove, false);
            document.addEventListener("touchend", (event) => {
                handleTouchEnd(event, siyuanApp);
            }, false);
        });
    }
}

const siyuanApp = new App();

// https://github.com/siyuan-note/siyuan/issues/8441
window.reconnectWebSocket = () => {
    window.siyuan.ws.send("ping", {});
    window.siyuan.mobile.files.send("ping", {});
    window.siyuan.mobile.editor.protyle.ws.send("ping", {});
    window.siyuan.mobile.popEditor.protyle.ws.send("ping", {});
};
window.goBack = goBack;
window.showKeyboardToolbar = (height) => {
    document.getElementById("keyboardToolbar").setAttribute("data-keyboardheight", (height ? height : window.innerHeight / 2 - 42).toString());
    showKeyboardToolbar();
};
window.hideKeyboardToolbar = hideKeyboardToolbar;
window.openFileByURL = (openURL) => {
    if (openURL && isSYProtocol(openURL)) {
        openMobileFileById(siyuanApp, getIdFromSYProtocol(openURL),
            getSearch("focus", openURL) === "1" ? [Constants.CB_GET_ALL, Constants.CB_GET_FOCUS] : [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT, Constants.CB_GET_ROOTSCROLL]);
        return true;
    }
    return false;
};
