import {fetchPost} from "../../util/fetch";
import {focusBlock, focusByWbr, focusSideBlock, getEditorRange} from "../util/selection";
import {getTopAloneElement} from "./getBlock";
import {Constants} from "../../constants";
import {blockRender} from "../render/blockRender";
import {processRender} from "../util/processCode";
import {highlightRender} from "../render/highlightRender";
import {hasClosestBlock, hasClosestByAttribute} from "../util/hasClosest";
import {setFold, zoomOut} from "../../menus/protyle";
import {disabledProtyle, enableProtyle, onGet} from "../util/onGet";
/// #if !MOBILE
import {getAllModels} from "../../layout/getAll";
/// #endif
import {avRender, refreshAV} from "../render/av/render";
import {removeFoldHeading} from "../util/heading";
import {genEmptyElement, genSBElement} from "../../block/util";
import {hideElements} from "../ui/hideElements";
import {reloadProtyle} from "../util/reload";
import {countBlockWord} from "../../layout/status";
import {needLogin, needSubscribe} from "../../util/needSubscribe";
import {resize} from "../util/resize";

const removeTopElement = (updateElement: Element, protyle: IProtyle) => {
    // 移动到其他文档中，该块需移除
    // TODO 文档没有打开时，需要通过后台获取 getTopAloneElement
    const topAloneElement = getTopAloneElement(updateElement);
    const doOperations: IOperation[] = [];
    if (!topAloneElement.isSameNode(updateElement)) {
        updateElement.remove();
        doOperations.push({
            action: "delete",
            id: topAloneElement.getAttribute("data-node-id")
        });
    }
    topAloneElement.remove();
    if (protyle.block.rootID === protyle.block.id && protyle.wysiwyg.element.childElementCount === 0) {
        const newId = Lute.NewNodeID();
        const newElement = genEmptyElement(false, false, newId);
        doOperations.push({
            action: "insert",
            data: newElement.outerHTML,
            id: newId,
            parentID: protyle.block.parentID
        });
        protyle.wysiwyg.element.innerHTML = newElement.outerHTML;
    }
    if (doOperations.length > 0) {
        transaction(protyle, doOperations, []);
    }
};

