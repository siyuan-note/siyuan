import {addScript, addScriptSync} from "../protyle/util/addScript";
import {Constants} from "../constants";
import {onMessage} from "./util/onMessage";
import {genUUID} from "../util/genID";
import {hasClosestByAttribute} from "../protyle/util/hasClosest";
import {Model} from "../layout/Model";
import "../assets/scss/mobile.scss";
import {Menus} from "../menus";
import {addBaseURL, setNoteBook} from "../util/pathName";
import {handleTouchEnd, handleTouchMove, handleTouchStart} from "./util/touch";
import {fetchGet, fetchPost} from "../util/fetch";
import {initFramework} from "./util/initFramework";
import {addGA, initAssets, loadAssets} from "../util/assets";
import {promiseTransactions} from "../protyle/wysiwyg/transaction";
import {bootSync} from "../dialog/processSystem";
import {initMessage} from "../dialog/message";
import {goBack} from "./util/MobileBackFoward";
import {hideKeyboardToolbar, showKeyboardToolbar} from "./util/showKeyboardToolbar";
import {getLocalStorage} from "../protyle/util/compatibility";

class App {
    constructor() {
        addScriptSync(`${Constants.PROTYLE_CDN}/js/lute/lute.min.js?v=${Constants.SIYUAN_VERSION}`, "protyleLuteScript");
        addScript(`${Constants.PROTYLE_CDN}/js/protyle-html.js?v=${Constants.SIYUAN_VERSION}`, "protyleWcHtmlScript");
        addBaseURL();
        window.siyuan = {
            transactions: [],
            reqIds: {},
            backStack: [],
            dialogs: [],
            blockPanels: [],
            menus: new Menus(),
            ws: new Model({
                id: genUUID(),
                type: "main",
                msgCallback(data) {
                    onMessage(data);
                }
            })
        };
        // 不能使用 touchstart，否则会被 event.stopImmediatePropagation() 阻塞
        window.addEventListener("click", (event: MouseEvent & { target: HTMLElement }) => {
            if (!window.siyuan.menus.menu.element.contains(event.target) && !hasClosestByAttribute(event.target, "data-menu", "true")) {
                window.siyuan.menus.menu.remove();
            }
        });
        fetchPost("/api/system/getConf", {}, confResponse => {
            confResponse.data.conf.keymap = Constants.SIYUAN_KEYMAP;
            window.siyuan.config = confResponse.data.conf;
            getLocalStorage(() => {
                fetchGet(`/appearance/langs/${window.siyuan.config.appearance.lang}.json?v=${Constants.SIYUAN_VERSION}`, (lauguages) => {
                    window.siyuan.languages = lauguages;
                    document.title = window.siyuan.languages.siyuanNote;
                    bootSync();
                    loadAssets(confResponse.data.conf.appearance);
                    initMessage();
                    initAssets();
                    fetchPost("/api/system/getEmojiConf", {}, emojiResponse => {
                        window.siyuan.emojis = emojiResponse.data as IEmoji[];
                        initFramework();
                    });
                    addGA();
                });
            });
            if (navigator.userAgent.indexOf("iPhone") > -1) {
                document.addEventListener("touchstart", handleTouchStart, false);
                document.addEventListener("touchmove", handleTouchMove, false);
            }
            document.addEventListener("touchend", handleTouchEnd, false);
        });
        setNoteBook();
        promiseTransactions();
    }
}

new App();

window.goBack = goBack;
window.showKeyboardToolbar = showKeyboardToolbar;
window.hideKeyboardToolbar = hideKeyboardToolbar;
