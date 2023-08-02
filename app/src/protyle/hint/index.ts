import {Constants} from "../../constants";
import {hasClosestBlock, hasClosestByAttribute, hasClosestByClassName, hasClosestByMatchTag} from "../util/hasClosest";
import {
    focusBlock,
    focusByRange,
    focusByWbr,
    getEditorRange,
    getSelectionOffset,
    getSelectionPosition
} from "../util/selection";
import {genHintItemHTML, hintEmbed, hintRef, hintSlash} from "./extend";
import {getSavePath} from "../../util/newFile";
import {upDownHint} from "../../util/upDownHint";
import {setPosition} from "../../util/setPosition";
import {getContenteditableElement, hasNextSibling, hasPreviousSibling} from "../wysiwyg/getBlock";
import {transaction, updateTransaction} from "../wysiwyg/transaction";
import {insertHTML} from "../util/insertHTML";
import {highlightRender} from "../render/highlightRender";
import {imgMenu} from "../../menus/protyle";
import {hideElements} from "../ui/hideElements";
import {fetchPost} from "../../util/fetch";
import {getDisplayName, pathPosix} from "../../util/pathName";
import {addEmoji, filterEmoji, lazyLoadEmoji, lazyLoadEmojiImg, unicode2Emoji} from "../../emoji";
import {blockRender} from "../render/blockRender";
import {uploadFiles} from "../upload";
/// #if !MOBILE
import {openFileById} from "../../editor/util";
/// #endif
import {openMobileFileById} from "../../mobile/editor";
import {processRender} from "../util/processCode";
import {AIChat} from "../../ai/chat";
import {isMobile} from "../../util/functions";
import {isCtrl} from "../util/compatibility";
import {avRender} from "../render/av/render";
import {genIconHTML} from "../render/util";

export class Hint {
    public timeId: number;
    public element: HTMLDivElement;
    public enableSlash = true;
    private enableEmoji = true;
    public enableExtend = false;
    public splitChar = "";
    public lastIndex = -1;
    private source: THintSource;

    constructor(protyle: IProtyle) {
        this.element = document.createElement("div");
        this.element.setAttribute("data-close", "false");
        // height 402 根据 .emojis max-height+8 得来
        this.element.setAttribute("style", `width:${Math.max(protyle.element.clientWidth / 2, 320)}px;`);
        this.element.className = "protyle-hint b3-list b3-list--background fn__none";
        this.element.addEventListener("click", (event) => {
            const eventTarget = event.target as HTMLElement;
            if (eventTarget.tagName === "INPUT") {
                event.stopPropagation();
                return;
            }
            const btnElement = hasClosestByMatchTag(eventTarget, "BUTTON");
            if (btnElement && !btnElement.classList.contains("emojis__item") && !btnElement.classList.contains("emojis__type")) {
                if (this.source !== "search") {
                    this.fill(decodeURIComponent(btnElement.getAttribute("data-value")), protyle, true, isCtrl(event));
                } else {
                    // 划选引用点击，需先重置 range
                    setTimeout(() => {
                        this.fill(decodeURIComponent(btnElement.getAttribute("data-value")), protyle);
                    }, 148);
                    focusByRange(protyle.toolbar.range);
                }

                event.preventDefault();
                event.stopPropagation(); // https://github.com/siyuan-note/siyuan/issues/3710
                return;
            }
            const emojisContentElement = this.element.querySelector(".emojis__panel");
            const typeElement = hasClosestByClassName(eventTarget, "emojis__type");
            if (typeElement) {
                const titleElement = emojisContentElement.querySelector(`[data-type="${typeElement.getAttribute("data-type")}"]`) as HTMLElement;
                if (titleElement) {
                    const index = titleElement.nextElementSibling.getAttribute("data-index");
                    if (index) {
                        let html = "";
                        window.siyuan.emojis[parseInt(index)].items.forEach(emoji => {
                            html += `<button data-unicode="${emoji.unicode}" class="emojis__item ariaLabel" aria-label="${window.siyuan.config.lang === "zh_CN" ? emoji.description_zh_cn : emoji.description}">
${unicode2Emoji(emoji.unicode)}</button>`;
                        });
                        titleElement.nextElementSibling.innerHTML = html;
                        titleElement.nextElementSibling.removeAttribute("data-index");
                    }

                    emojisContentElement.scrollTo({
                        top: titleElement.offsetTop,
                        // behavior: "smooth"  不能使用，否则无法定位
                    });
                }
                return;
            }
            const emojiElement = hasClosestByClassName(eventTarget, "emojis__item");
            if (emojiElement) {
                const unicode = emojiElement.getAttribute("data-unicode");
                if (this.element.querySelectorAll(".emojis__title").length > 2) {
                    // /emoji 后会自动添加冒号，导致 range 无法计算，因此不依赖 this.fill
                    const range = getSelection().getRangeAt(0);
                    if (range.endContainer.nodeType !== 3) {
                        range.endContainer.childNodes[range.endOffset - 1]?.remove();
                    } else if (range.endContainer.textContent === ":") {
                        // iphone
                        range.endContainer.textContent = "";
                    }
                    addEmoji(unicode);
                    let emoji;
                    if (unicode.indexOf(".") > -1) {
                        emoji = `:${unicode.split(".")[0]}: `;
                    } else {
                        emoji = unicode2Emoji(unicode) + " ";
                    }
                    insertHTML(protyle.lute.SpinBlockDOM(emoji), protyle, false, true);
                    this.element.classList.add("fn__none");
                } else {
                    this.fill(unicode, protyle);
                }
            }
        });
    }

