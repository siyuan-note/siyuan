import {Constants} from "../constants";
import {webFrame} from "electron";
import {globalShortcut} from "../util/globalShortcut";
import {fetchPost} from "../util/fetch";
import {JSONToCenter, resizeTabs} from "../layout/util";
import {initStatus} from "../layout/status";
import {appearance} from "../config/appearance";
import {initAssets, setInlineStyle} from "../util/assets";
import {renderSnippet} from "../config/util/snippets";
import {getSearch} from "../util/functions";
import {Layout} from "../layout";
import {initWindow} from "../util/onGetConfig";

export const init = () => {
    webFrame.setZoomFactor(window.siyuan.storage[Constants.LOCAL_ZOOM]);
    globalShortcut();
    fetchPost("/api/system/getEmojiConf", {}, response => {
        window.siyuan.emojis = response.data as IEmoji[];
        const id = getSearch("id");
        JSONToCenter({
            "direction": "lr",
            "resize": "lr",
            "size": "auto",
            "type": "center",
            "instance": "Layout",
            "children": [{
                "instance": "Wnd",
                "children": [{
                    "instance": "Tab",
                    active: true,
                    docIcon: "1f389",
                    title: "请从这里开始",
                    "children": [{
                        rootId: id,
                        blockId: id,
                        instance: "Editor",
                        mode: "wysiwyg"
                    }]
                }]
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
}
