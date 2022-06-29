import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {focusBlock, focusByRange, focusByWbr, focusSideBlock, getEditorRange} from "../util/selection";
import {getContenteditableElement, getTopAloneElement} from "./getBlock";
import {Constants} from "../../constants";
import {blockRender} from "../markdown/blockRender";
import {processRender} from "../util/processCode";
import {highlightRender} from "../markdown/highlightRender";
import {hasClosestBlock, hasClosestByAttribute} from "../util/hasClosest";
import {lockFile} from "../../dialog/processSystem";
import {setFold} from "../../menus/protyle";
import {addLoading} from "../ui/initUI";
import {onGet} from "../util/onGet";
/// #if !MOBILE
import {getAllModels} from "../../layout/getAll";
/// #endif
import {removeFoldHeading} from "../util/heading";
import {genEmptyElement, genSBElement} from "../../block/util";
import {hideElements} from "../ui/hideElements";

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
    const protyle = window.siyuan.transactions[0].protyle;
    const doOperations = window.siyuan.transactions[0].doOperations;
    const undoOperations = window.siyuan.transactions[0].undoOperations;
    // 1. * ;2. * ;3. a
    // 第一步请求没有返回前在 transaction 中会合并1、2步，此时第一步请求返回将被以下代码删除，在输入a时，就会出现 block not found，因此以下代码不能放入请求回掉中
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
            promiseTransactions();
        } else {
            promiseTransaction();
        }
        if (response.code === 1) {
            lockFile(protyle.block.rootID);
            return;
        }
        if (doOperations.length === 1 && (doOperations[0].action === "unfoldHeading" || doOperations[0].action === "foldHeading" || doOperations[0].action === "setAttrs")) {
            const gutterFoldElement = protyle.gutter.element.querySelector('[data-type="fold"]');
            if (gutterFoldElement) {
                gutterFoldElement.removeAttribute("disabled");
            }
            if (doOperations[0].action === "unfoldHeading") {
                const scrollTop = protyle.contentElement.scrollTop;
                protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${doOperations[0].id}"]`).forEach(item => {
                    if (!item.lastElementChild.classList.contains("protyle-attr")) {
                        item.lastElementChild.remove();
                    }
                    item.insertAdjacentHTML("afterend", response.data[0].doOperations[0].retData);
                    if (doOperations[0].data === "remove") {
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
                blockRender(protyle, protyle.wysiwyg.element);
                protyle.contentElement.scrollTop = scrollTop;
                protyle.scroll.lastScrollTop = scrollTop;
            } else if (doOperations[0].action === "foldHeading") {
                // 折叠标题后未触发动态加载 https://github.com/siyuan-note/siyuan/issues/4168
                if (protyle.wysiwyg.element.lastElementChild.getAttribute("data-eof") !== "true" &&
                    !protyle.scroll.element.classList.contains("fn__none")) {
                    fetchPost("/api/filetree/getDoc", {
                        id: protyle.wysiwyg.element.lastElementChild.getAttribute("data-node-id"),
                        mode: 2,
                        k: protyle.options.key || "",
                        size: Constants.SIZE_GET,
                    }, getResponse => {
                        onGet(getResponse, protyle, [Constants.CB_GET_APPEND, Constants.CB_GET_UNCHANGEID]);
                    });
                }
            }
            return;
        }

        doOperations.forEach(operation => {
            if (operation.action === "update") {
                // 当前编辑器中更新嵌入块
                updateEmbed(protyle, operation);
                // 更新引用块
                updateRef(protyle, operation.id);
                return;
            }
            if (operation.action === "delete" || operation.action === "append") {
                // 更新嵌入块
                protyle.wysiwyg.element.querySelectorAll('[data-type="NodeBlockQueryEmbed"]').forEach((item) => {
                    if (item.querySelector(`[data-node-id="${operation.id}"]`)) {
                        item.removeAttribute("data-render");
                        blockRender(protyle, item);
                    }
                });
                // 更新引用块
                protyle.wysiwyg.element.querySelectorAll(`[data-type="block-ref"][data-id="${operation.id}"]`).forEach(item => {
                    if (item.getAttribute("data-subtype") === "d") {
                        item.textContent = "block not found";
                    }
                });
                return;
            }
            if (operation.action === "move") {
                // 更新嵌入块
                protyle.wysiwyg.element.querySelectorAll('[data-type="NodeBlockQueryEmbed"]').forEach((item) => {
                    if (item.querySelector(`[data-node-id="${operation.id}"]`)) {
                        item.removeAttribute("data-render");
                        blockRender(protyle, item);
                    }
                });
                return;
            }
            // insert
            // 不更新嵌入块：在快速删除时重新渲染嵌入块会导致滚动条产生滚动从而触发 getDoc 请求，此时删除的块还没有写库，会把已删除的块 append 到文档底部，最终导致查询块失败、光标丢失
            // protyle.wysiwyg.element.querySelectorAll('[data-type="NodeBlockQueryEmbed"]').forEach((item) => {
            //     if (item.getAttribute("data-node-id") === operation.id) {
            //         item.removeAttribute("data-render");
            //         blockRender(protyle, item);
            //     }
            // });
            // 更新引用块
            updateRef(protyle, operation.id);
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
    }
};

export const promiseTransactions = () => {
    window.siyuan.transactionsTimeout = window.setInterval(() => {
        if (window.siyuan.transactions.length === 0) {
            return;
        }
        window.clearInterval(window.siyuan.transactionsTimeout);
        promiseTransaction();
    }, Constants.TIMEOUT_INPUT * 2);
};

// 用于推送和撤销
export const onTransaction = (protyle: IProtyle, operation: IOperation, focus: boolean) => {
    let updateElement: Element;
    Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`)).find(item => {
        if (!hasClosestByAttribute(item.parentElement, "data-type", "NodeBlockQueryEmbed")) {
            updateElement = item;
            return true;
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
        if (updateElement) {
            if (focus) {
                focusSideBlock(updateElement);
            }
            updateElement.remove();
        }
        // 更新 ws 嵌入块
        protyle.wysiwyg.element.querySelectorAll('[data-type="NodeBlockQueryEmbed"]').forEach((item) => {
            if (item.querySelector(`[data-node-id="${operation.id}"]`)) {
                item.removeAttribute("data-render");
                blockRender(protyle, item);
            }
        });
        // 更新 ws 引用块
        protyle.wysiwyg.element.querySelectorAll(`[data-type="block-ref"][data-id="${operation.id}"]`).forEach(item => {
            if (item.getAttribute("data-subtype") === "d") {
                item.textContent = "block not found";
            }
        });
        return;
    }
    if (operation.action === "update") {
        if (updateElement) {
            updateElement.outerHTML = operation.data;
            Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.id}"]`)).find(item => {
                if (item.getAttribute("data-type") === "NodeBlockQueryEmbed" // 引用转换为块嵌入，undo、redo 后也需要更新 updateElement
                    || !hasClosestByAttribute(item, "data-type", "NodeBlockQueryEmbed")) {
                    updateElement = item;
                    return true;
                }
            });
            const wbrElement = updateElement.querySelector("wbr");
            if (focus) {
                const range = getEditorRange(updateElement);
                if (wbrElement) {
                    focusByWbr(updateElement, range);
                } else {
                    focusBlock(updateElement);
                }
            } else if (wbrElement) {
                wbrElement.remove();
            }
            processRender(updateElement);
            highlightRender(updateElement);
            blockRender(protyle, updateElement);
        }
        // 更新 ws 嵌入块
        updateEmbed(protyle, operation);
        // 更新 ws 引用块
        updateRef(protyle, operation.id);
        return;
    }
    if (operation.action === "move") {
        let cloneRange;
        let range;
        if (focus && getSelection().rangeCount > 0) {
            range = getSelection().getRangeAt(0);
            cloneRange = {
                startContainer: range.startContainer,
                startOffset: range.startOffset,
                endContainer: range.endContainer,
                endOffset: range.endOffset,
            };
        }
        /// #if !MOBILE
        if (!updateElement) {
            // 打开两个相同的文档 A、A1，从 A 拖拽块 B 到 A1，在后续 ws 处理中，无法获取到拖拽出去的 B
            getAllModels().editor.forEach(editor => {
                const updateCloneElement = editor.editor.protyle.wysiwyg.element.querySelector(`[data-node-id="${operation.id}"]`);
                if (updateCloneElement) {
                    updateElement = updateCloneElement.cloneNode(true) as Element;
                }
            });
        }
        /// #endif
        if (operation.previousID) {
            let beforeElement: Element;
            Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.previousID}"]`)).find(item => {
                if (!hasClosestByAttribute(item.parentElement, "data-type", "NodeBlockQueryEmbed")) {
                    beforeElement = item;
                    return true;
                }
            });
            if (beforeElement && updateElement) {
                beforeElement.after(updateElement);
            } else if (updateElement && updateElement.parentElement) {
                removeTopElement(updateElement, protyle);
            }
        } else {
            let parentElement: Element;
            Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.parentID}"]`)).find(item => {
                if (!hasClosestByAttribute(item.parentElement, "data-type", "NodeBlockQueryEmbed")) {
                    parentElement = item;
                    return true;
                }
            });
            if (parentElement && updateElement) {
                // 列表特殊处理
                if (parentElement.firstElementChild?.classList.contains("protyle-action")) {
                    parentElement.firstElementChild.after(updateElement);
                } else {
                    parentElement.prepend(updateElement);
                }
            } else if (operation.parentID === protyle.block.parentID && updateElement) {
                protyle.wysiwyg.element.prepend(updateElement);
            } else if (updateElement && updateElement.parentElement) {
                removeTopElement(updateElement, protyle);
            }
        }
        if (focus && cloneRange && range) {
            if (operation.data === "focus") {
                focusBlock(updateElement);
            } else {
                range.setStart(cloneRange.startContainer, cloneRange.startOffset);
                range.setEnd(cloneRange.endContainer, cloneRange.endOffset);
                focusByRange(range);
            }
        }
        // 更新 ws 嵌入块
        protyle.wysiwyg.element.querySelectorAll('[data-type="NodeBlockQueryEmbed"]').forEach((item) => {
            if (item.querySelector(`[data-node-id="${operation.id}"]`)) {
                item.removeAttribute("data-render");
                blockRender(protyle, item);
            }
        });
        return;
    }
    if (operation.action === "insert") {
        let cursorElement;
        if (operation.previousID) {
            let beforeElement: Element;
            Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.previousID}"]`)).find(item => {
                if (!hasClosestByAttribute(item.parentElement, "data-type", "NodeBlockQueryEmbed")) {
                    beforeElement = item;
                    return true;
                }
            });
            if (beforeElement) {
                beforeElement.insertAdjacentHTML("afterend", operation.data);
                cursorElement = beforeElement.nextElementSibling as HTMLElement;
            }
        } else {
            let parentElement: Element;
            Array.from(protyle.wysiwyg.element.querySelectorAll(`[data-node-id="${operation.parentID}"]`)).find(item => {
                if (!hasClosestByAttribute(item.parentElement, "data-type", "NodeBlockQueryEmbed")) {
                    parentElement = item;
                    return true;
                }
            });
            if (parentElement) {
                // 列表特殊处理
                if (parentElement.firstElementChild?.classList.contains("protyle-action")) {
                    parentElement.firstElementChild.insertAdjacentHTML("afterend", operation.data);
                    cursorElement = parentElement.firstElementChild.nextElementSibling as HTMLElement;
                } else {
                    parentElement.insertAdjacentHTML("afterbegin", operation.data);
                    cursorElement = parentElement.firstElementChild as HTMLElement;
                }
            } else if (operation.parentID === protyle.block.parentID) {
                protyle.wysiwyg.element.insertAdjacentHTML("afterbegin", operation.data);
                cursorElement = protyle.wysiwyg.element.firstElementChild as HTMLElement;
            }
        }
        if (!cursorElement) {
            return;
        }
        processRender(cursorElement);
        highlightRender(cursorElement);
        blockRender(protyle, cursorElement);

        // https://github.com/siyuan-note/siyuan/issues/4420
        protyle.wysiwyg.element.querySelectorAll('[data-type="NodeHeading"]').forEach(item => {
            if (item.lastElementChild.getAttribute("spin") === "1") {
                item.lastElementChild.remove();
            }
        });

        const wbrElement = cursorElement.querySelector("wbr");
        if (focus) {
            const range = getEditorRange(cursorElement);
            if (wbrElement) {
                focusByWbr(cursorElement, range);
            } else {
                focusBlock(cursorElement);
            }
        } else if (wbrElement) {
            wbrElement.remove();
        }
        // 更新 ws 嵌入块
        protyle.wysiwyg.element.querySelectorAll(`[data-type="NodeBlockQueryEmbed"][data-node-id="${operation.id}"]`).forEach((item) => {
            item.removeAttribute("data-render");
            blockRender(protyle, item);
        });
        protyle.wysiwyg.element.querySelectorAll('[data-type="NodeBlockQueryEmbed"]').forEach((item) => {
            if (item.querySelector(`[data-node-id="${operation.id}"]`)) {
                item.removeAttribute("data-render");
                blockRender(protyle, item);
            }
        });
        // 更新 ws 引用块
        updateRef(protyle, operation.id);
        return;
    }
    if (operation.action === "append") {
        addLoading(protyle);
        fetchPost("/api/filetree/getDoc", {
            id: protyle.block.id,
            mode: 0,
            size: Constants.SIZE_GET,
        }, getResponse => {
            onGet(getResponse, protyle);
        });
    }
};

