import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {focusBlock, focusByWbr, focusSideBlock, getEditorRange} from "../util/selection";
import {getContenteditableElement, getFirstBlock, getTopAloneElement} from "./getBlock";
import {Constants} from "../../constants";
import {blockRender} from "../render/blockRender";
import {processRender} from "../util/processCode";
import {highlightRender} from "../render/highlightRender";
import {hasClosestBlock, hasClosestByAttribute, hasTopClosestByAttribute, isInEmbedBlock} from "../util/hasClosest";
import {setFold, zoomOut} from "../../menus/protyle";
import {disabledProtyle, enableProtyle, onGet} from "../util/onGet";
/// #if !MOBILE
import {getAllModels} from "../../layout/getAll";
/// #endif
import {avRender, refreshAV} from "../render/av/render";
import {removeFoldHeading} from "../util/heading";
import {cancelSB, genEmptyElement, genSBElement} from "../../block/util";
import {hideElements} from "../ui/hideElements";
import {reloadProtyle} from "../util/reload";
import {countBlockWord} from "../../layout/status";
import {isPaidUser, needSubscribe} from "../../util/needSubscribe";
import {resize} from "../util/resize";
import {processClonePHElement} from "../render/util";
import {scrollCenter} from "../../util/highlightById";

const removeTopElement = (updateElement: Element, protyle: IProtyle) => {
    // 移动到其他文档中，该块需移除
    // TODO 文档没有打开时，需要通过后台获取 getTopAloneElement
    const topAloneElement = getTopAloneElement(updateElement);
    const doOperations: IOperation[] = [];
    if (topAloneElement !== updateElement) {
        updateElement.remove();
        doOperations.push({
            action: "delete",
            id: topAloneElement.getAttribute("data-node-id")
        });
    }
    topAloneElement.remove();
    if (protyle.wysiwyg.element.childElementCount === 0) {
        if (protyle.block.rootID === protyle.block.id) {
            const newId = Lute.NewNodeID();
            const newElement = genEmptyElement(false, false, newId);
            doOperations.push({
                action: "insert",
                data: newElement.outerHTML,
                id: newId,
                parentID: protyle.block.parentID
            });
            protyle.wysiwyg.element.innerHTML = newElement.outerHTML;
        } else {
            zoomOut({
                protyle,
                id: protyle.block.rootID,
                isPushBack: false,
                focusId: protyle.block.id,
            });
        }
    }
    if (doOperations.length > 0) {
        transaction(protyle, doOperations, []);
    }
};

// 用于执行操作，外加处理当前编辑器中块引用、嵌入块的更新
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
        if (((0 !== window.siyuan.config.sync.provider && isPaidUser()) ||
                (0 === window.siyuan.config.sync.provider && !needSubscribe(""))) &&
            window.siyuan.config.repo.key && window.siyuan.config.sync.enabled) {
            document.getElementById("toolbarSync").classList.remove("fn__none");
        }
        /// #endif
        let range: Range;
        if (getSelection().rangeCount > 0) {
            range = getSelection().getRangeAt(0);
        }
        response.data[0].doOperations.forEach((operation: IOperation) => {
            if (operation.action === "unfoldHeading" || operation.action === "foldHeading") {
                processFold(operation, protyle);
                return;
            }
            if (operation.action === "update") {
                if (protyle.options.backlinkData) {
                    // 反链中有多个相同块的情况
                    Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`)).forEach(item => {
                        if (!isInEmbedBlock(item)) {
                            if (range && (item === range.startContainer || item.contains(range.startContainer))) {
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
                return;
            }
            if (operation.action === "delete" || operation.action === "append") {
                if (protyle.options.backlinkData) {
                    Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`)).forEach(item => {
                        if (!isInEmbedBlock(item) && !item.contains(range.startContainer)) {
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
                hideElements(["gutter"], protyle);
                return;
            }
            if (operation.action === "move") {
                if (protyle.options.backlinkData) {
                    const updateElements: Element[] = [];
                    Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`)).forEach(item => {
                        if (!isInEmbedBlock(item)) {
                            const topElement = hasTopClosestByAttribute(item, "data-node-id", null);
                            if (topElement && !topElement.contains(range.startContainer)) {
                                // 当前操作块不再进行操作，否则光标丢失 https://github.com/siyuan-note/siyuan/issues/13946
                                updateElements.push(item);
                            }
                        }
                    });
                    let hasFind = false;
                    if (operation.previousID && updateElements.length > 0) {
                        Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.previousID}"]`)).forEach(item => {
                            if (!isInEmbedBlock(item) && !item.nextElementSibling.contains(range.startContainer)) {
                                item.after(processClonePHElement(updateElements[0].cloneNode(true) as Element));
                                hasFind = true;
                            }
                        });
                    } else if (updateElements.length > 0) {
                        Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.parentID}"]`)).forEach(item => {
                            if (!isInEmbedBlock(item) && !getFirstBlock(item).contains(range.startContainer)) {
                                const cloneElement = processClonePHElement(updateElements[0].cloneNode(true) as Element);
                                // 列表特殊处理
                                if (item.firstElementChild?.classList.contains("protyle-action")) {
                                    item.firstElementChild.after(cloneElement);
                                } else if (item.classList.contains("callout")) {
                                    item.querySelector(".callout-content").prepend(cloneElement);
                                } else {
                                    item.prepend(cloneElement);
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
                    if (item.querySelector(`[data-node-id="${operation.id}"],[data-node-id="${operation.parentID}"],[data-node-id="${operation.previousID}"]`)) {
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
                                !item.contains(range.startContainer) && // 当前操作块不再进行操作
                                !hasClosestByAttribute(item, "data-node-id", operation.id) && // 段落转列表会在段落后插入新列表
                                !isInEmbedBlock(item)) {
                                item.insertAdjacentHTML("afterend", operation.data);
                                cursorElements.push(item.nextElementSibling);
                            }
                        });
                    } else {
                        Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.parentID}"]`)).forEach(item => {
                            if (!isInEmbedBlock(item) && !item.contains(range.startContainer)) {
                                // 列表特殊处理
                                if (item.firstElementChild && item.firstElementChild.classList.contains("protyle-action") &&
                                    item.firstElementChild.nextElementSibling?.getAttribute("data-node-id") !== operation.id) {
                                    item.firstElementChild.insertAdjacentHTML("afterend", operation.data);
                                    cursorElements.push(item.firstElementChild.nextElementSibling);
                                } else if (item.classList.contains("callout") &&
                                    item.querySelector("[data-node-id]")?.getAttribute("data-node-id") !== operation.id) {
                                    item.querySelector(".callout-content").insertAdjacentHTML("afterbegin", operation.data);
                                    cursorElements.push(item.querySelector("[data-node-id]"));
                                } else if (item.firstElementChild.getAttribute("data-node-id") !== operation.id) {
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
                protyle.wysiwyg.element.querySelectorAll("[parent-heading]").forEach(item => {
                    item.remove();
                });
            }
        });

        // 删除仅有的折叠标题后展开内容为空
        if (protyle.wysiwyg.element.childElementCount === 0 &&
            // 聚焦时不需要新增块，否则会导致 https://github.com/siyuan-note/siyuan/issues/12326 第一点
            !protyle.block.showAll) {
            const newID = Lute.NewNodeID();
            const emptyElement = genEmptyElement(false, true, newID);
            protyle.wysiwyg.element.insertAdjacentElement("afterbegin", emptyElement);
            transaction(protyle, [{
                action: "insert",
                data: emptyElement.outerHTML,
                id: newID,
                parentID: protyle.block.parentID
            }]);
            // 不能撤销，否则就无限循环了
            focusByWbr(emptyElement, range);
        }
    });
};