// 用于执行操作，外加处理当前编辑器中引用块、嵌入块的更新
const promiseTransaction = () => {
    if (window.siyuan.transactions.length === 0) {
        return;
    }
    const protyle = window.siyuan.transactions[0].protyle;
    const doOperations = window.siyuan.transactions[0].doOperations;
    const undoOperations = window.siyuan.transactions[0].undoOperations;
    // 1. * ;2. * ;3. a
    // 第一步请求没有返回前在 transaction 中会合并1、2步，此时第一步请求返回将被以下代码删除，在输入a时，就会出现 block not found，因此以下代码不能放入请求回调中
    window.siyuan.transactions.splice(0, 1);
    fetchPost("/api/transactions", {
        session: protyle.id,
        app: Constants.SIYUAN_APPID,
        transactions: [{
            doOperations,
            undoOperations // 目前用于 ws 推送更新大纲
        }]
    }, (response) => {
        if (window.siyuan.transactions.length === 0) {
            countBlockWord([], protyle.block.rootID, true);
        } else {
            promiseTransaction();
        }
        /// #if MOBILE
        if (((0 !== window.siyuan.config.sync.provider && !needLogin("")) ||
                (0 === window.siyuan.config.sync.provider && !needSubscribe(""))) &&
            window.siyuan.config.repo.key && window.siyuan.config.sync.enabled) {
            document.getElementById("toolbarSync").classList.remove("fn__none");
        }
        /// #endif
        if (response.data[0].doOperations[0].action === "setAttrs") {
            const gutterFoldElement = protyle.gutter.element.querySelector('[data-type="fold"]');
            if (gutterFoldElement) {
                gutterFoldElement.removeAttribute("disabled");
            }
            // 仅在 alt+click 箭头折叠时才会触发
            protyle.wysiwyg.element.querySelectorAll('[data-type="NodeBlockQueryEmbed"]').forEach((item) => {
                if (item.querySelector(`[data-node-id="${response.data[0].doOperations[0].id}"]`)) {
                    item.removeAttribute("data-render");
                    blockRender(protyle, item);
                }
            });
            return;
        }

        let range: Range;
        if (getSelection().rangeCount > 0) {
            range = getSelection().getRangeAt(0);
        }
        response.data[0].doOperations.forEach((operation: IOperation) => {
            if (operation.action === "unfoldHeading" || operation.action === "foldHeading") {
                const gutterFoldElement = protyle.gutter.element.querySelector('[data-type="fold"]');
                if (gutterFoldElement) {
                    gutterFoldElement.removeAttribute("disabled");
                }
                if (operation.action === "unfoldHeading") {
                    const scrollTop = protyle.contentElement.scrollTop;
                    protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`).forEach(item => {
                        if (!item.lastElementChild.classList.contains("protyle-attr")) {
                            item.lastElementChild.remove();
                        }
                        removeUnfoldRepeatBlock(operation.retData, protyle);
                        item.insertAdjacentHTML("afterend", operation.retData);
                        if (operation.data === "remove") {
                            // https://github.com/siyuan-note/siyuan/issues/2188
                            const selection = getSelection();
                            if (selection.rangeCount > 0 && item.contains(selection.getRangeAt(0).startContainer)) {
                                focusBlock(item.nextElementSibling, undefined, true);
                            }
                            item.remove();
                        }
                    });
                    processRender(protyle.wysiwyg.element);
                    highlightRender(protyle.wysiwyg.element);
                    avRender(protyle.wysiwyg.element, protyle);
                    blockRender(protyle, protyle.wysiwyg.element);
                    protyle.contentElement.scrollTop = scrollTop;
                    protyle.scroll.lastScrollTop = scrollTop;
                    return;
                }
                // 折叠标题后未触发动态加载 https://github.com/siyuan-note/siyuan/issues/4168
                if (protyle.wysiwyg.element.lastElementChild.getAttribute("data-eof") !== "2" &&
                    !protyle.scroll.element.classList.contains("fn__none") &&
                    protyle.contentElement.scrollHeight - protyle.contentElement.scrollTop < protyle.contentElement.clientHeight * 2    // https://github.com/siyuan-note/siyuan/issues/7785
                ) {
                    fetchPost("/api/filetree/getDoc", {
                        id: protyle.wysiwyg.element.lastElementChild.getAttribute("data-node-id"),
                        mode: 2,
                        size: window.siyuan.config.editor.dynamicLoadBlocks,
                    }, getResponse => {
                        onGet({
                            data: getResponse,
                            protyle,
                            action: [Constants.CB_GET_APPEND, Constants.CB_GET_UNCHANGEID],
                        });
                    });
                }
                return;
            }
            if (operation.action === "update") {
                if (protyle.options.backlinkData) {
                    // 反链中有多个相同块的情况
                    Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`)).forEach(item => {
                        if (item.getAttribute("data-type") === "NodeBlockQueryEmbed" ||
                            !hasClosestByAttribute(item, "data-type", "NodeBlockQueryEmbed")) {
                            if (range && (item.isSameNode(range.startContainer) || item.contains(range.startContainer))) {
                                // 正在编辑的块不能进行更新
                            } else {
                                item.outerHTML = operation.data.replace("<wbr>", "");
                            }
                        }
                    });
                    processRender(protyle.wysiwyg.element);
                    highlightRender(protyle.wysiwyg.element);
                    avRender(protyle.wysiwyg.element, protyle);
                    blockRender(protyle, protyle.wysiwyg.element);
                }
                // 当前编辑器中更新嵌入块
                updateEmbed(protyle, operation);
                // 更新引用块
                updateRef(protyle, operation.id);
                return;
            }
            if (operation.action === "delete" || operation.action === "append") {
                if (protyle.options.backlinkData) {
                    Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`)).forEach(item => {
                        if (!hasClosestByAttribute(item, "data-type", "NodeBlockQueryEmbed")) {
                            item.remove();
                        }
                    });
                }
                // 更新嵌入块
                protyle.wysiwyg.element.querySelectorAll('[data-type="NodeBlockQueryEmbed"]').forEach((item) => {
                    if (item.querySelector(`[data-node-id="${operation.id}"]`)) {
                        item.removeAttribute("data-render");
                        blockRender(protyle, item);
                    }
                });
                return;
            }
            if (operation.action === "move") {
                if (protyle.options.backlinkData) {
                    const updateElements: Element[] = [];
                    Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`)).forEach(item => {
                        if (item.getAttribute("data-type") === "NodeBlockQueryEmbed" || !hasClosestByAttribute(item, "data-type", "NodeBlockQueryEmbed")) {
                            updateElements.push(item);
                            return;
                        }
                    });
                    let hasFind = false;
                    if (operation.previousID && updateElements.length > 0) {
                        Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.previousID}"]`)).forEach(item => {
                            if (item.getAttribute("data-type") === "NodeBlockQueryEmbed" || !hasClosestByAttribute(item.parentElement, "data-type", "NodeBlockQueryEmbed")) {
                                item.after(updateElements[0].cloneNode(true));
                                hasFind = true;
                            }
                        });
                    } else if (updateElements.length > 0) {
                        Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.parentID}"]`)).forEach(item => {
                            if (item.getAttribute("data-type") === "NodeBlockQueryEmbed" || !hasClosestByAttribute(item.parentElement, "data-type", "NodeBlockQueryEmbed")) {
                                // 列表特殊处理
                                if (item.firstElementChild?.classList.contains("protyle-action")) {
                                    item.firstElementChild.after(updateElements[0].cloneNode(true));
                                } else {
                                    item.prepend(updateElements[0].cloneNode(true));
                                }
                                hasFind = true;
                            }
                        });
                    }
                    updateElements.forEach(item => {
                        if (hasFind) {
                            item.remove();
                        } else if (!hasFind && item.parentElement) {
                            removeTopElement(item, protyle);
                        }
                    });
                }
                // 更新嵌入块
                protyle.wysiwyg.element.querySelectorAll('[data-type="NodeBlockQueryEmbed"]').forEach((item) => {
                    if (item.querySelector(`[data-node-id="${operation.id}"]`)) {
                        item.removeAttribute("data-render");
                        blockRender(protyle, item);
                    }
                });
                return;
            }
            if (operation.action === "insert") {
                // insert
                if (protyle.options.backlinkData) {
                    const cursorElements: Element[] = [];
                    if (operation.previousID) {
                        Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.previousID}"]`)).forEach(item => {
                            if (item.nextElementSibling?.getAttribute("data-node-id") !== operation.id &&
                                !hasClosestByAttribute(item, "data-node-id", operation.id) && // 段落转列表会在段落后插入新列表
                                (item.getAttribute("data-type") === "NodeBlockQueryEmbed" || !hasClosestByAttribute(item.parentElement, "data-type", "NodeBlockQueryEmbed"))) {
                                item.insertAdjacentHTML("afterend", operation.data);
                                cursorElements.push(item.nextElementSibling);
                            }
                        });
                    } else {
                        Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.parentID}"]`)).forEach(item => {
                            if (item.getAttribute("data-type") === "NodeBlockQueryEmbed" || !hasClosestByAttribute(item.parentElement, "data-type", "NodeBlockQueryEmbed")) {
                                // 列表特殊处理
                                if (item.firstElementChild && item.firstElementChild.classList.contains("protyle-action") &&
                                    item.firstElementChild.nextElementSibling.getAttribute("data-node-id") !== operation.id) {
                                    item.firstElementChild.insertAdjacentHTML("afterend", operation.data);
                                    cursorElements.push(item.firstElementChild.nextElementSibling);
                                } else if (item.firstElementChild && item.firstElementChild.getAttribute("data-node-id") !== operation.id) {
                                    item.insertAdjacentHTML("afterbegin", operation.data);
                                    cursorElements.push(item.firstElementChild);
                                }
                            }
                        });
                    }
                    // https://github.com/siyuan-note/siyuan/issues/4420
                    protyle.wysiwyg.element.querySelectorAll('[data-type="NodeHeading"]').forEach(item => {
                        if (item.lastElementChild.getAttribute("spin") === "1") {
                            item.lastElementChild.remove();
                        }
                    });
                    cursorElements.forEach(item => {
                        processRender(item);
                        highlightRender(item);
                        avRender(item, protyle);
                        blockRender(protyle, item);
                        const wbrElement = item.querySelector("wbr");
                        if (wbrElement) {
                            wbrElement.remove();
                        }
                    });
                }
                // 不更新嵌入块：在快速删除时重新渲染嵌入块会导致滚动条产生滚动从而触发 getDoc 请求，此时删除的块还没有写库，会把已删除的块 append 到文档底部，最终导致查询块失败、光标丢失
                // protyle.wysiwyg.element.querySelectorAll('[data-type="NodeBlockQueryEmbed"]').forEach((item) => {
                //     if (item.getAttribute("data-node-id") === operation.id) {
                //         item.removeAttribute("data-render");
                //         blockRender(protyle, item);
                //     }
                // });
                // 更新引用块
                updateRef(protyle, operation.id);
            }
        });
    });
};

