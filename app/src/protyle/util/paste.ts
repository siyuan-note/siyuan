import {Constants} from "../../constants";
import {uploadFiles, uploadLocalFiles} from "../upload";
import {processPasteCode, processRender} from "./processCode";
import {writeText} from "./compatibility";
/// #if !BROWSER
import {clipboard} from "electron";
/// #endif
import {hasClosestBlock} from "./hasClosest";
import {getEditorRange} from "./selection";
import {blockRender} from "../render/blockRender";
import {highlightRender} from "../render/highlightRender";
import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {isDynamicRef, isFileAnnotation} from "../../util/functions";
import {insertHTML} from "./insertHTML";
import {scrollCenter} from "../../util/highlightById";
import {hideElements} from "../ui/hideElements";
import {avRender} from "../render/av/render";

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
    let localFiles: string[] = [];
    /// #if !BROWSER
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
    }
    /// #endif
    if (localFiles.length === 0) {
        // Inline-level elements support pasted as plain text https://github.com/siyuan-note/siyuan/issues/8010
        navigator.clipboard.readText().then(textPlain => {
            insertHTML(protyle.lute.BlockDOM2EscapeMarkerContent(protyle.lute.Md2BlockDOM(textPlain)), protyle);
            filterClipboardHint(protyle, textPlain);
        });
    }
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
    avRender(protyle.wysiwyg.element);
    filterClipboardHint(protyle, textPlain);
    scrollCenter(protyle, undefined, false, "smooth");
};

