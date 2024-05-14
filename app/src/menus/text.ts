import {Menu} from "../plugin/Menu";

export const textMenu = (target: Element) => {
    const menu = new Menu();
    if (menu.isOpen) {
        return;
    }
    menu.addItem({
        label: window.siyuan.languages.copy,
        icon: "iconCopy",
        click() {
            document.execCommand("copy");
        }
    });
    menu.addItem({
        label: window.siyuan.languages.selectAll,
        icon: "iconSelect",
        click() {
            if (getSelection().rangeCount === 0) {
                return;
            }
            getSelection().getRangeAt(0).selectNode(target);
        }
    });
    return menu;
};