    public render(protyle: IProtyle) {
        if (!window.getSelection().focusNode) {
            this.element.classList.add("fn__none");
            clearTimeout(this.timeId);
            return;
        }
        if (!this.enableExtend) {
            clearTimeout(this.timeId);
            return;
        }
        protyle.toolbar.range = getSelection().getRangeAt(0);
        // 粘贴后 range.startContainer 为空 https://github.com/siyuan-note/siyuan/issues/7360
        if (protyle.toolbar.range.startContainer.nodeType === 3 && protyle.toolbar.range.startContainer.textContent === "") {
            const lastSibling = hasPreviousSibling(protyle.toolbar.range.startContainer) as Text;
            if (lastSibling && lastSibling.nodeType === 3) {
                if (lastSibling.wholeText !== lastSibling.textContent) {
                    let previousSibling = lastSibling.previousSibling;
                    while (previousSibling && previousSibling.nodeType === 3) {
                        if (previousSibling.textContent === "") {
                            previousSibling = previousSibling.previousSibling;
                            previousSibling.nextSibling.remove();
                        } else {
                            lastSibling.textContent = previousSibling.textContent + lastSibling.textContent;
                            previousSibling.remove();
                            break;
                        }
                    }
                }
                protyle.toolbar.range.setStart(lastSibling, lastSibling.textContent.length);
                protyle.toolbar.range.collapse(true);
            }
        }
        const start = getSelectionOffset(protyle.toolbar.range.startContainer, protyle.wysiwyg.element).start;
        const currentLineValue = protyle.toolbar.range.startContainer.textContent.substring(0, start) || "";
        const key = this.getKey(currentLineValue, protyle.options.hint.extend);
        if (typeof key === "undefined" ||
            (   // 除 emoji 提示外，其余在 inline-code 内移动不进行提示
                this.splitChar !== ":" && hasClosestByAttribute(protyle.toolbar.range.startContainer, "data-type", "NodeCodeBlock")
            )
        ) {
            this.element.classList.add("fn__none");
            clearTimeout(this.timeId);
            return;
        }

        // https://github.com/siyuan-note/siyuan/issues/7933
        if (this.splitChar === "#") {
            const blockElement = hasClosestBlock(protyle.toolbar.range.startContainer);
            if (blockElement && blockElement.getAttribute("data-type") === "NodeHeading") {
                const blockIndex = getSelectionOffset(protyle.toolbar.range.startContainer, blockElement).start;
                if (blockElement.textContent.startsWith("#".repeat(blockIndex))) {
                    this.element.classList.add("fn__none");
                    clearTimeout(this.timeId);
                    return;
                }
            }
        }

        if (this.splitChar === ":") {
            clearTimeout(this.timeId);
            if (key) {
                this.genEmojiHTML(protyle, key);
            } else {
                this.element.classList.add("fn__none");
            }
            return;
        }
        // https://github.com/siyuan-note/siyuan/issues/5083
        if (this.splitChar === "/" || this.splitChar === "、") {
            clearTimeout(this.timeId);
            if (this.enableSlash && !isMobile()) {
                this.genHTML(hintSlash(key, protyle), protyle, false, "hint");
            }
            return;
        }

        protyle.options.hint.extend.forEach((item) => {
            if (item.key === this.splitChar) {
                clearTimeout(this.timeId);
                this.timeId = window.setTimeout(() => {
                    this.genHTML(item.hint(key, protyle, "hint"), protyle, false, "hint");
                }, protyle.options.hint.delay);
            }
        });
    }

    public genLoading(protyle: IProtyle) {
        if (this.element.classList.contains("fn__none")) {
            this.element.innerHTML = '<div class="fn__loading" style="height: 128px;position: initial"><img width="64px" src="/stage/loading-pure.svg"></div>';
            this.element.classList.remove("fn__none");
            const textareaPosition = getSelectionPosition(protyle.wysiwyg.element);
            setPosition(this.element, textareaPosition.left, textareaPosition.top + 26, 30);
        } else {
            this.element.insertAdjacentHTML("beforeend", '<div class="fn__loading"><img width="64px" src="/stage/loading-pure.svg"></div>');
        }
    }

    public bindUploadEvent(protyle: IProtyle, element: HTMLElement) {
        const uploadElement = element.querySelector('input[type="file"]');
        if (uploadElement) {
            uploadElement.addEventListener("change", (event: InputEvent & { target: HTMLInputElement }) => {
                if (event.target.files.length === 0) {
                    return;
                }
                const range = getEditorRange(protyle.wysiwyg.element);
                if (this.lastIndex > -1) {
                    range.setStart(range.startContainer, this.lastIndex);
                }
                range.deleteContents();
                uploadFiles(protyle, event.target.files, event.target);
                hideElements(["hint", "toolbar"], protyle);
            });
        }
    }

