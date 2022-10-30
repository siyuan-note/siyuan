import {Constants} from "../../constants";
import {uploadFiles, uploadLocalFiles} from "../upload";
import {processPasteCode, processRender} from "./processCode";
import {writeText} from "./compatibility";
/// #if !BROWSER
import {clipboard} from "electron";
/// #endif
import {hasClosestBlock} from "./hasClosest";
import {focusByWbr, getEditorRange} from "./selection";
import {blockRender} from "../markdown/blockRender";
import {highlightRender} from "../markdown/highlightRender";
import {updateTransaction} from "../wysiwyg/transaction";
import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {isDynamicRef, isFileAnnotation} from "../../util/functions";
import {insertHTML} from "./insertHTML";
import {scrollCenter} from "../../util/highlightById";
import {hideElements} from "../ui/hideElements";

const filterClipboardHint = (protyle: IProtyle, textPlain: string) => {
    let needRender = true;
    protyle.options.hint.extend.find(item => {
        if (item.key === textPlain) {
            needRender = false;
            return true;
        }
    });
    if (needRender) {
        protyle.hint.render(protyle);
    }
};

export const pasteAsPlainText = async (protyle: IProtyle) => {
    /// #if !BROWSER && !MOBILE
    let localFiles: string[] = [];
    if ("darwin" === window.siyuan.config.system.os) {
        const xmlString = clipboard.read("NSFilenamesPboardType");
        const domParser = new DOMParser();
        const xmlDom = domParser.parseFromString(xmlString, "application/xml");
        Array.from(xmlDom.getElementsByTagName("string")).forEach(item => {
            localFiles.push(item.childNodes[0].nodeValue);
        });
    } else {
        const xmlString = await fetchSyncPost("/api/clipboard/readFilePaths", {});
        if (xmlString.data.length > 0) {
            localFiles = xmlString.data;
        }
    }
    if (localFiles.length > 0) {
        uploadLocalFiles(localFiles, protyle, false);
        writeText("");
    } else {
        protyle.lute.SetHTMLTag2TextMark(true); // 临时设置 Lute 解析参数，行级元素键盘和下划线无法粘贴为纯文本 https://github.com/siyuan-note/siyuan/issues/6220
        const dom = protyle.lute.InlineMd2BlockDOM(clipboard.readText());
        protyle.lute.SetHTMLTag2TextMark(false);
        insertHTML(protyle.lute.BlockDOM2Content(dom), protyle);
    }
    /// #endif
};