export const turnsIntoTransaction = (options: { protyle: IProtyle, selectsElement: Element[], type: string, level?: string }) => {
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
                html += `<div data-marker="*" data-subtype="t" data-node-id="${Lute.NewNodeID()}" data-type="NodeListItem" class="li"><div class="protyle-action protyle-action--task"><svg><use xlink:href="#iconUncheck"></use></svg></div><div class="protyle-attr" contenteditable="false"></div></div>`;
            }
        });
        parentElement.innerHTML = html + '<div class="protyle-attr" contenteditable="false"></div>';
    }
    const previousId = options.selectsElement[0].previousElementSibling ? options.selectsElement[0].previousElementSibling.getAttribute("data-node-id") : undefined;
    const parentId = options.selectsElement[0].parentElement.getAttribute("data-node-id") || options.protyle.block.parentID;
    const doOperations: IOperation[] = [{
        action: "insert",
        id,
        data: parentElement.outerHTML,
        previousID: previousId,
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
        const itemId = item.getAttribute("data-node-id");
        undoOperations.push({
            action: "move",
            id: itemId,
            previousID: itemPreviousId || previousId,
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
    });
    transaction(options.protyle, doOperations, undoOperations);
    focusBlock(options.protyle.wysiwyg.element.querySelector(`[data-node-id="${options.selectsElement[0].getAttribute("data-node-id")}"]`));
    hideElements(["gutter"], options.protyle);
};

export const turnIntoTransaction = async (options: { protyle: IProtyle, nodeElement: Element, id: string, type: string, level?: number }) => {
    if (!options.nodeElement.querySelector("wbr")) {
        getContenteditableElement(options.nodeElement)?.insertAdjacentHTML("afterbegin", "<wbr>");
    }
    if (options.type === "HLevel" && options.nodeElement.getAttribute("data-type") === "NodeHeading" &&
        options.nodeElement.getAttribute("fold") === "1") {
        setFold(options.protyle, options.nodeElement);
    }
    if (options.type === "CancelList" || options.type === "CancelBlockquote") {
        for await(const item of options.nodeElement.querySelectorAll('[data-type="NodeHeading"][fold="1"]')) {
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
            }]);
            item.insertAdjacentHTML("afterend", response.data[0].doOperations[0].retData);
        }
    }
    const oldHTML = options.nodeElement.outerHTML;
    const previousId = options.nodeElement.previousElementSibling?.getAttribute("data-node-id");
    const parentId = options.nodeElement.parentElement.getAttribute("data-node-id") || options.protyle.block.parentID;
    // @ts-ignore
    const newHTML = options.protyle.lute[options.type](options.nodeElement.outerHTML, options.level);
    options.nodeElement.outerHTML = newHTML;
    if (options.type === "CancelList" || options.type === "CancelBlockquote") {
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
    options.protyle.wysiwyg.element.querySelectorAll('[data-type="block-ref"]').forEach(item => {
        if (item.textContent === "") {
            fetchPost("/api/block/getRefText", {id: item.getAttribute("data-id")}, (response) => {
                item.textContent = response.data;
            });
        }
    });
    blockRender(options.protyle, options.protyle.wysiwyg.element);
    processRender(options.protyle.wysiwyg.element);
    highlightRender(options.protyle.wysiwyg.element);
};

