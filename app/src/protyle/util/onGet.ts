import {Constants} from "../../constants";
import {hideElements} from "../ui/hideElements";
import {fetchPost} from "../../util/fetch";
import {processRender} from "./processCode";
import {highlightRender} from "../render/highlightRender";
import {blockRender} from "../render/blockRender";
import {highlightById} from "../../util/highlightById";
/// #if !MOBILE
import {pushBack} from "../../util/backForward";
/// #endif
import {focusBlock, focusByOffset} from "./selection";
import {hasClosestByAttribute, hasClosestByClassName} from "./hasClosest";
import {preventScroll} from "../scroll/preventScroll";
import {removeLoading} from "../ui/initUI";
import {isMobile} from "../../util/functions";
import {foldPassiveType} from "../wysiwyg/renderBacklink";
import {showMessage} from "../../dialog/message";
import {avRender} from "../render/av/render";
import {hideTooltip} from "../../dialog/tooltip";

export const onGet = (options: {
    data: IWebSocketData,
    protyle: IProtyle,
    action?: string[],
    scrollAttr?: IScrollAttr
    afterCB?: () => void
}) => {
    if (!options.action) {
        options.action = [];
    }
    options.protyle.wysiwyg.element.removeAttribute("data-top");
    if (options.data.code === 1) {
        // 其他报错
        if (options.protyle.model) {
            options.protyle.model.parent.parent.removeTab(options.protyle.model.parent.id, false, false);
        } else {
            options.protyle.element.innerHTML = `<div class="ft__smaller ft__secondary b3-form__space--small" contenteditable="false">${window.siyuan.languages.refExpired}</div>`;
        }
        return;
    }
    if (options.data.code === 3) {
        // block not found
        return;
    }
    options.protyle.notebookId = options.data.data.box;
    options.protyle.path = options.data.data.path;

    if (options.data.data.eof && !options.scrollAttr) {
        if (options.action.includes(Constants.CB_GET_BEFORE)) {
            options.protyle.wysiwyg.element.firstElementChild.setAttribute("data-eof", "1");
        } else {
            options.protyle.wysiwyg.element.lastElementChild.setAttribute("data-eof", "2");
        }
        if (options.data.data.mode !== 4) {
            return;
        }
    }
    hideElements(["gutter"], options.protyle);
    options.protyle.block.parentID = options.data.data.parentID;
    options.protyle.block.parent2ID = options.data.data.parent2ID;
    options.protyle.block.rootID = options.data.data.rootID;
    options.protyle.block.showAll = false;
    options.protyle.block.mode = options.data.data.mode;
    options.protyle.block.blockCount = options.data.data.blockCount;
    options.protyle.block.scroll = options.data.data.scroll;
    options.protyle.block.action = options.action;
    if (!options.action.includes(Constants.CB_GET_UNCHANGEID)) {
        options.protyle.block.id = options.data.data.id;    // 非缩放情况时不一定是 rootID（搜索打开页签）；缩放时必为缩放 id，否则需查看代码
        options.protyle.scroll.lastScrollTop = 0;
        options.protyle.contentElement.scrollTop = 0;
        options.protyle.wysiwyg.element.setAttribute("data-doc-type", options.data.data.type);
    }

    // 防止动态加载加载过多的内容
    if (options.action.includes(Constants.CB_GET_APPEND) || options.action.includes(Constants.CB_GET_BEFORE) || options.action.includes(Constants.CB_GET_HTML)) {
        setHTML({
            content: options.data.data.content,
            expand: options.data.data.isBacklinkExpand,
            action: options.action,
            scrollAttr: options.scrollAttr,
            isSyncing: options.data.data.isSyncing,
            afterCB: options.afterCB,
        }, options.protyle);
        removeLoading(options.protyle);
        return;
    }

    fetchPost("/api/block/getDocInfo", {
        id: options.protyle.block.rootID
    }, (response) => {
        if (options.protyle.options.render.title) {
            // 页签没有打开
            options.protyle.title.render(options.protyle, response);
        } else {
            if (options.protyle.options.render.background) {
                options.protyle.background.render(response.data.ial, options.protyle.block.rootID);
            }
            options.protyle.wysiwyg.renderCustom(response.data.ial);
        }

        setHTML({
            content: options.data.data.content,
            expand: options.data.data.isBacklinkExpand,
            action: options.action,
            scrollAttr: options.scrollAttr,
            isSyncing: options.data.data.isSyncing,
            afterCB: options.afterCB,
        }, options.protyle);
        removeLoading(options.protyle);
    });
};

