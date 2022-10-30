import {Tab} from "../layout/Tab";
import {MenuItem} from "./Menu";
import {Editor} from "../editor";
import {copyTab} from "../layout/util";
import {copySubMenu} from "./commonMenuItem";

const closeMenu = (tab: Tab) => {
    const allTabs: Tab[] = [];
    const unmodifiedTabs: Tab[] = [];
    const leftTabs: Tab[] = [];
    const rightTabs: Tab[] = [];
    let midIndex = -1;
    tab.parent.children.forEach((item: Tab, index: number) => {
        const editor = item.model as Editor;
        if (!editor || (editor.editor?.protyle && !editor.editor?.protyle.updated)) {
            unmodifiedTabs.push(item);
        }
        if (item.id === tab.id) {
            midIndex = index;
        }
        if (midIndex === -1) {
            leftTabs.push(item);
        } else if (index > midIndex) {
            rightTabs.push(item);
        }
        allTabs.push(item);
    });

    window.siyuan.menus.menu.append(new MenuItem({
        icon: "iconClose",
        label: window.siyuan.languages.close,
        accelerator: window.siyuan.config.keymap.general.closeTab.custom,
        click: () => {
            tab.parent.removeTab(tab.id);
        }
    }).element);
    if (allTabs.length > 1) {
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.closeOthers,
            click: async () => {
                for (let index = 0; index < allTabs.length; index++) {
                    if (allTabs[index].id !== tab.id && !allTabs[index].headElement.classList.contains("item--pin")) {
                        await allTabs[index].parent.removeTab(allTabs[index].id, true);
                    }
                }
                if (!tab.headElement.parentElement.querySelector(".item--focus")) {
                    tab.parent.switchTab(tab.headElement, true);
                }
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.closeAll,
            click: async () => {
                for (let index = 0; index < allTabs.length; index++) {
                    if (!allTabs[index].headElement.classList.contains("item--pin")) {
                        await allTabs[index].parent.removeTab(allTabs[index].id, true);
                    }
                }
                if (allTabs[0].headElement.parentElement) {
                    allTabs[0].parent.switchTab(allTabs[0].headElement, true);
                }
            }
        }).element);
        if (unmodifiedTabs.length > 0) {
            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.closeUnmodified,
                click: async () => {
                    for (let index = 0; index < unmodifiedTabs.length; index++) {
                        if (!unmodifiedTabs[index].headElement.classList.contains("item--pin")) {
                            await unmodifiedTabs[index].parent.removeTab(unmodifiedTabs[index].id);
                        }
                    }
                    if (tab.headElement.parentElement && !tab.headElement.parentElement.querySelector(".item--focus")) {
                        tab.parent.switchTab(tab.headElement, true);
                    } else if (allTabs[0].headElement.parentElement) {
                        allTabs[0].parent.switchTab(allTabs[0].headElement, true);
                    }
                }
            }).element);
        }
        if (leftTabs.length > 0) {
            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.closeLeft,
                click: async () => {
                    for (let index = 0; index < leftTabs.length; index++) {
                        if (!leftTabs[index].headElement.classList.contains("item--pin")) {
                            await leftTabs[index].parent.removeTab(leftTabs[index].id);
                        }
                    }
                    if (!tab.headElement.parentElement.querySelector(".item--focus")) {
                        tab.parent.switchTab(tab.headElement, true);
                    }
                }
            }).element);
        }
        if (rightTabs.length > 0) {
            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.closeRight,
                click: async () => {
                    for (let index = 0; index < rightTabs.length; index++) {
                        if (!rightTabs[index].headElement.classList.contains("item--pin")) {
                            await rightTabs[index].parent.removeTab(rightTabs[index].id);
                        }
                    }
                    if (!tab.headElement.parentElement.querySelector(".item--focus")) {
                        tab.parent.switchTab(tab.headElement, true);
                    }
                }
            }).element);
        }
    }
    window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
};

const splitSubMenu = (tab: Tab) => {
    const subMenus: IMenu[] = [{
        icon: "iconSplitLR",
        label: window.siyuan.languages.splitLR,
        click: () => {
            tab.parent.split("lr").addTab(copyTab(tab));
        }
    }];
    if (tab.parent.children.length > 1) {
        subMenus.push({
            icon: "iconLayoutRight",
            label: window.siyuan.languages.splitMoveR,
            click: () => {
                const newWnd = tab.parent.split("lr");
                newWnd.headersElement.append(tab.headElement);
                newWnd.headersElement.parentElement.classList.remove("fn__none");
                newWnd.moveTab(tab);
            }
        });
    }
    subMenus.push({
        icon: "iconSplitTB",
        label: window.siyuan.languages.splitTB,
        click: () => {
            tab.parent.split("tb").addTab(copyTab(tab));
        }
    });

    if (tab.parent.children.length > 1) {
        subMenus.push({
            icon: "iconLayoutBottom",
            label: window.siyuan.languages.splitMoveB,
            click: () => {
                const newWnd = tab.parent.split("tb");
                newWnd.headersElement.append(tab.headElement);
                newWnd.headersElement.parentElement.classList.remove("fn__none");
                newWnd.moveTab(tab);
            }
        });
    }
    return subMenus;
};

export const initTabMenu = (tab: Tab) => {
    window.siyuan.menus.menu.remove();
    closeMenu(tab);
    window.siyuan.menus.menu.append(new MenuItem({
        label: window.siyuan.languages.split,
        submenu: splitSubMenu(tab)
    }).element);
    const model = tab.model;
    let rootId;
    if ((model && model instanceof Editor)) {
        rootId = model.editor.protyle.block.rootID;
    } else {
        const initData = tab.headElement.getAttribute("data-initdata");
        if (initData) {
            const initDataObj = JSON.parse(initData);
            rootId = initDataObj.rootId || initDataObj.blockId;
        }
    }
    if (rootId) {
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.copy,
            icon: "iconCopy",
            type: "submenu",
            submenu: copySubMenu(rootId, false)
        }).element);
    }
    if (tab.headElement.classList.contains("item--pin")) {
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.unpin,
            icon: "iconPin",
            click: () => {
                tab.unpin();
            }
        }).element);
    } else {
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.pin,
            icon: "iconPin",
            click: () => {
                tab.pin();
            }
        }).element);
    }
    return window.siyuan.menus.menu;
};
