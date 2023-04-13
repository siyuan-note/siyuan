import {hasClosestByClassName} from "../util/hasClosest";
import {openAttr, openFileAttr} from "../../menus/commonMenuItem";
/// #if !MOBILE
import {openGlobalSearch} from "../../search/util";
/// #endif
import {isMobile} from "../../util/functions";

export const commonClick = (event: MouseEvent & {
    target: HTMLElement
}, protyle: IProtyle, data?:IObject) => {
    const isM = isMobile();
    const attrBookmarkElement = hasClosestByClassName(event.target, "protyle-attr--bookmark");
    if (attrBookmarkElement) {
        if (!isM && (event.ctrlKey || event.metaKey)) {
            /// #if !MOBILE
            openGlobalSearch(attrBookmarkElement.textContent.trim(), true);
            /// #endif
        } else {
            if (data) {
                openFileAttr(data, protyle.block.rootID, "bookmark");
            } else {
                openAttr(attrBookmarkElement.parentElement.parentElement, protyle, "bookmark");
            }
        }
        event.stopPropagation();
        return true;
    }

    const attrNameElement = hasClosestByClassName(event.target, "protyle-attr--name");
    if (attrNameElement) {
        if (!isM && (event.ctrlKey || event.metaKey)) {
            /// #if !MOBILE
            openGlobalSearch(attrNameElement.textContent.trim(), true);
            /// #endif
        } else {
            if (data ) {
                openFileAttr(data, protyle.block.rootID, "name");
            } else {
                openAttr(attrNameElement.parentElement.parentElement, protyle, "name");
            }
        }
        event.stopPropagation();
        return true;
    }

    const attrAliasElement = hasClosestByClassName(event.target, "protyle-attr--alias");
    if (attrAliasElement) {
        if (!isM && (event.ctrlKey || event.metaKey)) {
            /// #if !MOBILE
            openGlobalSearch(attrAliasElement.textContent.trim(), true);
            /// #endif
        } else {
            if (data) {
                openFileAttr(data, protyle.block.rootID, "alias");
            } else {
                openAttr(attrAliasElement.parentElement.parentElement, protyle, "alias");
            }
        }
        event.stopPropagation();
        return true;
    }

    const attrMemoElement = hasClosestByClassName(event.target, "protyle-attr--memo");
    if (attrMemoElement) {
        if (!isM && (event.ctrlKey || event.metaKey)) {
            /// #if !MOBILE
            openGlobalSearch(attrMemoElement.getAttribute("aria-label").trim(), true);
            /// #endif
        } else {
            if (data) {
                openFileAttr(data, protyle.block.rootID, "memo");
            } else {
                openAttr(attrMemoElement.parentElement.parentElement, protyle, "memo");
            }
        }
        event.stopPropagation();
        return true;
    }
};