const setHTML = (options: {
    content: string,
    action?: string[],
    isSyncing: boolean,
    expand: boolean,
    scrollAttr?: IScrollAttr
    afterCB?: () => void
}, protyle: IProtyle) => {
    if (protyle.contentElement.classList.contains("fn__none") && protyle.wysiwyg.element.innerHTML !== "") {
        return;
    }
    protyle.block.showAll = options.action.includes(Constants.CB_GET_ALL);
    const REMOVED_OVER_HEIGHT = protyle.contentElement.clientHeight * 8;
    if (options.action.includes(Constants.CB_GET_APPEND)) {
        // 动态加载移除
        if (!protyle.wysiwyg.element.querySelector(".protyle-wysiwyg--select") && !protyle.scroll.keepLazyLoad && protyle.contentElement.scrollHeight > REMOVED_OVER_HEIGHT) {
            let removeElement = protyle.wysiwyg.element.firstElementChild as HTMLElement;
            const removeElements = [];
            while (protyle.wysiwyg.element.childElementCount > 2 && removeElements && !protyle.wysiwyg.element.lastElementChild.isSameNode(removeElement)) {
                if (protyle.contentElement.scrollHeight - removeElement.offsetTop > REMOVED_OVER_HEIGHT) {
                    removeElements.push(removeElement);
                } else {
                    break;
                }
                removeElement = removeElement.nextElementSibling as HTMLElement;
            }
            const lastRemoveTop = removeElement.getBoundingClientRect().top;
            removeElements.forEach(item => {
                item.remove();
            });
            protyle.contentElement.scrollTop = protyle.contentElement.scrollTop + (removeElement.getBoundingClientRect().top - lastRemoveTop);
            protyle.scroll.lastScrollTop = protyle.contentElement.scrollTop;
            hideElements(["toolbar"], protyle);
        }
        protyle.wysiwyg.element.insertAdjacentHTML("beforeend", options.content);
    } else if (options.action.includes(Constants.CB_GET_BEFORE)) {
        const firstElement = protyle.wysiwyg.element.firstElementChild as HTMLElement;
        const lastTop = firstElement.getBoundingClientRect().top;
        protyle.wysiwyg.element.insertAdjacentHTML("afterbegin", options.content);
        protyle.contentElement.scrollTop = protyle.contentElement.scrollTop + (firstElement.getBoundingClientRect().top - lastTop);
        protyle.scroll.lastScrollTop = protyle.contentElement.scrollTop;
        // 动态加载移除
        if (!protyle.wysiwyg.element.querySelector(".protyle-wysiwyg--select") && !protyle.scroll.keepLazyLoad) {
            const removeElements: Element[] = [];
            let childCount = protyle.wysiwyg.element.childElementCount;
            let scrollHeight = protyle.contentElement.scrollHeight;
            let lastElement = protyle.wysiwyg.element.lastElementChild;
            while (childCount > 2 && scrollHeight > REMOVED_OVER_HEIGHT && lastElement.getBoundingClientRect().top > window.innerHeight) {
                removeElements.push(lastElement);
                lastElement = lastElement.previousElementSibling;
                childCount--;
                scrollHeight -= lastElement.clientHeight + 8;   // 大部分元素的 margin
            }
            removeElements.forEach((item) => {
                item.remove();
            });
            hideElements(["toolbar"], protyle);
        }
    } else {
        protyle.wysiwyg.element.innerHTML = options.content;
    }
    if (options.action.includes(Constants.CB_GET_BACKLINK)) {
        foldPassiveType(options.expand, protyle.wysiwyg.element);
    }
    processRender(protyle.wysiwyg.element);
    highlightRender(protyle.wysiwyg.element);
    avRender(protyle.wysiwyg.element, protyle);
    blockRender(protyle, protyle.wysiwyg.element);
    if (options.action.includes(Constants.CB_GET_HISTORY)) {
        return;
    }
    if (protyle.options.render.scroll) {
        protyle.scroll.update(protyle);
    }
    if (options.scrollAttr) {
        protyle.contentElement.scrollTop = options.scrollAttr.scrollTop;
        if (options.action.includes(Constants.CB_GET_HL)) {
            highlightById(protyle, options.scrollAttr.focusId, true);
        } else if (options.action.includes(Constants.CB_GET_FOCUS)) {
            if (options.scrollAttr.focusId) {
                const range = focusByOffset(protyle.wysiwyg.element.querySelector(`[data-node-id="${options.scrollAttr.focusId}"]`), options.scrollAttr.focusStart, options.scrollAttr.focusEnd);
                /// #if !MOBILE
                if (!options.action.includes(Constants.CB_GET_UNUNDO)) {
                    pushBack(protyle, range || undefined);
                }
                /// #endif
            } else {
                focusElementById(protyle, options.action);
            }
        }
        if (!protyle.scroll.element.classList.contains("fn__none")) {
            // 使用动态滚动条定位到最后一个块，重启后无法触发滚动事件，需要再次更新 index
            protyle.scroll.updateIndex(protyle, options.scrollAttr.startId);
            // https://github.com/siyuan-note/siyuan/issues/8224
            const contentRect = protyle.contentElement.getBoundingClientRect();
            if (protyle.wysiwyg.element.clientHeight - parseInt(protyle.wysiwyg.element.style.paddingBottom) < protyle.contentElement.clientHeight &&
                protyle.wysiwyg.element.lastElementChild.getBoundingClientRect().bottom < contentRect.bottom &&
                protyle.wysiwyg.element.firstElementChild.getBoundingClientRect().top > contentRect.top) {
                showMessage(window.siyuan.languages.scrollGetMore);
            }
        }
    } else if (options.action.includes(Constants.CB_GET_HL)) {
        preventScroll(protyle); // 搜索页签滚动会导致再次请求
        const hlElement = highlightById(protyle, protyle.block.id, true);
        /// #if !MOBILE
        if (hlElement && !options.action.includes(Constants.CB_GET_UNUNDO)) {
            pushBack(protyle, undefined, hlElement);
        }
        /// #endif
    } else if (options.action.includes(Constants.CB_GET_FOCUS)) {
        focusElementById(protyle, options.action);
    } else if (options.action.includes(Constants.CB_GET_FOCUSFIRST)) {
        // settimeout 时间需短一点，否则定位后快速滚动无效
        const headerHeight = protyle.wysiwyg.element.offsetTop - 16;
        preventScroll(protyle, headerHeight, 256);
        protyle.contentElement.scrollTop = headerHeight;
        focusBlock(protyle.wysiwyg.element.firstElementChild);
        /// #if !MOBILE
        if (!options.action.includes(Constants.CB_GET_UNUNDO)) {
            pushBack(protyle, undefined, protyle.wysiwyg.element.firstElementChild);
        }
        /// #endif
    }
    if (options.isSyncing) {
        disabledForeverProtyle(protyle);
    } else {
        if (protyle.breadcrumb) {
            protyle.breadcrumb.element.nextElementSibling.textContent = "";
        }
        protyle.element.removeAttribute("disabled-forever");
        let readOnly = window.siyuan.config.readonly ? "true" : "false";
        if (readOnly === "false") {
            readOnly = protyle.wysiwyg.element.getAttribute(Constants.CUSTOM_SY_READONLY);
            if (!readOnly) {
                readOnly = window.siyuan.config.editor.readOnly ? "true" : "false";
            }
        }
        if (readOnly === "true") {
            disabledProtyle(protyle);
        } else {
            enableProtyle(protyle);
        }
    }
    if (options.action.includes(Constants.CB_GET_SETID)) {
        // 点击大纲后，如果需要动态加载，在定位后，需要重置 block.id https://github.com/siyuan-note/siyuan/issues/4487
        protyle.block.id = protyle.block.rootID;
        protyle.wysiwyg.element.setAttribute("data-doc-type", "NodeDocument");
    }
    if (protyle.options.defId) {
        protyle.wysiwyg.element.querySelectorAll(`[data-id="${protyle.options.defId}"]`).forEach(item => {
            item.classList.add("def--mark");
        });
        protyle.options.defId = undefined;
    }
    // 屏幕太高的页签 https://github.com/siyuan-note/siyuan/issues/5018
    if (!protyle.scroll.element.classList.contains("fn__none") &&
        !protyle.element.classList.contains("block__edit") &&   // 不能为浮窗，否则悬浮为根文档无法打开整个文档 https://github.com/siyuan-note/siyuan/issues/9082
        protyle.wysiwyg.element.lastElementChild.getAttribute("data-eof") !== "2" &&
        protyle.contentElement.scrollHeight > 0 && // 没有激活的页签 https://github.com/siyuan-note/siyuan/issues/5255
        !options.action.includes(Constants.CB_GET_FOCUSFIRST) && // 防止 eof 为true https://github.com/siyuan-note/siyuan/issues/5291
        protyle.contentElement.scrollHeight <= protyle.contentElement.clientHeight) {
        fetchPost("/api/filetree/getDoc", {
            id: protyle.wysiwyg.element.lastElementChild.getAttribute("data-node-id"),
            mode: 2,
            size: window.siyuan.config.editor.dynamicLoadBlocks,
        }, getResponse => {
            onGet({data: getResponse, protyle, action: [Constants.CB_GET_APPEND, Constants.CB_GET_UNCHANGEID]});
        });
    }

    if (options.action.includes(Constants.CB_GET_APPEND) || options.action.includes(Constants.CB_GET_BEFORE)) {
        protyle.app.plugins.forEach(item => {
            item.eventBus.emit("loaded-protyle-dynamic", {
                protyle,
                positon: options.action.includes(Constants.CB_GET_APPEND) ? "afterend" : "beforebegin"
            });
        });
        return;
    }
    if (protyle.options.render.breadcrumb) {
        protyle.breadcrumb.toggleExit(!options.action.includes(Constants.CB_GET_ALL));
        protyle.breadcrumb.render(protyle);
    }
    if (options.afterCB) {
        options.afterCB();
    }
    protyle.app.plugins.forEach(item => {
        item.eventBus.emit("loaded-protyle", protyle);  // 准备废弃
        item.eventBus.emit("loaded-protyle-static", {protyle});
    });
};

