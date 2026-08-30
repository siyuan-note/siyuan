import {Constants} from "../constants";
import {escapeAttr} from "../util/escape";
import {unicode2Emoji} from "./iconValue";

export type TFileTreeDefaultIcon = "notebook" | "folder" | "file";

const FILE_TREE_SVG_ICONS: Record<TFileTreeDefaultIcon, string> = {
    notebook: "iconNotebook",
    folder: "iconFileText",
    file: "iconFile",
};

const getDefaultEmoji = (defaultIcon: TFileTreeDefaultIcon) => {
    const images = window.siyuan.storage[Constants.LOCAL_IMAGES];
    if (defaultIcon === "notebook") {
        return images.note;
    }
    return images[defaultIcon];
};

const isDefaultIcon = (value: string | undefined): value is TFileTreeDefaultIcon =>
    value === "notebook" || value === "folder" || value === "file";

const getDirectIconElement = (liElement: HTMLElement) => Array.from(liElement.children).find((item) =>
    item.classList.contains("b3-list-item__icon") || item.classList.contains("b3-list-item__graphic")) as HTMLElement | undefined;

export const getFileTreeDefaultIconAttr = (icon: string, defaultIcon: TFileTreeDefaultIcon, disabled = false) =>
    !icon && !disabled ? ` data-default-icon="${defaultIcon}"` : "";

export const getFileTreeIconHTML = (icon: string, defaultIcon: TFileTreeDefaultIcon, className = "",
                                    needSpan = false, useSVGDefaultIcon =
                                        window.siyuan.config.fileTree.useSVGDefaultIcon === true) => {
    if (icon) {
        return unicode2Emoji(icon, className, needSpan);
    }

    if (!useSVGDefaultIcon) {
        return unicode2Emoji(getDefaultEmoji(defaultIcon), className, needSpan);
    }

    const classAttr = needSpan ? ` class="${escapeAttr(className)}"` : "";
    return `<svg${classAttr}><use xlink:href="#${FILE_TREE_SVG_ICONS[defaultIcon]}"></use></svg>`;
};

export const getDocumentIconHTML = (icon: string, className = "", useSVGDefaultIcon =
    window.siyuan.config.fileTree.useSVGDefaultIcon === true) => {
    if (!icon && useSVGDefaultIcon) {
        return `<svg class="${escapeAttr(className)}"><use xlink:href="#${FILE_TREE_SVG_ICONS.file}"></use></svg>`;
    }
    return getFileTreeIconHTML(icon, "file", className, true, useSVGDefaultIcon);
};

const resolveDefaultIcon = (liElement: HTMLElement): TFileTreeDefaultIcon => {
    if (liElement.getAttribute("data-type") === "navigation-root" ||
        liElement.dataset.defaultIcon === "notebook") {
        return "notebook";
    }
    const toggleElement = Array.from(liElement.children).find((item) =>
        item.classList.contains("b3-list-item__toggle"));
    return toggleElement?.classList.contains("fn__hidden") ? "file" : "folder";
};

export const updateFileTreeItemIcon = (liElement: HTMLElement, icon: string,
                                       defaultIcon = resolveDefaultIcon(liElement)) => {
    const iconElement = getDirectIconElement(liElement);
    if (!iconElement || !iconElement.classList.contains("b3-list-item__icon")) {
        return;
    }
    if (icon) {
        delete liElement.dataset.defaultIcon;
        iconElement.innerHTML = unicode2Emoji(icon);
        return;
    }
    liElement.dataset.defaultIcon = defaultIcon;
    iconElement.innerHTML = getFileTreeIconHTML("", defaultIcon);
};

export const syncFileTreeItemDefaultIcon = (liElement: HTMLElement,
                                            defaultIcon = resolveDefaultIcon(liElement)) => {
    if (!liElement.hasAttribute("data-default-icon")) {
        return;
    }
    updateFileTreeItemIcon(liElement, "", defaultIcon);
};

export const refreshDefaultFileTreeIcons = (root: ParentNode = document) => {
    root.querySelectorAll<HTMLElement>("[data-default-icon]").forEach((liElement) => {
        const defaultIcon = liElement.dataset.defaultIcon;
        if (!isDefaultIcon(defaultIcon)) {
            return;
        }
        const iconElement = getDirectIconElement(liElement);
        if (!iconElement) {
            return;
        }
        if (iconElement.classList.contains("b3-list-item__icon")) {
            iconElement.innerHTML = getFileTreeIconHTML("", defaultIcon);
        } else {
            iconElement.outerHTML = getFileTreeIconHTML("", defaultIcon, "b3-list-item__graphic", true);
        }
    });
};