const updateEmbed = (protyle: IProtyle, operation: IOperation) => {
    let updatedEmbed = false;
    protyle.wysiwyg.element.querySelectorAll(`[data-type="NodeBlockQueryEmbed"] [data-node-id="${operation.id}"]`).forEach((item) => {
        const tempElement = document.createElement("div");
        tempElement.innerHTML = operation.data;
        tempElement.querySelectorAll('[contenteditable="true"]').forEach(editItem => {
            editItem.setAttribute("contenteditable", "false");
        });
        const wbrElement = tempElement.querySelector("wbr");
        if (wbrElement) {
            wbrElement.remove();
        }
        item.outerHTML = tempElement.innerHTML;
        updatedEmbed = true;
    });
    if (updatedEmbed) {
        processRender(protyle.wysiwyg.element);
        highlightRender(protyle.wysiwyg.element);
        avRender(protyle.wysiwyg.element, protyle);
    }
};

const deleteBlock = (updateElements: Element[], id: string, protyle: IProtyle, isUndo: boolean) => {
    if (isUndo) {
        focusSideBlock(updateElements[0]);
    }
    updateElements.forEach(item => {
        item.remove();
    });
    // 更新 ws 嵌入块
    protyle.wysiwyg.element.querySelectorAll('[data-type="NodeBlockQueryEmbed"]').forEach((item) => {
        if (item.querySelector(`[data-node-id="${id}"]`)) {
            item.removeAttribute("data-render");
            blockRender(protyle, item);
        }
    });
};