export const pasteText = (protyle: IProtyle, textPlain: string, nodeElement: Element) => {
    const range = getEditorRange(protyle.wysiwyg.element);
    if (nodeElement.getAttribute("data-type") === "NodeCodeBlock") {
        // 粘贴在代码位置
        insertHTML(textPlain, protyle);
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
    filterClipboardHint(protyle, textPlain);
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
    // 复制标题及其下方块使用 writeText，需将 textPLain 转换为 textHTML
    if (textPlain.endsWith(Constants.ZWSP) && !textHTML) {
        textHTML = textPlain;
    }
    /// #if !MOBILE
    if (!textHTML && !textPlain && ("clipboardData" in event)) {
        if ("darwin" === window.siyuan.config.system.os) {
            /// #if !BROWSER
            const xmlString = clipboard.read("NSFilenamesPboardType");
            const domParser = new DOMParser();
            const xmlDom = domParser.parseFromString(xmlString, "application/xml");
            const localFiles: string[] = [];
            Array.from(xmlDom.getElementsByTagName("string")).forEach(item => {
                localFiles.push(item.childNodes[0].nodeValue);
            });
            if (localFiles.length > 0) {
                uploadLocalFiles(localFiles, protyle, true);
                writeText("");
                return;
            }
            /// #endif
        } else {
            const xmlString = await fetchSyncPost("/api/clipboard/readFilePaths", {});
            if (xmlString.data.length > 0) {
                uploadLocalFiles(xmlString.data, protyle, true);
                writeText("");
                return;
            }
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

    // 剪切复制中首位包含空格或仅有空格 https://github.com/siyuan-note/siyuan/issues/5667
    if (!textHTML.endsWith(Constants.ZWSP) && !textHTML.startsWith(Constants.ZWSP)) {
        // process word
        const doc = new DOMParser().parseFromString(textHTML, "text/html");
        if (doc.body && doc.body.innerHTML) {
            textHTML = doc.body.innerHTML;
        }
        // windows 剪切板
        if (textHTML.startsWith("\n<!--StartFragment-->") && textHTML.endsWith("<!--EndFragment-->\n\n")) {
            textHTML = doc.body.innerHTML.trim().replace("<!--StartFragment-->", "").replace("<!--EndFragment-->", "");
        }
    }

    textHTML = Lute.Sanitize(textHTML);

    const nodeElement = hasClosestBlock(event.target);
    if (!nodeElement) {
        if (files && files.length > 0) {
            uploadFiles(protyle, files);
        }
        return;
    }
    hideElements(["select"], protyle);
    protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--hl").forEach(item => {
        item.classList.remove("protyle-wysiwyg--hl");
    });
    const code = processPasteCode(textHTML, textPlain);
    const range = getEditorRange(protyle.wysiwyg.element);
    // process code
    if (nodeElement.getAttribute("data-type") === "NodeCodeBlock") {
        // 粘贴在代码位置
        insertHTML(textPlain, protyle);
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
            insertHTML(code, protyle, true);
            highlightRender(protyle.wysiwyg.element);
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
                // mac 复制后会带有 <meta charset="utf-8"> https://github.com/siyuan-note/siyuan/issues/5751
                tempElement.innerHTML = textHTML.substr(1).replace('<meta charset="utf-8">', "");
                let isBlock = false;
                tempElement.querySelectorAll("[data-node-id]").forEach((e) => {
                    e.classList.remove("protyle-wysiwyg--select", "protyle-wysiwyg--hl");
                    isBlock = true;
                });
                if (nodeElement.classList.contains("table")) {
                    isBlock = false;
                }
                insertHTML(tempElement.innerHTML, protyle, isBlock);
                // 转换为 md，避免再次粘贴 ID 重复
                const tempMd = protyle.lute.BlockDOM2StdMd(tempElement.innerHTML);
                writeText(tempMd);
                filterClipboardHint(protyle, tempMd);
            } else if (textHTML.endsWith(Constants.ZWSP)) {
                // 编辑器内部粘贴
                tempElement.innerHTML = textHTML.substr(0, textHTML.length - 1).replace('<meta charset="utf-8">', "");
                tempElement.querySelectorAll("[data-node-id]").forEach((e) => {
                    const newId = Lute.NewNodeID();
                    e.setAttribute("data-node-id", newId);
                    e.classList.remove("protyle-wysiwyg--select", "protyle-wysiwyg--hl");
                    if (e.getAttribute("updated")) {
                        e.setAttribute("updated", newId.split("-")[0]);
                    }
                });
                // 从历史中复制后粘贴
                tempElement.querySelectorAll('[spellcheck="false"][contenteditable="false"]').forEach((e) => {
                    e.setAttribute("contenteditable", "true");
                });
                const tempInnerHTML = tempElement.innerHTML;
                insertHTML(tempInnerHTML, protyle);
                filterClipboardHint(protyle, tempInnerHTML);
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
                    protyle.wysiwyg.element.querySelectorAll('[data-type~="block-ref"]').forEach(item => {
                        if (item.textContent === "") {
                            fetchPost("/api/block/getRefText", {id: item.getAttribute("data-id")}, (response) => {
                                item.innerHTML = response.data;
                            });
                        }
                    });
                    blockRender(protyle, protyle.wysiwyg.element);
                    processRender(protyle.wysiwyg.element);
                    highlightRender(protyle.wysiwyg.element);
                    filterClipboardHint(protyle, response.data);
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
            filterClipboardHint(protyle, textPlainDom);
        }
        blockRender(protyle, protyle.wysiwyg.element);
        processRender(protyle.wysiwyg.element);
        highlightRender(protyle.wysiwyg.element);
    }
    scrollCenter(protyle);
};
