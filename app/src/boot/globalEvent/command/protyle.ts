import {hasClosestBlock} from "../../../protyle/util/hasClosest";
import {getTopAloneElement} from "../../../protyle/wysiwyg/getBlock";
import {enterBack, zoomOut} from "../../../menus/protyle";
/// #if !MOBILE
import {openFileById} from "../../../editor/util";
/// #endif
import {checkFold} from "../../../util/noRelyPCFunction";
import {updateReadonly} from "../../../protyle/breadcrumb/action";
import {Constants} from "../../../constants";
import {fetchPost} from "../../../util/fetch";

export const onlyProtyleCommand = (options: {
    command: string,
    previousRange: Range,
    protyle: IProtyle,
}) => {
    if (options.command === "switchReadonly") {
        updateReadonly(options.protyle.breadcrumb.element.parentElement.querySelector('.block__icon[data-type="readonly"]'), options.protyle);
        return true;
    }
    if (options.command === "switchAdjust") {
        let fullWidth;
        const adjustWidth = options.protyle.wysiwyg.element.getAttribute(Constants.CUSTOM_SY_FULLWIDTH);
        if (!adjustWidth) {
            fullWidth = window.siyuan.config.editor.fullWidth ? "false" : "true";
        } else {
            fullWidth = adjustWidth === "true" ? "false" : "true";
        }
        fetchPost("/api/attr/setBlockAttrs", {
            id: options.protyle.block.rootID,
            attrs: {[Constants.CUSTOM_SY_FULLWIDTH]: fullWidth}
        });
        return true;
    }
    const nodeElement = hasClosestBlock(options.previousRange.startContainer);
    if (!nodeElement) {
        return false;
    }
    if (options.command === "enter") {
        let topNodeElement = getTopAloneElement(nodeElement);
        if (topNodeElement.parentElement.classList.contains("li") && topNodeElement.parentElement.parentElement.classList.contains("list") &&
            topNodeElement.nextElementSibling?.classList.contains("list") && topNodeElement.previousElementSibling.classList.contains("protyle-action")) {
            topNodeElement = topNodeElement.parentElement;
        }
        const id = topNodeElement.getAttribute("data-node-id");
        if (options.protyle.options.backlinkData) {
            /// #if !MOBILE
            checkFold(id, (zoomIn, action) => {
                openFileById({
                    app: options.protyle.app,
                    id,
                    action,
                    zoomIn
                });
            });
            /// #endif
        } else {
            zoomOut({protyle: options.protyle, id});
        }
        return true;
    }
    if (options.command === "enterBack") {
        enterBack(options.protyle, nodeElement.getAttribute("data-node-id"));
        return true;
    }
    return false;
};