    private getHTMLByData(data: IHintData[]) {
        let hintsHTML = '<div style="flex: 1;overflow:auto;">';
        if (this.source !== "hint") {
            hintsHTML = '<input style="margin:0 8px 4px 8px" class="b3-text-field"><div style="flex: 1;overflow:auto;">';
        }
        data.forEach((hintData, i) => {
            // https://github.com/siyuan-note/siyuan/issues/1229 提示时，新建文件不应默认选中
            let focusClass = "";
            if ((i === 1 && data[i].focus) ||
                (i === 0 && (data.length === 1 || !data[1].focus))) {
                focusClass = " b3-list-item--focus";
            }
            if (hintData.html === "separator") {
                hintsHTML += '<div class="b3-menu__separator"></div>';
            } else {
                hintsHTML += `<button style="width: calc(100% - 16px)" class="b3-list-item b3-list-item--two${focusClass}" data-value="${encodeURIComponent(hintData.value)}">${hintData.html}</button>`;
            }
        });
        return `${hintsHTML}</div>`;
    }

    public genHTML(data: IHintData[], protyle: IProtyle, hide = false, source: THintSource) {
        this.source = source;
        if (data.length === 0) {
            if (!this.element.querySelector(".fn__loading") || hide) {
                this.element.classList.add("fn__none");
            }
            return;
        }

        this.element.innerHTML = this.getHTMLByData(data);
        this.element.classList.remove("fn__none");
        // https://github.com/siyuan-note/siyuan/issues/4575
        if (data[0].filter) {
            this.element.classList.add("hint--menu");
        } else {
            this.element.classList.remove("hint--menu");
        }
        this.element.style.width = Math.max(protyle.element.clientWidth / 2, 320) + "px";
        if (this.source === "av") {
            const blockElement = hasClosestBlock(protyle.toolbar.range.startContainer);
            if (blockElement) {
                const rowAddRect = blockElement.querySelector(".av__row--add").getBoundingClientRect();
                setPosition(this.element, rowAddRect.left, rowAddRect.bottom, rowAddRect.height);
            }
        } else {
            const textareaPosition = getSelectionPosition(protyle.wysiwyg.element);
            setPosition(this.element, textareaPosition.left, textareaPosition.top + 26, 30);
        }
        this.element.scrollTop = 0;
        this.bindUploadEvent(protyle, this.element);
        if (this.source !== "hint") {
            const searchElement = this.element.querySelector("input.b3-text-field") as HTMLInputElement;
            const oldValue = this.element.querySelector("mark")?.textContent || "";
            searchElement.value = oldValue;
            searchElement.select();
            searchElement.addEventListener("keydown", (event: KeyboardEvent) => {
                if (event.key !== "Meta" && event.key !== "Control") {
                    // 需要冒泡以满足光标在块标位置时 ctrl 弹出悬浮层
                    event.stopPropagation();
                }
                if (event.isComposing) {
                    return;
                }
                upDownHint(this.element.lastElementChild, event);
                if (event.key === "Enter") {
                    setTimeout(() => {
                        this.fill(decodeURIComponent(this.element.querySelector(".b3-list-item--focus").getAttribute("data-value")), protyle);
                    }, 148);
                    focusByRange(protyle.toolbar.range);
                    event.preventDefault();
                } else if (event.key === "Escape") {
                    this.element.classList.add("fn__none");
                    focusByRange(protyle.toolbar.range);
                }
            });
            const nodeElement = protyle.toolbar.range ? hasClosestBlock(protyle.toolbar.range.startContainer) : false;
            searchElement.addEventListener("input", (event: InputEvent) => {
                if (event.isComposing) {
                    return;
                }
                event.stopPropagation();
                this.genSearchHTML(protyle, searchElement, nodeElement, oldValue);
            });
            searchElement.addEventListener("compositionend", (event: InputEvent) => {
                event.stopPropagation();
                this.genSearchHTML(protyle, searchElement, nodeElement, oldValue);
            });
        }
    }

    private genSearchHTML(protyle: IProtyle, searchElement: HTMLInputElement, nodeElement: false | HTMLElement, oldValue: string) {
        this.element.lastElementChild.innerHTML = '<div class="ft__center"><img style="height:32px;width:32px;" src="/stage/loading-pure.svg"></div>';
        fetchPost("/api/search/searchRefBlock", {
            k: searchElement.value,
            id: nodeElement ? nodeElement.getAttribute("data-node-id") : protyle.block.parentID,
            beforeLen: Math.floor((Math.max(protyle.element.clientWidth / 2, 320) - 58) / 28.8),
            rootID: protyle.block.rootID,
        }, (response) => {
            let searchHTML = "";
            if (response.data.newDoc) {
                const blockRefText = `((newFile "${oldValue}"${Constants.ZWSP}'${response.data.k}${Lute.Caret}'))`;
                searchHTML += `<button style="width: calc(100% - 16px)" class="b3-list-item b3-list-item--two${response.data.blocks.length === 0 ? " b3-list-item--focus" : ""}" data-value="${encodeURIComponent(blockRefText)}"><div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconFile"></use></svg>
<span class="b3-list-item__text">${window.siyuan.languages.newFile} <mark>${response.data.k}</mark></span></div></button>`;
            }
            response.data.blocks.forEach((item: IBlock, index: number) => {
                const blockRefHTML = `<span data-type="block-ref" data-id="${item.id}" data-subtype="s">${oldValue}</span>`;
                searchHTML += `<button style="width: calc(100% - 16px)" class="b3-list-item b3-list-item--two${index === 0 ? " b3-list-item--focus" : ""}" data-value="${encodeURIComponent(blockRefHTML)}">
${genHintItemHTML(item)}
</button>`;
            });
            if (searchHTML === "") {
                searchHTML = `<button style="width: calc(100% - 16px)" class="b3-list-item b3-list-item--two" data-value="">${window.siyuan.languages.emptyContent}</button>`;
            }
            this.element.lastElementChild.innerHTML = searchHTML;
        });
    }

