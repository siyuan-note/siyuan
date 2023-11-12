import {hasClosestByClassName} from "../util/hasClosest";
import {openAttr, openFileAttr} from "../../menus/commonMenuItem";
/// #if !MOBILE
import {openGlobalSearch} from "../../search/util";
/// #endif
import {isMobile} from "../../util/functions";
import {isOnlyMeta} from "../util/compatibility";

export const commonClick = (event: MouseEvent & {
    target: HTMLElement
}, protyle: IProtyle, data?: IObject) => {
    const isM = isMobile();
    const attrBookmarkElement = hasClosestByClassName(event.target, "protyle-attr--bookmark");
    if (attrBookmarkElement) {
        if (!isM && isOnlyMeta(event)) {
            /// #if !MOBILE
            openGlobalSearch(protyle.app, attrBookmarkElement.textContent.trim(), true);
            /// #endif
        } else {
            if (data) {
                openFileAttr(data, "bookmark", protyle);
            } else {
                openAttr(attrBookmarkElement.parentElement.parentElement, "bookmark", protyle);
            }
        }
        event.stopPropagation();
        return true;
    }

    const attrNameElement = hasClosestByClassName(event.target, "protyle-attr--name");
    if (attrNameElement) {
        if (!isM && isOnlyMeta(event)) {
            /// #if !MOBILE
            openGlobalSearch(protyle.app, attrNameElement.textContent.trim(), true);
            /// #endif
        } else {
            if (data) {
                openFileAttr(data, "name", protyle);
            } else {
                openAttr(attrNameElement.parentElement.parentElement, "name", protyle);
            }
        }
        event.stopPropagation();
        return true;
    }

    const avElement = hasClosestByClassName(event.target, "protyle-attr--av");
    if (avElement) {
        if (data) {
            openFileAttr(data, "av", protyle);
        } else {
            openAttr(avElement.parentElement.parentElement, "av", protyle);
        }
        event.stopPropagation();
        return true;
    }

    const attrAliasElement = hasClosestByClassName(event.target, "protyle-attr--alias");
    if (attrAliasElement) {
        if (!isM && isOnlyMeta(event)) {
            /// #if !MOBILE
            openGlobalSearch(protyle.app, attrAliasElement.textContent.trim(), true);
            /// #endif
        } else {
            if (data) {
                openFileAttr(data, "alias", protyle);
            } else {
                openAttr(attrAliasElement.parentElement.parentElement, "alias", protyle);
            }
        }
        event.stopPropagation();
        return true;
    }

    const attrMemoElement = hasClosestByClassName(event.target, "protyle-attr--memo");
    if (attrMemoElement) {
        if (!isM && isOnlyMeta(event)) {
            /// #if !MOBILE
            openGlobalSearch(protyle.app, attrMemoElement.getAttribute("aria-label").trim(), true);
            /// #endif
        } else {
            if (data) {
                openFileAttr(data, "memo", protyle);
            } else {
                openAttr(attrMemoElement.parentElement.parentElement, "memo", protyle);
            }
        }
        event.stopPropagation();
        return true;
    }
};
