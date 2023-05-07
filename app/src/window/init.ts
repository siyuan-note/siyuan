import {Constants} from "../constants";
import {webFrame} from "electron";
import {globalShortcut} from "../boot/globalShortcut";
import {fetchPost} from "../util/fetch";
import {JSONToCenter, resizeTabs} from "../layout/util";
import {initStatus} from "../layout/status";
import {appearance} from "../config/appearance";
import {initAssets, setInlineStyle} from "../util/assets";
import {renderSnippet} from "../config/util/snippets";
import {getSearch} from "../util/functions";
import {initWindow} from "../boot/onGetConfig";

export const init = () => {
    webFrame.setZoomFactor(window.siyuan.storage[Constants.LOCAL_ZOOM]);
    globalShortcut();
    fetchPost("/api/system/getEmojiConf", {}, response => {
        window.siyuan.emojis = response.data as IEmoji[];

        const layout = JSON.parse(sessionStorage.getItem("layout") || "{}");
        if (layout.layout) {
            JSONToCenter(layout.layout);
            window.siyuan.layout.centerLayout = window.siyuan.layout.layout;
            return;
        }
        const tabJSON = JSON.parse(getSearch("json"));
        tabJSON.active = true;
        JSONToCenter({
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
    });
    initStatus(true);
    initWindow();
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