    private genEmojiHTML(protyle: IProtyle, value = "") {
        if (value && !this.enableEmoji) {
            return;
        }
        const panelElement = this.element.querySelector(".emojis__panel");
        if (panelElement) {
            panelElement.innerHTML = filterEmoji(value, 256);
            if (value) {
                panelElement.nextElementSibling.classList.add("fn__none");
            } else {
                panelElement.nextElementSibling.classList.remove("fn__none");
            }
            lazyLoadEmojiImg(panelElement);
        } else {
            this.element.innerHTML = `<div class="emojis">
<div class="emojis__panel">${filterEmoji(value, 256)}</div>
<div class="fn__flex${value ? " fn__none" : ""}">
    <button data-type="0" class="emojis__type ariaLabel" aria-label="${window.siyuan.languages.recentEmoji}">${unicode2Emoji("2b50")}</button>
    <button data-type="1" class="emojis__type ariaLabel" aria-label="${window.siyuan.emojis[0][window.siyuan.config.lang === "zh_CN" ? "title_zh_cn" : "title"]}">${unicode2Emoji("1f527")}</button>
    <button data-type="2" class="emojis__type ariaLabel" aria-label="${window.siyuan.emojis[1][window.siyuan.config.lang === "zh_CN" ? "title_zh_cn" : "title"]}">${unicode2Emoji("1f60d")}</button>
    <button data-type="3" class="emojis__type ariaLabel" aria-label="${window.siyuan.emojis[2][window.siyuan.config.lang === "zh_CN" ? "title_zh_cn" : "title"]}">${unicode2Emoji("1f433")}</button>
    <button data-type="4" class="emojis__type ariaLabel" aria-label="${window.siyuan.emojis[3][window.siyuan.config.lang === "zh_CN" ? "title_zh_cn" : "title"]}">${unicode2Emoji("1f96a")}</button>
    <button data-type="5" class="emojis__type ariaLabel" aria-label="${window.siyuan.emojis[4][window.siyuan.config.lang === "zh_CN" ? "title_zh_cn" : "title"]}">${unicode2Emoji("1f3a8")}</button>
    <button data-type="6" class="emojis__type ariaLabel" aria-label="${window.siyuan.emojis[5][window.siyuan.config.lang === "zh_CN" ? "title_zh_cn" : "title"]}">${unicode2Emoji("1f3dd")}</button>
    <button data-type="7" class="emojis__type ariaLabel" aria-label="${window.siyuan.emojis[6][window.siyuan.config.lang === "zh_CN" ? "title_zh_cn" : "title"]}">${unicode2Emoji("1f52e")}</button>
    <button data-type="8" class="emojis__type ariaLabel" aria-label="${window.siyuan.emojis[7][window.siyuan.config.lang === "zh_CN" ? "title_zh_cn" : "title"]}">${unicode2Emoji("267e")}</button>
    <button data-type="9" class="emojis__type ariaLabel" aria-label="${window.siyuan.emojis[8][window.siyuan.config.lang === "zh_CN" ? "title_zh_cn" : "title"]}">${unicode2Emoji("1f6a9")}</button>
</div>
</div>`;
            lazyLoadEmoji(this.element);
            lazyLoadEmojiImg(this.element);
        }
        const firstEmojiElement = this.element.querySelector(".emojis__item");
        if (firstEmojiElement) {
            firstEmojiElement.classList.add("emojis__item--current");
            this.element.classList.remove("fn__none");
            this.element.style.width = Math.max(protyle.element.clientWidth / 2, 320) + "px";
            const textareaPosition = getSelectionPosition(protyle.wysiwyg.element);
            setPosition(this.element, textareaPosition.left, textareaPosition.top + 26, 30);
            this.element.querySelector(".emojis__panel").scrollTop = 0;
        } else {
            this.element.classList.add("fn__none");
        }
    }

