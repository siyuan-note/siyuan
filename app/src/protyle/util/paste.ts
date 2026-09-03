import {Constants} from "../../constants";
import {uploadFiles, uploadLocalFiles} from "../upload";
import type {IUploadInsertOptions} from "../upload";
import {
    createUploadInsertPosition,
    getAvailableUploadInsertRange,
    isUploadInsertPositionAvailable,
} from "../upload/insertPosition";
import {processPasteCode, processRender} from "./processCode";
import {getLocalFiles, getTextSiyuanFromTextHTML, readText} from "./compatibility";
import {hasClosestBlock, hasClosestByAttribute, hasClosestByClassName} from "./hasClosest";
import {focusByOffset, getEditorRange, getSelectionOffset, getUndoFocusContext} from "./selection";
import {blockRender} from "../render/blockRender";
import {highlightRender} from "../render/highlightRender";
import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {isDynamicRef, isFileAnnotation} from "../../util/functions";
import {insertHTML} from "./insertHTML";
import {scrollCenter} from "../../util/highlightById";
import {hideElements} from "../ui/hideElements";
import {showMessage} from "../../dialog/message";
import {avRender} from "../render/av/render";
import {cellScrollIntoView, getCellText} from "../render/av/cell";
import {fixAdjacentTags, getCalloutInfo, getContenteditableElement} from "../wysiwyg/getBlock";
import {clearBlockElement} from "./clear";
import {removeZWJ} from "./normalizeText";
import {base64ToURL, showBase64ImageSizeLimit} from "../upload/base64";
import {applyHTMLLocalAssetPaths, collectHTMLLocalAssets, removeHTMLLocalAssetPaths} from "../upload/htmlLocalAssets";
import {
    applyHTMLEmbeddedAssetPaths,
    collectHTMLEmbeddedAssets,
    hasHTMLEmbeddedAssets,
    type IHTMLEmbeddedAsset,
    validateHTMLEmbeddedAssetSizes,
} from "../upload/htmlEmbeddedAssets";
import {getCompleteAssetUploadPathsByInput} from "../upload/uploadResult";
import {resolveLinkDest} from "../toolbar/util";
import {updateTransaction} from "../wysiwyg/transaction";
import * as dayjs from "dayjs";
import {updateListOrder} from "../wysiwyg/list";
import {refreshSbAndPersistWidth} from "../../block/util";
import {
    extractCrossBlockPasteContext,
    serializePastedBlockDOM,
    shouldPreservePastedBlockStructure
} from "./pasteSource";
import {normalizePasteResponse} from "./pasteResponse";
import {applyLuteMarkdownSyntax} from "../render/luteMarkdownSyntax";
import {convertOfficeLists} from "./officeList";
import {extractOfficeMathHTML} from "./officeMath";
import {
    extractWPSPresentationClipboard,
    getWPSPresentationFallback,
    type IWPSPresentationClipboard,
    shouldConvertWPSPresentation,
} from "./wpsPresentation";
import {hasDataTransferFiles} from "../upload/localDropFiles";
import {resetPastedQueryEmbedRenderState} from "../render/embedRenderState";
import {getHostCapabilities, sanitizeKernelHTML} from "../../util/hostCapabilities";
import {eventBusHas, hasPluginSubscriber} from "../../plugin/EventBusCore";
import {normalizeSemanticInlineElements, stripSemanticMarkersFromRangeText} from "./inlineElementMarker";
/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif

const PASTE_PLUGIN_TIMEOUT = 120_000;
const PASTE_PLUGIN_TIMED_OUT = Symbol("paste-plugin-timed-out");

export const beforePaste = (protyle: IProtyle, blockElement: HTMLElement) => {
    // 链接，备注，样式，引用，pdf标注粘贴 https://github.com/siyuan-note/siyuan/issues/11572
    const range = getSelection().getRangeAt(0);
    protyle.toolbar.range = range;
    const inlineElement = range.startContainer.parentElement;
    if (range.toString() === "" && inlineElement.tagName === "SPAN") {
        const currentTypes = (inlineElement.getAttribute("data-type") || "").split(" ");
        if (currentTypes.includes("inline-memo") || currentTypes.includes("text") ||
            currentTypes.includes("block-ref") || currentTypes.includes("file-annotation-ref") ||
            currentTypes.includes("a")) {
            const offset = getSelectionOffset(inlineElement, blockElement, range);
            if (offset.start === 0) {
                range.setStartBefore(inlineElement);
                range.collapse(true);
            } else if (offset.start === inlineElement.textContent.length) {
                range.setEndAfter(inlineElement);
                range.collapse(false);
            }
        }
    }
};

export const normalizeVirtualBlockRef = (element: HTMLElement) => {
    element.querySelectorAll<HTMLElement>('[data-type~="virtual-block-ref"]').forEach(item => {
        const types = (item.getAttribute("data-type") || "").split(" ")
            .filter(type => type && type !== "virtual-block-ref");
        if (types.length > 0) {
            item.setAttribute("data-type", types.join(" "));
        } else {
            item.replaceWith(...Array.from(item.childNodes));
        }
    });
};

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
    } else if ("NodeCustomBlock" === dataType) {
        refText = blockElement.getAttribute("data-content") || window.siyuan.languages.custom;
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
        text += blockElement.querySelector("protyle-html").getAttribute("data-content");
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
    } else if ("NodeCustomBlock" === dataType) {
        text += blockElement.getAttribute("data-content") || "";
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

        // 临界区：Lute 已是所有编辑器共享的单例，此处临时把 inline-syntax 标志置 true 再恢复。
        // enable/transform/restore 必须保持同步执行，中间不得插入 await，否则并发编辑器的
        // 转换调用（如实时输入的 SpinBlockDOM）会读到被改写的标志而产生错误输出。
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
    applyLuteMarkdownSyntax(protyle.lute, window.siyuan.config.editor.markdown);
};

