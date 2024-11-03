import {hasClosestBlock} from "../../../protyle/util/hasClosest";
import {getTopAloneElement} from "../../../protyle/wysiwyg/getBlock";
import {enterBack, zoomOut} from "../../../menus/protyle";
import {openFileById} from "../../../editor/util";
import {Constants} from "../../../constants";

export const onlyProtyleCommand = (options: {
    command: string,
    previousRange: Range,
    protyle: IProtyle,
}) => {
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
            openFileById({
                app: options.protyle.app,
                id,
                action: [Constants.CB_GET_ALL, Constants.CB_GET_FOCUS]
            });
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
