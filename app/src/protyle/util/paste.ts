import {Constants} from "../../constants";
import {uploadFiles, uploadLocalFiles} from "../upload";
import {processPasteCode, processRender} from "./processCode";
import {getLocalFiles, getTextSiyuanFromTextHTML, readText} from "./compatibility";
import {hasClosestBlock, hasClosestByAttribute, hasClosestByClassName} from "./hasClosest";
import {getEditorRange} from "./selection";
import {blockRender} from "../render/blockRender";
import {highlightRender} from "../render/highlightRender";
import {fetchPost} from "../../util/fetch";
import {isDynamicRef, isFileAnnotation} from "../../util/functions";
import {insertHTML} from "./insertHTML";
import {scrollCenter} from "../../util/highlightById";
import {hideElements} from "../ui/hideElements";
import {avRender} from "../render/av/render";
import {cellScrollIntoView, getCellText} from "../render/av/cell";
import {getCalloutInfo, getContenteditableElement} from "../wysiwyg/getBlock";
import {clearBlockElement} from "./clear";
import {removeZWJ} from "./normalizeText";
import {base64ToURL} from "../../util/image";

export const getTextStar = (blockElement: HTMLElement, contentOnly = false) => {
    const dataType = blockElement.dataset.type;
    let refText = "";
    if (["NodeHeading", "NodeParagraph"].includes(dataType)) {
        refText = getContenteditableElement(blockElement).innerHTML;
    } else if ("NodeHTMLBlock" === dataType) {
        refText = "HTML";
    } else if ("NodeAttributeView" === dataType) {
        refText = blockElement.querySelector(".av__title").textContent || window.siyuan.languages.database;
    } else if ("NodeThematicBreak" === dataType) {
        refText = window.siyuan.languages.line;
    } else if ("NodeIFrame" === dataType) {
        refText = "IFrame";
    } else if ("NodeWidget" === dataType) {
        refText = window.siyuan.languages.widget;
    } else if ("NodeVideo" === dataType) {
        refText = window.siyuan.languages.video;
    } else if ("NodeAudio" === dataType) {
        refText = window.siyuan.languages.audio;
    } else if (["NodeCodeBlock", "NodeTable"].includes(dataType)) {
        refText = getPlainText(blockElement);
    } else if (blockElement.classList.contains("render-node")) {
        // 需在嵌入块后，代码块前
        refText += blockElement.dataset.subtype || Lute.UnEscapeHTMLStr(blockElement.getAttribute("data-content"));
    } else if (["NodeBlockquote", "NodeList", "NodeSuperBlock", "NodeListItem"].includes(dataType)) {
        Array.from(blockElement.querySelectorAll("[data-node-id]")).find((item: HTMLElement) => {
            if (!["NodeBlockquote", "NodeList", "NodeSuperBlock", "NodeListItem"].includes(item.getAttribute("data-type"))) {
                // 获取子块内容，使用容器块本身的 ID
                refText = getTextStar(item, true);
                return true;
            }
        });
    } else if ("NodeCallout" === dataType) {
        refText = getCalloutInfo(blockElement);
    }
    if (contentOnly) {
        return refText;
    }
    return refText + ` <span data-type="block-ref" data-subtype="s" data-id="${blockElement.getAttribute("data-node-id")}">*</span>`;
};