const updateBlock = (updateElements: Element[], protyle: IProtyle, operation: IOperation, isUndo: boolean) => {
    updateElements.forEach(item => {
        item.outerHTML = operation.data;
    });
    Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`)).find(item => {
        if (item.getAttribute("data-type") === "NodeBlockQueryEmbed" // 引用转换为块嵌入，undo、redo 后也需要更新 updateElement
            || !hasClosestByAttribute(item, "data-type", "NodeBlockQueryEmbed")) {
            updateElements[0] = item;
            return true;
        }
    });
    const wbrElement = updateElements[0].querySelector("wbr");
    if (isUndo) {
        const range = getEditorRange(updateElements[0]);
        if (wbrElement) {
            focusByWbr(updateElements[0], range);
        } else {
            focusBlock(updateElements[0]);
        }
    } else if (wbrElement) {
        wbrElement.remove();
    }
    processRender(updateElements.length === 1 ? updateElements[0] : protyle.wysiwyg.element);
    highlightRender(updateElements.length === 1 ? updateElements[0] : protyle.wysiwyg.element);
    avRender(updateElements.length === 1 ? updateElements[0] : protyle.wysiwyg.element, protyle);
    blockRender(protyle, updateElements.length === 1 ? updateElements[0] : protyle.wysiwyg.element);
    // 更新 ws 嵌入块
    updateEmbed(protyle, operation);
    // 更新 ws 引用块
    updateRef(protyle, operation.id);
};

// 用于推送和撤销
export const onTransaction = (protyle: IProtyle, operation: IOperation, isUndo: boolean) => {
    const updateElements: Element[] = [];
    Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`)).forEach(item => {
        if (!hasClosestByAttribute(item.parentElement, "data-type", "NodeBlockQueryEmbed")) {
            updateElements.push(item);
        }
    });
    if (operation.action === "setAttrs") {
        protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`).forEach(item => {
            if (JSON.parse(operation.data).fold === "1") {
                item.setAttribute("fold", "1");
            } else {
                item.removeAttribute("fold");
            }
        });
        return;
    }
    if (operation.action === "unfoldHeading") {
        const scrollTop = protyle.contentElement.scrollTop;
        protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`).forEach(item => {
            if (operation.retData) { // undo 的时候没有 retData
                removeUnfoldRepeatBlock(operation.retData, protyle);
                item.insertAdjacentHTML("afterend", operation.retData);
            }
            item.removeAttribute("fold");
            if (operation.data === "remove") {
                item.remove();
            }
        });
        if (operation.retData) {
            processRender(protyle.wysiwyg.element);
            highlightRender(protyle.wysiwyg.element);
            avRender(protyle.wysiwyg.element, protyle);
            blockRender(protyle, protyle.wysiwyg.element);
            protyle.contentElement.scrollTop = scrollTop;
            protyle.scroll.lastScrollTop = scrollTop;
        }
        return;
    }
    if (operation.action === "foldHeading") {
        protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`).forEach(item => {
            item.setAttribute("fold", "1");
            if (!operation.retData) {
                removeFoldHeading(item);
            }
        });
        if (operation.retData) {
            operation.retData.forEach((item: string) => {
                protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${item}"]`).forEach(item => {
                    item.remove();
                });
            });
        }
        return;
    }
    if (operation.action === "delete") {
        if (updateElements.length > 0) {
            deleteBlock(updateElements, operation.id, protyle, isUndo);
        } else if (isUndo) {
            zoomOut({
                protyle,
                id: protyle.block.rootID,
                isPushBack: false,
                focusId: operation.id,
                callback() {
                    Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`)).forEach(item => {
                        if (!hasClosestByAttribute(item.parentElement, "data-type", "NodeBlockQueryEmbed")) {
                            updateElements.push(item);
                        }
                    });
                    deleteBlock(updateElements, operation.id, protyle, isUndo);
                }
            });
        }
        return;
    }
    if (operation.action === "update") {
        if (updateElements.length > 0) {
            updateBlock(updateElements, protyle, operation, isUndo);
        } else if (isUndo) {
            zoomOut({
                protyle,
                id: protyle.block.rootID,
                isPushBack: false,
                focusId: operation.id,
                callback() {
                    Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`)).forEach(item => {
                        if (!hasClosestByAttribute(item.parentElement, "data-type", "NodeBlockQueryEmbed")) {
                            updateElements.push(item);
                        }
                    });
                    updateBlock(updateElements, protyle, operation, isUndo);
                }
            });
        }
        return;
    }
    if (operation.action === "updateAttrs") { // 调用接口才推送
        const data = operation.data as any;
        const attrsResult: IObject = {};
        let bookmarkHTML = "";
        let nameHTML = "";
        let aliasHTML = "";
        let memoHTML = "";
        Object.keys(data.new).forEach(key => {
            attrsResult[key] = data.new[key];
            const escapeHTML = Lute.EscapeHTMLStr(data.new[key]);
            if (key === "bookmark") {
                bookmarkHTML = `<div class="protyle-attr--bookmark">${escapeHTML}</div>`;
            } else if (key === "name") {
                nameHTML = `<div class="protyle-attr--name"><svg><use xlink:href="#iconN"></use></svg>${escapeHTML}</div>`;
            } else if (key === "alias") {
                aliasHTML = `<div class="protyle-attr--alias"><svg><use xlink:href="#iconA"></use></svg>${escapeHTML}</div>`;
            } else if (key === "memo") {
                memoHTML = `<div class="protyle-attr--memo b3-tooltips b3-tooltips__sw" aria-label="${escapeHTML}"><svg><use xlink:href="#iconM"></use></svg></div>`;
            }
        });
        let nodeAttrHTML = bookmarkHTML + nameHTML + aliasHTML + memoHTML;
        if (protyle.block.rootID === operation.id) {
            // 文档
            if (protyle.title) {
                const refElement = protyle.title.element.querySelector(".protyle-attr--refcount");
                if (refElement) {
                    nodeAttrHTML += refElement.outerHTML;
                }
                if (data.new[Constants.CUSTOM_RIFF_DECKS] && data.new[Constants.CUSTOM_RIFF_DECKS] !== data.old[Constants.CUSTOM_RIFF_DECKS]) {
                    protyle.title.element.style.animation = "addCard 450ms linear";
                    protyle.title.element.setAttribute(Constants.CUSTOM_RIFF_DECKS, data.new[Constants.CUSTOM_RIFF_DECKS]);
                    setTimeout(() => {
                        protyle.title.element.style.animation = "";
                    }, 450);
                } else if (!data.new[Constants.CUSTOM_RIFF_DECKS]) {
                    protyle.title.element.removeAttribute(Constants.CUSTOM_RIFF_DECKS);
                }
                protyle.title.element.querySelector(".protyle-attr").innerHTML = nodeAttrHTML;
            }
            protyle.wysiwyg.renderCustom(attrsResult);
            if (data.new[Constants.CUSTOM_SY_FULLWIDTH] !== data.old[Constants.CUSTOM_SY_FULLWIDTH]) {
                resize(protyle);
            }
            if (data.new[Constants.CUSTOM_SY_READONLY] !== data.old[Constants.CUSTOM_SY_READONLY]) {
                let customReadOnly = data.new[Constants.CUSTOM_SY_READONLY];
                if (!customReadOnly) {
                    customReadOnly = window.siyuan.config.editor.readOnly ? "true" : "false";
                }
                if (customReadOnly === "true") {
                    disabledProtyle(protyle);
                } else {
                    enableProtyle(protyle);
                }
            }
            if (data.new.icon !== data.old.icon) {
                /// #if MOBILE
                if (window.siyuan.mobile.editor.protyle.background.ial.icon !== data.new.icon) {
                    window.siyuan.mobile.editor.protyle.background.ial.icon = data.new.icon;
                    window.siyuan.mobile.editor.protyle.background.render(window.siyuan.mobile.editor.protyle.background.ial, window.siyuan.mobile.editor.protyle.block.rootID);
                }
                /// #else
                if (protyle.background.ial.icon !== data.new.icon) {
                    protyle.background.ial.icon = data.new.icon;
                    protyle.background.render(protyle.background.ial, protyle.block.rootID);
                    protyle.model?.parent.setDocIcon(data.new.icon);
                }
                /// #endif
            }
            return;
        }
        protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`).forEach((item: HTMLElement) => {
            if (item.getAttribute("data-type") === "NodeThematicBreak") {
                return;
            }
            Object.keys(data.old).forEach(key => {
                item.removeAttribute(key);
            });
            if (data.new.style && data.new[Constants.CUSTOM_RIFF_DECKS] && data.new[Constants.CUSTOM_RIFF_DECKS] !== data.old[Constants.CUSTOM_RIFF_DECKS]) {
                data.new.style += ";animation:addCard 450ms linear";
            }
            Object.keys(data.new).forEach(key => {
                item.setAttribute(key, data.new[key]);
                if (key === Constants.CUSTOM_RIFF_DECKS && data.new[Constants.CUSTOM_RIFF_DECKS] !== data.old[Constants.CUSTOM_RIFF_DECKS]) {
                    item.style.animation = "addCard 450ms linear";
                    setTimeout(() => {
                        item.style.animation = "";
                    }, 450);
                }
            });
            const refElement = item.lastElementChild.querySelector(".protyle-attr--refcount");
            if (refElement) {
                nodeAttrHTML += refElement.outerHTML;
            }
            item.lastElementChild.innerHTML = nodeAttrHTML + Constants.ZWSP;
        });
        return;
    }
    if (operation.action === "move") {
        let range;
        if (isUndo && getSelection().rangeCount > 0) {
            range = getSelection().getRangeAt(0);
            range.insertNode(document.createElement("wbr"));
        }
        /// #if !MOBILE
        if (updateElements.length === 0) {
            // 打开两个相同的文档 A、A1，从 A 拖拽块 B 到 A1，在后续 ws 处理中，无法获取到拖拽出去的 B
            getAllModels().editor.forEach(editor => {
                const updateCloneElement = editor.editor.protyle.wysiwyg.element.querySelector(`[data-node-id="${operation.id}"]`);
                if (updateCloneElement) {
                    updateElements.push(updateCloneElement.cloneNode(true) as Element);
                }
            });
        }
        if (updateElements.length === 0) {
            // 页签拖入浮窗 https://github.com/siyuan-note/siyuan/issues/6647
            window.siyuan.blockPanels.forEach((item) => {
                const updateCloneElement = item.element.querySelector(`[data-node-id="${operation.id}"]`);
                if (updateCloneElement) {
                    updateElements.push(updateCloneElement.cloneNode(true) as Element);
                }
            });
        }
        /// #endif
        let hasFind = false;
        if (operation.previousID && updateElements.length > 0) {
            Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.previousID}"]`)).forEach(item => {
                if (!hasClosestByAttribute(item.parentElement, "data-type", "NodeBlockQueryEmbed")) {
                    item.after(updateElements[0].cloneNode(true));
                    hasFind = true;
                }
            });
        } else if (updateElements.length > 0) {
            if (!protyle.options.backlinkData && operation.parentID === protyle.block.parentID) {
                protyle.wysiwyg.element.prepend(updateElements[0].cloneNode(true));
                hasFind = true;
            } else {
                Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.parentID}"]`)).forEach(item => {
                    if (!hasClosestByAttribute(item.parentElement, "data-type", "NodeBlockQueryEmbed")) {
                        // 列表特殊处理
                        if (item.firstElementChild?.classList.contains("protyle-action")) {
                            item.firstElementChild.after(updateElements[0].cloneNode(true));
                        } else {
                            item.prepend(updateElements[0].cloneNode(true));
                        }
                        hasFind = true;
                    }
                });
            }
        }
        updateElements.forEach(item => {
            if (hasFind) {
                item.remove();
            } else if (!hasFind && item.parentElement) {
                removeTopElement(item, protyle);
            }
        });
        if (isUndo && range) {
            if (operation.data === "focus") {
                // 标记需要 focus，https://ld246.com/article/1650018446988/comment/1650081404993?r=Vanessa#comments
                Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`)).find(item => {
                    if (!hasClosestByAttribute(item.parentElement, "data-type", "NodeBlockQueryEmbed")) {
                        focusBlock(item);
                        return true;
                    }
                });
            } else {
                focusByWbr(protyle.wysiwyg.element, range);
            }
        }
        // 更新 ws 嵌入块
        protyle.wysiwyg.element.querySelectorAll('[data-type="NodeBlockQueryEmbed"]').forEach((item) => {
            if (item.querySelector(`[data-node-id="${operation.id}"],[data-node-id="${operation.parentID}"],[data-node-id="${operation.previousID}"]`)) {
                item.removeAttribute("data-render");
                blockRender(protyle, item);
            }
        });
        return;
    }
    if (operation.action === "insert") {
        const cursorElements = [];
        if (operation.previousID) {
            Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.previousID}"]`)).forEach(item => {
                const embedElement = hasClosestByAttribute(item.parentElement, "data-type", "NodeBlockQueryEmbed");
                if (embedElement) {
                    // https://github.com/siyuan-note/siyuan/issues/5524
                    embedElement.removeAttribute("data-render");
                    blockRender(protyle, embedElement);
                } else {
                    item.insertAdjacentHTML("afterend", operation.data);
                    cursorElements.push(item.nextElementSibling);
                }
            });
        } else {
            if (!protyle.options.backlinkData && operation.parentID === protyle.block.parentID) {
                protyle.wysiwyg.element.insertAdjacentHTML("afterbegin", operation.data);
                cursorElements.push(protyle.wysiwyg.element.firstElementChild);
            } else {
                Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.parentID}"]`)).forEach(item => {
                    if (!hasClosestByAttribute(item.parentElement, "data-type", "NodeBlockQueryEmbed")) {
                        // 列表特殊处理
                        if (item.firstElementChild?.classList.contains("protyle-action")) {
                            item.firstElementChild.insertAdjacentHTML("afterend", operation.data);
                            cursorElements.push(item.firstElementChild.nextElementSibling);
                        } else {
                            item.insertAdjacentHTML("afterbegin", operation.data);
                            cursorElements.push(item.firstElementChild);
                        }
                    }
                });
            }
        }
        // https://github.com/siyuan-note/siyuan/issues/4420
        protyle.wysiwyg.element.querySelectorAll('[data-type="NodeHeading"]').forEach(item => {
            if (item.lastElementChild.getAttribute("spin") === "1") {
                item.lastElementChild.remove();
            }
        });
        if (cursorElements.length === 0) {
            return;
        }
        cursorElements.forEach(item => {
            processRender(item);
            highlightRender(item);
            avRender(item, protyle);
            blockRender(protyle, item);
            const wbrElement = item.querySelector("wbr");
            if (isUndo) {
                const range = getEditorRange(item);
                if (wbrElement) {
                    focusByWbr(item, range);
                } else {
                    focusBlock(item);
                }
            } else if (wbrElement) {
                wbrElement.remove();
            }
        });
        // 更新 ws 引用块
        updateRef(protyle, operation.id);
    } else if (operation.action === "append") {
        reloadProtyle(protyle, false);
    } else if (["addAttrViewCol", "insertAttrViewBlock", "updateAttrViewCol", "updateAttrViewColOptions",
        "updateAttrViewColOption", "updateAttrViewCell", "sortAttrViewRow", "sortAttrViewCol", "setAttrViewColHidden",
        "setAttrViewColWrap", "setAttrViewColWidth", "removeAttrViewColOption", "setAttrViewName", "setAttrViewFilters",
        "setAttrViewSorts", "setAttrViewColCalc", "removeAttrViewCol", "updateAttrViewColNumberFormat"].includes(operation.action)) {
        refreshAV(protyle, operation);
    }
};

