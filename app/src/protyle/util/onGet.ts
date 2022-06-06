import {lockFile} from "../../dialog/processSystem";
import {Constants} from "../../constants";
import {hideElements} from "../ui/hideElements";
import {genEmptyElement} from "../../block/util";
import {transaction} from "../wysiwyg/transaction";
import {fetchPost} from "../../util/fetch";
import {processRender} from "./processCode";
import {highlightRender} from "../markdown/highlightRender";
import {blockRender} from "../markdown/blockRender";
import {highlightById, scrollCenter} from "../../util/highlightById";
import {pushBack} from "../../util/backForward";
import {focusBlock} from "./selection";
import {hasClosestByAttribute, hasClosestByClassName} from "./hasClosest";
import {preventScroll} from "../scroll/preventScroll";

export const onGet = (data: IWebSocketData, protyle: IProtyle, action: string[] = []) => {
    const loadingElement = protyle.element.querySelector(".fn__loading");
    if (loadingElement) {
        loadingElement.remove();
    }
    protyle.wysiwyg.element.removeAttribute("data-top");
    if (data.code === 1) {
        // 其他报错
        if (protyle.model) {
            protyle.model.parent.parent.removeTab(protyle.model.parent.id);
        } else {
            protyle.element.innerHTML = `<div class="ft__smaller ft__secondary b3-form__space--small" contenteditable="false">${window.siyuan.languages.refExpired}</div>`;
        }
        return;
    }
    if (data.code === 3) {
        // block not found
        return;
    }
    protyle.notebookId = data.data.box;
    protyle.path = data.data.path;
    if (data.code === 2) {
        // 文件被锁定
        protyle.block.rootID = data.data;
        lockFile(data.data);
        return;
    }

    if (data.data.eof) {
        if (action.includes(Constants.CB_GET_BEFORE)) {
            protyle.wysiwyg.element.firstElementChild.setAttribute("data-eof", "true");
        } else {
            protyle.wysiwyg.element.lastElementChild.setAttribute("data-eof", "true");
        }
        if (data.data.mode !== 4) {
            return;
        }
    }
    hideElements(["gutter"], protyle);
    let html = data.data.content;
    if (html === "" && !action) {
        const element = genEmptyElement(false, false);
        html = element.outerHTML;
        transaction(protyle, [{
            action: "insert",
            id: element.getAttribute("data-node-id"),
            data: html,
            parentID: data.data.parentID
        }]);
    }

    protyle.block.parentID = data.data.parentID;
    protyle.block.parent2ID = data.data.parent2ID;
    protyle.block.rootID = data.data.rootID;
    protyle.block.showAll = false;
    protyle.block.mode = data.data.mode;
    protyle.block.blockCount = data.data.blockCount;
    if (!action.includes(Constants.CB_GET_UNCHANGEID)) {
        protyle.block.id = data.data.id;
        protyle.scroll.lastScrollTop = 0;
        protyle.contentElement.scrollTop = 0;
        protyle.wysiwyg.element.setAttribute("data-doc-type", data.data.type);
    }

    if (protyle.options.render.title) {
        protyle.title.render(protyle);
    } else if (protyle.options.render.background) {
        fetchPost("/api/block/getDocInfo", {
            id: protyle.block.rootID
        }, (response) => {
            protyle.background.render(response.data.ial, protyle.block.rootID);
            protyle.wysiwyg.renderCustom(response.data.ial);
        });
    }

    setHTML({
        content: html,
        action,
    }, protyle);
};

