import {buildEntryVisibilityMenuItems as buildMenuItems,
    buildEntryVisibilityToggleItem as buildToggleItem,
    IEntryVisibilityMenuRuntime,
} from "./menuItems";
import {getDockEntryKey, TOP_BAR_ROOT_PATH} from "./catalog";
import {getEntryOrder, isEntryVisible, setEntryVisibilityValue} from "./runtime";

const findEntryElement = (path: string) => {
    const separatorIndex = path.indexOf(".");
    const scope = path.substring(0, separatorIndex);
    const key = path.substring(separatorIndex + 1);
    if (scope === TOP_BAR_ROOT_PATH) {
        return Array.from(document.querySelectorAll<HTMLElement>("[data-topbar-entry]"))
            .find((item) => item.getAttribute("data-topbar-entry") === key);
    }
    if (scope === "dock") {
        return Array.from(document.querySelectorAll<HTMLElement>(".dock__item[data-type]"))
            .find((item) => getDockEntryKey(item) === key);
    }
    if (scope === "statusBar") {
        return Array.from(document.querySelectorAll<HTMLElement>("#status [data-statusbar-entry]"))
            .find((item) => item.getAttribute("data-statusbar-entry") === key);
    }
    return undefined;
};

const getEntryIcon = (path: string): Pick<IMenu, "icon" | "iconHTML"> => {
    if (path === `${TOP_BAR_ROOT_PATH}.toolbarVIP` || path === `${TOP_BAR_ROOT_PATH}.toolbarTitle`) {
        return {icon: "iconAccount"};
    }
    const element = findEntryElement(path);
    if (!element) {
        return {};
    }
    const customElement = element.querySelector(":scope > .b3-menu__icon--custom");
    if (customElement) {
        const iconElement = customElement.cloneNode(true) as HTMLElement;
        iconElement.classList.add("b3-menu__icon");
        return {iconHTML: iconElement.outerHTML};
    }
    const href = element.querySelector("use")?.getAttribute("xlink:href");
    if (href) {
        return {icon: href.substring(1)};
    }
    const svgElement = element.querySelector("svg");
    if (svgElement) {
        const iconElement = svgElement.cloneNode(true) as HTMLElement;
        iconElement.classList.add("b3-menu__icon");
        return {iconHTML: iconElement.outerHTML};
    }
    const childElement = element.firstElementChild;
    if (childElement) {
        const iconElement = childElement.cloneNode(true) as HTMLElement;
        iconElement.classList.add("b3-menu__icon");
        return {iconHTML: iconElement.outerHTML};
    }
    return {};
};

const getRuntime = (): IEntryVisibilityMenuRuntime => ({
    getEntryOrder,
    isEntryVisible,
    setEntryVisibilityValue,
    getEntryIcon,
    readonly: window.siyuan.config.readonly,
    languages: window.siyuan.languages,
});

export const buildEntryVisibilityMenuItems = (parentPath: string) =>
    buildMenuItems(parentPath, getRuntime());

export const buildDockEntryVisibilityMenuItems = (container?: Element) => {
    if (!container) {
        return buildMenuItems("dock", getRuntime());
    }
    const keys = new Set<string>();
    container.querySelectorAll(".dock__item[data-type]").forEach((item) => {
        const key = getDockEntryKey(item);
        if (key) {
            keys.add(key);
        }
    });
    return buildMenuItems("dock", getRuntime(), (key) => keys.has(key));
};

export const buildEntryVisibilityToggleItem = (path: string) =>
    buildToggleItem(path, getRuntime());
