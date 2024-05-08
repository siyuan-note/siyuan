import {addLoading} from "../ui/initUI";
import {fetchPost} from "../../util/fetch";
import {getDocByScroll, saveScroll} from "../scroll/saveScroll";
import {renderBacklink} from "../wysiwyg/renderBacklink";
import {hasClosestByClassName} from "./hasClosest";
import {preventScroll} from "../scroll/preventScroll";

export const reloadProtyle = (protyle: IProtyle, focus: boolean) => {
    if (!protyle.preview.element.classList.contains("fn__none")) {
        protyle.preview.render(protyle);
        return;
    }
    if (window.siyuan.config.editor.displayBookmarkIcon) {
        protyle.wysiwyg.element.classList.add("protyle-wysiwyg--attr");
    } else {
        protyle.wysiwyg.element.classList.remove("protyle-wysiwyg--attr");
    }
    if (protyle.title) {
        protyle.title.editElement.removeAttribute("data-render");
        protyle.title.element.setAttribute("spellcheck", window.siyuan.config.editor.spellcheck.toString());
        if (window.siyuan.config.editor.displayBookmarkIcon) {
            protyle.title.element.classList.add("protyle-wysiwyg--attr");
        } else {
            protyle.title.element.classList.remove("protyle-wysiwyg--attr");
        }
    }
    protyle.lute.SetProtyleMarkNetImg(window.siyuan.config.editor.displayNetImgMark);
    protyle.lute.SetSpellcheck(window.siyuan.config.editor.spellcheck);
    protyle.lute.SetSup(window.siyuan.config.editor.markdown.inlineSup);
    protyle.lute.SetSub(window.siyuan.config.editor.markdown.inlineSub);
    protyle.lute.SetTag(window.siyuan.config.editor.markdown.inlineTag);
    protyle.lute.SetInlineMath(window.siyuan.config.editor.markdown.inlineMath);
    protyle.lute.SetGFMStrikethrough1(false);
    addLoading(protyle);
    if (protyle.options.backlinkData) {
        const isMention = protyle.element.getAttribute("data-ismention") === "true";
        const tabElement = hasClosestByClassName(protyle.element, "sy__backlink");
        if (tabElement) {
            const inputsElement = tabElement.querySelectorAll(".b3-text-field") as NodeListOf<HTMLInputElement>;
            fetchPost(isMention ? "/api/ref/getBackmentionDoc" : "/api/ref/getBacklinkDoc", {
                defID: protyle.element.getAttribute("data-defid"),
                refTreeID: protyle.block.rootID,
                keyword: isMention ? inputsElement[1].value : inputsElement[0].value
            }, response => {
                protyle.options.backlinkData = isMention ? response.data.backmentions : response.data.backlinks;
                renderBacklink(protyle, protyle.options.backlinkData);
            });
        }
    } else {
        preventScroll(protyle);
        getDocByScroll({
            protyle,
            focus,
            scrollAttr: saveScroll(protyle, true)
        });
    }
};
