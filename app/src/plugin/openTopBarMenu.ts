import type {App} from "../index";
import {Menu} from "./Menu";
import {setStorageVal} from "../protyle/util/compatibility";
import {isBazaarAvailable} from "../util/bazaarAvailability";
/// #if !MOBILE
import {setTabPosition} from "../layout/tabUtil";
/// #endif
import {Constants} from "../constants";
import {hasPluginSetting} from "./index";
import {isMobile} from "../util/functions";
import {isEntryVisible, setEntryVisibilityValue} from "../config/entryVisibility/runtime";
import {TOP_BAR_ROOT_PATH} from "../config/entryVisibility/catalog";

export const openTopBarMenu = (app: App, target?: Element) => {
    const menu = new Menu(Constants.MENU_BAR_PLUGIN);
    const manageElement = menu.addItem({
        id: "manage",
        icon: "iconSettings",
        label: window.siyuan.languages.manage,
        ignore: !isBazaarAvailable() || window.siyuan.config.readonly,
        click() {
            void import("../config").then(({openSetting}) => openSetting(app, "bazaar"));
        }
    });
    const manageSeparatorElement = menu.addSeparator({
        id: "separator_1",
        ignore: !isBazaarAvailable() || window.siyuan.config.readonly,
    });
    let hasPlugin = false;
    app.plugins.forEach((plugin) => {
        const hasSetting = hasPluginSetting(plugin);
        let hasTopBar = false;
        for (let i = 0; i < plugin.topBarIcons.length; i++) {
            const item = plugin.topBarIcons[i];
            if (!document.contains(item)) {
                plugin.topBarIcons.splice(i, 1);
                i--;
                continue;
            }
            const entryKey = item.getAttribute("data-topbar-entry");
            const entryPath = entryKey ? `${TOP_BAR_ROOT_PATH}.${entryKey}` : "";
            const hasUnpin = isMobile() || !entryPath
                ? window.siyuan.storage[Constants.LOCAL_PLUGINTOPUNPIN].includes(item.id)
                : !isEntryVisible(entryPath);
            const submenu: IMenu[] = [{
                id: hasUnpin ? "pin" : "unpin",
                icon: hasUnpin ? "iconPin" : "iconUnpin",
                label: hasUnpin ? window.siyuan.languages.pin : window.siyuan.languages.unpin,
                disabled: !isMobile() && window.siyuan.config.readonly,
                click() {
                    if (!isMobile() && entryPath) {
                        setEntryVisibilityValue(entryPath, hasUnpin);
                    } else {
                        if (hasUnpin) {
                            window.siyuan.storage[Constants.LOCAL_PLUGINTOPUNPIN].splice(
                                window.siyuan.storage[Constants.LOCAL_PLUGINTOPUNPIN].indexOf(item.id), 1);
                            item.classList.remove("fn__none");
                        } else {
                            window.siyuan.storage[Constants.LOCAL_PLUGINTOPUNPIN].push(item.id);
                            window.siyuan.storage[Constants.LOCAL_PLUGINTOPUNPIN] = Array.from(new Set(
                                window.siyuan.storage[Constants.LOCAL_PLUGINTOPUNPIN]));
                            item.classList.add("fn__none");
                        }
                        setStorageVal(Constants.LOCAL_PLUGINTOPUNPIN,
                            window.siyuan.storage[Constants.LOCAL_PLUGINTOPUNPIN]);
                    }
                    /// #if !MOBILE
                    setTabPosition(true);
                    /// #endif
                }
            }];
            if (hasSetting) {
                submenu.push({
                    id: "config",
                    icon: "iconSettings",
                    label: window.siyuan.languages.config,
                    click() {
                        plugin.openSetting();
                    },
                });
            }
            const itemLabel = target ? item.getAttribute("aria-label") : item.textContent.trim();
            if (!target) {
                submenu.push({
                    id: "play",
                    icon: "iconPlay",
                    label: itemLabel,
                    click() {
                        item.dispatchEvent(new CustomEvent("click"));
                        return true;
                    },
                });
            }
            const menuOption: IMenu = {
                id: item.id,
                icon: "iconInfo",
                label: itemLabel,
                click: target ? () => {
                    item.dispatchEvent(new CustomEvent("click"));
                } : undefined,
                type: "submenu",
                submenu
            };
            const customIconElement = item.querySelector(":scope > .b3-menu__icon--custom");
            const iconElement = (customIconElement || item.querySelector("svg")).cloneNode(true) as HTMLElement;
            iconElement.classList.add("b3-menu__icon");
            menuOption.iconHTML = iconElement.outerHTML;
            menu.addItem(menuOption);
            hasPlugin = true;
            hasTopBar = true;
        }
        if (!hasTopBar && hasSetting) {
            hasPlugin = true;
            menu.addItem({
                id: plugin.name,
                icon: "iconSettings",
                label: plugin.displayName,
                click() {
                    plugin.openSetting();
                }
            });
        }
    });
    if (!hasPlugin) {
        manageSeparatorElement?.remove();
        if (!manageElement && !target) {
            menu.addItem({
                id: "emptyContent",
                iconHTML: "",
                type: "readonly",
                label: window.siyuan.languages.emptyContent,
            });
        }
    }
    if (target) {
        let rect = target.getBoundingClientRect();
        if (rect.width === 0) {
            rect = document.querySelector("#barMore").getBoundingClientRect();
        }
        menu.open({x: rect.right, y: rect.bottom, isLeft: true});
    } else {
        menu.fullscreen();
    }
};
