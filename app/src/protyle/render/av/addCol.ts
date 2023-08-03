import {Menu} from "../../../plugin/Menu";
import {transaction} from "../../wysiwyg/transaction";

export const addCol = (protyle: IProtyle, blockElement: HTMLElement) => {
    const menu = new Menu("av-header-add");
    const avID = blockElement.getAttribute("data-av-id");
    menu.addItem({
        icon: "iconAlignLeft",
        label: window.siyuan.languages.text,
        click() {
            const id = Lute.NewNodeID();
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: "Text",
                avID,
                type: "text",
                id
            }], [{
                action: "removeAttrViewCol",
                id,
                avID,
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
                type: "number",
                id
            }], [{
                action: "removeAttrViewCol",
                id,
                avID,
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
                type: "select",
                id
            }], [{
                action: "removeAttrViewCol",
                id,
                avID,
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
                type: "mSelect",
                id
            }], [{
                action: "removeAttrViewCol",
                id,
                avID,
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
                type: "date",
                id
            }], [{
                action: "removeAttrViewCol",
                id,
                avID,
            }]);
        }
    });
    menu.addItem({
        icon: "iconLink",
        label: window.siyuan.languages.link,
        click() {
            const id = Lute.NewNodeID();
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: "URL",
                avID,
                type: "url",
                id
            }], [{
                action: "removeAttrViewCol",
                id,
                avID,
            }]);
        }
    });
    menu.addItem({
        icon: "iconEmail",
        label: window.siyuan.languages.email,
        click() {
            const id = Lute.NewNodeID();
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: "Email",
                avID,
                type: "email",
                id
            }], [{
                action: "removeAttrViewCol",
                id,
                avID,
            }]);
        }
    });
    menu.addItem({
        icon: "iconPhone",
        label: window.siyuan.languages.phone,
        click() {
            const id = Lute.NewNodeID();
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: "Phone",
                avID,
                type: "phone",
                id
            }], [{
                action: "removeAttrViewCol",
                id,
                avID,
            }]);
        }
    });
    return menu;
};