export const disabledForeverProtyle = (protyle: IProtyle) => {
    disabledProtyle(protyle);
    if (protyle.breadcrumb && !isMobile()) {
        protyle.breadcrumb.element.nextElementSibling.textContent = window.siyuan.languages["_kernel"][81];
    } else {
        showMessage(window.siyuan.languages["_kernel"][81]);
    }
    protyle.element.setAttribute("disabled-forever", "true");
};

/** 禁用编辑器 */
export const disabledProtyle = (protyle: IProtyle) => {
    window.siyuan.menus.menu.remove();
    hideElements(["gutter", "toolbar", "select", "hint", "util"], protyle);
    protyle.disabled = true;
    if (protyle.title) {
        const titleElement = protyle.title.element.querySelector(".protyle-title__input") as HTMLElement;
        titleElement.setAttribute("contenteditable", "false");
        titleElement.style.userSelect = "text";
    }
    /// #if MOBILE
    document.getElementById("toolbarName").setAttribute("readonly", "readonly");
    /// #endif
    if (protyle.background) {
        protyle.background.element.classList.remove("protyle-background--enable");
        protyle.background.element.classList.remove("protyle-background--mobileshow");
    }
    protyle.wysiwyg.element.querySelectorAll(".protyle-icons--show").forEach(item => {
        item.classList.remove("protyle-icons--show");
    });
    protyle.wysiwyg.element.style.userSelect = "text";
    protyle.wysiwyg.element.setAttribute("contenteditable", "false");
    protyle.wysiwyg.element.querySelectorAll('[contenteditable="true"][spellcheck]').forEach(item => {
        item.setAttribute("contenteditable", "false");
    });
    if (protyle.breadcrumb) {
        protyle.breadcrumb.element.parentElement.querySelector('[data-type="readonly"] use').setAttribute("xlink:href", "#iconLock");
        protyle.breadcrumb.element.parentElement.querySelector('[data-type="readonly"]').setAttribute("aria-label", window.siyuan.languages.unlockEdit);
    }
    hideTooltip();
};