const updateEmbed = (protyle: IProtyle, operation: IOperation) => {
    let updatedEmbed = false;

    const updateHTML = (item: Element, html: string) => {
        const tempElement = document.createElement("template");
        tempElement.innerHTML = protyle.lute.SpinBlockDOM(html);
        tempElement.content.querySelectorAll('[contenteditable="true"]').forEach(editItem => {
            editItem.setAttribute("contenteditable", "false");
        });
        tempElement.content.querySelectorAll(".protyle-wysiwyg--select").forEach(selectItem => {
            selectItem.classList.remove("protyle-wysiwyg--select");
        });
        const wbrElement = tempElement.content.querySelector("wbr");
        if (wbrElement) {
            wbrElement.remove();
        }
        item.outerHTML = tempElement.innerHTML;
        updatedEmbed = true;
    };

    const allTempElement = document.createElement("template");
    allTempElement.innerHTML = operation.data;
    protyle.wysiwyg.element.querySelectorAll('[data-type="NodeBlockQueryEmbed"]').forEach((item) => {
        const matchElement = item.querySelectorAll(`[data-node-id="${operation.id}"]`);
        if (matchElement.length > 0) {
            matchElement.forEach(embedItem => {
                updateHTML(embedItem, operation.data);
            });
        } else {
            item.querySelectorAll(".protyle-wysiwyg__embed").forEach(embedBlockItem => {
                const newTempElement = allTempElement.content.querySelector(`[data-node-id="${embedBlockItem.getAttribute("data-id")}"]`);
                if (newTempElement && !isInEmbedBlock(newTempElement)) {
                    updateHTML(embedBlockItem.querySelector("[data-node-id]"), newTempElement.outerHTML);
                }
            });
        }
    });
    if (updatedEmbed) {
        processRender(protyle.wysiwyg.element);
        highlightRender(protyle.wysiwyg.element);
        avRender(protyle.wysiwyg.element, protyle);
    }
};

