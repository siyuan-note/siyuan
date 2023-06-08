import {hasClosestBlock, hasClosestByAttribute, hasClosestByClassName} from "../../util/hasClosest";
import {transaction} from "../../wysiwyg/transaction";
import {Menu} from "../../../plugin/API";

export const avClick = (protyle: IProtyle, event: MouseEvent & { target: HTMLElement }) => {
    const blockElement = hasClosestBlock(event.target)
    const addElement = hasClosestByAttribute(event.target, "data-type", "av-header-add")
    if (addElement && blockElement) {
        const menu = new Menu("av-header-add")
        menu.addItem({
            icon: "iconAlignLeft",
            label: window.siyuan.languages.text,
            click() {
                const id = Lute.NewNodeID()
                transaction(protyle, [{
                    action: "addAttrViewCol",
                    name: "Text",
                    parentID: blockElement.getAttribute("data-av-id"),
                    type: "text",
                    id
                }], [{
                    action: "removeAttrViewCol",
                    id,
                    parentID: blockElement.getAttribute("data-av-type"),
                }]);

            }
        })
        const addRect = addElement.getBoundingClientRect()
        menu.open({
            x: addRect.left,
            y: addRect.bottom
        })
        event.preventDefault();
        event.stopPropagation();
        return true
    }
    const cellElement = hasClosestByClassName(event.target, "av__cell")
    if (cellElement && blockElement) {
        event.preventDefault();
        event.stopPropagation();
        return true
    }
    return false
}