/** 解除编辑器禁用 */
export const enableProtyle = (protyle: IProtyle) => {
    if (protyle.element.getAttribute("disabled-forever") === "true") {
        return;
    }
    protyle.disabled = false;
    if (isMobile()) {
        // Android 端空块输入法弹出会收起 https://ld246.com/article/1689713888289
        // iPhone，iPad 端 protyle.wysiwyg.element contenteditable 为 true 时，输入会在块中间插入 span 导致保存失败 https://ld246.com/article/1643473862873/comment/1643813765839#comments
        document.getElementById("toolbarName").removeAttribute("readonly");
    } else {
        protyle.wysiwyg.element.setAttribute("contenteditable", "true");
        protyle.wysiwyg.element.style.userSelect = "";
    }
    if (protyle.title) {
        const titleElement = protyle.title.element.querySelector(".protyle-title__input") as HTMLElement;
        titleElement.setAttribute("contenteditable", "true");
        titleElement.style.userSelect = "";
    }
    if (protyle.background) {
        protyle.background.element.classList.add("protyle-background--enable");
    }
    protyle.wysiwyg.element.querySelectorAll('[contenteditable="false"][spellcheck]').forEach(item => {
        if (!hasClosestByClassName(item, "protyle-wysiwyg__embed")) {
            item.setAttribute("contenteditable", "true");
        }
    });
    if (protyle.breadcrumb) {
        protyle.breadcrumb.element.parentElement.querySelector('[data-type="readonly"] use').setAttribute("xlink:href", "#iconUnlock");
        protyle.breadcrumb.element.parentElement.querySelector('[data-type="readonly"]').setAttribute("aria-label", window.siyuan.languages.lockEdit);
    }
    hideTooltip();
};


