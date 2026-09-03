import {hideElements} from "../ui/hideElements";
import {isSupportCSSHL} from "../render/searchMarkRender";
import {destroyAIEditor} from "../../ai/editor";
import {cancelAssetUploads} from "../upload/pluginEvent";
import {unmountBreadcrumbButtons} from "../../plugin/breadcrumbButton";
import {forEachPluginSubscriber} from "../../plugin/EventBusCore";
import {unregisterCustomBlockRoot} from "../../plugin/customBlockRender";
import {destroyTrackedRanges} from "./trackedRange";

export const destroy = (protyle: IProtyle) => {
    if (!protyle) {
        return;
    }
    destroyTrackedRanges(protyle);
    cancelAssetUploads(protyle);
    unmountBreadcrumbButtons(protyle);
    hideElements(["util"], protyle, true);
    destroyAIEditor(protyle);
    protyle.hint?.destroy();
    protyle.preview?.destroy();
    if (isSupportCSSHL()) {
        protyle.highlight.markHL.clear();
        protyle.highlight.mark.clear();
        protyle.highlight.ranges = [];
        protyle.highlight.rangeIndex = 0;
    }
    protyle.observer?.disconnect();
    protyle.observerLoad?.disconnect();
    protyle.element.classList.remove("protyle");
    protyle.element.removeAttribute("style");
    if (protyle.wysiwyg) {
        unregisterCustomBlockRoot(protyle.wysiwyg.element);
        protyle.wysiwyg.destroy();
        protyle.wysiwyg.tableControl?.destroy();
        protyle.wysiwyg.lastHTMLs = {};
    }
    if (protyle.undo) {
        protyle.undo.clear();
    }
    if (protyle.ws) {
        try {
            protyle.ws.send("closews", {});
        } catch (e) {
            setTimeout(() => {
                protyle.ws?.send("closews", {});
            }, 10240);
        }
    }
    forEachPluginSubscriber("destroy-protyle", eventBus => {
        eventBus.emit("destroy-protyle", {
            protyle,
        });
    });
};