export const paste = async (protyle: IProtyle, event: (ClipboardEvent | DragEvent) & { target: HTMLElement }) => {
    event.stopPropagation();
    event.preventDefault();
    let textHTML;
    let textPlain;
    let siyuanHTML;
    let files;
    if ("clipboardData" in event) {
        textHTML = event.clipboardData.getData("text/html");
        textPlain = event.clipboardData.getData("text/plain");
        siyuanHTML = event.clipboardData.getData("text/siyuan");
        files = event.clipboardData.files;
    } else {
        textHTML = event.dataTransfer.getData("text/html");
        textPlain = event.dataTransfer.getData("text/plain");
        siyuanHTML = event.dataTransfer.getData("text/siyuan");
        if (event.dataTransfer.types[0] === "Files") {
            files = event.dataTransfer.items;
        }
    }
    /// #if !BROWSER
    // 不再支持 PC 浏览器 https://github.com/siyuan-note/siyuan/issues/7206
    if (!siyuanHTML && !textHTML && !textPlain && ("clipboardData" in event)) {
        if ("darwin" === window.siyuan.config.system.os) {
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
    // 复制标题及其下方块使用 writeText，需将 textPlain 转换为 textHTML
    if (textPlain.endsWith(Constants.ZWSP) && !textHTML && !siyuanHTML) {
        siyuanHTML = textPlain.substr(0, textPlain.length - 1);
    }
    // 剪切复制中首位包含空格或仅有空格 https://github.com/siyuan-note/siyuan/issues/5667
    if (!siyuanHTML) {
        // process word
        const doc = new DOMParser().parseFromString(textHTML, "text/html");
        if (doc.body && doc.body.innerHTML) {
            textHTML = doc.body.innerHTML;
        }
        // windows 剪切板
        if (textHTML.startsWith("\n<!--StartFragment-->") && textHTML.endsWith("<!--EndFragment-->\n\n")) {
            textHTML = doc.body.innerHTML.trim().replace("<!--StartFragment-->", "").replace("<!--EndFragment-->", "");
        }
        textHTML = Lute.Sanitize(textHTML);
    }

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
    if (nodeElement.getAttribute("data-type") === "NodeCodeBlock" ||
        protyle.toolbar.getCurrentType(range).includes("code")) {
        // 粘贴在代码位置
        insertHTML(textPlain, protyle);
        return;
    } else if (siyuanHTML) {
        // 编辑器内部粘贴
        const tempElement = document.createElement("div");
        tempElement.innerHTML = siyuanHTML;
        let isBlock = false;
        tempElement.querySelectorAll("[data-node-id]").forEach((e) => {
            const newId = Lute.NewNodeID();
            e.setAttribute("data-node-id", newId);
            e.removeAttribute("custom-riff-decks");
            e.classList.remove("protyle-wysiwyg--select", "protyle-wysiwyg--hl");
            e.setAttribute("updated", newId.split("-")[0]);
            isBlock = true;
        });
        if (nodeElement.classList.contains("table")) {
            isBlock = false;
        }
        // 从历史中复制后粘贴
        tempElement.querySelectorAll('[contenteditable="false"][spellcheck]').forEach((e) => {
            e.setAttribute("contenteditable", "true");
        });
        const tempInnerHTML = tempElement.innerHTML;
        insertHTML(tempInnerHTML, protyle, isBlock);
        filterClipboardHint(protyle, protyle.lute.BlockDOM2StdMd(tempInnerHTML));
        blockRender(protyle, protyle.wysiwyg.element);
        processRender(protyle.wysiwyg.element);
        highlightRender(protyle.wysiwyg.element);
        avRender(protyle.wysiwyg.element);
    } else if (code) {
        if (!code.startsWith('<div data-type="NodeCodeBlock" class="code-block" data-node-id="')) {
            // 原有代码在行内元素中粘贴会嵌套
            insertHTML(code, protyle);
        } else {
            insertHTML(code, protyle, true);
            highlightRender(protyle.wysiwyg.element);
        }
        hideElements(["hint"], protyle);
    } else {
        let isHTML = false;
        if (textHTML.replace("<!--StartFragment--><!--EndFragment-->", "").trim() !== "") {
            textHTML = textHTML.replace("<!--StartFragment-->", "").replace("<!--EndFragment-->", "").trim();
            if (files && files.length === 1 && (
                textHTML.startsWith("<img") ||  // 浏览器上复制单个图片
                (textHTML.startsWith("<table") && textHTML.indexOf("<img") > -1)  // Excel 或者浏览器中复制带有图片的表格
            )) {
                isHTML = false;
            } else {
                // 需注意 Edge 中的画选不应识别为图片 https://github.com/siyuan-note/siyuan/issues/7021
                isHTML = true;
            }
        }
        if (isHTML) {
            const tempElement = document.createElement("div");
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
                avRender(protyle.wysiwyg.element);
                filterClipboardHint(protyle, response.data);
                scrollCenter(protyle, undefined, false, "smooth");
            });
            return;
        } else if (files && files.length > 0) {
            uploadFiles(protyle, files);
        } else if (textPlain.trim() !== "" && files && files.length === 0) {
            if (range.toString() !== "") {
                if (isDynamicRef(textPlain)) {
                    protyle.toolbar.setInlineMark(protyle, "block-ref", "range", {
                        type: "id",
                        // range 不能 escape，否则 https://github.com/siyuan-note/siyuan/issues/8359
                        color: `${textPlain.substring(2, 22 + 2)}${Constants.ZWSP}s${Constants.ZWSP}${range.toString()}`
                    });
                    return;
                } else if (isFileAnnotation(textPlain)) {
                    protyle.toolbar.setInlineMark(protyle, "file-annotation-ref", "range", {
                        type: "file-annotation-ref",
                        color: textPlain.substring(2).replace(/ ".+">>$/, "")
                    });
                    return;
                } else if (protyle.lute.IsValidLinkDest(textPlain)) {
                    // https://github.com/siyuan-note/siyuan/issues/8475
                    protyle.toolbar.setInlineMark(protyle, "a", "range", {
                        type: "a",
                        color: textPlain
                    });
                    return;
                }
            }
            const textPlainDom = protyle.lute.Md2BlockDOM(textPlain);
            insertHTML(textPlainDom, protyle);
            filterClipboardHint(protyle, textPlain);
        }
        blockRender(protyle, protyle.wysiwyg.element);
        processRender(protyle.wysiwyg.element);
        highlightRender(protyle.wysiwyg.element);
        avRender(protyle.wysiwyg.element);
    }
    scrollCenter(protyle, undefined, false, "smooth");
};
