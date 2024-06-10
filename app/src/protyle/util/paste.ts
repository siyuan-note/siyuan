import {Constants} from "../../constants";
import {uploadFiles, uploadLocalFiles} from "../upload";
import {processPasteCode, processRender} from "./processCode";
import {readText, writeText} from "./compatibility";
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
import {cellScrollIntoView, getCellText} from "../render/av/cell";
import {getContenteditableElement} from "../wysiwyg/getBlock";

export const getTextStar = (blockElement: HTMLElement) => {
    const dataType = blockElement.dataset.type;
    let refText = "";
    if (["NodeHeading", "NodeParagraph"].includes(dataType)) {
        refText = getContenteditableElement(blockElement).innerHTML;
    } else {
        if ("NodeHTMLBlock" === dataType) {
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
                    refText = getTextStar(blockElement.querySelector("[data-node-id]"));
                    return true;
                }
            });
            if (refText) {
                return refText;
            }
        }
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
    } else if (["NodeHeading", "NodeParagraph", "NodeCodeBlock", "NodeTable"].includes(dataType)) {
        text += blockElement.querySelector("[spellcheck]").textContent;
    } else if (!isNested && ["NodeBlockquote", "NodeList", "NodeSuperBlock", "NodeListItem"].includes(dataType)) {
        blockElement.querySelectorAll("[data-node-id]").forEach((item: HTMLElement) => {
            const nestedText = getPlainText(item, true);
            text += nestedText ? nestedText + "\n" : "";
        });
    }
    return text;
};

export const pasteEscaped = async (protyle: IProtyle, nodeElement: Element) => {
    try {
        // * _ [ ] ! \ ` < > & ~ { } ( ) = # $ ^ | .
        let clipText = await readText();
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
        pasteText(protyle, clipText, nodeElement);
    } catch (e) {
        console.log(e);
    }
};

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
            // 对 HTML 标签进行内部转义，避免被 Lute 解析以后变为小写 https://github.com/siyuan-note/siyuan/issues/10620
            textPlain = textPlain.replace(/</g, ";;;lt;;;").replace(/>/g, ";;;gt;;;");
            const content = protyle.lute.BlockDOM2EscapeMarkerContent(protyle.lute.Md2BlockDOM(textPlain));
            // insertHTML 会进行内部反转义
            insertHTML(content, protyle, false, false, true);
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
        } else {
            const linkDest = protyle.lute.GetLinkDest(textPlain);
            if (linkDest) {
                textPlain = `[${range.toString()}](${linkDest})`;
            }
        }
    }
    insertHTML(protyle.lute.Md2BlockDOM(textPlain), protyle, false, false, true);

    blockRender(protyle, protyle.wysiwyg.element);
    processRender(protyle.wysiwyg.element);
    highlightRender(protyle.wysiwyg.element);
    avRender(protyle.wysiwyg.element, protyle);
    filterClipboardHint(protyle, textPlain);
    scrollCenter(protyle, undefined, false, "smooth");
};

export const paste = async (protyle: IProtyle, event: (ClipboardEvent | DragEvent) & { target: HTMLElement }) => {
    event.stopPropagation();
    event.preventDefault();
    let textHTML: string;
    let textPlain: string;
    let siyuanHTML: string;
    let files: FileList | DataTransferItemList;
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
    hideElements(["select"], protyle);
    protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--hl").forEach(item => {
        item.classList.remove("protyle-wysiwyg--hl");
    });
    const code = processPasteCode(textHTML, textPlain);
    const range = getEditorRange(protyle.wysiwyg.element);
    if (nodeElement.getAttribute("data-type") === "NodeCodeBlock" ||
        protyle.toolbar.getCurrentType(range).includes("code")) {
        // 粘贴在代码位置
        // https://github.com/siyuan-note/siyuan/issues/9142
        // https://github.com/siyuan-note/siyuan/issues/9323
        // 需排除行内代码 https://github.com/siyuan-note/siyuan/issues/9369
        if (nodeElement.querySelector(".protyle-action")?.contains(range.startContainer)) {
            range.setStart(nodeElement.querySelector(".hljs").firstChild, 0);
        }
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
            e.removeAttribute(Constants.CUSTOM_RIFF_DECKS);
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
            insertHTML(tempInnerHTML, protyle, isBlock, false, true);
        }
        filterClipboardHint(protyle, protyle.lute.BlockDOM2StdMd(tempInnerHTML));
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
                filterClipboardHint(protyle, response.data);
                scrollCenter(protyle, undefined, false, "smooth");
            });
            return;
        } else if (files && files.length > 0) {
            uploadFiles(protyle, files);
        } else if (textPlain.trim() !== "" && files && files.length === 0) {
            if (range.toString() !== "") {
                const firstLine = textPlain.split("\n")[0];
                if (isDynamicRef(textPlain)) {
                    protyle.toolbar.setInlineMark(protyle, "block-ref", "range", {
                        type: "id",
                        // range 不能 escape，否则 https://github.com/siyuan-note/siyuan/issues/8359
                        color: `${textPlain.substring(2, 22 + 2)}${Constants.ZWSP}s${Constants.ZWSP}${range.toString()}`
                    });
                    return;
                } else if (isFileAnnotation(firstLine)) {
                    protyle.toolbar.setInlineMark(protyle, "file-annotation-ref", "range", {
                        type: "file-annotation-ref",
                        color: firstLine.substring(2).replace(/ ".+">>$/, "")
                    });
                    return;
                } else {
                    // https://github.com/siyuan-note/siyuan/issues/8475
                    const linkDest = protyle.lute.GetLinkDest(textPlain);
                    if (linkDest) {
                        protyle.toolbar.setInlineMark(protyle, "a", "range", {
                            type: "a",
                            color: linkDest
                        });
                        return;
                    }
                }
            }
            const textPlainDom = protyle.lute.Md2BlockDOM(textPlain);
            insertHTML(textPlainDom, protyle, false, false, true);
            filterClipboardHint(protyle, textPlain);
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
        scrollCenter(protyle, undefined, false, "smooth");
    }
};
