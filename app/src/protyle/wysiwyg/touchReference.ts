import {Constants} from "../../constants";
import {openFileById} from "../../editor/util";
import {pushBackByClick, saveBackScroll} from "../../util/backForward";
import {checkFold} from "../../util/noRelyPCFunction";
import {parseSiYuanUriInfo} from "../../util/pathName";
import {processSiYuanUri} from "../../util/uri";
import {hideElements} from "../ui/hideElements";
import {hasClosestByAttribute} from "../util/hasClosest";

export const openTouchReference = (protyle: IProtyle, target: HTMLElement, point: {x: number, y: number}) => {
    if (window.getSelection()?.toString()) {
        return false;
    }
    const reference = hasClosestByAttribute(target, "data-type", "block-ref");
    const link = hasClosestByAttribute(target, "data-type", "a");
    const href = link ? link.getAttribute("data-href") || "" : "";
    const uri = parseSiYuanUriInfo(href);
    const id = reference ? reference.getAttribute("data-id") : uri?.id;
    if (!id) {
        return false;
    }
    // 触摸跳转直接记录来源，不获取编辑光标，避免唤起软键盘。
    pushBackByClick(protyle, target, point);
    saveBackScroll(protyle);
    hideElements(["dialog", "toolbar"], protyle);
    if (!reference && uri?.avItemID) {
        processSiYuanUri(protyle.app, href);
    } else {
        checkFold(id, (zoomIn, action, isRoot) => {
            if (!isRoot) {
                action.push(Constants.CB_GET_HL);
            }
            openFileById({app: protyle.app, id, action, zoomIn, scrollPosition: "start"});
        });
    }
    return true;
};
