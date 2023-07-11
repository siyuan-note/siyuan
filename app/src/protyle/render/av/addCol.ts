import {Menu} from "../../../plugin/Menu";
import {transaction} from "../../wysiwyg/transaction";

export const addCol = (protyle: IProtyle, blockElement: HTMLElement) => {
    const menu = new Menu("av-header-add");
    const avID = blockElement.getAttribute("data-av-id");
    const viewID = blockElement.querySelector(".item--focus").getAttribute("data-id");
    menu.addItem({
        icon: "iconAlignLeft",
        label: window.siyuan.languages.text,
        click() {
            const id = Lute.NewNodeID();
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: "Text",
                avID,
                viewID,
                type: "text",
                id
            }], [{
                action: "removeAttrViewCol",
                id,
                avID,
                viewID,
            }]);
        }
    });
    menu.addItem({
        icon: "iconNumber",
        label: window.siyuan.languages.number,
        click() {
            const id = Lute.NewNodeID();
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: "Number",
                avID,
                viewID,
                type: "number",
                id
            }], [{
                action: "removeAttrViewCol",
                id,
                avID,
                viewID,
            }]);
        }
    });
    menu.addItem({
        icon: "iconListItem",
        label: window.siyuan.languages.select,
        click() {
            const id = Lute.NewNodeID();
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: "Select",
                avID,
                viewID,
                type: "select",
                id
            }], [{
                action: "removeAttrViewCol",
                id,
                avID,
                viewID,
            }]);
        }
    });
    menu.addItem({
        icon: "iconList",
        label: window.siyuan.languages.multiSelect,
        click() {
            const id = Lute.NewNodeID();
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: "Multi-select",
                avID,
                viewID,
                type: "mSelect",
                id
            }], [{
                action: "removeAttrViewCol",
                id,
                avID,
                viewID,
            }]);
        }
    });
    menu.addItem({
        icon: "iconCalendar",
        label: window.siyuan.languages.date,
        click() {
            const id = Lute.NewNodeID();
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: "Date",
                avID,
                viewID,
                type: "date",
                id
            }], [{
                action: "removeAttrViewCol",
                id,
                avID,
                viewID,
            }]);
        }
    });
    return menu;
};