export const turnsIntoOneTransaction = (options: {
    protyle: IProtyle,
    selectsElement: Element[],
    type: string,
    level?: string
}) => {
    let parentElement: Element;
    const id = Lute.NewNodeID();
    if (options.type === "BlocksMergeSuperBlock") {
        parentElement = genSBElement(options.level, id);
    } else if (options.type === "Blocks2Blockquote") {
        parentElement = document.createElement("div");
        parentElement.classList.add("bq");
        parentElement.setAttribute("data-node-id", id);
        parentElement.setAttribute("data-type", "NodeBlockquote");
        parentElement.innerHTML = '<div class="protyle-attr" contenteditable="false"></div>';
    } else if (options.type.endsWith("Ls")) {
        parentElement = document.createElement("div");
        parentElement.classList.add("list");
        parentElement.setAttribute("data-node-id", id);
        parentElement.setAttribute("data-type", "NodeList");
        if (options.type === "Blocks2ULs") {
            parentElement.setAttribute("data-subtype", "u");
        } else if (options.type === "Blocks2OLs") {
            parentElement.setAttribute("data-subtype", "o");
        } else {
            parentElement.setAttribute("data-subtype", "t");
        }
        let html = "";
        options.selectsElement.forEach((item, index) => {
            if (options.type === "Blocks2ULs") {
                html += `<div data-marker="*" data-subtype="u" data-node-id="${Lute.NewNodeID()}" data-type="NodeListItem" class="li"><div class="protyle-action" draggable="true"><svg><use xlink:href="#iconDot"></use></svg></div><div class="protyle-attr" contenteditable="false"></div></div>`;
            } else if (options.type === "Blocks2OLs") {
                html += `<div data-marker="${index + 1}." data-subtype="o" data-node-id="${Lute.NewNodeID()}" data-type="NodeListItem" class="li"><div class="protyle-action protyle-action--order" contenteditable="false" draggable="true">${index + 1}.</div><div class="protyle-attr" contenteditable="false"></div></div>`;
            } else {
                html += `<div data-marker="*" data-subtype="t" data-node-id="${Lute.NewNodeID()}" data-type="NodeListItem" class="li"><div class="protyle-action protyle-action--task" draggable="true"><svg><use xlink:href="#iconUncheck"></use></svg></div><div class="protyle-attr" contenteditable="false"></div></div>`;
            }
        });
        parentElement.innerHTML = html + '<div class="protyle-attr" contenteditable="false"></div>';
    }
    const previousId = options.selectsElement[0].getAttribute("data-node-id");
    const parentId = options.selectsElement[0].parentElement.getAttribute("data-node-id") || options.protyle.block.parentID;
    const doOperations: IOperation[] = [{
        action: "insert",
        id,
        data: parentElement.outerHTML,
        nextID: previousId,
        parentID: parentId
    }];
    const undoOperations: IOperation[] = [];
    if (options.selectsElement[0].previousElementSibling) {
        options.selectsElement[0].before(parentElement);
    } else {
        options.selectsElement[0].parentElement.prepend(parentElement);
    }
    let itemPreviousId: string;
    options.selectsElement.forEach((item, index) => {
        item.classList.remove("protyle-wysiwyg--select");
        item.removeAttribute("select-start");
        item.removeAttribute("select-end");
        const itemId = item.getAttribute("data-node-id");
        undoOperations.push({
            action: "move",
            id: itemId,
            previousID: itemPreviousId || id,
            parentID: parentId
        });
        if (options.type.endsWith("Ls")) {
            doOperations.push({
                action: "move",
                id: itemId,
                parentID: parentElement.children[index].getAttribute("data-node-id")
            });
            parentElement.children[index].firstElementChild.after(item);
        } else {
            doOperations.push({
                action: "move",
                id: itemId,
                previousID: itemPreviousId,
                parentID: id
            });
            parentElement.lastElementChild.before(item);
        }
        itemPreviousId = item.getAttribute("data-node-id");

        if (index === options.selectsElement.length - 1) {
            undoOperations.push({
                action: "delete",
                id,
            });
        }
        // 超级块内嵌入块无面包屑，需重新渲染 https://github.com/siyuan-note/siyuan/issues/7574
        if (item.getAttribute("data-type") === "NodeBlockQueryEmbed") {
            item.removeAttribute("data-render");
            blockRender(options.protyle, item);
        }
    });
    transaction(options.protyle, doOperations, undoOperations);
    focusBlock(options.protyle.wysiwyg.element.querySelector(`[data-node-id="${options.selectsElement[0].getAttribute("data-node-id")}"]`));
    hideElements(["gutter"], options.protyle);
};

