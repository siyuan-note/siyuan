import {hideElements} from "../ui/hideElements";
import {isSupportCSSHL} from "../render/searchMarkRender";
import {removeDestroyListeners} from "../ui/initUI";

export const destroy = (protyle: IProtyle) => {
    if (!protyle) {
        return;
    }
    hideElements(["util"], protyle);
    if (isSupportCSSHL()) {
        protyle.highlight.markHL.clear();
        protyle.highlight.mark.clear();
        protyle.highlight.ranges = [];
        protyle.highlight.rangeIndex = 0;
    }
    protyle.observer?.disconnect();
    protyle.observerLoad?.disconnect();
    removeDestroyListeners(protyle);
    protyle.hint?.disconnectEmojiObservers();
    protyle.element.classList.remove("protyle");
    protyle.element.removeAttribute("style");
    if (protyle.wysiwyg) {
        protyle.wysiwyg.lastHTMLs = {};
    }
    if (protyle.undo) {
        protyle.undo.clear();
    }
    try {
        protyle.ws.send("closews", {});
    } catch (e) {
        setTimeout(() => {
            protyle.ws.send("closews", {});
        }, 10240);
    }
    protyle.app.plugins.forEach(item => {
        item.eventBus.emit("destroy-protyle", {
            protyle,
        });
    });
};
