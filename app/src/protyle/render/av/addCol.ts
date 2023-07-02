import {Menu} from "../../../plugin/Menu";
import {transaction} from "../../wysiwyg/transaction";

export const addCol = (protyle: IProtyle, blockElement: HTMLElement) => {
    const menu = new Menu("av-header-add");
    menu.addItem({
        icon: "iconAlignLeft",
        label: window.siyuan.languages.text,
        click() {
            const id = Lute.NewNodeID();
            const type = "text";
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: "Text",
                parentID: blockElement.getAttribute("data-av-id"),
                type,
                id
            }], [{
                action: "removeAttrViewCol",
                id,
                parentID: blockElement.getAttribute("data-av-id"),
            }]);
        }
    });
    menu.addItem({
        icon: "iconNumber",
        label: window.siyuan.languages.number,
        click() {
            const id = Lute.NewNodeID();
            const type = "text";
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: "Text",
                parentID: blockElement.getAttribute("data-av-id"),
                type,
                id
            }], [{
                action: "removeAttrViewCol",
                id,
                parentID: blockElement.getAttribute("data-av-id"),
            }]);
        }
    });
    menu.addItem({
        icon: "iconListItem",
        label: window.siyuan.languages.select,
        click() {
            const id = Lute.NewNodeID();
            const type = "text";
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: "Text",
                parentID: blockElement.getAttribute("data-av-id"),
                type,
                id
            }], [{
                action: "removeAttrViewCol",
                id,
                parentID: blockElement.getAttribute("data-av-id"),
            }]);
        }
    });
    menu.addItem({
        icon: "iconList",
        label: window.siyuan.languages.multiSelect,
        click() {
            const id = Lute.NewNodeID();
            const type = "text";
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: "Text",
                parentID: blockElement.getAttribute("data-av-id"),
                type,
                id
            }], [{
                action: "removeAttrViewCol",
                id,
                parentID: blockElement.getAttribute("data-av-id"),
            }]);
        }
    });
    menu.addItem({
        icon: "iconCalendar",
        label: window.siyuan.languages.date,
        click() {
            const id = Lute.NewNodeID();
            const type = "text";
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: "Text",
                parentID: blockElement.getAttribute("data-av-id"),
                type,
                id
            }], [{
                action: "removeAttrViewCol",
                id,
                parentID: blockElement.getAttribute("data-av-id"),
            }]);
        }
    });
    return menu;
};