const removeUnfoldRepeatBlock = (html: string, protyle: IProtyle) => {
    const temp = document.createElement("template");
    temp.innerHTML = html;
    Array.from(temp.content.children).forEach(item => {
        protyle.wysiwyg.element.querySelector(`:scope > [data-node-id="${item.getAttribute("data-node-id")}"]`)?.remove();
    });
};

export const turnsIntoTransaction = (options: {
    protyle: IProtyle,
    selectsElement?: Element[],
    nodeElement?: Element,
    type: string,
    level?: number | string,
    isContinue?: boolean,
}) => {
    let selectsElement: Element[] = options.selectsElement;
    let range: Range;
    // 通过快捷键触发
    if (options.nodeElement) {
        range = getSelection().getRangeAt(0);
        range.insertNode(document.createElement("wbr"));
        selectsElement = Array.from(options.protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select"));
        if (selectsElement.length === 0) {
            selectsElement = [options.nodeElement];
        }
        let isContinue = false;
        let hasEmbedBlock = false;
        let isList = false;
        selectsElement.find((item, index) => {
            if (item.classList.contains("li")) {
                isList = true;
                return true;
            }
            if (item.classList.contains("bq") || item.classList.contains("sb") || item.classList.contains("p")) {
                hasEmbedBlock = true;
            }
            if (item.nextElementSibling && selectsElement[index + 1] &&
                item.nextElementSibling.isSameNode(selectsElement[index + 1])) {
                isContinue = true;
            } else if (index !== selectsElement.length - 1) {
                isContinue = false;
                return true;
            }
        });
        if (isList || (hasEmbedBlock && options.type === "Blocks2Ps")) {
            return;
        }
        if (selectsElement.length === 1 && options.type === "Blocks2Hs" &&
            selectsElement[0].getAttribute("data-type") === "NodeHeading" &&
            options.level === parseInt(selectsElement[0].getAttribute("data-subtype").substr(1))) {
            // 快捷键同级转换，消除标题
            options.type = "Blocks2Ps";
        }
        options.isContinue = isContinue;
    }

    let html = "";
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];
    selectsElement.forEach((item, index) => {
        if ((options.type === "Blocks2Ps" || options.type === "Blocks2Hs") &&
            item.getAttribute("data-type") === "NodeHeading" && item.getAttribute("fold") === "1") {
            setFold(options.protyle, item);
        }
        item.classList.remove("protyle-wysiwyg--select");
        item.removeAttribute("select-start");
        item.removeAttribute("select-end");
        html += item.outerHTML;
        const id = item.getAttribute("data-node-id");
        undoOperations.push({
            action: "update",
            id,
            data: item.outerHTML
        });

        if ((options.type === "Blocks2Ps" || options.type === "Blocks2Hs") && !options.isContinue) {
            // @ts-ignore
            item.outerHTML = options.protyle.lute[options.type](item.outerHTML, options.level);
        } else {
            if (index === selectsElement.length - 1) {
                const tempElement = document.createElement("div");
                // @ts-ignore
                tempElement.innerHTML = options.protyle.lute[options.type](html, options.level);
                item.outerHTML = tempElement.innerHTML;
            } else {
                item.remove();
            }
        }
    });
    undoOperations.forEach(item => {
        const nodeElement = options.protyle.wysiwyg.element.querySelector(`[data-node-id="${item.id}"]`);
        doOperations.push({
            action: "update",
            id: item.id,
            data: nodeElement.outerHTML
        });
    });
    transaction(options.protyle, doOperations, undoOperations);
    processRender(options.protyle.wysiwyg.element);
    highlightRender(options.protyle.wysiwyg.element);
    avRender(options.protyle.wysiwyg.element, options.protyle);
    blockRender(options.protyle, options.protyle.wysiwyg.element);
    if (range) {
        focusByWbr(options.protyle.wysiwyg.element, range);
    } else {
        focusBlock(options.protyle.wysiwyg.element.querySelector(`[data-node-id="${selectsElement[0].getAttribute("data-node-id")}"]`));
    }
    hideElements(["gutter"], options.protyle);
};

