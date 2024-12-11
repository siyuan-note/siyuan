import {Constants} from "../constants";
import {Menu} from "../plugin/Menu";
import {setStorageVal} from "../protyle/util/compatibility";
import {escapeHtml} from "../util/escape";
import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {Protyle} from "../protyle";
import {assetInputEvent} from "./assets";
/// #if MOBILE
import {updateSearchResult} from "../mobile/menu/search";
/// #else
import {inputEvent} from "./util";
/// #endif

export const toggleReplaceHistory = (replaceInputElement: HTMLInputElement) => {
    const list = window.siyuan.storage[Constants.LOCAL_SEARCHKEYS];
    if (!list.replaceKeys || list.replaceKeys.length === 0) {
        return;
    }
    const menu = new Menu("search-replace-history");
    if (menu.isOpen) {
        return;
    }
    menu.element.classList.add("b3-menu--list");
    menu.addItem({
        iconHTML: "",
        label: window.siyuan.languages.clearHistory,
        click() {
            window.siyuan.storage[Constants.LOCAL_SEARCHKEYS].replaceKeys = [];
            setStorageVal(Constants.LOCAL_SEARCHKEYS, window.siyuan.storage[Constants.LOCAL_SEARCHKEYS]);
        }
    });
    const separatorElement = menu.addSeparator(1);
    let current = true;
    list.replaceKeys.forEach((s: string) => {
        if (s !== replaceInputElement.value && s) {
            const menuItem = menu.addItem({
                iconHTML: "",
                label: escapeHtml(s),
                action: "iconCloseRound",
                bind(element) {
                    element.addEventListener("click", (itemEvent) => {
                        if (hasClosestByClassName(itemEvent.target as Element, "b3-menu__action")) {
                            list.replaceKeys.find((item: string, index: number) => {
                                if (item === s) {
                                    list.replaceKeys.splice(index, 1);
                                    return true;
                                }
                            });
                            window.siyuan.storage[Constants.LOCAL_SEARCHKEYS].replaceKeys = list.replaceKeys;
                            setStorageVal(Constants.LOCAL_SEARCHKEYS, window.siyuan.storage[Constants.LOCAL_SEARCHKEYS]);
                            if (element.previousElementSibling?.classList.contains("b3-menu__separator") && !element.nextElementSibling) {
                                window.siyuan.menus.menu.remove();
                            } else {
                                element.remove();
                            }
                        } else {
                            replaceInputElement.value = element.textContent;
                            window.siyuan.menus.menu.remove();
                        }
                        itemEvent.preventDefault();
                        itemEvent.stopPropagation();
                    });
                }
            });
            if (current) {
                menuItem.classList.add("b3-menu__item--current");
            }
            current = false;
        }
    });
    if (current) {
        separatorElement.remove();
    }
    const rect = replaceInputElement.previousElementSibling.getBoundingClientRect();
    menu.open({
        x: rect.left,
        y: rect.bottom
    });
};

