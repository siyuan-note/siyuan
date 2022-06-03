import {Constants} from "../../constants";
import {uploadFiles, uploadLocalFiles} from "../upload";
import {processPasteCode, processRender} from "./processCode";
import {writeText} from "./compatibility";
import {hasClosestBlock} from "./hasClosest";
import {focusByWbr, getEditorRange} from "./selection";
import {blockRender} from "../markdown/blockRender";
import * as dayjs from "dayjs";
import {highlightRender} from "../markdown/highlightRender";
import {transaction, updateTransaction} from "../wysiwyg/transaction";
import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {isDynamicRef, isFileAnnotation} from "../../util/functions";
import {insertHTML} from "./insertHTML";
import {scrollCenter} from "../../util/highlightById";
import {getContenteditableElement} from "../wysiwyg/getBlock";

export const pasteText = (protyle: IProtyle, textPlain: string, nodeElement: Element) => {
    const range = getEditorRange(protyle.wysiwyg.element);
    const id = nodeElement.getAttribute("data-node-id");
    if (nodeElement.getAttribute("data-type") === "NodeCodeBlock") {
        // 粘贴在代码位置
        range.insertNode(document.createElement("wbr"));
        const html = nodeElement.outerHTML;
        range.deleteContents();
        range.insertNode(document.createTextNode(textPlain.replace(/\r\n|\r|\u2028|\u2029/g, "\n")));
        range.collapse(false);
        range.insertNode(document.createElement("wbr"));
        nodeElement.outerHTML = protyle.lute.SpinBlockDOM(nodeElement.outerHTML);
        nodeElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${id}"]`) as HTMLElement;
        highlightRender(nodeElement);
        nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
        updateTransaction(protyle, id, nodeElement.outerHTML, html);
        return;
    }
    if (range.toString() !== "") {
        if (isDynamicRef(textPlain)) {
            textPlain = textPlain.replace(/'.+'\)\)$/, ` "${range.toString()}"))`);
        } else if (isFileAnnotation(textPlain)) {
            textPlain = textPlain.replace(/".+">>$/, `"${range.toString()}">>`);
        } else if (protyle.lute.IsValidLinkDest(textPlain)) {
            textPlain = `[${range.toString()}](${textPlain})`;
        }
    }
    insertHTML(protyle.lute.Md2BlockDOM(textPlain), protyle);

    blockRender(protyle, protyle.wysiwyg.element);
    processRender(protyle.wysiwyg.element);
    highlightRender(protyle.wysiwyg.element);
    if (textPlain.indexOf("[[") === -1 && textPlain.indexOf("((") === -1 && textPlain.indexOf("【【") === -1 && textPlain.indexOf("（（") === -1) {
        protyle.hint.render(protyle);
    }
    scrollCenter(protyle);
};

