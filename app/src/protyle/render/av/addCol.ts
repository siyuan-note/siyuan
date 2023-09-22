import {Menu} from "../../../plugin/Menu";
import {transaction} from "../../wysiwyg/transaction";
import {addAttrViewColAnimation} from "./action";

export const addCol = (protyle: IProtyle, blockElement: Element) => {
    const menu = new Menu("av-header-add");
    const avID = blockElement.getAttribute("data-av-id");
    menu.addItem({
        icon: "iconAlignLeft",
        label: window.siyuan.languages.text,
        click() {
            const id = Lute.NewNodeID();
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: window.siyuan.languages.text,
                avID,
                type: "text",
                id
            }], [{
                action: "removeAttrViewCol",
                id,
                avID,
            }]);
            addAttrViewColAnimation({
                blockElement: blockElement,
                protyle: protyle,
                type: "text",
                name: window.siyuan.languages.text,
                id
            });
        }
    });
    menu.addItem({
        icon: "iconNumber",
        label: window.siyuan.languages.number,
        click() {
            const id = Lute.NewNodeID();
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: window.siyuan.languages.number,
                avID,
                type: "number",
                id
            }], [{
                action: "removeAttrViewCol",
                id,
                avID,
            }]);
            addAttrViewColAnimation({
                blockElement: blockElement,
                protyle: protyle,
                type: "number",
                name: window.siyuan.languages.number,
                id
            });
        }
    });
    menu.addItem({
        icon: "iconListItem",
        label: window.siyuan.languages.select,
        click() {
            const id = Lute.NewNodeID();
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: window.siyuan.languages.select,
                avID,
                type: "select",
                id
            }], [{
                action: "removeAttrViewCol",
                id,
                avID,
            }]);
            addAttrViewColAnimation({
                blockElement: blockElement,
                protyle: protyle,
                type: "select",
                name: window.siyuan.languages.select,
                id
            });
        }
    });
    menu.addItem({
        icon: "iconList",
        label: window.siyuan.languages.multiSelect,
        click() {
            const id = Lute.NewNodeID();
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: window.siyuan.languages.multiSelect,
                avID,
                type: "mSelect",
                id
            }], [{
                action: "removeAttrViewCol",
                id,
                avID,
            }]);
            addAttrViewColAnimation({
                blockElement: blockElement,
                protyle: protyle,
                type: "mSelect",
                name: window.siyuan.languages.multiSelect,
                id
            });
        }
    });
    menu.addItem({
        icon: "iconCalendar",
        label: window.siyuan.languages.date,
        click() {
            const id = Lute.NewNodeID();
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: window.siyuan.languages.date,
                avID,
                type: "date",
                id
            }], [{
                action: "removeAttrViewCol",
                id,
                avID,
            }]);
            addAttrViewColAnimation({
                blockElement: blockElement,
                protyle: protyle,
                type: "date",
                name: window.siyuan.languages.date,
                id
            });
        }
    });
    menu.addItem({
        icon: "iconImage",
        label: window.siyuan.languages.assets,
        click() {
            const id = Lute.NewNodeID();
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: window.siyuan.languages.assets,
                avID,
                type: "mAsset",
                id
            }], [{
                action: "removeAttrViewCol",
                id,
                avID,
            }]);
            addAttrViewColAnimation({
                blockElement: blockElement,
                protyle: protyle,
                type: "mAsset",
                name: window.siyuan.languages.assets,
                id
            });
        }
    });
    menu.addItem({
        icon: "iconLink",
        label: window.siyuan.languages.link,
        click() {
            const id = Lute.NewNodeID();
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: window.siyuan.languages.link,
                avID,
                type: "url",
                id
            }], [{
                action: "removeAttrViewCol",
                id,
                avID,
            }]);
            addAttrViewColAnimation({
                blockElement: blockElement,
                protyle: protyle,
                type: "url",
                name: window.siyuan.languages.link,
                id
            });
        }
    });
    menu.addItem({
        icon: "iconEmail",
        label: window.siyuan.languages.email,
        click() {
            const id = Lute.NewNodeID();
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: window.siyuan.languages.email,
                avID,
                type: "email",
                id
            }], [{
                action: "removeAttrViewCol",
                id,
                avID,
            }]);
            addAttrViewColAnimation({
                blockElement: blockElement,
                protyle: protyle,
                type: "email",
                name: window.siyuan.languages.email,
                id
            });
        }
    });
    menu.addItem({
        icon: "iconPhone",
        label: window.siyuan.languages.phone,
        click() {
            const id = Lute.NewNodeID();
            transaction(protyle, [{
                action: "addAttrViewCol",
                name: window.siyuan.languages.phone,
                avID,
                type: "phone",
                id
            }], [{
                action: "removeAttrViewCol",
                id,
                avID,
            }]);
            addAttrViewColAnimation({
                blockElement: blockElement,
                protyle: protyle,
                type: "phone",
                name: window.siyuan.languages.phone,
                id
            });
        }
    });
    return menu;
};
