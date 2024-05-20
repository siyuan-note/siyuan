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
            if (getSelection().rangeCount === 0) {
                return;
            }
            const range = getSelection().getRangeAt(0);
            if (!range.toString()) {
                getSelection().getRangeAt(0).selectNode(target);
            }
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