export const toggleSearchHistory = (searchElement: Element, config: Config.IUILayoutTabSearchConfig, edit: Protyle) => {
    const list = window.siyuan.storage[Constants.LOCAL_SEARCHKEYS];
    if (!list.keys || list.keys.length === 0) {
        return;
    }
    const menu = new Menu("search-history");
    if (menu.isOpen) {
        return;
    }
    menu.element.classList.add("b3-menu--list");
    menu.addItem({
        iconHTML: "",
        label: window.siyuan.languages.clearHistory,
        click() {
            window.siyuan.storage[Constants.LOCAL_SEARCHKEYS].keys = [];
            setStorageVal(Constants.LOCAL_SEARCHKEYS, window.siyuan.storage[Constants.LOCAL_SEARCHKEYS]);
        }
    });
    const separatorElement = menu.addSeparator(1);
    let current = true;
    const searchInputElement = searchElement.querySelector("#searchInput, #toolbarSearch") as HTMLInputElement;
    list.keys.forEach((s: string) => {
        if (s !== searchInputElement.value && s) {
            const menuItem = menu.addItem({
                iconHTML: "",
                label: escapeHtml(s),
                action: "iconCloseRound",
                bind(element) {
                    element.addEventListener("click", (itemEvent) => {
                        if (hasClosestByClassName(itemEvent.target as Element, "b3-menu__action")) {
                            list.keys.find((item: string, index: number) => {
                                if (item === s) {
                                    list.keys.splice(index, 1);
                                    return true;
                                }
                            });
                            window.siyuan.storage[Constants.LOCAL_SEARCHKEYS].keys = list.keys;
                            setStorageVal(Constants.LOCAL_SEARCHKEYS, window.siyuan.storage[Constants.LOCAL_SEARCHKEYS]);
                            if (element.previousElementSibling?.classList.contains("b3-menu__separator") && !element.nextElementSibling) {
                                window.siyuan.menus.menu.remove();
                            } else {
                                element.remove();
                            }
                        } else {
                            searchInputElement.value = element.textContent;
                            config.page = 1;
                            /// #if MOBILE
                            updateSearchResult(config, searchElement, true);
                            /// #else
                            inputEvent(searchElement, config, edit, true);
                            /// #endif
                            window.siyuan.menus.menu.remove();
                        }
                        itemEvent.preventDefault();
                        itemEvent.stopPropagation();
                    });
                }
            });
            if (current) {
                menuItem.classList.add("b3-menu__item--current");
            }
            current = false;
        }
    });
    if (current) {
        separatorElement.remove();
    }
    const rect = searchInputElement.previousElementSibling.getBoundingClientRect();
    menu.open({
        x: rect.left,
        y: rect.bottom
    });
};

export const toggleAssetHistory = (assetElement: Element) => {
    const keys = window.siyuan.storage[Constants.LOCAL_SEARCHASSET].keys;
    if (!keys || keys.length === 0) {
        return;
    }
    const menu = new Menu("search-asset-history");
    if (menu.isOpen) {
        return;
    }
    menu.element.classList.add("b3-menu--list");
    menu.addItem({
        iconHTML: "",
        label: window.siyuan.languages.clearHistory,
        click() {
            window.siyuan.storage[Constants.LOCAL_SEARCHASSET].keys = [];
            setStorageVal(Constants.LOCAL_SEARCHASSET, window.siyuan.storage[Constants.LOCAL_SEARCHASSET]);
        }
    });
    const separatorElement = menu.addSeparator(1);
    let current = true;
    const assetInputElement = assetElement.querySelector("#searchAssetInput") as HTMLInputElement;
    keys.forEach((s: string) => {
        if (s !== assetInputElement.value && s) {
            const menuItem = menu.addItem({
                iconHTML: "",
                label: escapeHtml(s),
                action: "iconCloseRound",
                bind(element) {
                    element.addEventListener("click", (itemEvent) => {
                        if (hasClosestByClassName(itemEvent.target as Element, "b3-menu__action")) {
                            keys.find((item: string, index: number) => {
                                if (item === s) {
                                    keys.splice(index, 1);
                                    return true;
                                }
                            });
                            window.siyuan.storage[Constants.LOCAL_SEARCHASSET].keys = keys;
                            setStorageVal(Constants.LOCAL_SEARCHASSET, window.siyuan.storage[Constants.LOCAL_SEARCHASSET]);
                            if (element.previousElementSibling?.classList.contains("b3-menu__separator") && !element.nextElementSibling) {
                                window.siyuan.menus.menu.remove();
                            } else {
                                element.remove();
                            }
                        } else {
                            assetInputElement.value = element.textContent;
                            assetInputEvent(assetElement);
                            window.siyuan.menus.menu.remove();
                        }
                        itemEvent.preventDefault();
                        itemEvent.stopPropagation();
                    });
                }
            });
            if (current) {
                menuItem.classList.add("b3-menu__item--current");
            }
            current = false;
        }
    });
    if (current) {
        separatorElement.remove();
    }
    const rect = assetInputElement.previousElementSibling.getBoundingClientRect();
    menu.open({
        x: rect.left,
        y: rect.bottom
    });
};