const readLocalFile = async (protyle: IProtyle, localFiles: ILocalFiles[], options?: IUploadInsertOptions) => {
    if (protyle && protyle.app && protyle.app.plugins && hasPluginSubscriber("paste")) {
        const plugins = Array.from(protyle.app.plugins);
        for (let i = 0; i < plugins.length; i++) {
            const plugin = plugins[i];
            if (!eventBusHas(plugin.eventBus, "paste")) {
                continue;
            }
            const response = await new Promise<{ localFiles: ILocalFiles[] } | undefined |
                typeof PASTE_PLUGIN_TIMED_OUT>((resolve, reject) => {
                let settled = false;
                const finish = (value: { localFiles: ILocalFiles[] } | undefined | typeof PASTE_PLUGIN_TIMED_OUT) => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    clearTimeout(timeoutId);
                    resolve(value);
                };
                const resolveResponse = (value: { localFiles: ILocalFiles[] } |
                    PromiseLike<{ localFiles: ILocalFiles[] } | undefined> | undefined) => {
                    void Promise.resolve(value).then(finish, error => {
                        if (!settled) {
                            settled = true;
                            clearTimeout(timeoutId);
                            reject(error);
                        }
                    });
                };
                const timeoutId = setTimeout(() => finish(PASTE_PLUGIN_TIMED_OUT), PASTE_PLUGIN_TIMEOUT);
                const emitResult = plugin.eventBus.emit("paste", {
                    protyle,
                    resolve: resolveResponse,
                    textHTML: "",
                    textPlain: "",
                    siyuanHTML: "",
                    localFiles
                });
                if (emitResult) {
                    finish(undefined);
                }
            });
            if (options?.insertPosition &&
                !isUploadInsertPositionAvailable(protyle.wysiwyg.element, options.insertPosition)) {
                return;
            }
            if (response === PASTE_PLUGIN_TIMED_OUT) {
                console.error(new Error(`Plugin ${plugin.name || `#${i + 1}`} paste processing timed out`));
                showMessage(window.siyuan.languages.uploadError);
                return;
            }
            if (response?.localFiles) {
                localFiles = response.localFiles;
            }
        }
    }
    if (options?.insertPosition &&
        !isUploadInsertPositionAvailable(protyle.wysiwyg.element, options.insertPosition)) {
        return;
    }
    uploadLocalFiles(localFiles, protyle, true, options);
};

export const convertPastedListItemSubtype = (listItemElement: HTMLElement, subtype: string) => {
    const actionElement = listItemElement.querySelector<HTMLElement>(".protyle-action");
    if (!actionElement || !["u", "o", "t"].includes(subtype)) {
        return;
    }
    listItemElement.setAttribute("data-subtype", subtype);
    listItemElement.classList.remove("protyle-task--done");
    if (subtype === "o") {
        listItemElement.removeAttribute("data-task");
        listItemElement.setAttribute("data-marker", "1.");
        actionElement.className = "protyle-action protyle-action--order";
        actionElement.setAttribute("contenteditable", "false");
        actionElement.textContent = "1.";
    } else if (subtype === "t") {
        listItemElement.setAttribute("data-marker", "*");
        listItemElement.setAttribute("data-task", " ");
        actionElement.className = "protyle-action protyle-action--task";
        actionElement.removeAttribute("contenteditable");
        actionElement.innerHTML = "<svg><use xlink:href=\"#iconUncheck\"></use></svg>";
    } else {
        listItemElement.removeAttribute("data-task");
        listItemElement.setAttribute("data-marker", "*");
        actionElement.className = "protyle-action";
        actionElement.removeAttribute("contenteditable");
        actionElement.innerHTML = "<svg><use xlink:href=\"#iconDot\"></use></svg>";
    }
};

const pasteCrossBlockRange = (protyle: IProtyle, tempElement: HTMLElement, range: Range,
                              preserveNestedList: boolean) => {
    const pastedRoots = Array.from(tempElement.children) as HTMLElement[];
    if (!range.collapsed || pastedRoots.length < 2) {
        return false;
    }
    const textBlockTypes = ["NodeParagraph", "NodeHeading"];
    const firstBlockElement = pastedRoots[0];
    if (!textBlockTypes.includes(firstBlockElement.getAttribute("data-type"))) {
        return false;
    }
    const targetBlockElement = hasClosestBlock(range.startContainer) as HTMLElement;
    if (!targetBlockElement) {
        return false;
    }

    const lastRootElement = pastedRoots[pastedRoots.length - 1];
    const containerType = lastRootElement.getAttribute("data-type");
    const isTextBlockPaste = pastedRoots.every(item => textBlockTypes.includes(item.getAttribute("data-type")));
    const pastedContainerElement = !isTextBlockPaste && pastedRoots.length === 2 &&
        ["NodeList", "NodeBlockquote", "NodeCallout", "NodeSuperBlock"].includes(containerType) ?
        lastRootElement : undefined;
    if (!isTextBlockPaste && !pastedContainerElement) {
        return false;
    }

    const targetContainerElement = pastedContainerElement ?
        targetBlockElement.closest<HTMLElement>(`[data-type="${containerType}"]`) : undefined;
    const pastedContentElement = containerType === "NodeCallout" ?
        pastedContainerElement?.querySelector<HTMLElement>(":scope > .callout-content") : pastedContainerElement;
    const targetContentElement = containerType === "NodeCallout" ?
        targetContainerElement?.querySelector<HTMLElement>(":scope > .callout-content") : targetContainerElement;
    const pastedChildren = isTextBlockPaste ? pastedRoots.slice(1) :
        Array.from(pastedContentElement?.children || []).filter(item =>
            item.hasAttribute("data-node-id")) as HTMLElement[];
    const endBlockElement = isTextBlockPaste ? lastRootElement :
        Array.from(pastedContainerElement.querySelectorAll<HTMLElement>(
            '[data-type="NodeParagraph"], [data-type="NodeHeading"]'
        )).reverse().find(item => {
            const attrElement = item.querySelector(":scope > .protyle-attr");
            return !attrElement || (attrElement.textContent || "").replace(/\u200b/g, "") === "";
        });
    let targetChildElement: HTMLElement = targetBlockElement;
    if (pastedContainerElement) {
        while (targetChildElement.parentElement && targetChildElement.parentElement !== targetContentElement) {
            targetChildElement = targetChildElement.parentElement;
        }
    }
    if (!endBlockElement || pastedChildren.length === 0 ||
        (pastedContainerElement && (!targetContainerElement || !targetContentElement ||
            targetChildElement.parentElement !== targetContentElement))) {
        return false;
    }
    if (containerType === "NodeList") {
        if (targetChildElement.getAttribute("data-type") !== "NodeListItem" ||
            targetBlockElement.previousElementSibling?.classList.contains("protyle-action") !== true) {
            return false;
        }
        if (!preserveNestedList) {
            const targetSubtype = targetContainerElement.getAttribute("data-subtype");
            pastedChildren.forEach(item => {
                if (item.getAttribute("data-subtype") !== targetSubtype) {
                    convertPastedListItemSubtype(item, targetSubtype);
                }
            });
        }
    }
    const targetEditableElement = getContenteditableElement(targetBlockElement);
    const firstEditableElement = getContenteditableElement(firstBlockElement);
    const endEditableElement = getContenteditableElement(endBlockElement);
    if (!targetEditableElement?.contains(range.startContainer) || !firstEditableElement || !endEditableElement) {
        return false;
    }

    const isNestedListPaste = preserveNestedList && containerType === "NodeList";
    const transactionElement = isNestedListPaste ? targetBlockElement : targetChildElement;
    const oldHTML = transactionElement.outerHTML;
    const oldListItemHTML = containerType === "NodeList" && !isNestedListPaste ? new Map(Array.from(
        targetContainerElement.querySelectorAll<HTMLElement>(":scope > .li")
    ).map(item => [item.getAttribute("data-node-id"), item.outerHTML])) : undefined;
    const undoFocusContext = getUndoFocusContext(protyle.wysiwyg.element, range, true);
    const markerElement = document.createElement("wbr");
    range.insertNode(markerElement);
    const suffixRange = document.createRange();
    suffixRange.setStartAfter(markerElement);
    suffixRange.setEnd(targetEditableElement, targetEditableElement.childNodes.length);
    const suffixFragment = suffixRange.extractContents();
    const pastedEndRange = document.createRange();
    pastedEndRange.selectNodeContents(endEditableElement);
    const pastedEnd = getSelectionOffset(endEditableElement, undefined, pastedEndRange, true).end;
    while (firstEditableElement.firstChild) {
        markerElement.before(firstEditableElement.firstChild);
    }
    markerElement.remove();
    endEditableElement.append(suffixFragment);
    let boundaryElement = endBlockElement;
    while (boundaryElement) {
        if (boundaryElement.hasAttribute("data-node-id") &&
            !boundaryElement.querySelector(":scope > .protyle-attr")) {
            boundaryElement.insertAdjacentHTML("beforeend",
                `<div class="protyle-attr" contenteditable="false">${Constants.ZWSP}</div>`);
        }
        if (boundaryElement === (pastedContainerElement || endBlockElement)) {
            break;
        }
        boundaryElement = boundaryElement.parentElement;
    }
    fixAdjacentTags(targetEditableElement);
    fixAdjacentTags(endEditableElement);
    const insertedElements = isNestedListPaste ? [pastedContainerElement] : pastedChildren;
    if (isNestedListPaste) {
        targetBlockElement.after(pastedContainerElement);
        updateListOrder(pastedContainerElement);
    } else {
        targetChildElement.after(...pastedChildren);
    }
    if (containerType === "NodeList" && !isNestedListPaste) {
        updateListOrder(targetContainerElement);
    }
    transactionElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));

    const widthDoOperations: IOperation[] = [];
    const widthUndoOperations: IOperation[] = [];
    const superBlockElement = targetChildElement.parentElement?.getAttribute("data-type") === "NodeSuperBlock" ?
        targetChildElement.parentElement : undefined;
    if (superBlockElement) {
        refreshSbAndPersistWidth(superBlockElement, widthDoOperations, widthUndoOperations);
    }
    const doOperations: IOperation[] = [];
    const undoOperations: IOperation[] = [];
    insertedElements.slice().reverse().forEach(item => {
        doOperations.push({
            action: "insert",
            id: item.getAttribute("data-node-id"),
            data: item.outerHTML,
            previousID: (isNestedListPaste ? targetBlockElement : targetChildElement).getAttribute("data-node-id"),
            parentID: isNestedListPaste ? targetChildElement.getAttribute("data-node-id") : undefined,
        });
        undoOperations.push({
            action: "delete",
            id: item.getAttribute("data-node-id")
        });
    });
    if (oldListItemHTML) {
        targetContainerElement.querySelectorAll<HTMLElement>(":scope > .li").forEach(item => {
            const itemOldHTML = oldListItemHTML.get(item.getAttribute("data-node-id"));
            if (!itemOldHTML || item === targetChildElement || itemOldHTML === item.outerHTML) {
                return;
            }
            item.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
            item.setAttribute(Constants.ATTRIBUTE_EDITING, "true");
            doOperations.push({
                action: "update",
                id: item.getAttribute("data-node-id"),
                data: item.outerHTML
            });
            undoOperations.push({
                action: "update",
                id: item.getAttribute("data-node-id"),
                data: itemOldHTML
            });
        });
    }
    doOperations.push(...widthDoOperations);
    undoOperations.unshift(...widthUndoOperations);
    focusByOffset(endBlockElement, pastedEnd, pastedEnd, true, true);
    updateTransaction(protyle, transactionElement, oldHTML, undoFocusContext, {
        doOperations,
        undoOperations,
        context: getUndoFocusContext(protyle.wysiwyg.element, getEditorRange(protyle.wysiwyg.element), true)
    });
    return true;
};