    public fill(value: string, protyle: IProtyle, updateRange = true, refIsS = false) {
        hideElements(["hint", "toolbar"], protyle);
        if (updateRange && this.source !== "av") {
            protyle.toolbar.range = getEditorRange(protyle.wysiwyg.element);
        }
        const range = protyle.toolbar.range;
        let nodeElement = hasClosestBlock(protyle.toolbar.range.startContainer) as HTMLElement;
        if (!nodeElement) {
            return;
        }
        if (this.source === "av") {
            const avID = nodeElement.getAttribute("data-av-id");
            const rowsElement = nodeElement.querySelectorAll(".av__row");
            const previousID = rowsElement[rowsElement.length - 1].getAttribute("data-id");
            let tempElement = document.createElement("div");
            tempElement.innerHTML = value.replace(/<mark>/g, "").replace(/<\/mark>/g, "");
            tempElement = tempElement.firstElementChild as HTMLDivElement;
            if (value.startsWith("((newFile ") && value.endsWith(`${Lute.Caret}'))`)) {
                const fileNames = value.substring(11, value.length - 4).split(`"${Constants.ZWSP}'`);
                const realFileName = fileNames.length === 1 ? fileNames[0] : fileNames[1];
                getSavePath(protyle.path, protyle.notebookId, (pathString) => {
                    fetchPost("/api/filetree/createDocWithMd", {
                        notebook: protyle.notebookId,
                        path: pathPosix().join(pathString, realFileName),
                        parentID: protyle.block.rootID,
                        markdown: ""
                    }, response => {
                        transaction(protyle, [{
                            action: "insertAttrViewBlock",
                            avID,
                            previousID,
                            srcIDs: [response.data],
                        }], [{
                            action: "removeAttrViewBlock",
                            srcIDs: [response.data],
                            avID,
                        }]);
                    });
                });
            } else {
                const sourceId = tempElement.getAttribute("data-id");
                transaction(protyle, [{
                    action: "insertAttrViewBlock",
                    avID,
                    previousID,
                    srcIDs: [sourceId],
                }], [{
                    action: "removeAttrViewBlock",
                    srcIDs: [sourceId],
                    avID,
                }]);
            }
            return;
        }
        this.enableExtend = false;
        let id = "";
        if (nodeElement) {
            id = nodeElement.getAttribute("data-node-id");
        }
        const html = nodeElement.outerHTML;
        // 自顶向下法新建文档后光标定位问题 https://github.com/siyuan-note/siyuan/issues/299
        // QQ 拼音输入法自动补全需移除补全内容 https://github.com/siyuan-note/siyuan/issues/320
        // 前后有标记符的情况 https://github.com/siyuan-note/siyuan/issues/2511
        const endSplit = Constants.BLOCK_HINT_CLOSE_KEYS[this.splitChar];
        if (Constants.BLOCK_HINT_KEYS.includes(this.splitChar) && endSplit && range.startContainer.nodeType === 3
            && (range.startContainer as Text).wholeText.indexOf(endSplit) > -1
            // 在包含 )) 的块中引用时会丢失字符  https://ld246.com/article/1679980200782
            && (range.startContainer as Text).wholeText.indexOf(this.splitChar) > -1) {
            let matchEndChar = 0;
            let textNode = range.startContainer;
            while (textNode && matchEndChar < 2) {
                const index = textNode.textContent.indexOf(endSplit);
                const startIndex = textNode.textContent.indexOf(this.splitChar);
                if (index > -1 && (index < startIndex || startIndex < 0)) {
                    matchEndChar = 2;
                    range.setEnd(textNode, index + 2);
                    break;
                }
                const indexOne = textNode.textContent.indexOf(endSplit.substr(1));
                if (indexOne > -1) {
                    matchEndChar += 1;
                }
                if (matchEndChar === 2) {
                    range.setEnd(textNode, indexOne + 1);
                    break;
                }
                textNode = textNode.nextSibling;
            }
        }

        if (this.lastIndex > -1) {
            range.setStart(range.startContainer, this.lastIndex);
            if (navigator.userAgent.indexOf("iPhone") > -1) {
                focusByRange(range);
            }
        }
        // 新建文件
        if (Constants.BLOCK_HINT_KEYS.includes(this.splitChar) && value.startsWith("((newFile ") && value.endsWith(`${Lute.Caret}'))`)) {
            focusByRange(range);
            const fileNames = value.substring(11, value.length - 4).split(`"${Constants.ZWSP}'`);
            const realFileName = fileNames.length === 1 ? fileNames[0] : fileNames[1];
            getSavePath(protyle.path, protyle.notebookId, (pathString) => {
                fetchPost("/api/filetree/createDocWithMd", {
                    notebook: protyle.notebookId,
                    path: pathPosix().join(pathString, realFileName),
                    parentID: protyle.block.rootID,
                    markdown: ""
                }, response => {
                    protyle.toolbar.setInlineMark(protyle, "block-ref", "range", {
                        type: "id",
                        color: `${response.data}${Constants.ZWSP}${(fileNames.length === 2 || refIsS) ? "s" : "d"}${Constants.ZWSP}${(fileNames.length === 2 ? fileNames[0] : realFileName).substring(0, window.siyuan.config.editor.blockRefDynamicAnchorTextMaxLen)}`
                    });
                });
            });
            return;
        }
        if (Constants.BLOCK_HINT_KEYS.includes(this.splitChar)) {
            if (value === "") {
                const editElement = getContenteditableElement(nodeElement);
                if (editElement.textContent === "") {
                    editElement.innerHTML = "<wbr>";
                    focusByWbr(editElement, range);
                }
                return;
            }
            let tempElement = document.createElement("div");
            tempElement.innerHTML = value.replace(/<mark>/g, "").replace(/<\/mark>/g, "");
            tempElement = tempElement.firstElementChild as HTMLDivElement;
            if (refIsS) {
                const staticText = range.toString().replace(this.splitChar, "");
                if (staticText) {
                    tempElement.setAttribute("data-subtype", "s");
                    tempElement.innerText = staticText;
                }
            }
            protyle.toolbar.setInlineMark(protyle, "block-ref", "range", {
                type: "id",
                color: `${tempElement.getAttribute("data-id")}${Constants.ZWSP}${tempElement.getAttribute("data-subtype")}${Constants.ZWSP}${tempElement.textContent}`
            });
            return;
        } else if (this.splitChar === ":") {
            addEmoji(value);
            let emoji;
            if (value.indexOf(".") > -1) {
                emoji = `:${value.split(".")[0]}: `;
            } else {
                emoji = unicode2Emoji(value) + " ";
            }
            insertHTML(protyle.lute.SpinBlockDOM(emoji), protyle);
        } else if (["「「", "{{"].includes(this.splitChar) || this.splitChar === "#" || this.splitChar === ":") {
            if (value === "") {
                const editElement = getContenteditableElement(nodeElement);
                if (editElement.textContent === "") {
                    editElement.innerHTML = "<wbr>";
                    focusByWbr(editElement, range);
                }
                return;
            }
            insertHTML(protyle.lute.SpinBlockDOM(value), protyle, false, isMobile());
            blockRender(protyle, protyle.wysiwyg.element);
            return;
        } else if (this.splitChar === "/" || this.splitChar === "、") {
            this.enableExtend = true;
            if (value === "((" || value === "{{") {
                if (value === "((") {
                    hintRef("", protyle, "hint");
                } else {
                    hintEmbed("", protyle);
                }
                this.splitChar = value;
                this.lastIndex = 0;
                range.deleteContents();
                const textNode = document.createTextNode(value);
                range.insertNode(textNode);
                range.setEnd(textNode, value.length);
                range.collapse(false);
                return;
            } else if (value === Constants.ZWSP) {
                range.deleteContents();
                this.fixImageCursor(range);
                protyle.toolbar.showTpl(protyle, nodeElement, range);
                updateTransaction(protyle, id, nodeElement.outerHTML, html);
                return;
            } else if (value === Constants.ZWSP + 1) {
                range.deleteContents();
                this.fixImageCursor(range);
                protyle.toolbar.showWidget(protyle, nodeElement, range);
                updateTransaction(protyle, id, nodeElement.outerHTML, html);
                return;
            } else if (value === Constants.ZWSP + 2) {
                range.deleteContents();
                this.fixImageCursor(range);
                protyle.toolbar.showAssets(protyle, nodeElement, range);
                updateTransaction(protyle, id, nodeElement.outerHTML, html);
                return;
            } else if (value === Constants.ZWSP + 3) {
                range.deleteContents();
                return;
            } else if (value === Constants.ZWSP + 4) {
                const newSubDocId = Lute.NewNodeID();
                fetchPost("/api/filetree/createDoc", {
                    notebook: protyle.notebookId,
                    path: pathPosix().join(getDisplayName(protyle.path, false, true), newSubDocId + ".sy"),
                    title: "Untitled",
                    md: ""
                }, () => {
                    insertHTML(`<span data-type="block-ref" data-id="${newSubDocId}" data-subtype="d">Untitled</span>`, protyle);
                    /// #if MOBILE
                    openMobileFileById(protyle.app, newSubDocId, [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT]);
                    /// #else
                    openFileById({
                        app: protyle.app,
                        id: newSubDocId,
                        action: [Constants.CB_GET_HL, Constants.CB_GET_CONTEXT]
                    });
                    /// #endif
                });
                return;
            } else if (value === Constants.ZWSP + 5) {
                range.deleteContents();
                AIChat(protyle, nodeElement);
                return;
            } else if (Constants.INLINE_TYPE.includes(value)) {
                range.deleteContents();
                focusByRange(range);
                if (["a", "block-ref", "inline-math", "inline-memo", "text"].includes(value)) {
                    protyle.toolbar.element.querySelector(`[data-type="${value}"]`).dispatchEvent(new CustomEvent("click"));
                    return;
                }
                protyle.toolbar.setInlineMark(protyle, value, "range");
                return;
            } else if (value === "emoji") {
                range.deleteContents();
                range.insertNode(document.createTextNode(":"));
                range.collapse(false);
                this.genEmojiHTML(protyle);
                return;
            } else if (value.indexOf("style") > -1) {
                range.deleteContents();
                this.fixImageCursor(range);
                nodeElement.setAttribute("style", value.split(Constants.ZWSP)[1] || "");
                updateTransaction(protyle, id, nodeElement.outerHTML, html);
                return;
            } else if (value.startsWith("plugin")) {
                protyle.app.plugins.find((plugin) => {
                    const ids = value.split(Constants.ZWSP);
                    if (ids[1] === plugin.name) {
                        plugin.protyleSlash.find((slash) => {
                            if (slash.id === ids[2]) {
                                slash.callback(protyle.getInstance());
                                return true;
                            }
                        });
                        return true;
                    }
                });
                return;
            } else {
                range.deleteContents();
                if (value !== "![]()") {
                    this.fixImageCursor(range);
                }
                let textContent = value;
                if (value === "```") {
                    textContent = value + window.siyuan.storage[Constants.LOCAL_CODELANG] + Lute.Caret + "\n```";
                }
                const editableElement = getContenteditableElement(nodeElement);
                if (value === "![]()") { // https://github.com/siyuan-note/siyuan/issues/4586 1
                    let newHTML = "";
                    range.insertNode(document.createElement("wbr"));
                    range.insertNode(document.createTextNode(value));
                    newHTML = protyle.lute.SpinBlockDOM(nodeElement.outerHTML);
                    nodeElement.outerHTML = newHTML;
                    nodeElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${id}"]`);
                    focusByWbr(nodeElement, range);
                    updateTransaction(protyle, id, nodeElement.outerHTML, html);
                    let imgElement: HTMLElement = range.startContainer.childNodes[range.startOffset - 1] as HTMLElement || range.startContainer as HTMLElement;
                    if (imgElement && imgElement.nodeType !== 3 && imgElement.classList.contains("img")) {
                        // 已经找到图片
                    } else if (imgElement.previousSibling?.nodeType !== 3 && (imgElement.previousSibling as HTMLElement).classList.contains("img")) {
                        // https://github.com/siyuan-note/siyuan/issues/7540
                        imgElement = imgElement.previousSibling as HTMLElement;
                    } else {
                        Array.from(nodeElement.querySelectorAll(".img")).find((item: HTMLElement) => {
                            if (item.querySelector("img").getAttribute("data-src") === "") {
                                imgElement = item;
                                return true;
                            }
                        });
                    }
                    const rect = imgElement.getBoundingClientRect();
                    imgMenu(protyle, range, imgElement, {
                        clientX: rect.left,
                        clientY: rect.top
                    });
                    return;
                } else if (editableElement.textContent === "" && nodeElement.getAttribute("data-type") === "NodeParagraph") {
                    let newHTML = "";
                    if (value === "<div>") {
                        newHTML = `<div data-node-id="${id}" data-type="NodeHTMLBlock" class="render-node" data-subtype="block">${genIconHTML()}<div><protyle-html data-content=""></protyle-html><span style="position: absolute">${Constants.ZWSP}</span></div><div class="protyle-attr" contenteditable="false"></div></div>`;
                    } else {
                        editableElement.textContent = textContent;
                        newHTML = protyle.lute.SpinBlockDOM(nodeElement.outerHTML);
                    }
                    nodeElement.outerHTML = newHTML;
                    nodeElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${id}"]`);
                    // https://github.com/siyuan-note/siyuan/issues/6864
                    if (nodeElement.getAttribute("data-type") === "NodeTable") {
                        nodeElement.querySelectorAll("colgroup col").forEach((item: HTMLElement) => {
                            item.style.minWidth = "60px";
                        });
                        newHTML = nodeElement.outerHTML;
                    }
                    updateTransaction(protyle, id, newHTML, html);
                } else {
                    let newHTML = protyle.lute.SpinBlockDOM(textContent);
                    if (value === "<div>") {
                        newHTML = `<div data-node-id="${Lute.NewNodeID()}" data-type="NodeHTMLBlock" class="render-node" data-subtype="block">${genIconHTML()}<div><protyle-html data-content=""></protyle-html><span style="position: absolute">${Constants.ZWSP}</span></div><div class="protyle-attr" contenteditable="false"></div></div>`;
                    }
                    nodeElement.insertAdjacentHTML("afterend", newHTML);
                    const oldHTML = nodeElement.outerHTML;
                    const newId = newHTML.substr(newHTML.indexOf('data-node-id="') + 14, 22);
                    nodeElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${newId}"]`);
                    // https://github.com/siyuan-note/siyuan/issues/6864
                    if (nodeElement.getAttribute("data-type") === "NodeTable") {
                        nodeElement.querySelectorAll("colgroup col").forEach((item: HTMLElement) => {
                            item.style.minWidth = "60px";
                        });
                    }
                    transaction(protyle, [{
                        data: oldHTML,
                        id,
                        action: "update"
                    }, {
                        data: nodeElement.outerHTML,
                        id: newId,
                        previousID: id,
                        action: "insert"
                    }], [{
                        id: newId,
                        action: "delete"
                    }, {
                        data: html,
                        id,
                        action: "update"
                    }]);
                }
                if (value === "<div>" || value === "$$" || (value.indexOf("```") > -1 && value.length > 3)) {
                    protyle.toolbar.showRender(protyle, nodeElement);
                    processRender(nodeElement);
                } else if (value.startsWith("```")) {
                    highlightRender(nodeElement);
                } else if (value.startsWith("<iframe") || value.startsWith("<video") || value.startsWith("<audio")) {
                    protyle.gutter.renderMenu(protyle, nodeElement);
                    const rect = nodeElement.getBoundingClientRect();
                    window.siyuan.menus.menu.popup({
                        x: rect.left,
                        y: rect.top
                    }, true);
                    const itemElement = window.siyuan.menus.menu.element.querySelector('[data-id="assetSubMenu"]');
                    itemElement.classList.add("b3-menu__item--show");
                    window.siyuan.menus.menu.showSubMenu(itemElement.querySelector(".b3-menu__submenu"));
                    window.siyuan.menus.menu.element.querySelectorAll("input")[0].focus();
                } else if (value === "---") {
                    focusBlock(nodeElement);
                } else if (nodeElement.classList.contains("av")) {
                    avRender(nodeElement);
                } else {
                    focusByWbr(nodeElement, range);
                }
            }
        }
    }

