import {App} from "../index";
import {showMessage} from "../dialog/message";
import {saveScroll} from "../protyle/scroll/saveScroll";
import {writeText} from "../protyle/util/compatibility";
import {hasClosestBlock, hasClosestByAttribute, hasTopClosestByClassName} from "../protyle/util/hasClosest";
import {isNotEditBlock} from "../protyle/wysiwyg/getBlock";
import {removeBlock} from "../protyle/wysiwyg/remove";
import {getCurrentEditor} from "./editor";
import {handleTouchEnd, handleTouchMove, handleTouchStart} from "./util/touch";
import {Menu} from "../plugin/Menu";
import {loadAssets, initAssets, addGA} from "../util/assets";
import {initRightMenu} from "./menu";
import {initFramework} from "./util/initFramework";

export const init = (app: App, isStart: boolean) => {
    initWindowEvent(app);

    loadAssets(window.siyuan.config.appearance);
    initAssets();
    initFramework(app, isStart);
    initRightMenu(app);
    addGA();
};

export const initWindowEvent = (app: App) => {
    // 不能使用 touchstart，否则会被 event.stopImmediatePropagation() 阻塞
    window.addEventListener("click", (event: MouseEvent & { target: HTMLElement }) => {
        if (!window.siyuan.menus.menu.element.contains(event.target) && !hasClosestByAttribute(event.target, "data-menu", "true")) {
            window.siyuan.menus.menu.remove();
        }
        const copyElement = hasTopClosestByClassName(event.target, "protyle-action__copy");
        if (copyElement) {
            let text = copyElement.parentElement.nextElementSibling.textContent.trimEnd();
            text = text.replace(/\u00A0/g, " "); // Replace non-breaking spaces with normal spaces when copying https://github.com/siyuan-note/siyuan/issues/9382
            writeText(text);
            showMessage(window.siyuan.languages.copied, 2000);
            event.preventDefault();
        }
    });
    window.addEventListener("beforeunload", () => {
        saveScroll(window.siyuan.mobile.editor.protyle);
    }, false);
    window.addEventListener("pagehide", () => {
        saveScroll(window.siyuan.mobile.editor.protyle);
    }, false);

    document.addEventListener("touchstart", handleTouchStart, false);
    document.addEventListener("touchmove", handleTouchMove, false);
    document.addEventListener("touchend", (event) => {
        handleTouchEnd(event, app);
    }, false);
    // 移动端删除键 https://github.com/siyuan-note/siyuan/issues/9259
    window.addEventListener("keydown", (event) => {
        if (getSelection().rangeCount > 0) {
            const range = getSelection().getRangeAt(0);
            const editor = getCurrentEditor();
            if (range.toString() === "" &&
                editor && editor.protyle.wysiwyg.element.contains(range.startContainer) &&
                !event.altKey && (event.key === "Backspace" || event.key === "Delete")) {
                const nodeElement = hasClosestBlock(range.startContainer);
                if (nodeElement && isNotEditBlock(nodeElement)) {
                    nodeElement.classList.add("protyle-wysiwyg--select");
                    removeBlock(editor.protyle, nodeElement, range);
                    event.stopPropagation();
                    event.preventDefault();
                    return;
                }
            }
        }
    });
};

export const initPluginMenu = (menus: IMenu[][]) => {
    const menuItems: IMenu[] = [];
    menus.forEach(items => {
        if (Array.isArray(items) && items.length > 0) {
            menuItems.push(...items);
        }
    });
    if (menuItems.length > 0) {
        const pluginElement = document.createElement("div");
        pluginElement.classList.add("b3-menu__item");
        pluginElement.setAttribute("data-menu", "true");
        pluginElement.innerHTML = `<svg class="b3-menu__icon"><use xlink:href="#iconPlugin"></use></svg><span class="b3-menu__label">${window.siyuan.languages.plugin}</span>`;
        pluginElement.addEventListener("click", () => {
            const menu = new Menu();
            menuItems.forEach(item => menu.addItem(item));
            menu.fullscreen();
        });
        document.querySelector("#menuAbout").after(pluginElement);
    }
};