const insertConvertedBlockDOM = (protyle: IProtyle, dom: string, range: Range) => {
    protyle.toolbar.range = range;
    insertHTML(dom, protyle, false, true, true);
    protyle.wysiwyg.element.querySelectorAll('[data-type~="block-ref"]').forEach(item => {
        if (item.textContent === "") {
            fetchPost("/api/block/getRefText", {id: item.getAttribute("data-id")}, (response) => {
                item.innerHTML = sanitizeKernelHTML(response.data);
            });
        }
    });
    blockRender(protyle, protyle.wysiwyg.element);
    processRender(protyle.wysiwyg.element);
    highlightRender(protyle.wysiwyg.element);
    avRender(protyle.wysiwyg.element, protyle);
    scrollCenter(protyle, undefined, "nearest", "smooth");
};

export const paste = async (protyle: IProtyle, event: (ClipboardEvent | DragEvent | IClipboardData) & {
    target: HTMLElement
}, uploadOptions?: IUploadInsertOptions) => {
    if ("clipboardData" in event || "dataTransfer" in event) {
        event.stopPropagation();
        event.preventDefault();
    }
    const pasteInsertPosition = uploadOptions?.insertPosition ||
        createUploadInsertPosition(getEditorRange(protyle.wysiwyg.element));
    const isPasteInsertPositionAvailable = () =>
        isUploadInsertPositionAvailable(protyle.wysiwyg.element, pasteInsertPosition);
    const restorePasteInsertRange = () => {
        return getAvailableUploadInsertRange(protyle.wysiwyg.element, pasteInsertPosition);
    };
    const insertAtPasteRange = (html: string, range: Range, isBlock = false, insertByCursor = false) => {
        protyle.toolbar.range = range;
        insertHTML(html, protyle, isBlock, true, insertByCursor);
    };
    const assetUploadOptions: IUploadInsertOptions = {
        ...uploadOptions,
        insertPosition: pasteInsertPosition,
        source: uploadOptions?.source || ("dataTransfer" in event ? "drop" : "paste"),
        target: uploadOptions?.target || "editor",
        position: uploadOptions?.position || ("dataTransfer" in event ? {x: event.clientX, y: event.clientY} : undefined),
    };
    let textHTML: string;
    let textPlain: string;
    let siyuanHTML: string;
    let files: FileList | DataTransferItemList | File[];
    let vscodeEditorData = "";
    let mathML = "";
    let office = "";
    let officeMathHTML = "";
    let wps = "";
    let wpsPresentation: IWPSPresentationClipboard | undefined;
    let officeListConverted = false;
    if ("clipboardData" in event) {
        textHTML = event.clipboardData.getData("text/html");
        textPlain = event.clipboardData.getData("text/plain");
        siyuanHTML = event.clipboardData.getData("text/siyuan");
        vscodeEditorData = event.clipboardData.getData("vscode-editor-data");
        files = event.clipboardData.files;
        wpsPresentation = extractWPSPresentationClipboard(event.clipboardData.types,
            (type) => event.clipboardData.getData(type));
    } else if ("dataTransfer" in event) {
        textHTML = event.dataTransfer.getData("text/html");
        textPlain = event.dataTransfer.getData("text/plain");
        siyuanHTML = event.dataTransfer.getData("text/siyuan");
        vscodeEditorData = event.dataTransfer.getData("vscode-editor-data");
        wpsPresentation = extractWPSPresentationClipboard(event.dataTransfer.types,
            (type) => event.dataTransfer.getData(type));
        if (hasDataTransferFiles(event.dataTransfer.types)) {
            files = event.dataTransfer.files;
        } else if (wpsPresentation && Array.from(event.dataTransfer.types).some((type) => type.toLowerCase() === "files")) {
            // 混合的 DataTransferItemList 还包含字符串项，上传时仅保留文件
            files = event.dataTransfer.files;
        }
    } else {
        if (event.localFiles?.length > 0) {
            readLocalFile(protyle, event.localFiles, assetUploadOptions);
            return;
        }
        textHTML = event.textHTML;
        textPlain = event.textPlain;
        siyuanHTML = event.siyuanHTML;
        files = event.files;
    }

    // Improve the pasting of selected text in PDF rectangular annotation https://github.com/siyuan-note/siyuan/issues/11629
    textPlain = textPlain.replace(/\r\n|\r|\u2028|\u2029/g, "\n");
    // PowerPoint 将可编辑公式放在条件注释中，必须在 DOM 解析和清理前读取
    officeMathHTML = extractOfficeMathHTML(textHTML);

    /// #if !BROWSER
    if (!("dataTransfer" in event) && !siyuanHTML && textHTML && textPlain) {
        [mathML, office, wps] = await Promise.all([
            ipcRenderer.invoke(Constants.SIYUAN_GET, {
                cmd: "clipboardReadMathML",
                text: textPlain,
            }),
            ipcRenderer.invoke(Constants.SIYUAN_GET, {
                cmd: "clipboardReadOffice",
                text: textPlain,
            }),
            ipcRenderer.invoke(Constants.SIYUAN_GET, {
                cmd: "clipboardReadWPS",
                text: textPlain,
            }),
        ]);
        if (!isPasteInsertPositionAvailable()) {
            return;
        }
    }
    if (!siyuanHTML && !textHTML && !textPlain && !wpsPresentation && ("clipboardData" in event)) {
        const localFiles: ILocalFiles[] = await getLocalFiles();
        if (!isPasteInsertPositionAvailable()) {
            return;
        }
        if (localFiles.length > 0) {
            readLocalFile(protyle, localFiles, assetUploadOptions);
            return;
        }
    }
    /// #endif
    let originalTextHTML = textHTML;
    if (vscodeEditorData) {
        try {
            const metadata = JSON.parse(vscodeEditorData);
            if (metadata.version === 1 && metadata.mode === "markdown") {
                textHTML = "";
            }
        } catch (e) {
            // 忽略无效的 VS Code 剪贴板元数据
        }
    }
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

    if (protyle && protyle.app && protyle.app.plugins && hasPluginSubscriber("paste")) {
        const plugins = Array.from(protyle.app.plugins);
        for (let i = 0; i < plugins.length; i++) {
            const plugin = plugins[i];
            if (!eventBusHas(plugin.eventBus, "paste")) {
                continue;
            }
            const response = await new Promise<IClipboardData | undefined | typeof PASTE_PLUGIN_TIMED_OUT>((resolve,
                                                                                                            reject) => {
                let settled = false;
                const finish = (value: IClipboardData | undefined | typeof PASTE_PLUGIN_TIMED_OUT) => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    clearTimeout(timeoutId);
                    resolve(value);
                };
                const resolveResponse = (value: IClipboardData | PromiseLike<IClipboardData | undefined> |
                    undefined) => {
                    void Promise.resolve(value).then(finish, error => {
                        if (!settled) {
                            settled = true;
                            clearTimeout(timeoutId);
                            reject(error);
                        }
                    });
                };
                const timeoutId = setTimeout(() => finish(PASTE_PLUGIN_TIMED_OUT), PASTE_PLUGIN_TIMEOUT);
                const emitResult = plugin.eventBus.emit("paste", {
                    protyle,
                    resolve: resolveResponse,
                    textHTML,
                    textPlain,
                    siyuanHTML,
                    files
                });
                if (emitResult) {
                    finish(undefined);
                }
            });

            if (!isPasteInsertPositionAvailable()) {
                return;
            }

            if (response === PASTE_PLUGIN_TIMED_OUT) {
                console.error(new Error(`Plugin ${plugin.name || `#${i + 1}`} paste processing timed out`));
                showMessage(window.siyuan.languages.uploadError);
                return;
            }

            if (response) {
                // 插件返回的是完整的剪贴板文本载荷，文件字段仅在显式返回时替换
                const normalizedResponse = normalizePasteResponse(response, files);
                textHTML = normalizedResponse.textHTML;
                textPlain = normalizedResponse.textPlain;
                siyuanHTML = normalizedResponse.siyuanHTML;
                files = normalizedResponse.files;
                originalTextHTML = textHTML;
                mathML = "";
                office = "";
                officeMathHTML = extractOfficeMathHTML(textHTML);
                wps = "";
                wpsPresentation = undefined;
            }
        }
    }

    // 外部网页可通过 copy 事件伪造 text/siyuan 或 ZWSP 结尾的 text/plain，与内部数据混同，粘贴前统一消毒 https://github.com/siyuan-note/siyuan/security/advisories/GHSA-9rr9-pxr4-gcgc
    if (siyuanHTML) {
        siyuanHTML = Lute.Sanitize(siyuanHTML);
    }

    if (!siyuanHTML && textHTML) {
        const officeList = convertOfficeLists(textHTML);
        textHTML = officeList.html;
        if (officeList.convertedCount > 0) {
            officeListConverted = true;
            originalTextHTML = textHTML;
        }
    }

    // 插件可能替换完整剪贴板载荷，因此仅从最终保留的内部数据中读取层级上下文
    const crossBlockPasteContext = siyuanHTML ? extractCrossBlockPasteContext(textHTML) : {
        nestedList: false,
        html: textHTML,
    };
    textHTML = crossBlockPasteContext.html;
    originalTextHTML = extractCrossBlockPasteContext(originalTextHTML).html;


    let range = restorePasteInsertRange();
    if (!range) {
        return;
    }
    let nodeElement = hasClosestBlock(event.target);
    if (!nodeElement) {
        nodeElement = hasClosestBlock(range.startContainer);
    }
    if (!nodeElement) {
        if (files && files.length > 0) {
            uploadFiles(protyle, files, undefined, undefined, undefined, assetUploadOptions);
        }
        return;
    }
    protyle.hint.enableExtend = protyle.hint.enableExtend ? Constants.BLOCK_HINT_KEYS.concat("{{", "/", "#", "、", "「「", "「『", "『「", "『『",).includes(protyle.hint.splitChar) : false;
    hideElements(protyle.hint.enableExtend ? ["select"] : ["select", "hint"], protyle);
    protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--hl").forEach(item => {
        item.classList.remove("protyle-wysiwyg--hl");
    });
    const code = processPasteCode(textHTML, textPlain, originalTextHTML, protyle);
    if (nodeElement.getAttribute("data-type") === "NodeCodeBlock" ||
        protyle.toolbar.getCurrentType(range).includes("code")) {
        // https://github.com/siyuan-note/siyuan/issues/13552
        insertAtPasteRange(removeZWJ(textPlain).replace(/```/g, "\u200D```"), range);
        return;
    } else if (siyuanHTML) {
        async function streamInsert(container: HTMLElement, bigHtmlString: string) {
            // 大段内容使用惰性解析避免将 HTML 写入同源 iframe，防止 script 执行
            const doc = new DOMParser().parseFromString(bigHtmlString, "text/html");
            if (!doc.body || !doc.body.firstChild) {
                return false;
            }
            if (!isPasteInsertPositionAvailable()) {
                return false;
            }
            const fragment = document.createDocumentFragment();
            while (doc.body.firstChild) {
                fragment.appendChild(doc.body.firstChild);
            }
            container.appendChild(fragment);
            return true;
        }

        // 编辑器内部粘贴
        const tempElement = document.createElement("div");
        if (1024 * 512 < siyuanHTML.length) {
            if (!await streamInsert(tempElement, siyuanHTML)) {
                return;
            }
            range = restorePasteInsertRange();
            if (!range) {
                return;
            }
        } else {
            tempElement.innerHTML = siyuanHTML;
        }
        normalizeSemanticInlineElements(tempElement);
        const preservePastedBlockStructure = shouldPreservePastedBlockStructure(tempElement.children);
        const startRangeBlockElement = hasClosestBlock(range.startContainer);
        const endRangeBlockElement = hasClosestBlock(range.endContainer);
        if (startRangeBlockElement && endRangeBlockElement && startRangeBlockElement !== endRangeBlockElement) {
            const selectedElement = document.createElement("div");
            selectedElement.append(range.cloneContents());
            const pastedElement = tempElement.cloneNode(true) as HTMLElement;
            [selectedElement, pastedElement].forEach(element => {
                normalizeVirtualBlockRef(element);
                element.querySelectorAll(".protyle-attr").forEach(item => item.remove());
            });
            if (selectedElement.isEqualNode(pastedElement)) {
                range.collapse(false);
                getSelection().removeAllRanges();
                getSelection().addRange(range);
                protyle.toolbar.range = range;
                return;
            }
        }
        const selectedText = stripSemanticMarkersFromRangeText(range).split(Constants.ZWSP).join("");
        if (selectedText && startRangeBlockElement === endRangeBlockElement) {
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
                protyle.toolbar.range = range;
                const refElement = protyle.toolbar.setInlineMark(protyle, "block-ref", "range", {
                    type: "id",
                    color: `${linkElement.dataset.id}${Constants.ZWSP}s${Constants.ZWSP}${selectedText}`
                });
                if (refElement[0]) {
                    protyle.toolbar.range.selectNodeContents(refElement[0]);
                }
                return;
            }
            if (types.includes("a")) {
                protyle.toolbar.range = range;
                protyle.toolbar.setInlineMark(protyle, "a", "range", {
                    type: "a",
                    color: `${linkElement.dataset.href}${Constants.ZWSP}${selectedText}`
                });
                return;
            }
        }
        resetPastedQueryEmbedRenderState(tempElement);
        let isBlock = false;
        const pastedBlockElements = tempElement.querySelectorAll("[data-node-id]");
        if (pastedBlockElements.length > 0) {
            isBlock = true;
            // 剪切后粘贴时原块已被删除,保留原 ID 可避免该块被其他位置的引用失效;
            // 仅当 ID 仍存在(复制粘贴)时才生成新 ID
            const oldIds: string[] = [];
            pastedBlockElements.forEach((e) => {
                oldIds.push(e.getAttribute("data-node-id"));
            });
            const existResponse = await fetchSyncPost("/api/block/checkBlocksExist", {ids: oldIds});
            range = restorePasteInsertRange();
            if (!range) {
                return;
            }
            pastedBlockElements.forEach((e) => {
                const originalId = e.getAttribute("data-node-id");
                const isCutPaste = existResponse.data[originalId] === false; // 剪切来的（原块已删）
                if (!isCutPaste) {
                    // 复制粘贴：生成新 ID
                    e.setAttribute("data-node-id", Lute.NewNodeID());
                }
                clearBlockElement(e, isCutPaste); // 剪切粘贴保留引用角标
            });
            const updated = dayjs().format("YYYYMMDDHHmmss");
            pastedBlockElements.forEach((e) => {
                e.setAttribute("updated", updated);
            });
        }
        if (nodeElement.classList.contains("table")) {
            isBlock = false;
        }
        // 从历史中复制后粘贴
        tempElement.querySelectorAll('[contenteditable="false"][spellcheck]').forEach((e) => {
            e.setAttribute("contenteditable", "true");
        });
        const hasHeadingChildren = Array.from(tempElement.children).some(item =>
            item.hasAttribute("parent-heading"));
        // 完整块选择以及以标题开头的跨块文本选区需要保留块类型
        // 标题及下方块还需要保留折叠关系 https://github.com/siyuan-note/siyuan/issues/18419
        if (isBlock && !preservePastedBlockStructure && !hasHeadingChildren &&
            pasteCrossBlockRange(protyle, tempElement, range, crossBlockPasteContext.nestedList)) {
            blockRender(protyle, protyle.wysiwyg.element);
            processRender(protyle.wysiwyg.element);
            highlightRender(protyle.wysiwyg.element);
            avRender(protyle.wysiwyg.element, protyle);
            return;
        }

        // innerHTML 已按属性上下文转义 HTML 块源码，保留序列化结果才能避免 data-content 被内层引号截断。
        const tempInnerHTML = serializePastedBlockDOM(tempElement);

        if (!nodeElement.classList.contains("av") && tempInnerHTML.startsWith("[[{") && tempInnerHTML.endsWith("}]]")) {
            try {
                const json = JSON.parse(tempInnerHTML);
                if (json.length > 0 && json[0].length > 0 && json[0][0].id && json[0][0].type) {
                    insertAtPasteRange(textPlain, range, isBlock);
                } else {
                    insertAtPasteRange(tempInnerHTML, range, isBlock);
                }
            } catch (e) {
                insertAtPasteRange(tempInnerHTML, range, isBlock);
            }
        } else {
            insertAtPasteRange(tempInnerHTML, range, isBlock, true);
        }
        blockRender(protyle, protyle.wysiwyg.element);
        processRender(protyle.wysiwyg.element);
        highlightRender(protyle.wysiwyg.element);
        avRender(protyle.wysiwyg.element, protyle);
    } else if (code) {
        if (!code.startsWith('<div data-type="NodeCodeBlock" class="code-block" data-node-id="')) {
            // 原有代码在行内元素中粘贴会嵌套
            insertAtPasteRange(code, range);
        } else {
            insertAtPasteRange(code, range, true, true);
            highlightRender(protyle.wysiwyg.element);
        }
        hideElements(["hint"], protyle);
    } else {
        if (wpsPresentation && shouldConvertWPSPresentation(wpsPresentation, textHTML, siyuanHTML)) {
            let response: IWebSocketData | undefined;
            try {
                response = await fetchSyncPost("/api/lute/wpsPresentation2BlockDOM", {
                    data: wpsPresentation.data,
                    text: textPlain,
                    type: wpsPresentation.type,
                });
            } catch (e) {
                // 内核不可用时继续使用剪贴板中的纯文本或图片
            }
            range = restorePasteInsertRange();
            if (!range) {
                return;
            }
            const result = response?.data as { converted?: unknown, dom?: unknown };
            if (response?.code === 0 && result?.converted === true && typeof result.dom === "string" && result.dom.trim() !== "") {
                insertConvertedBlockDOM(protyle, result.dom, range);
                return;
            }
            const fallback = getWPSPresentationFallback(wpsPresentation.type, Boolean(files?.length));
            if (fallback === "files") {
                uploadFiles(protyle, files, undefined, undefined, undefined, assetUploadOptions);
                return;
            }
            files = [];
        }
        let isHTML = false;
        if (textHTML.replace("<!--StartFragment--><!--EndFragment-->", "").trim() !== "") {
            textHTML = textHTML.replace("<!--StartFragment-->", "").replace("<!--EndFragment-->", "").trim();
            if (!officeListConverted && files && files.length === 1 && (
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
        } else if (textPlain && textPlain.trimStart().startsWith("<")) {
            // 剪贴板没有 text/html，但 text/plain 实际是 HTML 表格（如从纯文本编辑器复制的表格 HTML）
            // Md2BlockDOM 会把标签当字面文本，需走 html2BlockDOM 解析
            // Improve pasting for tables containing merged cells https://github.com/siyuan-note/siyuan/issues/11888
            if (textPlain.toLowerCase().indexOf("</table>") > -1) {
                textHTML = textPlain;
                isHTML = true;
            }
        }
        if (isHTML) {
            const tempElement = document.createElement("div");
            tempElement.innerHTML = textHTML;
            if (!getHostCapabilities().localFileSystem) {
                removeHTMLLocalAssetPaths(collectHTMLLocalAssets(tempElement));
            }
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
            if (linkElement?.getAttribute("href")) {
                const selectText = stripSemanticMarkersFromRangeText(range).split(Constants.ZWSP).join("");
                protyle.toolbar.range = range;
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
            if (nodeElement.classList.contains("av") && tempElement.querySelector("table")) {
                insertAtPasteRange(tempElement.innerHTML, range, false, true);
                return;
            }
            let localAssets = collectHTMLLocalAssets(tempElement);
            let preparedHTML = false;
            const conversionContext = {
                text: textPlain,
                mathML,
                office,
                officeMathHTML,
                wps,
            };
            if (localAssets.length > 0 || hasHTMLEmbeddedAssets(tempElement)) {
                try {
                    validateHTMLEmbeddedAssetSizes(tempElement, protyle.options.upload.max);
                } catch (error) {
                    if (showBase64ImageSizeLimit(error)) {
                        return;
                    }
                    throw error;
                }
                let preflightResponse: IWebSocketData;
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), PASTE_PLUGIN_TIMEOUT);
                try {
                    preflightResponse = await fetchSyncPost("/api/lute/html2BlockDOM", {
                        ...conversionContext,
                        dom: tempElement.innerHTML,
                        preflight: true,
                    }, undefined, true, controller.signal);
                } catch (error) {
                    console.error(error);
                    if (isPasteInsertPositionAvailable()) {
                        showMessage(window.siyuan.languages.uploadError);
                    }
                    return;
                } finally {
                    clearTimeout(timeoutId);
                }
                range = restorePasteInsertRange();
                if (!range) {
                    return;
                }
                const preflight = preflightResponse?.data as {
                    converted?: unknown,
                    dom?: unknown,
                    normalizedHTML?: unknown,
                    useHTML?: unknown,
                };
                if (preflightResponse?.code !== 0 || preflight?.converted !== true ||
                    typeof preflight.useHTML !== "boolean") {
                    showMessage(window.siyuan.languages.uploadError);
                    return;
                }
                if (!preflight.useHTML) {
                    if (typeof preflight.dom !== "string") {
                        showMessage(window.siyuan.languages.uploadError);
                        return;
                    }
                    insertConvertedBlockDOM(protyle, preflight.dom, range);
                    return;
                }
                if (typeof preflight.normalizedHTML !== "string") {
                    showMessage(window.siyuan.languages.uploadError);
                    return;
                }
                tempElement.innerHTML = preflight.normalizedHTML;
                localAssets = collectHTMLLocalAssets(tempElement);
                if (!getHostCapabilities().localFileSystem) {
                    removeHTMLLocalAssetPaths(localAssets);
                    localAssets = [];
                }
                preparedHTML = true;
            }
            if (localAssets.length > 0) {
                let localAssetPaths: string[] | undefined;
                await new Promise<void>(resolve => {
                    uploadLocalFiles(localAssets.map(item => ({path: item.path, size: null})), protyle, true, {
                        ...assetUploadOptions,
                        requiredFileCount: localAssets.length,
                        fromHTMLPaste: true,
                    }, (_response, result) => {
                        localAssetPaths = getCompleteAssetUploadPathsByInput(localAssets.length, result);
                    }, () => resolve());
                });
                if (!localAssetPaths) {
                    return;
                }
                range = restorePasteInsertRange();
                if (!range) {
                    return;
                }
                applyHTMLLocalAssetPaths(localAssets, localAssetPaths);
            }
            let embeddedAssets: IHTMLEmbeddedAsset[];
            try {
                embeddedAssets = collectHTMLEmbeddedAssets(tempElement, protyle.options.upload.max);
            } catch (error) {
                if (showBase64ImageSizeLimit(error)) {
                    return;
                }
                throw error;
            }
            if (embeddedAssets.length > 0) {
                let embeddedAssetPaths: string[] | undefined;
                await new Promise<void>(resolve => {
                    uploadFiles(protyle, embeddedAssets.map(item => item.file), undefined, (_response, result) => {
                        embeddedAssetPaths = getCompleteAssetUploadPathsByInput(embeddedAssets.length, result);
                    }, () => resolve(), {
                        ...assetUploadOptions,
                        requiredFileCount: embeddedAssets.length,
                    });
                });
                if (!embeddedAssetPaths) {
                    return;
                }
                range = restorePasteInsertRange();
                if (!range) {
                    return;
                }
                applyHTMLEmbeddedAssetPaths(embeddedAssets, embeddedAssetPaths);
            }
            let conversionResponse: IWebSocketData;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), PASTE_PLUGIN_TIMEOUT);
            try {
                conversionResponse = await fetchSyncPost("/api/lute/html2BlockDOM", {
                    ...conversionContext,
                    dom: tempElement.innerHTML,
                    preparedHTML,
                    skipLocalAssets: localAssets.length > 0,
                    skipBase64Assets: true,
                    skipInlineSVGAssets: true,
                }, undefined, true, controller.signal);
            } catch (error) {
                console.error(error);
                if (isPasteInsertPositionAvailable()) {
                    showMessage(window.siyuan.languages.uploadError);
                }
                return;
            } finally {
                clearTimeout(timeoutId);
            }
            range = restorePasteInsertRange();
            if (!range) {
                return;
            }
            if (conversionResponse?.code !== 0 || typeof conversionResponse?.data !== "string") {
                showMessage(window.siyuan.languages.uploadError);
                return;
            }
            insertConvertedBlockDOM(protyle, conversionResponse.data, range);
            return;
        } else if (files && files.length > 0) {
            uploadFiles(protyle, files, undefined, undefined, undefined, assetUploadOptions);
            return;
        } else if (textPlain.trim() !== "" && (files && files.length === 0 || !files)) {
            const selectedText = stripSemanticMarkersFromRangeText(range).split(Constants.ZWSP).join("");
            if (selectedText !== "") {
                const firstLine = textPlain.split("\n")[0];
                if (isDynamicRef(textPlain)) {
                    protyle.toolbar.range = range;
                    const refElement = protyle.toolbar.setInlineMark(protyle, "block-ref", "range", {
                        type: "id",
                        // range 不能 escape，否则 https://github.com/siyuan-note/siyuan/issues/8359
                        color: `${textPlain.substring(2, 22 + 2)}${Constants.ZWSP}s${Constants.ZWSP}${selectedText}`
                    });
                    if (refElement[0]) {
                        protyle.toolbar.range.selectNodeContents(refElement[0]);
                    }
                    return;
                } else if (isFileAnnotation(firstLine)) {
                    protyle.toolbar.range = range;
                    protyle.toolbar.setInlineMark(protyle, "file-annotation-ref", "range", {
                        type: "file-annotation-ref",
                        color: firstLine.substring(2).replace(/ ".+">>$/, "")
                    });
                    return;
                } else {
                    // https://github.com/siyuan-note/siyuan/issues/8475
                    const linkDest = resolveLinkDest(textPlain, protyle.lute);
                    if (linkDest) {
                        protyle.toolbar.range = range;
                        protyle.toolbar.setInlineMark(protyle, "a", "range", {
                            type: "a",
                            color: linkDest
                        });
                        return;
                    }
                }
            }
            let textPlainDom: string;

            // Auto-convert pasted URL to link format https://github.com/siyuan-note/siyuan/issues/17337
            if (window.siyuan.config.editor.pasteURLAutoConvert) {
                textPlainDom = protyle.lute.Md2BlockDOMWithAutoLink(textPlain);
            } else {
                textPlainDom = protyle.lute.Md2BlockDOM(textPlain);
            }
            if (textPlainDom && textPlainDom.indexOf("data:image/") > -1) {
                const tempElement = document.createElement("template");
                tempElement.innerHTML = textPlainDom;
                const imgSrcList: string[] = [];
                const imageElements: HTMLImageElement[] = [];
                tempElement.content.querySelectorAll("img").forEach((item) => {
                    const dataSrc = item.getAttribute("data-src");
                    if (dataSrc?.startsWith("data:image/")) {
                        imgSrcList.push(dataSrc);
                        imageElements.push(item);
                    }
                });
                let base64SrcList: Array<string | undefined>;
                try {
                    base64SrcList = await base64ToURL(imgSrcList, protyle, assetUploadOptions);
                } catch (error) {
                    if (showBase64ImageSizeLimit(error)) {
                        return;
                    }
                    throw error;
                }
                range = restorePasteInsertRange();
                if (!range) {
                    return;
                }
                base64SrcList.forEach((item, index) => {
                    if (!item) {
                        return;
                    }
                    imageElements[index].setAttribute("src", item);
                    imageElements[index].setAttribute("data-src", item);
                    imageElements[index].parentElement.querySelector(".img__net")?.remove();
                });
                textPlainDom = tempElement.innerHTML;
            }
            insertAtPasteRange(textPlainDom, range, false, true);
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