    public select(event: KeyboardEvent, protyle: IProtyle) {
        const isEmojiPanel = this.element.firstElementChild.classList.contains("emojis");
        if (this.element.querySelectorAll("button").length === 0 && !isEmojiPanel) {
            return false;
        }
        if (event.key === "Enter") {
            if (isEmojiPanel) {
                const currentElement = this.element.querySelector(".emojis__item--current");
                if (!currentElement) {
                    return false;
                }
                const unicode = currentElement.getAttribute("data-unicode");
                if (this.element.querySelectorAll(".emojis__title").length > 2) {
                    // /emoji 后会自动添加冒号，导致 range 无法计算，因此不依赖 this.fill
                    const range = getSelection().getRangeAt(0);
                    if (range.endContainer.nodeType !== 3) {
                        range.endContainer.childNodes[range.endOffset - 1]?.remove();
                    }
                    addEmoji(unicode);
                    let emoji;
                    if (unicode.indexOf(".") > -1) {
                        emoji = `:${unicode.split(".")[0]}: `;
                    } else {
                        emoji = unicode2Emoji(unicode) + " ";
                    }
                    insertHTML(protyle.lute.SpinBlockDOM(emoji), protyle);
                    this.element.classList.add("fn__none");
                } else {
                    this.fill(unicode, protyle);
                }
            } else {
                const mark = decodeURIComponent(this.element.querySelector(".b3-list-item--focus").getAttribute("data-value"));
                if (mark === Constants.ZWSP + 3) {
                    (this.element.querySelector(".b3-list-item--focus input") as HTMLElement).click();
                } else {
                    this.fill(mark, protyle, true, isCtrl(event));
                }
            }
            event.preventDefault();
            event.stopPropagation();
            return true;
        }
        if (isEmojiPanel) {
            const currentElement = this.element.querySelector(".emojis__item--current");
            if (!currentElement) {
                return false;
            }
            let newCurrentElement: HTMLElement;
            if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                if (currentElement.previousElementSibling) {
                    currentElement.classList.remove("emojis__item--current");
                    newCurrentElement = currentElement.previousElementSibling as HTMLElement;
                } else if (currentElement.parentElement.previousElementSibling?.previousElementSibling) {
                    currentElement.classList.remove("emojis__item--current");
                    newCurrentElement = currentElement.parentElement.previousElementSibling.previousElementSibling.lastElementChild as HTMLElement;
                }
            } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                if (currentElement.nextElementSibling) {
                    currentElement.classList.remove("emojis__item--current");
                    newCurrentElement = currentElement.nextElementSibling as HTMLElement;
                } else if (currentElement.parentElement.nextElementSibling?.nextElementSibling) {
                    currentElement.classList.remove("emojis__item--current");
                    newCurrentElement = currentElement.parentElement.nextElementSibling.nextElementSibling.firstElementChild as HTMLElement;
                }
            }
            if (newCurrentElement) {
                newCurrentElement.classList.add("emojis__item--current");
                const topHeight = 4;
                const emojisContentElement = this.element.querySelector(".emojis__panel");
                if (newCurrentElement.offsetTop - topHeight < emojisContentElement.scrollTop) {
                    emojisContentElement.scrollTop = newCurrentElement.offsetTop - topHeight;
                } else if (newCurrentElement.offsetTop - topHeight - emojisContentElement.clientHeight + newCurrentElement.clientHeight > emojisContentElement.scrollTop) {
                    emojisContentElement.scrollTop = newCurrentElement.offsetTop - topHeight - emojisContentElement.clientHeight + newCurrentElement.clientHeight;
                }
            }
            event.preventDefault();
            event.stopPropagation();
            return true;
        } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            upDownHint(this.element.firstElementChild, event);
            event.preventDefault();
            event.stopPropagation();
            return true;
        }
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            hideElements(["hint"], protyle);
            event.preventDefault();
            event.stopPropagation();
            return true;
        }
        return false;
    }

    private fixImageCursor(range: Range) {
        const previous = hasPreviousSibling(range.startContainer);
        if (previous && previous.nodeType !== 3 && (previous as HTMLElement).classList.contains("img")) {
            if (!hasNextSibling(previous)) {
                range.insertNode(document.createTextNode(Constants.ZWSP));
                range.collapse(false);
            }
        }
    }

    private getKey(currentLineValue: string, extend: IHintExtend[]) {
        this.lastIndex = -1;
        this.splitChar = "";
        extend.forEach((item) => {
            const currentLastIndex = currentLineValue.lastIndexOf(item.key);
            if (this.lastIndex < currentLastIndex) {
                if (Constants.BLOCK_HINT_KEYS.includes(this.splitChar) &&
                    (item.key === ":" || item.key === "#" || item.key === "/" || item.key === "、")) {
                    // 块搜索中忽略以上符号
                } else if (this.splitChar === "#" &&
                    (item.key === "/" || item.key === "、")) {
                    // 标签中忽略以上符号
                } else {
                    this.splitChar = item.key;
                    this.lastIndex = currentLastIndex;
                }
            }
        });
        if (this.lastIndex === -1) {
            return undefined;
        }
        // 冒号前为数字或冒号不进行emoji提示
        if (this.splitChar === ":") {
            this.enableEmoji = !(/\d/.test(currentLineValue.substr(this.lastIndex - 1, 1)) ||
                currentLineValue.substr(this.lastIndex - 1, 2) === "::");

        }
        const lineArray = currentLineValue.split(this.splitChar);
        const lastItem = lineArray[lineArray.length - 1];
        if (lineArray.length > 1 && lastItem.trim() === lastItem && lastItem.length < Constants.SIZE_TITLE) {
            // 输入法自动补全 https://github.com/siyuan-note/insider/issues/100
            if (this.splitChar === "【【" && currentLineValue.endsWith("【【】")) {
                return "";
            }
            return lastItem;
        }
        return undefined;
    }
}
