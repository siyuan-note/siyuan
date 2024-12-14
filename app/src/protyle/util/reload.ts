import {addLoading, removeLoading} from "../ui/initUI";
import {fetchPost} from "../../util/fetch";
import {getDocByScroll, saveScroll} from "../scroll/saveScroll";
import {renderBacklink} from "../wysiwyg/renderBacklink";
import {hasClosestByClassName} from "./hasClosest";
import {preventScroll} from "../scroll/preventScroll";
import {isSupportCSSHL, searchMarkRender} from "../render/searchMarkRender";
import {restoreLuteMarkdownSyntax} from "./paste";

export const reloadProtyle = (protyle: IProtyle, focus: boolean, updateReadonly?: boolean) => {
    if (!protyle.preview.element.classList.contains("fn__none")) {
        protyle.preview.render(protyle);
        removeLoading(protyle);
        return;
    }
    if (window.siyuan.config.editor.displayBookmarkIcon) {
        protyle.wysiwyg.element.classList.add("protyle-wysiwyg--attr");
    } else {
        protyle.wysiwyg.element.classList.remove("protyle-wysiwyg--attr");
    }
    if (protyle.title) {
        protyle.title.element.removeAttribute("data-render");
        protyle.title.element.setAttribute("spellcheck", window.siyuan.config.editor.spellcheck.toString());
        if (window.siyuan.config.editor.displayBookmarkIcon) {
            protyle.title.element.classList.add("protyle-wysiwyg--attr");
        } else {
            protyle.title.element.classList.remove("protyle-wysiwyg--attr");
        }
    }
    protyle.lute.SetProtyleMarkNetImg(window.siyuan.config.editor.displayNetImgMark);
    protyle.lute.SetSpellcheck(window.siyuan.config.editor.spellcheck);
    restoreLuteMarkdownSyntax(protyle);
    protyle.lute.SetGFMStrikethrough1(false);
    addLoading(protyle);
    if (protyle.options.backlinkData) {
        const isMention = protyle.element.getAttribute("data-ismention") === "true";
        const tabElement = hasClosestByClassName(protyle.element, "sy__backlink");
        if (tabElement) {
            const inputsElement = tabElement.querySelectorAll(".b3-text-field") as NodeListOf<HTMLInputElement>;
            const keyword = isMention ? inputsElement[1].value : inputsElement[0].value;
            fetchPost(isMention ? "/api/ref/getBackmentionDoc" : "/api/ref/getBacklinkDoc", {
                defID: protyle.element.getAttribute("data-defid"),
                refTreeID: protyle.block.rootID,
                highlight: !isSupportCSSHL(),
                keyword,
            }, response => {
                protyle.options.backlinkData = isMention ? response.data.backmentions : response.data.backlinks;
                renderBacklink(protyle, protyle.options.backlinkData);
                searchMarkRender(protyle, response.data.keywords);
            });
        }
    } else {
        preventScroll(protyle);
        getDocByScroll({
            protyle,
            focus,
            scrollAttr: saveScroll(protyle, true) as IScrollAttr,
            updateReadonly,
            cb(keys) {
                if (protyle.query?.key) {
                    searchMarkRender(protyle, keys, protyle.highlight.rangeIndex);
                }
            }
        });
    }
};