const focusElementById = (protyle: IProtyle, action: string[]) => {
    let focusElement: Element;
    Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${protyle.block.id}"]`)).find((item: HTMLElement) => {
        if (!hasClosestByAttribute(item, "data-type", "block-render", true)) {
            focusElement = item;
            return true;
        }
    });
    if (protyle.block.mode === 4) {
        preventScroll(protyle);
        focusElement = protyle.wysiwyg.element.lastElementChild;
    }
    if (focusElement && !protyle.wysiwyg.element.firstElementChild.isSameNode(focusElement)) {
        focusBlock(focusElement);
        /// #if !MOBILE
        if (!action.includes(Constants.CB_GET_UNUNDO)) {
            pushBack(protyle, undefined, focusElement);
        }
        /// #endif
        focusElement.scrollIntoView();
        // 减少抖动 https://ld246.com/article/1654263598088
        setTimeout(() => {
            focusElement.scrollIntoView();
        }, Constants.TIMEOUT_LOAD);
    } else {
        focusBlock(protyle.wysiwyg.element.firstElementChild);
        /// #if !MOBILE
        if (!action.includes(Constants.CB_GET_UNUNDO)) {
            pushBack(protyle, undefined, protyle.wysiwyg.element.firstElementChild);
        }
        /// #endif
    }
};
