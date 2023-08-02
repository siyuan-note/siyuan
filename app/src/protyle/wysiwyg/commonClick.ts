import {hasClosestByClassName} from "../util/hasClosest";
import {openAttr, openFileAttr} from "../../menus/commonMenuItem";
/// #if !MOBILE
import {openGlobalSearch} from "../../search/util";
/// #endif
import {isMobile} from "../../util/functions";

export const commonClick = (event: MouseEvent & {
    target: HTMLElement
}, protyle: IProtyle, data?: IObject) => {
    const isM = isMobile();
    const attrBookmarkElement = hasClosestByClassName(event.target, "protyle-attr--bookmark");
    if (attrBookmarkElement) {
        if (!isM && (event.ctrlKey || event.metaKey)) {
            /// #if !MOBILE
            openGlobalSearch(protyle.app, attrBookmarkElement.textContent.trim(), true);
            /// #endif
        } else {
            if (data) {
                openFileAttr(data, "bookmark");
            } else {
                openAttr(attrBookmarkElement.parentElement.parentElement, "bookmark");
            }
        }
        event.stopPropagation();
        return true;
    }

    const attrNameElement = hasClosestByClassName(event.target, "protyle-attr--name");
    if (attrNameElement) {
        if (!isM && (event.ctrlKey || event.metaKey)) {
            /// #if !MOBILE
            openGlobalSearch(protyle.app, attrNameElement.textContent.trim(), true);
            /// #endif
        } else {
            if (data) {
                openFileAttr(data, "name");
            } else {
                openAttr(attrNameElement.parentElement.parentElement, "name");
            }
        }
        event.stopPropagation();
        return true;
    }

    const attrAliasElement = hasClosestByClassName(event.target, "protyle-attr--alias");
    if (attrAliasElement) {
        if (!isM && (event.ctrlKey || event.metaKey)) {
            /// #if !MOBILE
            openGlobalSearch(protyle.app, attrAliasElement.textContent.trim(), true);
            /// #endif
        } else {
            if (data) {
                openFileAttr(data, "alias");
            } else {
                openAttr(attrAliasElement.parentElement.parentElement, "alias");
            }
        }
        event.stopPropagation();
        return true;
    }

    const attrMemoElement = hasClosestByClassName(event.target, "protyle-attr--memo");
    if (attrMemoElement) {
        if (!isM && (event.ctrlKey || event.metaKey)) {
            /// #if !MOBILE
            openGlobalSearch(protyle.app, attrMemoElement.getAttribute("aria-label").trim(), true);
            /// #endif
        } else {
            if (data) {
                openFileAttr(data, "memo");
            } else {
                openAttr(attrMemoElement.parentElement.parentElement, "memo");
            }
        }
        event.stopPropagation();
        return true;
    }
};