const setHTML = (options: { content: string, action?: string[] }, protyle: IProtyle) => {
    if (protyle.contentElement.classList.contains("fn__none")) {
        return;
    }
    protyle.block.showAll = options.action.includes(Constants.CB_GET_ALL);
    if (options.action.includes(Constants.CB_GET_APPEND)) {
        protyle.wysiwyg.element.insertAdjacentHTML("beforeend", options.content);
    } else if (options.action.includes(Constants.CB_GET_BEFORE)) {
        const lastElement = protyle.wysiwyg.element.firstElementChild as HTMLElement;
        const lastTop = lastElement.getBoundingClientRect().top - protyle.element.getBoundingClientRect().top;
        protyle.wysiwyg.element.insertAdjacentHTML("afterbegin", options.content);
        const appendHeight = lastElement.offsetTop - lastTop;
        protyle.contentElement.scrollTop = appendHeight;
        protyle.scroll.lastScrollTop = appendHeight;
    } else {
        protyle.wysiwyg.element.innerHTML = options.content;
    }
    processRender(protyle.wysiwyg.element);
    highlightRender(protyle.wysiwyg.element);
    blockRender(protyle, protyle.wysiwyg.element);
    if (protyle.options.render.scroll) {
        protyle.scroll.update(protyle.block.blockCount, protyle);
    }

    if (options.action.includes(Constants.CB_GET_HL)) {
        preventScroll(protyle); // 搜索页签滚动会导致再次请求
        const hlElement = highlightById(protyle, protyle.block.id, true);
        if (hlElement && !options.action.includes(Constants.CB_GET_UNUNDO)) {
            pushBack(protyle, undefined, hlElement);
        }
    } else if (options.action.includes(Constants.CB_GET_FOCUS)) {
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
            if (!options.action.includes(Constants.CB_GET_UNUNDO)) {
                pushBack(protyle, undefined, focusElement);
            }
            focusElement.scrollIntoView();
            // 减少抖动 https://ld246.com/article/1654263598088
            setTimeout(() => {
                focusElement.scrollIntoView();
            }, Constants.TIMEOUT_BLOCKLOAD);
        } else {
            focusBlock(protyle.wysiwyg.element.firstElementChild);
            if (!options.action.includes(Constants.CB_GET_UNUNDO)) {
                pushBack(protyle, undefined, protyle.wysiwyg.element.firstElementChild);
            }
        }
    } else if (options.action.includes(Constants.CB_GET_FOCUSFIRST)) {
        // settimeout 时间需短一点，否则定位后快速滚动无效
        preventScroll(protyle, 8, 256);
        protyle.contentElement.scrollTop = 8;
        focusBlock(protyle.wysiwyg.element.firstElementChild);
        pushBack(protyle, undefined, protyle.wysiwyg.element.firstElementChild);
    }
    if (protyle.disabled) {
        disabledProtyle(protyle);
    } else {
        enableProtyle(protyle);
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
    // https://ld246.com/article/1653639418266
    if (protyle.element.classList.contains("block__edit") && (protyle.element.nextElementSibling || protyle.element.previousElementSibling)) {
        protyle.element.style.minHeight = Math.min(30 + protyle.wysiwyg.element.clientHeight - 16, window.innerHeight / 3) + "px";
    }
    if (options.action.includes(Constants.CB_GET_APPEND) || options.action.includes(Constants.CB_GET_BEFORE)) {
        return;
    }
    protyle.breadcrumb.render(protyle);
};

/** 禁用编辑器 */
export const disabledProtyle = (protyle: IProtyle) => {
    hideElements(["gutter", "toolbar", "select", "hint", "util"], protyle);
    protyle.disabled = true;
    protyle.wysiwyg.element.setAttribute("contenteditable", "false");
    protyle.wysiwyg.element.querySelectorAll('[contenteditable="true"][spellcheck="false"]').forEach(item => {
        item.setAttribute("contenteditable", "false");
    });
};

/** 解除编辑器禁用 */
export const enableProtyle = (protyle: IProtyle) => {
    protyle.disabled = false;
    if (navigator && navigator.maxTouchPoints > 1 && ["MacIntel", "iPhone"].includes(navigator.platform)) {
        // iPhone，iPad 端输入 contenteditable 为 true 时会在块中间插入 span
    } else {
        protyle.wysiwyg.element.setAttribute("contenteditable", "true");
    }
    protyle.wysiwyg.element.querySelectorAll('[contenteditable="false"][spellcheck="false"]').forEach(item => {
        if (!hasClosestByClassName(item, "protyle-wysiwyg__embed")) {
            item.setAttribute("contenteditable", "true");
        }
    });
};
