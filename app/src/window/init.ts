import {Constants} from "../constants";
import {webFrame} from "electron";
import {fetchPost} from "../util/fetch";
import {getInstanceById, JSONToCenter, resizeTabs} from "../layout/util";
import {initStatus} from "../layout/status";
import {appearance} from "../config/appearance";
import {initAssets, setInlineStyle} from "../util/assets";
import {renderSnippet} from "../config/util/snippets";
import {getSearch} from "../util/functions";
import {initWindow} from "../boot/onGetConfig";
import {App} from "../index";
import {afterLoadPlugin} from "../plugin/loader";
import {Tab} from "../layout/Tab";
import {initWindowEvent} from "../boot/globalEvent/event";

export const init = (app: App) => {
    webFrame.setZoomFactor(window.siyuan.storage[Constants.LOCAL_ZOOM]);
    initWindowEvent(app);
    fetchPost("/api/system/getEmojiConf", {}, response => {
        window.siyuan.emojis = response.data as IEmoji[];

        const layout = JSON.parse(sessionStorage.getItem("layout") || "{}");
        if (layout.layout) {
            JSONToCenter(app, layout.layout);
            window.siyuan.layout.centerLayout = window.siyuan.layout.layout;
            afterLayout(app);
            return;
        }
        const tabJSON = JSON.parse(getSearch("json"));
        tabJSON.active = true;
        JSONToCenter(app, {
            direction: "lr",
            resize: "lr",
            size: "auto",
            type: "center",
            instance: "Layout",
            children: [{
                instance: "Wnd",
                children: [tabJSON]
            }]
        });
        window.siyuan.layout.centerLayout = window.siyuan.layout.layout;
        afterLayout(app);
    });
    initStatus(true);
    initWindow(app);
    appearance.onSetappearance(window.siyuan.config.appearance);
    initAssets();
    renderSnippet();
    setInlineStyle();
    let resizeTimeout = 0;
    window.addEventListener("resize", () => {
        window.clearTimeout(resizeTimeout);
        resizeTimeout = window.setTimeout(() => {
            resizeTabs();
        }, 200);
    });
};

const afterLayout = (app:App) => {
    app.plugins.forEach(item => {
        afterLoadPlugin(item);
    });
    document.querySelectorAll('li[data-type="tab-header"][data-init-active="true"]').forEach((item: HTMLElement) => {
        item.removeAttribute("data-init-active");
        const tab = getInstanceById(item.getAttribute("data-id")) as Tab;
        tab.parent.switchTab(item, false, false);
    });
};