export const getPlainText = (blockElement: HTMLElement, isNested = false) => {
    let text = "";
    const dataType = blockElement.dataset.type;
    if ("NodeHTMLBlock" === dataType) {
        text += Lute.UnEscapeHTMLStr(blockElement.querySelector("protyle-html").getAttribute("data-content"));
    } else if ("NodeAttributeView" === dataType) {
        blockElement.querySelectorAll(".av__row").forEach(rowElement => {
            rowElement.querySelectorAll(".av__cell").forEach((cellElement: HTMLElement) => {
                text += getCellText(cellElement) + " ";
            });
            text += "\n";
        });
        text = text.trimEnd();
    } else if ("NodeThematicBreak" === dataType) {
        text += "---";
    } else if ("NodeIFrame" === dataType || "NodeWidget" === dataType) {
        text += blockElement.querySelector("iframe").getAttribute("src");
    } else if ("NodeVideo" === dataType) {
        text += blockElement.querySelector("video").getAttribute("src");
    } else if ("NodeAudio" === dataType) {
        text += blockElement.querySelector("audio").getAttribute("src");
    } else if (blockElement.classList.contains("render-node")) {
        // 需在嵌入块后，代码块前
        text += Lute.UnEscapeHTMLStr(blockElement.getAttribute("data-content"));
    } else if (["NodeHeading", "NodeParagraph"].includes(dataType)) {
        text += blockElement.querySelector("[spellcheck]").textContent;
    } else if ("NodeCodeBlock" === dataType) {
        text += removeZWJ(blockElement.querySelector("[spellcheck]").textContent);
    } else if (dataType === "NodeTable") {
        blockElement.querySelectorAll("th, td").forEach((item) => {
            text += item.textContent.trim() + "\t";
            if (!item.nextElementSibling) {
                text = text.slice(0, -1) + "\n";
            }
        });
        text = text.slice(0, -1);
    } else if (!isNested && ["NodeBlockquote", "NodeCallout", "NodeList", "NodeSuperBlock", "NodeListItem"].includes(dataType)) {
        if (dataType === "NodeCallout") {
            text += `${getCalloutInfo(blockElement)}\n`;
        }
        blockElement.querySelectorAll("[data-node-id]").forEach((item: HTMLElement) => {
            const nestedText = getPlainText(item, true);
            text += nestedText ? nestedText + "\n" : "";
        });
    }
    return text;
};

