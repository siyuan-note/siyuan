import {isIPad} from "../../protyle/util/compatibility";
import {hasClosestByAttribute, hasClosestByClassName, hasTopClosestByTag} from "../../protyle/util/hasClosest";
import {initFileMenu, initNavigationMenu} from "../../menus/navigation";
import {fileAnnotationRefMenu, linkMenu, refMenu, tagMenu} from "../../menus/protyle";
import {App} from "../../index";
import {Protyle} from "../../protyle";
import {getCurrentEditor} from "../../mobile/editor";
import {getInstanceById} from "../../layout/util";
import {Tab} from "../../layout/Tab";
import {Editor} from "../../editor";
import {hideTooltip} from "../../dialog/tooltip";

export const globalTouchEnd = (event: TouchEvent, yDiff: number, time: number, app: App) => {
    const target = event.target as HTMLElement;
    const isIPadBoolean = isIPad();
    if (typeof yDiff === "undefined" && new Date().getTime() - time > 900) {
        // ios 长按
        // 文档树
        const fileItemElement = hasClosestByAttribute(target, "data-type", "navigation-root") || hasClosestByAttribute(target, "data-type", "navigation-file");
        if (fileItemElement) {
            if (!window.siyuan.config.readonly && fileItemElement.dataset.type === "navigation-root") {
                const menu = initNavigationMenu(app, fileItemElement);
                if (isIPadBoolean) {
                    const rect = fileItemElement.getBoundingClientRect();
                    menu.popup({x: rect.right - 52, y: rect.bottom, h: rect.height});
                    hideTooltip();
                } else {
                    window.siyuan.menus.menu.fullscreen("bottom");
                }
            } else if (fileItemElement.dataset.type === "navigation-file") {
                const rootElement = hasTopClosestByTag(fileItemElement, "UL");
                if (rootElement) {
                    const menu = initFileMenu(app, rootElement.dataset.url, fileItemElement.dataset.path, fileItemElement);
                    if (isIPadBoolean) {
                        const rect = fileItemElement.getBoundingClientRect();
                        menu.popup({x: rect.right - 52, y: rect.bottom, h: rect.height});
                        hideTooltip();
                    } else {
                        window.siyuan.menus.menu.fullscreen("bottom");
                    }
                }
            }
            return true;
        }
        // 内元素弹出菜单
        if (target.tagName === "SPAN" && !hasClosestByAttribute(target, "data-type", "NodeBlockQueryEmbed")) {
            let editor: Protyle;
            if (isIPadBoolean) {
                const tabContainerElement = hasClosestByClassName(target, "protyle", true);
                if (tabContainerElement) {
                    const tab = getInstanceById(tabContainerElement.dataset.id);
                    if (tab instanceof Tab && tab.model instanceof Editor) {
                        editor = tab.model.editor;
                    }
                }
            } else {
                if (hasClosestByClassName(target, "protyle-wysiwyg", true)) {
                    editor = getCurrentEditor();
                }
            }
            if (!editor) {
                return false;
            }
            const types = (target.getAttribute("data-type") || "").split(" ");
            if (types.includes("inline-memo")) {
                editor.protyle.toolbar.showRender(editor.protyle, target);
            }
            if (editor.protyle.disabled) {
                event.stopImmediatePropagation();
                event.preventDefault();
                return true;
            }
            if (types.includes("block-ref")) {
                refMenu(editor.protyle, target);
                return true;
            }
            if (types.includes("file-annotation-ref")) {
                fileAnnotationRefMenu(editor.protyle, target);
                return true;
            }
            if (types.includes("tag")) {
                tagMenu(editor.protyle, target);
                return true;
            }
            if (types.includes("a")) {
                linkMenu(editor.protyle, target);
                return true;
            }
        }
    }
    return false;
};
