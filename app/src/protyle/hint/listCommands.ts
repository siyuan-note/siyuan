import {hasClosestBlock} from "../util/hasClosest";
import {getListContext, getListConversionType, TListSubtype} from "../wysiwyg/listContext";
import {isProtyleListItemFragment} from "../runtimeCapabilities";
import {Constants} from "../../constants";

export const LIST_COMMAND_PREFIX = "convert-current-list:";

export const getSlashListContext = (protyle: IProtyle, range = protyle.toolbar.range) => {
    if (!range || protyle.disabled || protyle.lite || window.siyuan.config.readonly || window.siyuan.isPublish ||
        isProtyleListItemFragment(protyle)) {
        return;
    }
    const node = hasClosestBlock(range.startContainer) as HTMLElement;
    if (!node || !node.isConnected || hasClosestBlock(range.endContainer) !== node ||
        node.closest(".protyle-wysiwyg") !== protyle.wysiwyg.element ||
        node.closest(".protyle-wysiwyg__embed, td, th")) {
        return;
    }
    const context = getListContext(node, protyle.wysiwyg.element);
    if (context?.listElement &&
        context.listElement.getAttribute(Constants.CUSTOM_SY_LIST_MINDMAP) !== "1" &&
        context.listElement.contains(range.endContainer)) {
        return context;
    }
};

export const getListCommandType = (subtype: TListSubtype, value: string) => {
    const target = value.substring(LIST_COMMAND_PREFIX.length);
    if (!value.startsWith(LIST_COMMAND_PREFIX)) {
        return;
    }
    if (target === "remove") {
        return "CancelList";
    }
    if (target === "u" || target === "o" || target === "t") {
        return getListConversionType(subtype, target);
    }
};

export const getListCommandLabel = (type: "u" | "o" | "t" | "remove") => {
    const lang = window.siyuan.languages;
    return type === "remove" ? lang.cancelCurrentList :
        lang.convertCurrentList.replace("${name}", lang[type === "u" ? "list" : type === "o" ? "ordered-list" : "check"]);
};

export const getListInsertLabel = (protyle: IProtyle, name: string) => {
    const node = protyle.toolbar.range && hasClosestBlock(protyle.toolbar.range.startContainer);
    const inList = node && getListContext(node as HTMLElement, protyle.wysiwyg.element);
    return window.siyuan.languages[inList ? "insertChildList" : "createList"].replace("${name}", name);
};