export const phTransaction = (protyle: IProtyle, range: Range, nodeElement: HTMLElement, level: number) => {
    const id = nodeElement.getAttribute("data-node-id");
    const nodeType = nodeElement.getAttribute("data-type");
    range.insertNode(document.createElement("wbr"));
    if (nodeType === "NodeHeading") {
        const subType = parseInt(nodeElement.getAttribute("data-subtype").substr(1));
        if (subType === level) {
            turnIntoTransaction({protyle, nodeElement, id, type: "H2P"});
        } else {
            turnIntoTransaction({protyle, nodeElement, id, type: "HLevel", level});
        }
    } else if (nodeType === "NodeParagraph") {
        turnIntoTransaction({protyle, nodeElement, id, type: "P2H", level});
    }
};

const updateRef = (protyle: IProtyle, id: string, index = 0) => {
    if (index > 6) {
        return;
    }
    protyle.wysiwyg.element.querySelectorAll(`[data-type="block-ref"][data-id="${id}"]`).forEach(item => {
        if (item.getAttribute("data-subtype") === "d") {
            fetchPost("/api/block/getRefText", {id: id}, (response) => {
                item.textContent = response.data;
                const blockElement = hasClosestBlock(item);
                if (blockElement) {
                    updateRef(protyle, blockElement.getAttribute("data-node-id"), index + 1);
                }
            });
        }
    });
};

export const transaction = (protyle: IProtyle, doOperations: IOperation[], undoOperations?: IOperation[]) => {
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