export const pasteEscaped = async (protyle: IProtyle, nodeElement: Element) => {
    try {
        let clipText = await readText() || "";
        // 删掉 <span data-type\="text".*>text</span> 标签，只保留文本
        clipText = clipText.replace(/<span data-type="text".*?>(.*?)<\/span>/g, "$1");

        // https://github.com/siyuan-note/siyuan/issues/5446
        // A\B\C\D\
        // E
        // task-blog-2~default~baiduj 无法原义粘贴含有 `~foo~` 的文本 https://github.com/siyuan-note/siyuan/issues/5523

        // 这里必须多加一个反斜杆，因为 Lute 在进行 Markdown 嵌套节点转换平铺标记节点时会剔除 Backslash 节点，
        // 多加入的一个反斜杆会作为文本节点保留下来，后续 Spin 时刚好用于转义标记符
        clipText = clipText.replace(/\\/g, "\\\\")
            .replace(/\*/g, "\\*")
            .replace(/_/g, "\\_")
            .replace(/\[/g, "\\[")
            .replace(/]/g, "\\]")
            .replace(/!/g, "\\!")
            .replace(/`/g, "\\`")
            .replace(/</g, "\\<")
            .replace(/>/g, "\\>")
            .replace(/&/g, "\\&")
            .replace(/~/g, "\\~")
            .replace(/\{/g, "\\{")
            .replace(/}/g, "\\}")
            .replace(/\(/g, "\\(")
            .replace(/\)/g, "\\)")
            .replace(/=/g, "\\=")
            .replace(/#/g, "\\#")
            .replace(/\$/g, "\\$")
            .replace(/\^/g, "\\^")
            .replace(/\|/g, "\\|")
            .replace(/\./g, "\\.");
        // 转义文本不能使用 DOM 结构 https://github.com/siyuan-note/siyuan/issues/11778
        paste(protyle, {textPlain: clipText, textHTML: "", target: nodeElement as HTMLElement});
    } catch (e) {
        console.log(e);
    }
};

export const pasteAsPlainText = async (protyle: IProtyle) => {
    let localFiles: ILocalFiles[] = [];
    /// #if !BROWSER
    localFiles = await getLocalFiles();
    if (localFiles.length > 0) {
        uploadLocalFiles(localFiles, protyle, false);
        return;
    }
    /// #endif
    if (localFiles.length === 0) {
        // Inline-level elements support pasted as plain text https://github.com/siyuan-note/siyuan/issues/8010
        let textPlain = await readText() || "";
        if (getSelection().rangeCount > 0) {
            const range = getSelection().getRangeAt(0);
            if (hasClosestByAttribute(range.startContainer, "data-type", "code") || hasClosestByClassName(range.startContainer, "hljs")) {
                insertHTML(removeZWJ(textPlain).replace(/```/g, "\u200D```"), protyle);
                return;
            }
        }
        // 对一些内置需要解析的 HTML 标签进行内部转移 Improve sub/sup pasting as plain text https://github.com/siyuan-note/siyuan/issues/12155
        textPlain = textPlain.replace(/<sub>/g, "__@sub@__").replace(/<\/sub>/g, "__@/sub@__");
        textPlain = textPlain.replace(/<sup>/g, "__@sup@__").replace(/<\/sup>/g, "__@/sup@__");
        textPlain = textPlain.replace(/<kbd>/g, "__@kbd@__").replace(/<\/kbd>/g, "__@/kbd@__");
        textPlain = textPlain.replace(/<u>/g, "__@u@__").replace(/<\/u>/g, "__@/u@__");

        // 删掉 <span data-type\="text".*>text</span> 标签，只保留文本
        textPlain = textPlain.replace(/<span data-type="text".*?>(.*?)<\/span>/g, "$1");

        // 对 <<assets/...>> 进行内部转义 https://github.com/siyuan-note/siyuan/issues/11992
        textPlain = textPlain.replace(/<<assets\//g, "__@lt2assets/@__").replace(/>>/g, "__@gt2@__");

        // 对 HTML 标签进行内部转义，避免被 Lute 解析以后变为小写 https://github.com/siyuan-note/siyuan/issues/10620
        textPlain = textPlain.replace(/</g, ";;;lt;;;").replace(/>/g, ";;;gt;;;");

        // 反转义 <<assets/...>>
        textPlain = textPlain.replace(/__@lt2assets\/@__/g, "<<assets/").replace(/__@gt2@__/g, ">>");

        // 反转义内置需要解析的 HTML 标签
        textPlain = textPlain.replace(/__@sub@__/g, "<sub>").replace(/__@\/sub@__/g, "</sub>");
        textPlain = textPlain.replace(/__@sup@__/g, "<sup>").replace(/__@\/sup@__/g, "</sup>");
        textPlain = textPlain.replace(/__@kbd@__/g, "<kbd>").replace(/__@\/kbd@__/g, "</kbd>");
        textPlain = textPlain.replace(/__@u@__/g, "<u>").replace(/__@\/u@__/g, "</u>");

        enableLuteMarkdownSyntax(protyle);
        const content = protyle.lute.BlockDOM2EscapeMarkerContent(protyle.lute.Md2BlockDOM(textPlain));
        restoreLuteMarkdownSyntax(protyle);

        // insertHTML 会进行内部反转义
        insertHTML(content, protyle, false, false, true);
    }
};

export const enableLuteMarkdownSyntax = (protyle: IProtyle) => {
    protyle.lute.SetInlineAsterisk(true);
    protyle.lute.SetGFMStrikethrough(true);
    protyle.lute.SetInlineMath(true);
    protyle.lute.SetSub(true);
    protyle.lute.SetSup(true);
    protyle.lute.SetTag(true);
    protyle.lute.SetInlineUnderscore(true);
};

export const restoreLuteMarkdownSyntax = (protyle: IProtyle) => {
    protyle.lute.SetInlineAsterisk(window.siyuan.config.editor.markdown.inlineAsterisk);
    protyle.lute.SetGFMStrikethrough(window.siyuan.config.editor.markdown.inlineStrikethrough);
    protyle.lute.SetInlineMath(window.siyuan.config.editor.markdown.inlineMath);
    protyle.lute.SetSub(window.siyuan.config.editor.markdown.inlineSub);
    protyle.lute.SetSup(window.siyuan.config.editor.markdown.inlineSup);
    protyle.lute.SetTag(window.siyuan.config.editor.markdown.inlineTag);
    protyle.lute.SetInlineUnderscore(window.siyuan.config.editor.markdown.inlineUnderscore);
    protyle.lute.SetMark(window.siyuan.config.editor.markdown.inlineMark);
};

const readLocalFile = async (protyle: IProtyle, localFiles: ILocalFiles[]) => {
    if (protyle && protyle.app && protyle.app.plugins) {
        for (let i = 0; i < protyle.app.plugins.length; i++) {
            const response: { localFiles: ILocalFiles[] } = await new Promise((resolve) => {
                const emitResult = protyle.app.plugins[i].eventBus.emit("paste", {
                    protyle,
                    resolve,
                    textHTML: "",
                    textPlain: "",
                    siyuanHTML: "",
                    localFiles
                });
                if (emitResult) {
                    resolve(undefined);
                }
            });
            if (response?.localFiles) {
                localFiles = response.localFiles;
            }
        }
    }
    uploadLocalFiles(localFiles, protyle, true);
};

export const paste = async (protyle: IProtyle, event: (ClipboardEvent | DragEvent | IClipboardData) & {
    target: HTMLElement
}) => {
    if ("clipboardData" in event || "dataTransfer" in event) {
        event.stopPropagation();
        event.preventDefault();
    }
    let textHTML: string;
    let textPlain: string;
    let siyuanHTML: string;
    let files: FileList | DataTransferItemList | File[];
    if ("clipboardData" in event) {
        textHTML = event.clipboardData.getData("text/html");
        textPlain = event.clipboardData.getData("text/plain");
        siyuanHTML = event.clipboardData.getData("text/siyuan");
        files = event.clipboardData.files;
    } else if ("dataTransfer" in event) {
        textHTML = event.dataTransfer.getData("text/html");
        textPlain = event.dataTransfer.getData("text/plain");
        siyuanHTML = event.dataTransfer.getData("text/siyuan");
        if (event.dataTransfer.types[0] === "Files") {
            files = event.dataTransfer.items;
        }
    } else {
        if (event.localFiles?.length > 0) {
            readLocalFile(protyle, event.localFiles);
            return;
        }
        textHTML = event.textHTML;
        textPlain = event.textPlain;
        siyuanHTML = event.siyuanHTML;
        files = event.files;
    }

    // Improve the pasting of selected text in PDF rectangular annotation https://github.com/siyuan-note/siyuan/issues/11629
    textPlain = textPlain.replace(/\r\n|\r|\u2028|\u2029/g, "\n");

    /// #if !BROWSER
    if (!siyuanHTML && !textHTML && !textPlain && ("clipboardData" in event)) {
        const localFiles: ILocalFiles[] = await getLocalFiles();
        if (localFiles.length > 0) {
            readLocalFile(protyle, localFiles);
            return;
        }
    }
    /// #endif
    const originalTextHTML = textHTML;
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
    // 复制/剪切折叠标题需获取 siyuanHTML
    if (textHTML && textPlain && !siyuanHTML) {
        const textObj = getTextSiyuanFromTextHTML(textHTML);
        siyuanHTML = textObj.textSiyuan;
        textHTML = textObj.textHtml;
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

    if (protyle && protyle.app && protyle.app.plugins) {
        for (let i = 0; i < protyle.app.plugins.length; i++) {
            const response: IObject & { files: FileList } = await new Promise((resolve) => {
                const emitResult = protyle.app.plugins[i].eventBus.emit("paste", {
                    protyle,
                    resolve,
                    textHTML,
                    textPlain,
                    siyuanHTML,
                    files
                });
                if (emitResult) {
                    resolve(undefined);
                }
            });

            if (response?.textHTML) {
                textHTML = response.textHTML;
            }
            if (response?.textPlain) {
                textPlain = response.textPlain;
            }
            if (response?.siyuanHTML) {
                siyuanHTML = response.siyuanHTML;
            }
            if (response?.files) {
                files = response.files as FileList;
            }
        }
    }

    const nodeElement = hasClosestBlock(event.target);
    if (!nodeElement) {
        if (files && files.length > 0) {
            uploadFiles(protyle, files);
        }
        return;
    }
    protyle.hint.enableExtend = Constants.BLOCK_HINT_KEYS.concat("{{", "/", "#", "、", "「「", "「『", "『「", "『『",).includes(protyle.hint.splitChar);
    hideElements(protyle.hint.enableExtend ? ["select"] : ["select", "hint"], protyle);
    protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--hl").forEach(item => {
        item.classList.remove("protyle-wysiwyg--hl");
    });
    const code = processPasteCode(textHTML, textPlain, originalTextHTML, protyle);
    const range = getEditorRange(protyle.wysiwyg.element);
    if (nodeElement.getAttribute("data-type") === "NodeCodeBlock" ||
        protyle.toolbar.getCurrentType(range).includes("code")) {
        // https://github.com/siyuan-note/siyuan/issues/13552
        insertHTML(removeZWJ(textPlain).replace(/```/g, "\u200D```"), protyle);
        return;
    } else if (siyuanHTML) {
        // 编辑器内部粘贴
        const tempElement = document.createElement("div");
        tempElement.innerHTML = siyuanHTML;
        if (range.toString()) {
            let types: string[] = [];
            let linkElement: HTMLElement;
            if (tempElement.childNodes.length === 1 && tempElement.childElementCount === 1) {
                types = (tempElement.firstElementChild.getAttribute("data-type") || "").split(" ");
                if ((types.includes("block-ref") || types.includes("a"))) {
                    linkElement = tempElement.firstElementChild as HTMLElement;
                }
            }
            if (!linkElement) {
                const linkTemp = document.createElement("template");
                linkTemp.innerHTML = protyle.lute.SpinBlockDOM(siyuanHTML);
                if (linkTemp.content.firstChild.nodeType !== 3 && linkTemp.content.firstElementChild.classList.contains("p")) {
                    linkTemp.innerHTML = linkTemp.content.firstElementChild.firstElementChild.innerHTML.trim();
                }
                if (linkTemp.content.childNodes.length === 1 && linkTemp.content.childElementCount === 1) {
                    types = (linkTemp.content.firstElementChild.getAttribute("data-type") || "").split(" ");
                    if ((types.includes("block-ref") || types.includes("a"))) {
                        linkElement = linkTemp.content.firstElementChild as HTMLElement;
                    }
                }
            }

            if (types.includes("block-ref")) {
                const refElement = protyle.toolbar.setInlineMark(protyle, "block-ref", "range", {
                    type: "id",
                    color: `${linkElement.dataset.id}${Constants.ZWSP}s${Constants.ZWSP}${range.toString()}`
                });
                if (refElement[0]) {
                    protyle.toolbar.range.selectNodeContents(refElement[0]);
                }
                return;
            }
            if (types.includes("a")) {
                protyle.toolbar.setInlineMark(protyle, "a", "range", {
                    type: "a",
                    color: `${linkElement.dataset.href}${Constants.ZWSP}${range.toString()}`
                });
                return;
            }
        }
        let isBlock = false;
        tempElement.querySelectorAll("[data-node-id]").forEach((e) => {
            const newId = Lute.NewNodeID();
            e.setAttribute("data-node-id", newId);
            clearBlockElement(e);
            isBlock = true;
        });
        if (nodeElement.classList.contains("table")) {
            isBlock = false;
        }
        // 从历史中复制后粘贴
        tempElement.querySelectorAll('[contenteditable="false"][spellcheck]').forEach((e) => {
            e.setAttribute("contenteditable", "true");
        });
        let tempInnerHTML = tempElement.innerHTML;
        if (!nodeElement.classList.contains("av") && tempInnerHTML.startsWith("[[{") && tempInnerHTML.endsWith("}]]")) {
            try {
                const json = JSON.parse(tempInnerHTML);
                if (json.length > 0 && json[0].length > 0 && json[0][0].id && json[0][0].type) {
                    insertHTML(textPlain, protyle, isBlock);
                } else {
                    insertHTML(tempInnerHTML, protyle, isBlock);
                }
            } catch (e) {
                insertHTML(tempInnerHTML, protyle, isBlock);
            }
        } else {
            if (-1 < tempInnerHTML.indexOf("NodeHTMLBlock")) {
                // 复制 HTML 块粘贴出来的不是 HTML 块 https://github.com/siyuan-note/siyuan/issues/12994
                tempInnerHTML = Lute.UnEscapeHTMLStr(tempInnerHTML);
            }
            insertHTML(tempInnerHTML, protyle, isBlock, false, true);
        }
        blockRender(protyle, protyle.wysiwyg.element);
        processRender(protyle.wysiwyg.element);
        highlightRender(protyle.wysiwyg.element);
        avRender(protyle.wysiwyg.element, protyle);
    } else if (code) {
        if (!code.startsWith('<div data-type="NodeCodeBlock" class="code-block" data-node-id="')) {
            // 原有代码在行内元素中粘贴会嵌套
            insertHTML(code, protyle);
        } else {
            insertHTML(code, protyle, true, false, true);
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
                // 需注意 Edge 中的划选不应识别为图片 https://github.com/siyuan-note/siyuan/issues/7021
                isHTML = true;
            }

            // 判断是否包含多个换行，包含多个换行则很有可能是纯文本（豆包复制粘贴问题，纯文本外面会包裹一个 HTML 标签，但内部是 Markdown 纯文本）
            let containsNewlines = false;
            const tempDiv = document.createElement("div");
            tempDiv.innerHTML = textHTML;
            const walker = document.createTreeWalker(tempDiv, NodeFilter.SHOW_TEXT, null);
            let node: Node | null = null;
            while ((node = walker.nextNode())) {
                if (node.nodeValue && (node.nodeValue.match(/\n/g) || []).length >= 2) {
                    containsNewlines = true;
                    break;
                }
            }

            const textHTMLLowercase = textHTML.toLowerCase();
            if (textPlain && "" !== textPlain.trim() && (textHTML.startsWith("<span") || textHTML.startsWith("<br")) && containsNewlines &&
                (0 > textHTMLLowercase.indexOf("class=\"katex") && 0 > textHTMLLowercase.indexOf("class=\"math") &&
                    0 > textHTMLLowercase.indexOf("</a>") && 0 > textHTMLLowercase.indexOf("</img>") && 0 > textHTMLLowercase.indexOf("</code>") &&
                    0 > textHTMLLowercase.indexOf("</b>") && 0 > textHTMLLowercase.indexOf("</strong>") &&
                    0 > textHTMLLowercase.indexOf("</i>") && 0 > textHTMLLowercase.indexOf("</em>") &&
                    0 > textHTMLLowercase.indexOf("</ol>") && 0 > textHTMLLowercase.indexOf("</ul>") &&
                    0 > textHTMLLowercase.indexOf("</table>") && 0 > textHTMLLowercase.indexOf("</blockquote>") &&
                    0 > textHTMLLowercase.indexOf("</h1>") && 0 > textHTMLLowercase.indexOf("</h2>") &&
                    0 > textHTMLLowercase.indexOf("</h3>") && 0 > textHTMLLowercase.indexOf("</h4>") &&
                    0 > textHTMLLowercase.indexOf("</h5>") && 0 > textHTMLLowercase.indexOf("</h6>"))) {
                // 豆包复制粘贴问题 https://github.com/siyuan-note/siyuan/issues/13265 https://github.com/siyuan-note/siyuan/issues/14313
                isHTML = false;
            }
        }
        if (isHTML) {
            const tempElement = document.createElement("div");
            tempElement.innerHTML = textHTML;
            // 移除空的 A 标签
            tempElement.querySelectorAll("a").forEach((e) => {
                if (e.innerHTML.trim() === "") {
                    e.remove();
                }
            });
            // https://github.com/siyuan-note/siyuan/issues/14625#issuecomment-2869618067
            let linkElement;
            if (tempElement.childElementCount === 1 && tempElement.childNodes.length === 1) {
                if (tempElement.firstElementChild.tagName === "A") {
                    linkElement = tempElement.firstElementChild;
                } else if (tempElement.firstElementChild.tagName === "P" &&
                    tempElement.firstElementChild.childElementCount === 1 &&
                    tempElement.firstElementChild.childNodes.length === 1 &&
                    tempElement.firstElementChild.firstElementChild.tagName === "A") {
                    linkElement = tempElement.firstElementChild.firstElementChild;
                }
            }
            if (linkElement) {
                const selectText = range.toString();
                const aElements = protyle.toolbar.setInlineMark(protyle, "a", "range", {
                    type: "a",
                    color: `${linkElement.getAttribute("href")}${Constants.ZWSP}${selectText || linkElement.textContent}`
                });
                if (!selectText) {
                    if (aElements[0].lastChild) {
                        // https://github.com/siyuan-note/siyuan/issues/15801
                        range.setEnd(aElements[0].lastChild, aElements[0].lastChild.textContent.length);
                    }
                    range.collapse(false);
                }
                return;
            }
            fetchPost("/api/lute/html2BlockDOM", {
                dom: tempElement.innerHTML
            }, (response) => {
                insertHTML(response.data, protyle, false, false, true);
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
                avRender(protyle.wysiwyg.element, protyle);
                scrollCenter(protyle, undefined, "nearest", "smooth");
            });
            return;
        } else if (files && files.length > 0) {
            uploadFiles(protyle, files);
            return;
        } else if (textPlain.trim() !== "" && (files && files.length === 0 || !files)) {
            if (range.toString() !== "") {
                const firstLine = textPlain.split("\n")[0];
                if (isDynamicRef(textPlain)) {
                    const refElement = protyle.toolbar.setInlineMark(protyle, "block-ref", "range", {
                        type: "id",
                        // range 不能 escape，否则 https://github.com/siyuan-note/siyuan/issues/8359
                        color: `${textPlain.substring(2, 22 + 2)}${Constants.ZWSP}s${Constants.ZWSP}${range.toString()}`
                    });
                    if (refElement[0]) {
                        protyle.toolbar.range.selectNodeContents(refElement[0]);
                    }
                    return;
                } else if (isFileAnnotation(firstLine)) {
                    protyle.toolbar.setInlineMark(protyle, "file-annotation-ref", "range", {
                        type: "file-annotation-ref",
                        color: firstLine.substring(2).replace(/ ".+">>$/, "")
                    });
                    return;
                } else {
                    // https://github.com/siyuan-note/siyuan/issues/8475
                    const linkDest = textPlain.startsWith("assets/") ? textPlain : protyle.lute.GetLinkDest(textPlain);
                    if (linkDest) {
                        protyle.toolbar.setInlineMark(protyle, "a", "range", {
                            type: "a",
                            color: linkDest
                        });
                        return;
                    }
                }
            }
            let textPlainDom = protyle.lute.Md2BlockDOM(textPlain);
            if (textPlainDom && textPlainDom.indexOf("data:image/") > -1) {
                const tempElement = document.createElement("template");
                tempElement.innerHTML = textPlainDom;
                const imgSrcList: string[] = [];
                const imageElements = tempElement.content.querySelectorAll("img");
                imageElements.forEach((item) => {
                    if (item.getAttribute("data-src").startsWith("data:image/")) {
                        imgSrcList.push(item.getAttribute("data-src"));
                    }
                });
                const base64SrcList = await base64ToURL(imgSrcList);
                base64SrcList.forEach((item, index) => {
                    imageElements[index].setAttribute("src", item);
                    imageElements[index].setAttribute("data-src", item);
                    imageElements[index].parentElement.querySelector(".img__net")?.remove();
                });
                textPlainDom = tempElement.innerHTML;
            }
            insertHTML(textPlainDom, protyle, false, false, true);
        }
        blockRender(protyle, protyle.wysiwyg.element);
        processRender(protyle.wysiwyg.element);
        highlightRender(protyle.wysiwyg.element);
        avRender(protyle.wysiwyg.element, protyle);
    }
    const selectCellElement = nodeElement.querySelector(".av__cell--select");
    if (nodeElement.classList.contains("av") && selectCellElement) {
        cellScrollIntoView(nodeElement, selectCellElement);
    } else {
        scrollCenter(protyle, undefined, "nearest", "smooth");
    }
};