export const paste = async (protyle: IProtyle, event: (ClipboardEvent | DragEvent) & { target: HTMLElement }) => {
    event.stopPropagation();
    event.preventDefault();

    let textHTML;
    let textPlain;
    let files;
    if ("clipboardData" in event) {
        textHTML = event.clipboardData.getData("text/html");
        textPlain = event.clipboardData.getData("text/plain");
        files = event.clipboardData.files;
    } else {
        textHTML = event.dataTransfer.getData("text/html");
        textPlain = event.dataTransfer.getData("text/plain");
        if (event.dataTransfer.types[0] === "Files") {
            files = event.dataTransfer.items;
        }
    }
    /// #if !MOBILE
    if (!textHTML && !textPlain && ("clipboardData" in event) && "darwin" !== window.siyuan.config.system.os) {
        const xmlString = await fetchSyncPost("/api/clipboard/readFilePaths", {});
        if (xmlString.data.length > 0) {
            uploadLocalFiles(xmlString.data, protyle);
            writeText("");
            return;
        }
    }
    /// #endif

    // 浏览器地址栏拷贝处理
    if (textHTML.replace(/&amp;/g, "&").replace(/<(|\/)(html|body|meta)[^>]*?>/ig, "").trim() ===
        `<a href="${textPlain}">${textPlain}</a>` ||
        textHTML.replace(/&amp;/g, "&").replace(/<(|\/)(html|body|meta)[^>]*?>/ig, "").trim() ===
        `<!--StartFragment--><a href="${textPlain}">${textPlain}</a><!--EndFragment-->`) {
        textHTML = "";
    }

    // process word
    const doc = new DOMParser().parseFromString(textHTML, "text/html");
    let wordHTML = "";
    if (doc.body) {
        wordHTML = doc.body.innerHTML;
    }
    // 复制空格的时候不能让其转换为空
    if (wordHTML !== Constants.ZWSP) {
        textHTML = wordHTML;
    }
    textHTML = Lute.Sanitize(textHTML);

    const nodeElement = hasClosestBlock(event.target);
    if (!nodeElement) {
        if (files && files.length > 0) {
            uploadFiles(protyle, files);
        }
        return;
    }
    protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select").forEach(item => {
        item.classList.remove("protyle-wysiwyg--select");
    });
    const code = processPasteCode(textHTML, textPlain);
    const range = getEditorRange(protyle.wysiwyg.element);
    const id = nodeElement.getAttribute("data-node-id");
    // process code
    if (nodeElement.getAttribute("data-type") === "NodeCodeBlock") {
        // 粘贴在代码位置
        range.insertNode(document.createElement("wbr"));
        const html = nodeElement.outerHTML;
        range.deleteContents();
        range.insertNode(document.createTextNode(textPlain.replace(/\r\n|\r|\u2028|\u2029/g, "\n")));
        range.collapse(false);
        range.insertNode(document.createElement("wbr"));
        getContenteditableElement(nodeElement).removeAttribute("data-render");
        highlightRender(nodeElement);
        nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
        updateTransaction(protyle, id, nodeElement.outerHTML, html);
        setTimeout(() => {
            scrollCenter(protyle, nodeElement as Element);
        }, Constants.TIMEOUT_BLOCKLOAD);
        return;
    } else if (code) {
        if (!code.startsWith('<div data-type="NodeCodeBlock" class="code-block" data-node-id="')) {
            const wbrElement = document.createElement("wbr");
            range.insertNode(wbrElement);
            const html = nodeElement.outerHTML;
            wbrElement.remove();
            range.deleteContents();
            const tempElement = document.createElement("code");
            tempElement.textContent = code;
            range.insertNode(document.createElement("wbr"));
            range.insertNode(tempElement);
            updateTransaction(protyle, nodeElement.getAttribute("data-node-id"), nodeElement.outerHTML, html);
            focusByWbr(protyle.wysiwyg.element, range);
        } else {
            nodeElement.insertAdjacentHTML("afterend", code);
            const codeElement = nodeElement.nextElementSibling as HTMLElement;
            transaction(protyle, [{
                action: "insert",
                data: codeElement.outerHTML,
                id: codeElement.getAttribute("data-node-id"),
                previousID: id
            }], [{
                action: "delete",
                id: codeElement.getAttribute("data-node-id")
            }]);
            highlightRender(codeElement);
        }
    } else {
        let isHTML = false;
        if (textHTML.startsWith(Constants.ZWSP) || textHTML.endsWith(Constants.ZWSP)) {
            isHTML = true;
        } else if (textHTML.replace("<!--StartFragment--><!--EndFragment-->", "").trim() !== "") {
            textHTML = textHTML.replace("<!--StartFragment-->", "").replace("<!--EndFragment-->", "").trim();
            // 浏览器上复制当个图片应拷贝到本地，excel 中的复制需粘贴
            if (files && files.length === 1 && textHTML.indexOf("<img") > -1) {
                isHTML = false;
            } else {
                isHTML = true;
            }
        }
        if (isHTML) {
            const tempElement = document.createElement("div");
            if (textHTML.startsWith(Constants.ZWSP)) {
                // 剪切块内容后粘贴
                tempElement.innerHTML = textHTML.substr(1);
                let isBlock = false;
                tempElement.querySelectorAll("[data-node-id]").forEach((e) => {
                    e.classList.remove("protyle-wysiwyg--select");
                    isBlock = true;
                });
                if (nodeElement.classList.contains("table")) {
                    isBlock = false;
                }
                insertHTML(tempElement.innerHTML, protyle, isBlock);
                // 转换为 md，避免再次粘贴 ID 重复
                const tempMd = protyle.lute.BlockDOM2StdMd(tempElement.innerHTML);
                writeText(tempMd);
                if (tempMd.indexOf("[[") === -1 && tempMd.indexOf("((") === -1 && tempMd.indexOf("【【") === -1 && tempMd.indexOf("（（") === -1) {
                    protyle.hint.render(protyle);
                }
            } else if (textHTML.endsWith(Constants.ZWSP)) {
                // 编辑器内部粘贴
                tempElement.innerHTML = textHTML.substr(0, textHTML.length - 1);
                tempElement.querySelectorAll("[data-node-id]").forEach((e) => {
                    const newId = Lute.NewNodeID();
                    e.setAttribute("data-node-id", newId);
                    e.classList.remove("protyle-wysiwyg--select");
                    if (e.getAttribute("updated")) {
                        e.setAttribute("updated", newId.split("-")[0]);
                    }
                });
                const tempInnerHTML = tempElement.innerHTML;
                insertHTML(tempInnerHTML, protyle);
                if (tempInnerHTML.indexOf("[[") === -1 && tempInnerHTML.indexOf("((") === -1 && tempInnerHTML.indexOf("【【") === -1 && tempInnerHTML.indexOf("（（") === -1) {
                    protyle.hint.render(protyle);
                }
            } else {
                tempElement.innerHTML = textHTML;
                tempElement.querySelectorAll("[style]").forEach((e) => {
                    e.removeAttribute("style");
                });
                // 移除空的 A 标签
                tempElement.querySelectorAll("a").forEach((e) => {
                    if (e.innerHTML.trim() === "") {
                        e.remove();
                    }
                });
                fetchPost("/api/lute/html2BlockDOM", {
                    dom: tempElement.innerHTML
                }, (response) => {
                    insertHTML(response.data, protyle);
                    protyle.wysiwyg.element.querySelectorAll('[data-type="block-ref"]').forEach(item => {
                        if (item.textContent === "") {
                            fetchPost("/api/block/getRefText", {id: item.getAttribute("data-id")}, (response) => {
                                item.textContent = response.data;
                            });
                        }
                    });
                    blockRender(protyle, protyle.wysiwyg.element);
                    processRender(protyle.wysiwyg.element);
                    highlightRender(protyle.wysiwyg.element);
                    if (response.data.indexOf("[[") === -1 && response.data.indexOf("((") === -1 && response.data.indexOf("【【") === -1 && response.data.indexOf("（（") === -1) {
                        protyle.hint.render(protyle);
                    }
                    scrollCenter(protyle);
                });
                return;
            }
        } else if (files && files.length > 0) {
            uploadFiles(protyle, files);
        } else if (textPlain.trim() !== "" && files && files.length === 0) {
            if (range.toString() !== "") {
                if (isDynamicRef(textPlain)) {
                    textPlain = textPlain.replace(/'.*'\)\)$/, ` "${Lute.EscapeHTMLStr(range.toString())}"))`);
                } else if (isFileAnnotation(textPlain)) {
                    textPlain = textPlain.replace(/".+">>$/, `"${Lute.EscapeHTMLStr(range.toString())}">>`);
                } else if (protyle.lute.IsValidLinkDest(textPlain)) {
                    textPlain = `[${range.toString()}](${textPlain})`;
                }
            }
            const textPlainDom = protyle.lute.Md2BlockDOM(textPlain);
            insertHTML(textPlainDom, protyle);
            if (textPlainDom.indexOf("[[") === -1 && textPlainDom.indexOf("((") === -1 && textPlainDom.indexOf("【【") === -1 && textPlainDom.indexOf("（（") === -1) {
                protyle.hint.render(protyle);
            }
        }
        blockRender(protyle, protyle.wysiwyg.element);
        processRender(protyle.wysiwyg.element);
        highlightRender(protyle.wysiwyg.element);
    }
    scrollCenter(protyle);
};