const updateRef = (protyle: IProtyle, id: string, index = 0) => {
    if (index > 6) {
        return;
    }
    protyle.wysiwyg.element.querySelectorAll(`[data-type~="block-ref"][data-id="${id}"]`).forEach(item => {
        if (item.getAttribute("data-subtype") === "d") {
            fetchPost("/api/block/getRefText", {id: id}, (response) => {
                item.innerHTML = response.data;
                const blockElement = hasClosestBlock(item);
                if (blockElement) {
                    updateRef(protyle, blockElement.getAttribute("data-node-id"), index + 1);
                }
            });
        }
    });
};

let transactionsTimeout: number;
export const transaction = (protyle: IProtyle, doOperations: IOperation[], undoOperations?: IOperation[]) => {
    if (!protyle) {
        // 文档书中点开属性->数据库后的变更操作
        fetchPost("/api/transactions", {
            session: Constants.SIYUAN_APPID,
            app: Constants.SIYUAN_APPID,
            transactions: [{
                doOperations
            }]
        });
        return;
    }

    const lastTransaction = window.siyuan.transactions[window.siyuan.transactions.length - 1];
    let needDebounce = false;
    const time = new Date().getTime();
    if (lastTransaction && lastTransaction.doOperations.length === 1 && lastTransaction.doOperations[0].action === "update" &&
        doOperations.length === 1 && doOperations[0].action === "update" &&
        lastTransaction.doOperations[0].id === doOperations[0].id &&
        protyle.transactionTime - time < Constants.TIMEOUT_INPUT) {
        needDebounce = true;
    }
    protyle.wysiwyg.lastHTMLs = {};
    if (undoOperations) {
        if (window.siyuan.config.fileTree.openFilesUseCurrentTab && protyle.model) {
            protyle.model.headElement.classList.remove("item--unupdate");
        }
        protyle.updated = true;

        if (needDebounce) {
            protyle.undo.replace(doOperations);
        } else {
            protyle.undo.add(doOperations, undoOperations);
        }
    }
    if (needDebounce) {
        // 不能覆盖 undoOperations https://github.com/siyuan-note/siyuan/issues/3727
        window.siyuan.transactions[window.siyuan.transactions.length - 1].protyle = protyle;
        window.siyuan.transactions[window.siyuan.transactions.length - 1].doOperations = doOperations;
    } else {
        window.siyuan.transactions.push({
            protyle,
            doOperations,
            undoOperations
        });
    }
    protyle.transactionTime = time;
    window.clearTimeout(transactionsTimeout);
    transactionsTimeout = window.setTimeout(() => {
        promiseTransaction();
    }, Constants.TIMEOUT_INPUT * 2);
};

export const updateTransaction = (protyle: IProtyle, id: string, newHTML: string, html: string) => {
    if (newHTML === html) {
        return;
    }
    transaction(protyle, [{
        id,
        data: newHTML,
        action: "update"
    }], [{
        id,
        data: html,
        action: "update"
    }]);
};

export const updateBatchTransaction = (nodeElements: Element[], protyle: IProtyle, cb: (e: HTMLElement) => void) => {
    const operations: IOperation[] = [];
    const undoOperations: IOperation[] = [];
    nodeElements.forEach((element) => {
        const id = element.getAttribute("data-node-id");
        element.classList.remove("protyle-wysiwyg--select");
        element.removeAttribute("select-start");
        element.removeAttribute("select-end");
        undoOperations.push({
            action: "update",
            id,
            data: element.outerHTML
        });
        cb(element as HTMLElement);
        operations.push({
            action: "update",
            id,
            data: element.outerHTML
        });
    });
    transaction(protyle, operations, undoOperations);
};
