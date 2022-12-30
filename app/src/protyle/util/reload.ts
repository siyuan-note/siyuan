import {addLoading} from "../ui/initUI";
import {fetchPost} from "../../util/fetch";
import {Constants} from "../../constants";
import {onGet} from "./onGet";
import {saveScroll} from "../scroll/saveScroll";
import {renderBacklink} from "../wysiwyg/renderBacklink";
import {hasClosestByClassName} from "./hasClosest";

export const reloadProtyle = (protyle: IProtyle) => {
    if (window.siyuan.config.editor.displayBookmarkIcon) {
        protyle.wysiwyg.element.classList.add("protyle-wysiwyg--attr");
    } else {
        protyle.wysiwyg.element.classList.remove("protyle-wysiwyg--attr");
    }
    if (protyle.title) {
        protyle.title.element.setAttribute("spellcheck", window.siyuan.config.editor.spellcheck.toString());
        if (window.siyuan.config.editor.displayBookmarkIcon) {
            protyle.title.element.classList.add("protyle-wysiwyg--attr");
        } else {
            protyle.title.element.classList.remove("protyle-wysiwyg--attr");
        }
    }
    protyle.lute.SetProtyleMarkNetImg(window.siyuan.config.editor.displayNetImgMark);
    protyle.lute.SetSpellcheck(window.siyuan.config.editor.spellcheck);
    addLoading(protyle);
    if (protyle.options.backlinkData) {
        const isMention = protyle.element.getAttribute("data-ismention") === "true";
        const tabElement = hasClosestByClassName(protyle.element, "sy__backlink");
        if (tabElement) {
            const inputsElement = tabElement.querySelectorAll(".b3-form__icon-input") as NodeListOf<HTMLInputElement>;
            fetchPost(isMention ? "/api/ref/getBackmentionDoc" : "/api/ref/getBacklinkDoc", {
                defID: protyle.element.getAttribute("data-defid"),
                refTreeID: protyle.block.rootID,
                keyword: isMention ? inputsElement[1].value : inputsElement[0].value
            }, response => {
                protyle.options.backlinkData = isMention ? response.data.backmentions : response.data.backlinks,
                    renderBacklink(protyle, protyle.options.backlinkData);
            });
        }
    } else {
        fetchPost("/api/filetree/getDoc", {
            id: protyle.block.showAll ? protyle.block.id : protyle.block.rootID,
            mode: 0,
            size: protyle.block.showAll ? Constants.SIZE_GET_MAX : window.siyuan.config.editor.dynamicLoadBlocks,
        }, getResponse => {
            onGet(getResponse, protyle, protyle.block.showAll ? [Constants.CB_GET_ALL, Constants.CB_GET_FOCUS] : [Constants.CB_GET_FOCUS], saveScroll(protyle, true), true);
        });
    }
};
