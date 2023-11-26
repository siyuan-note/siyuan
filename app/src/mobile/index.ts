import {Constants} from "../constants";
import {onMessage} from "./util/onMessage";
import {genUUID} from "../util/genID";
import {Model} from "../layout/Model";
import "../assets/scss/mobile.scss";
import {Menus} from "../menus";
import {addBaseURL, addMetaAnchor, getIdFromSYProtocol, isSYProtocol} from "../util/pathName";
import {fetchPost} from "../util/fetch";
import {bootSync, setTitle} from "../dialog/processSystem";
import {initMessage} from "../dialog/message";
import {goBack} from "./util/MobileBackFoward";
import {hideKeyboardToolbar, showKeyboardToolbar} from "./util/keyboardToolbar";
import {openMobileFileById} from "./editor";
import {getSearch} from "../util/functions";
import {openChangelog} from "../boot/openChangelog";
import {registerServiceWorker, unregisterServiceWorker} from "../util/serviceWorker";
import {PluginLoader} from "../plugin/loader";
import {initApp} from "../boot/initApp";
import {init, initPluginMenu} from "./init";

class App {
    public plugins: import("../plugin").Plugin[] = [];
    public appId: string;

    constructor() {
        addBaseURL();
        addMetaAnchor();

        this.appId = Constants.SIYUAN_APPID;
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

        fetchPost("/api/system/getConf", {}, async (confResponse) => {
            confResponse.data.conf.keymap = Constants.SIYUAN_KEYMAP;
            window.siyuan.config = confResponse.data.conf;

            if (!window.webkit?.messageHandlers && !window.JSAndroid) {
                await registerServiceWorker();
            } else {
                await unregisterServiceWorker();
            }

            const pluginLoader = new PluginLoader(this);

            await initApp();

            window.siyuan.menus = new Menus(this);

            bootSync();

            init(this, confResponse.data.start);
            openChangelog();

            await pluginLoader.init();
            await pluginLoader.load();
            const menus = await pluginLoader.layoutReady();
            initPluginMenu(menus);
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