const deleteBlock = (updateElements: Element[], id: string, protyle: IProtyle, isUndo: boolean) => {
    if (isUndo && updateElements[0]) {
        focusSideBlock(updateElements[0]);
    }
    updateElements.forEach(item => {
        if (isUndo) {
            // https://github.com/siyuan-note/siyuan/issues/13617
            item.remove();
        } else {
            // 需移除顶层，否则删除唯一的列表项后列表无法清除干净 https://github.com/siyuan-note/siyuan/issues/12326 第一点
            const topElement = getTopAloneElement(item);
            if (topElement) {
                topElement.remove();
            }
        }
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
        // 图标撤销后无法渲染
        if (item.getAttribute("data-subtype") === "echarts") {
            item.outerHTML = protyle.lute.SpinBlockDOM(operation.data);
        } else {
            item.outerHTML = operation.data;
        }
    });
    Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`)).find(item => {
        if (!isInEmbedBlock(item)) {
            if (item.getAttribute("data-type") === "NodeBlockQueryEmbed") {
                item.removeAttribute("data-render");
            }
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
};

// 用于推送和撤销
export const onTransaction = (protyle: IProtyle, operation: IOperation, isUndo: boolean) => {
    const updateElements: Element[] = [];
    Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`)).forEach(item => {
        if (!isInEmbedBlock(item)) {
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
            item.removeAttribute("fold");
            // undo 会走 transaction
            if (isUndo) {
                return;
            }
            const embedElement = isInEmbedBlock(item);
            if (embedElement) {
                embedElement.removeAttribute("data-render");
                blockRender(protyle, embedElement);
                return;
            }
            if (operation.retData) { // undo 的时候没有 retData
                removeUnfoldRepeatBlock(operation.retData, protyle);
                item.insertAdjacentHTML("afterend", operation.retData);
            }
            if (operation.data === "remove") {
                item.remove();
            }
        });
        if (operation.retData) {
            if (protyle.disabled) {
                disabledProtyle(protyle);
            }
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
        // undo 会走 transaction
        if (isUndo) {
            return;
        }
        if (operation.retData) {
            operation.retData.forEach((item: string) => {
                let embedElement: HTMLElement | false;
                Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${item}"]`)).find(itemElement => {
                    embedElement = isInEmbedBlock(itemElement);
                    if (embedElement) {
                        return true;
                    }
                    itemElement.remove();
                });
                // 折叠嵌入块的父级
                if (embedElement) {
                    embedElement.removeAttribute("data-render");
                    blockRender(protyle, embedElement);
                }
            });
            if (protyle.wysiwyg.element.childElementCount === 0) {
                zoomOut({
                    protyle,
                    id: protyle.block.rootID,
                    isPushBack: false,
                    focusId: operation.id,
                });
            }
        }
        return;
    }
    if (operation.action === "delete") {
        if (updateElements.length > 0 || !isUndo) {
            deleteBlock(updateElements, operation.id, protyle, isUndo);
        } else if (isUndo) {
            zoomOut({
                protyle,
                id: protyle.block.rootID,
                isPushBack: false,
                focusId: operation.id,
                callback() {
                    Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`)).forEach(item => {
                        if (!isInEmbedBlock(item)) {
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
        // 缩放后仅更新局部 https://github.com/siyuan-note/siyuan/issues/14326
        if (updateElements.length === 0) {
            const newUpdateElement = protyle.wysiwyg.element.querySelector("[data-node-id]");
            if (newUpdateElement) {
                const newUpdateId = newUpdateElement.getAttribute("data-node-id");
                const tempElement = document.createElement("template");
                tempElement.innerHTML = operation.data;
                const newTempElement = tempElement.content.querySelector(`[data-node-id="${newUpdateId}"]`);
                if (newTempElement) {
                    updateElements.push(newUpdateElement);
                    operation.data = newTempElement.outerHTML;
                    operation.id = newUpdateId;
                    // https://github.com/siyuan-note/siyuan/issues/14326#issuecomment-2746140335
                    for (let i = 1; i < protyle.wysiwyg.element.childElementCount; i++) {
                        protyle.wysiwyg.element.childNodes[i].remove();
                        i--;
                    }
                }
            }
        }
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
                        if (!isInEmbedBlock(item)) {
                            updateElements.push(item);
                        }
                    });
                    updateBlock(updateElements, protyle, operation, isUndo);
                }
            });
        } else { // updateElements 没有包含嵌入块，在悬浮层编辑嵌入块时，嵌入块也需要更新
            // 更新 ws 嵌入块
            updateEmbed(protyle, operation);
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
        let avHTML = "";
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
                memoHTML = `<div class="protyle-attr--memo ariaLabel" aria-label="${escapeHTML}" data-position="north"><svg><use xlink:href="#iconM"></use></svg></div>`;
            } else if (key === "custom-avs" && data.new["av-names"]) {
                avHTML = `<div class="protyle-attr--av"><svg><use xlink:href="#iconDatabase"></use></svg>${data.new["av-names"]}</div>`;
            }
        });
        let nodeAttrHTML = bookmarkHTML + nameHTML + aliasHTML + memoHTML + avHTML;
        if (protyle.block.rootID === operation.id) {
            // 文档
            if (protyle.title) {
                if (data.new["custom-avs"] && !data.new["av-names"]) {
                    nodeAttrHTML += protyle.title.element.querySelector(".protyle-attr--av")?.outerHTML || "";
                }
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
            if (data.new.icon !== data.old.icon ||
                data.new["title-img"] !== data.old["title-img"] ||
                data.new.tags !== data.old.tags && protyle.background) {
                /// #if MOBILE
                protyle = window.siyuan.mobile.editor.protyle;
                /// #endif
                protyle.background.ial.icon = data.new.icon;
                protyle.background.ial.tags = data.new.tags;
                protyle.background.ial["title-img"] = data.new["title-img"];
                protyle.background.render(protyle.background.ial, protyle.block.rootID);
                protyle.model?.parent.setDocIcon(data.new.icon);
            }
            return;
        }
        protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`).forEach((item: HTMLElement) => {
            if (item.getAttribute("data-type") === "NodeThematicBreak") {
                return;
            }
            Object.keys(data.old).forEach(key => {
                item.removeAttribute(key);
                if (key === "custom-avs") {
                    item.removeAttribute("av-names");
                }
            });
            if (data.new.style && data.new[Constants.CUSTOM_RIFF_DECKS] && data.new[Constants.CUSTOM_RIFF_DECKS] !== data.old[Constants.CUSTOM_RIFF_DECKS]) {
                data.new.style += ";animation:addCard 450ms linear";
            }
            Object.keys(data.new).forEach(key => {
                if ("id" === key) {
                    // 设置属性以后不应该给块元素添加 id 属性 No longer add the `id` attribute to block elements after setting the attribute https://github.com/siyuan-note/siyuan/issues/15327
                    return;
                }

                item.setAttribute(key, data.new[key]);
                if (key === Constants.CUSTOM_RIFF_DECKS &&
                    data.new[Constants.CUSTOM_RIFF_DECKS] !== data.old[Constants.CUSTOM_RIFF_DECKS]) {
                    item.style.animation = "addCard 450ms linear";
                    setTimeout(() => {
                        if (item.parentElement) {
                            item.style.animation = "";
                        } else {
                            protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`).forEach((realItem: HTMLElement) => {
                                realItem.style.animation = "";
                            });
                        }
                    }, 450);
                }
            });
            if (data["data-av-type"]) {
                item.setAttribute("data-av-type", data["data-av-type"]);
            }
            const attrElements = item.querySelectorAll(".protyle-attr");
            const attrElement = attrElements[attrElements.length - 1];
            if (data.new["custom-avs"] && !data.new["av-names"]) {
                nodeAttrHTML += attrElement.querySelector(".protyle-attr--av")?.outerHTML || "";
            }
            const refElement = attrElement.querySelector(".protyle-attr--refcount");
            if (refElement) {
                nodeAttrHTML += refElement.outerHTML;
            }
            attrElement.innerHTML = nodeAttrHTML + Constants.ZWSP;
        });
        return;
    }
    if (operation.action === "move") {
        if (operation.context?.ignoreProcess === "true") {
            return;
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
        let range;
        if (isUndo && getSelection().rangeCount > 0) {
            range = getSelection().getRangeAt(0);
            const rangeBlockElement = hasClosestBlock(range.startContainer);
            if (rangeBlockElement) {
                if (getContenteditableElement(rangeBlockElement)) {
                    range.insertNode(document.createElement("wbr"));
                } else {
                    getContenteditableElement(updateElements[0])?.insertAdjacentHTML("afterbegin", "<wbr>");
                }
            }
        }
        let hasFind = false;
        if (operation.previousID && updateElements.length > 0) {
            const previousElement = protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.previousID}"]`);
            if (previousElement.length === 0 && protyle.options.backlinkData && isUndo && getSelection().rangeCount > 0) {
                // 反链面板删除超级块中的最后一个段落块后撤销重做
                const blockElement = hasTopClosestByAttribute(range.startContainer, "data-node-id", null);
                if (blockElement) {
                    blockElement.before(processClonePHElement(updateElements[0].cloneNode(true) as Element));
                    hasFind = true;
                }
            } else {
                previousElement.forEach(item => {
                    if (!isInEmbedBlock(item)) {
                        item.after(processClonePHElement(updateElements[0].cloneNode(true) as Element));
                        hasFind = true;
                    }
                });
            }
        } else if (updateElements.length > 0) {
            const parentElement = protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.parentID}"]`);
            if (!protyle.options.backlinkData && operation.parentID === protyle.block.parentID && !protyle.block.showAll) {
                protyle.wysiwyg.element.prepend(processClonePHElement(updateElements[0].cloneNode(true) as Element));
                hasFind = true;
            } else if (parentElement.length === 0 && protyle.options.backlinkData && isUndo && getSelection().rangeCount > 0) {
                // 反链面板删除超级块中的段落块后撤销再重做 https://github.com/siyuan-note/siyuan/issues/14496#issuecomment-2771372486
                const topBlockElement = hasTopClosestByAttribute(getSelection().getRangeAt(0).startContainer, "data-node-id", null);
                if (topBlockElement) {
                    topBlockElement.before(processClonePHElement(updateElements[0].cloneNode(true) as Element));
                    hasFind = true;
                }
            } else {
                parentElement.forEach(item => {
                    if (!isInEmbedBlock(item)) {
                        const cloneElement = processClonePHElement(updateElements[0].cloneNode(true) as Element);
                        // 列表特殊处理
                        if (item.firstElementChild?.classList.contains("protyle-action")) {
                            item.firstElementChild.after(cloneElement);
                        } else if (item.classList.contains("callout")) {
                            item.querySelector(".callout-content").prepend(cloneElement);
                        } else {
                            item.prepend(cloneElement);
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
                    if (!isInEmbedBlock(item)) {
                        focusBlock(item);
                        return true;
                    }
                });
                document.querySelectorAll("wbr").forEach(item => {
                    item.remove();
                });
            } else {
                focusByWbr(protyle.wysiwyg.element, range);
            }
        }
        // 更新 ws 嵌入块，undo 会在 transaction 中更新
        if (!isUndo) {
            protyle.wysiwyg.element.querySelectorAll('[data-type="NodeBlockQueryEmbed"]').forEach((item) => {
                if (item.querySelector(`[data-node-id="${operation.id}"],[data-node-id="${operation.parentID}"],[data-node-id="${operation.previousID}"]`)) {
                    item.removeAttribute("data-render");
                    blockRender(protyle, item);
                }
            });
        }
        return;
    }
    if (operation.action === "insert") {
        if (operation.context?.ignoreProcess === "true") {
            return;
        }
        const cursorElements = [];
        if (operation.previousID) {
            const previousElement = protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.previousID}"]`);
            if (previousElement.length === 0 && isUndo && protyle.wysiwyg.element.childElementCount === 0) {
                // https://github.com/siyuan-note/siyuan/issues/15396 操作后撤销
                protyle.wysiwyg.element.innerHTML = operation.data;
                cursorElements.push(protyle.wysiwyg.element.firstElementChild);
            } else if (previousElement.length === 0 && protyle.options.backlinkData && isUndo && getSelection().rangeCount > 0) {
                // 反链面板删除超级块中的最后一个段落块后撤销
                const blockElement = hasClosestBlock(getSelection().getRangeAt(0).startContainer);
                if (blockElement) {
                    blockElement.insertAdjacentHTML("beforebegin", operation.data);
                    cursorElements.push(blockElement.previousElementSibling);
                }
            } else {
                previousElement.forEach(item => {
                    const embedElement = isInEmbedBlock(item);
                    if (embedElement) {
                        // https://github.com/siyuan-note/siyuan/issues/5524
                        embedElement.removeAttribute("data-render");
                        blockRender(protyle, embedElement);
                    } else {
                        item.insertAdjacentHTML("afterend", operation.data);
                        cursorElements.push(item.nextElementSibling);
                    }
                });
            }
        } else if (operation.nextID) {
            Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.nextID}"]`)).forEach(item => {
                const embedElement = isInEmbedBlock(item);
                if (embedElement) {
                    // https://github.com/siyuan-note/siyuan/issues/5524
                    embedElement.removeAttribute("data-render");
                    blockRender(protyle, embedElement);
                } else {
                    item.insertAdjacentHTML("beforebegin", operation.data);
                    cursorElements.push(item.previousElementSibling);
                }
            });
        } else {
            const parentElement = protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.parentID}"]`);
            if (!protyle.options.backlinkData && operation.parentID === protyle.block.parentID && !protyle.block.showAll) {
                protyle.wysiwyg.element.insertAdjacentHTML("afterbegin", operation.data);
                cursorElements.push(protyle.wysiwyg.element.firstElementChild);
            } else if (parentElement.length === 0 && protyle.options.backlinkData && isUndo && getSelection().rangeCount > 0) {
                // 反链面板删除超级块中的段落块后撤销
                const blockElement = hasClosestBlock(getSelection().getRangeAt(0).startContainer);
                if (blockElement) {
                    blockElement.insertAdjacentHTML("beforebegin", operation.data);
                    cursorElements.push(blockElement.previousElementSibling);
                }
            } else {
                parentElement.forEach(item => {
                    if (!isInEmbedBlock(item)) {
                        // 列表特殊处理
                        if (item.firstElementChild?.classList.contains("protyle-action")) {
                            item.firstElementChild.insertAdjacentHTML("afterend", operation.data);
                            cursorElements.push(item.firstElementChild.nextElementSibling);
                        } else if (item.classList.contains("callout")) {
                            item.querySelector(".callout-content").insertAdjacentHTML("afterbegin", operation.data);
                            cursorElements.push(item.querySelector("[data-node-id]"));
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
            // https://github.com/siyuan-note/siyuan/issues/16554
            item.querySelector(".protyle-attr--av")?.remove();
            item.removeAttribute("custom-avs");
            item.getAttributeNames().forEach(attr => {
                if (attr.startsWith("custom-sy-av-s-text-")) {
                    item.removeAttribute(attr);
                }
            });
            processRender(item);
            highlightRender(item);
            avRender(item, protyle);
            blockRender(protyle, item);
            const wbrElement = item.querySelector("wbr");
            if (isUndo) {
                if (operation.context?.setRange === "true") {
                    const range = getEditorRange(item);
                    if (wbrElement) {
                        focusByWbr(item, range);
                    } else {
                        focusBlock(item);
                    }
                }
            } else if (wbrElement) {
                wbrElement.remove();
            }
        });
        protyle.wysiwyg.element.querySelectorAll("[parent-heading]").forEach(item => {
            item.remove();
        });
        return;
    }
    if (operation.action === "append") {
        // 目前只有移动块的时候会调用，反连面板就自己点击刷新处理。
        if (!protyle.options.backlinkData) {
            reloadProtyle(protyle, false);
        }
        return;
    }
    if (["addAttrViewCol", "updateAttrViewCol", "updateAttrViewColOptions",
        "updateAttrViewColOption", "updateAttrViewCell", "sortAttrViewRow", "sortAttrViewCol", "setAttrViewColHidden",
        "setAttrViewColWrap", "setAttrViewColWidth", "removeAttrViewColOption", "setAttrViewName", "setAttrViewFilters",
        "setAttrViewSorts", "setAttrViewColCalc", "removeAttrViewCol", "updateAttrViewColNumberFormat", "removeAttrViewBlock",
        "replaceAttrViewBlock", "updateAttrViewColTemplate", "setAttrViewColPin", "addAttrViewView", "setAttrViewColIcon",
        "removeAttrViewView", "setAttrViewViewName", "setAttrViewViewIcon", "duplicateAttrViewView", "sortAttrViewView",
        "updateAttrViewColRelation", "setAttrViewPageSize", "updateAttrViewColRollup", "sortAttrViewKey", "setAttrViewColDesc",
        "duplicateAttrViewKey", "setAttrViewViewDesc", "setAttrViewCoverFrom", "setAttrViewCoverFromAssetKeyID",
        "setAttrViewBlockView", "setAttrViewCardSize", "setAttrViewCardAspectRatio", "hideAttrViewName", "setAttrViewShowIcon",
        "setAttrViewWrapField", "setAttrViewGroup", "removeAttrViewGroup", "hideAttrViewGroup", "sortAttrViewGroup",
        "foldAttrViewGroup", "hideAttrViewAllGroups", "setAttrViewFitImage", "setAttrViewDisplayFieldName",
        "insertAttrViewBlock", "setAttrViewColDateFillSpecificTime", "setAttrViewFillColBackgroundColor", "setAttrViewUpdatedIncludeTime",
        "setAttrViewCreatedIncludeTime"].includes(operation.action)) {
        // 撤销 transaction 会进行推送，需使用推送来进行刷新最新数据 https://github.com/siyuan-note/siyuan/issues/13607
        if (!isUndo) {
            refreshAV(protyle, operation);
        } else if (operation.action === "setAttrViewName") {
            // setAttrViewName 同文档不会推送，需手动刷新
            Array.from(protyle.wysiwyg.element.querySelectorAll(`.av[data-av-id="${operation.id}"]`)).forEach((item: HTMLElement) => {
                const titleElement = item.querySelector(".av__title") as HTMLElement;
                if (!titleElement) {
                    return;
                }
                titleElement.textContent = operation.data;
                titleElement.dataset.title = operation.data;
            });
        }
        return;
    }
    if (operation.action === "doUpdateUpdated") {
        updateElements.forEach(item => {
            item.setAttribute("updated", operation.data);
        });
        return;
    }
};

export const turnsIntoOneTransaction = async (options: {
    protyle: IProtyle,
    selectsElement: Element[],
    type: TTurnIntoOne,
    level?: TTurnIntoOneSub,
    unfocus?: boolean
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
        parentElement.innerHTML = `<div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div>`;
    } else if (options.type === "Blocks2Callout") {
        parentElement = document.createElement("div");
        parentElement.classList.add("callout");
        parentElement.setAttribute("data-node-id", id);
        parentElement.setAttribute("data-type", "NodeCallout");
        parentElement.setAttribute("contenteditable", "false");
        parentElement.setAttribute("data-subtype", "NOTE");
        parentElement.innerHTML = `<div class="callout-info"><span class="callout-icon">✏️</span><span class="callout-title">Note</span></div><div class="callout-content"></div><div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div>`;
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
        } else if (options.type === "Blocks2Callout") {
            doOperations.push({
                action: "move",
                id: itemId,
                previousID: itemPreviousId,
                parentID: id
            });
            parentElement.querySelector(".callout-content").insertAdjacentElement("beforeend", item);
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
    if ((["Blocks2Blockquote", "Blocks2Callout"].includes(options.type) || options.type.endsWith("Ls")) &&
        parentElement.parentElement.classList.contains("sb") && parentElement.parentElement.childElementCount === 2) {
        const cancelOperations = await cancelSB(options.protyle, parentElement.parentElement);
        doOperations.push(...cancelOperations.doOperations);
        undoOperations.splice(0, 0, ...cancelOperations.undoOperations);
    }
    transaction(options.protyle, doOperations, undoOperations);
    if (!options.unfocus) {
        focusBlock(options.protyle.wysiwyg.element.querySelector(`[data-node-id="${options.selectsElement[0].getAttribute("data-node-id")}"]`));
    }
    hideElements(["gutter"], options.protyle);
};

const removeUnfoldRepeatBlock = (html: string, protyle: IProtyle) => {
    const temp = document.createElement("template");
    temp.innerHTML = html;
    Array.from(temp.content.children).forEach(item => {
        protyle.wysiwyg.element.querySelector(`[data-node-id="${item.getAttribute("data-node-id")}"]`)?.remove();
    });
};

export const turnsIntoTransaction = (options: {
    protyle: IProtyle,
    selectsElement?: Element[],
    nodeElement?: Element,
    type: TTurnInto,
    level?: number,
    isContinue?: boolean,
    range?: Range
}) => {
    // https://github.com/siyuan-note/siyuan/issues/14505
    options.protyle.observerLoad?.disconnect();
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
        let isList = false;
        selectsElement.find((item, index) => {
            if (item.classList.contains("li")) {
                isList = true;
                return true;
            }
            if (item.nextElementSibling && selectsElement[index + 1] &&
                item.nextElementSibling === selectsElement[index + 1]) {
                isContinue = true;
            } else if (index !== selectsElement.length - 1) {
                isContinue = false;
                return true;
            }
        });
        if (isList) {
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
    let previousId: string;
    selectsElement.forEach((item: HTMLElement, index) => {
        item.classList.remove("protyle-wysiwyg--select");
        item.removeAttribute("select-start");
        item.removeAttribute("select-end");
        html += item.outerHTML;
        const id = item.getAttribute("data-node-id");

        const tempElement = document.createElement("template");
        if (!options.isContinue || options.level) {
            // @ts-ignore
            let newHTML = options.protyle.lute[options.type](item.outerHTML, options.level);
            tempElement.innerHTML = newHTML;

            if (!tempElement.content.querySelector(`[data-node-id="${id}"]`)) {
                undoOperations.push({
                    action: "insert",
                    id,
                    previousID: previousId || item.previousElementSibling?.getAttribute("data-node-id"),
                    data: item.outerHTML,
                    parentID: item.parentElement?.getAttribute("data-node-id") || options.protyle.block.parentID || options.protyle.block.rootID,
                });
                Array.from(tempElement.content.children).forEach((tempItem: HTMLElement) => {
                    const tempItemId = tempItem.getAttribute("data-node-id");
                    doOperations.push({
                        action: "insert",
                        id: tempItemId,
                        previousID: tempItem.previousElementSibling?.getAttribute("data-node-id") || item.previousElementSibling?.getAttribute("data-node-id"),
                        data: tempItem.outerHTML,
                        parentID: item.parentElement?.getAttribute("data-node-id") || options.protyle.block.parentID || options.protyle.block.rootID,
                    });
                    undoOperations.splice(0, 0, {
                        action: "delete",
                        id: tempItemId,
                    });
                });
                doOperations.push({
                    action: "delete",
                    id,
                });
                if (item === selectsElement[index + 1]?.previousElementSibling) {
                    previousId = id;
                } else {
                    previousId = undefined;
                }
            } else {
                let foldData;
                if (item.getAttribute("data-type") === "NodeHeading" && item.getAttribute("fold") === "1" &&
                    tempElement.content.firstElementChild.getAttribute("data-subtype") !== item.dataset.subtype) {
                    foldData = setFold(options.protyle, item, undefined, undefined, false, true);
                    newHTML = newHTML.replace(' fold="1"', "");
                }
                if (foldData && foldData.doOperations?.length > 0) {
                    doOperations.push(...foldData.doOperations);
                }
                undoOperations.push({
                    action: "update",
                    id,
                    data: item.outerHTML,
                });
                doOperations.push({
                    action: "update",
                    id,
                    data: newHTML
                });
                if (foldData && foldData.undoOperations?.length > 0) {
                    undoOperations.push(...foldData.undoOperations);
                }
            }
            item.outerHTML = newHTML;
        } else {
            undoOperations.push({
                action: "insert",
                id,
                previousID: doOperations[doOperations.length - 1]?.id || item.previousElementSibling?.getAttribute("data-node-id"),
                data: item.outerHTML,
                parentID: item.parentElement?.getAttribute("data-node-id") || options.protyle.block.parentID || options.protyle.block.rootID,
            });
            doOperations.push({
                action: "delete",
                id,
            });
            if (index === selectsElement.length - 1) {
                // @ts-ignore
                const newHTML = options.protyle.lute[options.type](html, options.level);
                tempElement.innerHTML = newHTML;
                Array.from(tempElement.content.children).forEach((tempItem: HTMLElement) => {
                    const tempItemId = tempItem.getAttribute("data-node-id");
                    doOperations.push({
                        action: "insert",
                        id: tempItemId,
                        previousID: tempItem.previousElementSibling?.getAttribute("data-node-id") || item.previousElementSibling?.getAttribute("data-node-id"),
                        data: tempItem.outerHTML,
                        parentID: item.parentElement?.getAttribute("data-node-id") || options.protyle.block.parentID || options.protyle.block.rootID,
                    });
                    undoOperations.splice(0, 0, {
                        action: "delete",
                        id: tempItemId,
                    });
                });
                item.outerHTML = newHTML;
            } else {
                item.remove();
            }
        }
    });
    transaction(options.protyle, doOperations, undoOperations);
    processRender(options.protyle.wysiwyg.element);
    highlightRender(options.protyle.wysiwyg.element);
    avRender(options.protyle.wysiwyg.element, options.protyle);
    blockRender(options.protyle, options.protyle.wysiwyg.element);
    if (range || options.range) {
        focusByWbr(options.protyle.wysiwyg.element, range || options.range);
    } else {
        focusBlock(options.protyle.wysiwyg.element.querySelector(`[data-node-id="${selectsElement[0].getAttribute("data-node-id")}"]`));
    }
    hideElements(["gutter"], options.protyle);
};

export const turnsOneInto = async (options: {
    protyle: IProtyle,
    nodeElement: Element,
    id: string,
    type: string,
    level?: number
}) => {
    if (!options.nodeElement.querySelector("wbr")) {
        getContenteditableElement(options.nodeElement)?.insertAdjacentHTML("afterbegin", "<wbr>");
    }
    if (["CancelBlockquote", "CancelList", "CancelCallout"].includes(options.type)) {
        for (const item of options.nodeElement.querySelectorAll('[data-type="NodeHeading"][fold="1"]')) {
            const itemId = item.getAttribute("data-node-id");
            item.removeAttribute("fold");
            const response = await fetchSyncPost("/api/transactions", {
                session: options.protyle.id,
                app: Constants.SIYUAN_APPID,
                transactions: [{
                    doOperations: [{
                        action: "unfoldHeading",
                        id: itemId,
                    }],
                    undoOperations: [{
                        action: "foldHeading",
                        id: itemId
                    }],
                }]
            });
            options.protyle.undo.add([{
                action: "unfoldHeading",
                id: itemId,
            }], [{
                action: "foldHeading",
                id: itemId
            }], options.protyle);
            item.insertAdjacentHTML("afterend", response.data[0].doOperations[0].retData);
        }
    }
    const oldHTML = options.nodeElement.outerHTML;
    let previousId = options.nodeElement.previousElementSibling?.getAttribute("data-node-id");
    if (!options.nodeElement.previousElementSibling && options.protyle.block.showAll) {
        const response = await fetchSyncPost("/api/block/getBlockRelevantIDs", {id: options.id});
        previousId = response.data.previousID;
    }
    const parentId = options.nodeElement.parentElement.getAttribute("data-node-id") || options.protyle.block.parentID;
    // @ts-ignore
    const newHTML = options.protyle.lute[options.type](options.nodeElement.outerHTML, options.level);
    options.nodeElement.outerHTML = newHTML;
    if (["CancelBlockquote", "CancelList", "CancelCallout"].includes(options.type)) {
        const tempElement = document.createElement("template");
        tempElement.innerHTML = newHTML;
        const doOperations: IOperation[] = [{
            action: "delete",
            id: options.id
        }];
        const undoOperations: IOperation[] = [];
        let tempPreviousId = previousId;
        Array.from(tempElement.content.children).forEach((item) => {
            const tempId = item.getAttribute("data-node-id");
            doOperations.push({
                action: "insert",
                data: item.outerHTML,
                id: tempId,
                previousID: tempPreviousId,
                parentID: parentId
            });
            undoOperations.push({
                action: "delete",
                id: tempId
            });
            tempPreviousId = tempId;
        });
        undoOperations.push({
            action: "insert",
            data: oldHTML,
            id: options.id,
            previousID: previousId,
            parentID: parentId
        });
        transaction(options.protyle, doOperations, undoOperations);
    } else {
        updateTransaction(options.protyle, options.id, newHTML, oldHTML);
    }
    focusByWbr(options.protyle.wysiwyg.element, getEditorRange(options.protyle.wysiwyg.element));
    options.protyle.wysiwyg.element.querySelectorAll('[data-type~="block-ref"]').forEach(item => {
        if (item.textContent === "") {
            fetchPost("/api/block/getRefText", {id: item.getAttribute("data-id")}, (response) => {
                item.innerHTML = response.data;
            });
        }
    });
    blockRender(options.protyle, options.protyle.wysiwyg.element);
    processRender(options.protyle.wysiwyg.element);
    highlightRender(options.protyle.wysiwyg.element);
    avRender(options.protyle.wysiwyg.element, options.protyle);
};

let transactionsTimeout: number;
export const transaction = (protyle: IProtyle, doOperations: IOperation[], undoOperations?: IOperation[]) => {
    if (doOperations.length === 0) {
        return;
    }
    if (!protyle) {
        // 文档树中点开属性->数据库后的变更操作 & 文档树添加到数据库
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
    if (undoOperations) {
        if (window.siyuan.config.fileTree.openFilesUseCurrentTab && protyle.model) {
            protyle.model.headElement.classList.remove("item--unupdate");
        }
        protyle.updated = true;
        if (needDebounce) {
            protyle.undo.replace(doOperations, protyle);
        } else {
            protyle.undo.add(doOperations, undoOperations, protyle);
        }
    }
    // 加速折叠 https://github.com/siyuan-note/siyuan/issues/11828
    if ((doOperations.length === 1 && (
        doOperations[0].action === "unfoldHeading" || doOperations[0].action === "setAttrViewBlockView" ||
        (doOperations[0].action === "setAttrs" && doOperations[0].data.startsWith('{"fold":'))
    )) || (doOperations.length === 2 && doOperations[0].action === "insertAttrViewBlock")) {
        // 防止 needDebounce 为 true
        protyle.transactionTime = time + Constants.TIMEOUT_INPUT * 2;
        fetchPost("/api/transactions", {
            session: protyle.id,
            app: Constants.SIYUAN_APPID,
            transactions: [{
                doOperations,
                undoOperations
            }]
        }, (response) => {
            response.data[0].doOperations.forEach((operation: IOperation) => {
                if (operation.action === "unfoldHeading" || operation.action === "foldHeading") {
                    processFold(operation, protyle);
                } else if (operation.action === "setAttrs") {
                    const gutterFoldElement = protyle.gutter.element.querySelector('[data-type="fold"]');
                    if (gutterFoldElement) {
                        gutterFoldElement.removeAttribute("disabled");
                    }
                    // 仅在 alt+click 箭头折叠时才会触发
                    protyle.wysiwyg.element.querySelectorAll('[data-type="NodeBlockQueryEmbed"]').forEach((item) => {
                        if (item.querySelector(`[data-node-id="${operation.id}"]`)) {
                            item.removeAttribute("data-render");
                            blockRender(protyle, item);
                        }
                    });
                }
            });
        });
        return;
    }
    window.clearTimeout(transactionsTimeout);
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
    transactionsTimeout = window.setTimeout(() => {
        promiseTransaction();
    }, Constants.TIMEOUT_INPUT * 2);

    // 插入块后会导致高度变化，从而产生再次定位 https://github.com/siyuan-note/siyuan/issues/11798
    doOperations.find(item => {
        if (item.action === "insert") {
            protyle.observerLoad?.disconnect();
            return true;
        }
    });
};

const processFold = (operation: IOperation, protyle: IProtyle) => {
    if (operation.action === "unfoldHeading" || operation.action === "foldHeading") {
        const gutterFoldElement = protyle.gutter.element.querySelector('[data-type="fold"]');
        if (gutterFoldElement) {
            gutterFoldElement.removeAttribute("disabled");
        }
        if (operation.action === "unfoldHeading") {
            const scrollTop = protyle.contentElement.scrollTop;
            protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`).forEach(item => {
                const embedElement = isInEmbedBlock(item);
                if (embedElement) {
                    embedElement.removeAttribute("data-render");
                    blockRender(protyle, embedElement);
                    return;
                }
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
            if (protyle.disabled) {
                disabledProtyle(protyle);
            }
            processRender(protyle.wysiwyg.element);
            highlightRender(protyle.wysiwyg.element);
            avRender(protyle.wysiwyg.element, protyle);
            blockRender(protyle, protyle.wysiwyg.element);
            if (operation.context?.focusId) {
                const focusElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${operation.context.focusId}"]`);
                focusBlock(focusElement);
                scrollCenter(protyle, focusElement);
            } else {
                protyle.contentElement.scrollTop = scrollTop;
                protyle.scroll.lastScrollTop = scrollTop;
            }
            return;
        }
        protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`).forEach(item => {
            const embedElement = isInEmbedBlock(item);
            if (embedElement) {
                embedElement.removeAttribute("data-render");
                blockRender(protyle, embedElement);
            }
        });
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
