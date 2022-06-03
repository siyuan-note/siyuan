import {Constants} from "../../constants";
import {hasClosestBlock, hasClosestByAttribute, hasClosestByClassName, hasClosestByMatchTag} from "../util/hasClosest";
import {
    focusByRange,
    focusByWbr,
    focusSideBlock,
    getEditorRange,
    getSelectionOffset,
    getSelectionPosition
} from "../util/selection";
import {hintEmbed, hintRef} from "./extend";
import {getSavePath} from "../../util/newFile";
import {upDownHint} from "../../util/upDownHint";
import {setPosition} from "../../util/setPosition";
import {getContenteditableElement} from "../wysiwyg/getBlock";
import {transaction, updateTransaction} from "../wysiwyg/transaction";
import {genEmptyBlock} from "../../block/util";
import {insertHTML} from "../util/insertHTML";
import {highlightRender} from "../markdown/highlightRender";
import {imgMenu} from "../../menus/protyle";
import {hideElements} from "../ui/hideElements";
import {fetchPost} from "../../util/fetch";
import {getDisplayName, pathPosix} from "../../util/pathName";
import {addEmoji, filterEmoji, lazyLoadEmoji, unicode2Emoji} from "../../emoji";
import {escapeHtml} from "../../util/escape";
import {blockRender} from "../markdown/blockRender";
import {uploadFiles} from "../upload";
import {openFileById} from "../../editor/util";
import {isMobile} from "../../util/functions";
import {openMobileFileById} from "../../mobile/editor";
import {getIconByType} from "../../editor/getIcon";

export class Hint {
    public timeId: number;
    public element: HTMLDivElement;
    public enableSlash = true;
    public enableEmoji = false;
    public splitChar = "";
    public lastIndex = -1;

    constructor(protyle: IProtyle) {
        this.element = document.createElement("div");
        this.element.setAttribute("data-close", "false");
        // height 402 根据 .emojis max-height+8 得来
        this.element.setAttribute("style", `overflow:auto;z-index:200;max-height:402px;width:${Math.max(protyle.element.clientWidth / 2, 320)}px;box-sizing: border-box;`);
        this.element.className = "b3-menu b3-list b3-list--background fn__none";
        this.element.addEventListener("click", (event) => {
            const eventTarget = event.target as HTMLElement;
            if (eventTarget.tagName === "INPUT") {
                event.stopPropagation();
                return;
            }
            const btnElement = hasClosestByMatchTag(eventTarget, "BUTTON");
            if (btnElement && !btnElement.classList.contains("emojis__item")) {
                if (btnElement.parentElement.classList.contains("b3-list")) {
                    this.fill(decodeURIComponent(btnElement.getAttribute("data-value")), protyle);
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
                            html += `<button data-unicode="${emoji.unicode}" class="emojis__item" aria-label="${window.siyuan.config.lang === "zh_CN" ? emoji.description_zh_cn : emoji.description}">
${unicode2Emoji(emoji.unicode, true)}</button>`;
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
                    }
                    addEmoji(unicode);
                    let emoji;
                    if (unicode.indexOf(".") > -1) {
                        emoji = `:${unicode.split(".")[0]}: `;
                    } else {
                        emoji = unicode2Emoji(unicode, true) + " ";
                    }
                    insertHTML(protyle.lute.SpinBlockDOM(emoji), protyle);
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
        const range = getSelection().getRangeAt(0);
        const start = getSelectionOffset(range.startContainer as HTMLElement, protyle.wysiwyg.element).start;
        const currentLineValue = range.startContainer.textContent.substring(0, start) || "";
        const key = this.getKey(currentLineValue, protyle.options.hint.extend);

        if (typeof key === "undefined" ||
            (   // 除emoji 提示外，其余在 tag/inline math/inline-code 内移动不进行提示
                this.splitChar !== ":" &&
                (protyle.toolbar.getCurrentType(range).length > 0 || hasClosestByAttribute(range.startContainer, "data-type", "NodeCodeBlock"))
            )
        ) {
            this.element.classList.add("fn__none");
            clearTimeout(this.timeId);
            return;
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
        protyle.options.hint.extend.forEach((item) => {
            if (item.key === this.splitChar) {
                clearTimeout(this.timeId);
                this.timeId = window.setTimeout(() => {
                    if (this.splitChar === "/" || this.splitChar === "、") {
                        if (this.enableSlash) {
                            this.genHTML(item.hint(key, protyle), protyle);
                        }
                    } else {
                        this.genHTML(item.hint(key, protyle), protyle);
                    }
                }, protyle.options.hint.delay);
            }
        });
    }

    public genLoading(protyle: IProtyle) {
        if (this.element.classList.contains("fn__none")) {
            this.element.innerHTML = "<div class=\"fn__loading\" style=\"height: 128px;position: initial\"><img width=\"64px\" src=\"/stage/loading-pure.svg\"></div>";
            this.element.classList.remove("fn__none");
            const textareaPosition = getSelectionPosition(protyle.wysiwyg.element);
            setPosition(this.element, textareaPosition.left, textareaPosition.top + 26, 30);
        } else {
            this.element.insertAdjacentHTML("beforeend", "<div class=\"fn__loading\"><img width=\"64px\" src=\"/stage/loading-pure.svg\"></div>");
        }
    }

    public genHTML(data: IHintData[], protyle: IProtyle, hide = false, hasSearch = false) {
        if (data.length === 0) {
            if (!this.element.querySelector(".fn__loading") || hide) {
                this.element.classList.add("fn__none");
            }
            return;
        }

        let hintsHTML = "";
        if (hasSearch) {
            hintsHTML = '<input style="margin: 0 4px 4px 4px" class="b3-text-field"><div style="flex: 1;overflow:auto;">';
            this.element.style.display = "flex";
            this.element.style.flexDirection = "column";
        } else {
            this.element.style.display = "";
        }
        let hasFocus = false;
        data.forEach((hintData, i) => {
            // https://github.com/siyuan-note/siyuan/issues/1229 提示时，新建文件不应默认选中
            let focusClass = "";
            if (i === 0) {
                if (hintData.value.startsWith("((newFile ") && hintData.value.endsWith(`${Lute.Caret}"))`) && data.length > 1) {
                    focusClass = "";
                } else {
                    focusClass = " b3-list-item--focus";
                    hasFocus = true;
                }
            } else if (i === 1 && !hasFocus) {
                focusClass = " b3-list-item--focus";
            }
            if (hintData.html === "separator") {
                hintsHTML += '<div class="b3-menu__separator"></div>';
            } else {
                hintsHTML += `<button class="b3-list-item b3-list-item--two fn__block${focusClass}" data-value="${encodeURIComponent(hintData.value)}">${hintData.html}</button>`;
            }
        });
        if (hasSearch) {
            hintsHTML = hintsHTML + "</div>";
        }
        this.element.innerHTML = hintsHTML;
        this.element.classList.remove("fn__none");
        // https://github.com/siyuan-note/siyuan/issues/4575
        if (data[0].filter) {
            this.element.classList.add("hint--menu");
        } else {
            this.element.classList.remove("hint--menu");
        }
        this.element.style.width = Math.max(protyle.element.clientWidth / 2, 320) + "px";
        const textareaPosition = getSelectionPosition(protyle.wysiwyg.element);
        setPosition(this.element, textareaPosition.left, textareaPosition.top + 26, 30);
        this.element.scrollTop = 0;
        const uploadElement = this.element.querySelector('input[type="file"]');
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
        if (hasSearch) {
            const searchElement = this.element.querySelector("input.b3-text-field") as HTMLInputElement;
            const oldValue = this.element.querySelector("mark").textContent;
            searchElement.value = oldValue;
            searchElement.select();
            searchElement.addEventListener("keydown", (event: KeyboardEvent) => {
                event.stopPropagation();
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
            const nodeElement = hasClosestBlock(protyle.toolbar.range.startContainer);
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
        this.element.lastElementChild.innerHTML = "<div class=\"ft__center\"><img style=\"height:32px;width:32px;\" src=\"/stage/loading-pure.svg\"></div>";
        fetchPost("/api/search/searchRefBlock", {
            k: searchElement.value,
            id: nodeElement ? nodeElement.getAttribute("data-node-id") : protyle.block.parentID,
            beforeLen: Math.floor((Math.max(protyle.element.clientWidth / 2, 320) - 58) / 28.8),
            rootID: protyle.block.rootID,
        }, (response) => {
            let searchHTML = "";
            if (response.data.newDoc) {
                searchHTML += `<button class="b3-list-item b3-list-item--two fn__block${response.data.blocks.length === 0 ? " b3-list-item--focus" : ""}" data-value="${encodeURIComponent('((newFile "' + oldValue + Lute.Caret + '"))')}"><div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconFile"></use></svg>
<span class="b3-list-item__text">${window.siyuan.languages.newFile} <mark>${response.data.k}</mark></span></div></button>`;
            }
            response.data.blocks.forEach((item: IBlock, index: number) => {
                const iconName = getIconByType(item.type);
                let attrHTML = "";
                if (item.name) {
                    attrHTML += `<span class="fn__flex"><svg class="fn__flex-center svg--small svg ft__on-background"><use xlink:href="#iconN"></use></svg>&nbsp;${item.name}</span><span class="fn__space"></span>`;
                }
                if (item.alias) {
                    attrHTML += `<span class="fn__flex"><svg class="fn__flex-center svg--small svg ft__on-background"><use xlink:href="#iconA"></use></svg>&nbsp;${item.alias}</span><span class="fn__space"></span>`;
                }
                if (item.memo) {
                    attrHTML += `<span class="fn__flex"><svg class="fn__flex-center svg--small svg ft__on-background"><use xlink:href="#iconM"></use></svg>&nbsp;${item.memo}</span>`;
                }
                if (attrHTML) {
                    attrHTML = `<div class="fn__flex b3-list-item__meta" style="line-height: 1">${attrHTML}</div>`;
                }
                searchHTML += `<button class="b3-list-item b3-list-item--two fn__block${index === 0 ? " b3-list-item--focus" : ""}" data-value="${encodeURIComponent('<span data-type="block-ref" data-id="' + item.id + '" data-subtype="s">' + oldValue + "</span>")}">${attrHTML}<div class="b3-list-item__first">
    <svg class="b3-list-item__graphic popover__block" data-id="${item.id}"><use xlink:href="#${iconName}"></use></svg>
    <span class="b3-list-item__text">${item.content}</span>
</div>
<div class="b3-list-item__meta">${item.hPath}</div></button>`;
            });
            if (searchHTML === "") {
                searchHTML = `<button class="b3-list-item b3-list-item--two fn__block" data-value="">${window.siyuan.languages.emptyContent}</button>`;
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
            panelElement.innerHTML = filterEmoji(value, 256, true);
            if (value) {
                panelElement.nextElementSibling.classList.add("fn__none");
            } else {
                panelElement.nextElementSibling.classList.remove("fn__none");
            }
        } else {
            this.element.innerHTML = `<div class="emojis" style="height: auto;">
<div class="emojis__panel">${filterEmoji(value, 256, true)}</div>
<div class="fn__flex${value ? " fn__none" : ""}">
    <div data-type="0" class="emojis__type" aria-label="${window.siyuan.languages.recentEmoji}">${unicode2Emoji("2b50", true)}</div>
    <div data-type="1" class="emojis__type" aria-label="${window.siyuan.emojis[0][window.siyuan.config.lang === "zh_CN" ? "title_zh_cn" : "title"]}">${unicode2Emoji("1f527", true)}</div>
    <div data-type="2" class="emojis__type" aria-label="${window.siyuan.emojis[1][window.siyuan.config.lang === "zh_CN" ? "title_zh_cn" : "title"]}">${unicode2Emoji("1f60d", true)}</div>
    <div data-type="3" class="emojis__type" aria-label="${window.siyuan.emojis[2][window.siyuan.config.lang === "zh_CN" ? "title_zh_cn" : "title"]}">${unicode2Emoji("1f433", true)}</div>
    <div data-type="4" class="emojis__type" aria-label="${window.siyuan.emojis[3][window.siyuan.config.lang === "zh_CN" ? "title_zh_cn" : "title"]}">${unicode2Emoji("1f96a", true)}</div>
    <div data-type="5" class="emojis__type" aria-label="${window.siyuan.emojis[4][window.siyuan.config.lang === "zh_CN" ? "title_zh_cn" : "title"]}">${unicode2Emoji("1f3a8", true)}</div>
    <div data-type="6" class="emojis__type" aria-label="${window.siyuan.emojis[5][window.siyuan.config.lang === "zh_CN" ? "title_zh_cn" : "title"]}">${unicode2Emoji("1f3dd", true)}</div>
    <div data-type="7" class="emojis__type" aria-label="${window.siyuan.emojis[6][window.siyuan.config.lang === "zh_CN" ? "title_zh_cn" : "title"]}">${unicode2Emoji("1f52e", true)}</div>
    <div data-type="8" class="emojis__type" aria-label="${window.siyuan.emojis[7][window.siyuan.config.lang === "zh_CN" ? "title_zh_cn" : "title"]}">${unicode2Emoji("267e", true)}</div>
    <div data-type="9" class="emojis__type" aria-label="${window.siyuan.emojis[8][window.siyuan.config.lang === "zh_CN" ? "title_zh_cn" : "title"]}">${unicode2Emoji("1f6a9", true)}</div>
</div>
</div>`;
            lazyLoadEmoji(this.element, true);
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

    public fill(value: string, protyle: IProtyle) {
        hideElements(["hint", "toolbar"], protyle);
        const range: Range = getEditorRange(protyle.wysiwyg.element);

        let nodeElement = hasClosestBlock(range.startContainer) as HTMLElement;
        if (!nodeElement) {
            return;
        }
        let id = "";
        if (nodeElement) {
            id = nodeElement.getAttribute("data-node-id");
        }
        let html = nodeElement.outerHTML;
        // 自顶向下法新建文档后光标定位问题 https://github.com/siyuan-note/siyuan/issues/299
        // QQ 拼音输入法自动补全需移除补全内容 https://github.com/siyuan-note/siyuan/issues/320
        // 前后有标记符的情况 https://github.com/siyuan-note/siyuan/issues/2511
        const endSplit = Constants.BLOCK_HINT_CLOSE_KEYS[this.splitChar];
        if (Constants.BLOCK_HINT_KEYS.includes(this.splitChar) && endSplit && range.startContainer.nodeType === 3
            && (range.startContainer as Text).wholeText.indexOf(endSplit) > -1) {
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
        }
        range.deleteContents();
        // 新建文件
        if (Constants.BLOCK_HINT_KEYS.includes(this.splitChar) && value.startsWith("((newFile ") && value.endsWith(`${Lute.Caret}"))`)) {
            focusByRange(range);
            const fileName = value.substring(11, value.length - 4);
            getSavePath(protyle.path, protyle.notebookId, (pathString) => {
                fetchPost("/api/filetree/createDocWithMd", {
                    notebook: protyle.notebookId,
                    path: pathPosix().join(pathString, fileName),
                    markdown: ""
                }, response => {
                    insertHTML(genEmptyBlock(false, false, `<span data-type="block-ref" data-id="${response.data}" data-subtype="d">${escapeHtml(fileName)}</span>`), protyle);
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
            range.insertNode(document.createElement("wbr"));
            html = nodeElement.outerHTML;
            const tempElement = document.createElement("template");
            tempElement.innerHTML = value.replace(/<mark>/g, "").replace(/<\/mark>/g, "");
            range.insertNode(tempElement.content.cloneNode(true));
            updateTransaction(protyle, id, nodeElement.outerHTML, html);
            focusByWbr(nodeElement, range);
            return;
        } else if (this.splitChar === ":") {
            addEmoji(value);
            let emoji;
            if (value.indexOf(".") > -1) {
                emoji = `:${value.split(".")[0]}: `;
            } else {
                emoji = unicode2Emoji(value, true) + " ";
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
            insertHTML(protyle.lute.SpinBlockDOM(value), protyle);
            blockRender(protyle, protyle.wysiwyg.element);
            return;
        } else if (this.splitChar === "/" || this.splitChar === "、") {
            if (value === "((" || value === "{{") {
                if (value === "((") {
                    hintRef("", protyle);
                } else {
                    hintEmbed("", protyle);
                }
                this.splitChar = value;
                this.lastIndex = 0;
                const textNode = document.createTextNode(value);
                range.insertNode(textNode);
                range.setEnd(textNode, value.length);
                range.collapse(false);
                return;
            } else if (value === Constants.ZWSP) {
                protyle.toolbar.showTpl(protyle, nodeElement, range);
                updateTransaction(protyle, id, nodeElement.outerHTML, html);
                return;
            } else if (value === Constants.ZWSP + 1) {
                protyle.toolbar.showWidget(protyle, nodeElement, range);
                updateTransaction(protyle, id, nodeElement.outerHTML, html);
                return;
            } else if (value === Constants.ZWSP + 2) {
                protyle.toolbar.showAssets(protyle, nodeElement, range);
                updateTransaction(protyle, id, nodeElement.outerHTML, html);
                return;
            } else if (value === Constants.ZWSP + 3) {
                return;
            } else if (value === Constants.ZWSP + 4) {
                const newSubDocId = Lute.NewNodeID();
                fetchPost("/api/filetree/createDoc", {
                    notebook: protyle.notebookId,
                    path: pathPosix().join(getDisplayName(protyle.path, false, true), newSubDocId + ".sy"),
                    title: window.siyuan.languages.untitled,
                    md: ""
                }, () => {
                    insertHTML(genEmptyBlock(false, false, `<span data-type="block-ref" data-id="${newSubDocId}" data-subtype="d">${escapeHtml(window.siyuan.languages.untitled)}</span>`), protyle);
                    if (isMobile()) {
                        openMobileFileById(newSubDocId, true);
                    } else {
                        openFileById({
                            id: newSubDocId,
                            hasContext: true,
                            action: [Constants.CB_GET_HL]
                        });
                    }
                });
                return;
            } else if (Constants.INLINE_TYPE.includes(value)) {
                protyle.toolbar.range = range;
                protyle.toolbar.setInlineMark(protyle, value, "add");
                return;
            } else if (value === "emoji") {
                range.insertNode(document.createTextNode(":"));
                range.collapse(false);
                this.enableEmoji = true;
                this.genEmojiHTML(protyle);
                return;
            } else if (value.indexOf("style") > -1) {
                nodeElement.setAttribute("style", value.split(Constants.ZWSP)[1] || "");
                updateTransaction(protyle, id, nodeElement.outerHTML, html);
                return;
            } else {
                let textContent = value;
                if (value === "```") {
                    textContent = value + (localStorage.getItem(Constants.LOCAL_CODELANG) || "") + Lute.Caret + "\n```";
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
                    } else {
                        imgElement = nodeElement.querySelector(".img");
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
                        newHTML = `<div data-node-id="${id}" data-type="NodeHTMLBlock" class="render-node" data-subtype="block"><div class="protyle-icons"><span class="protyle-icon protyle-icon--first protyle-action__edit"><svg><use xlink:href="#iconEdit"></use></svg></span><span class="protyle-icon protyle-action__menu protyle-icon--last"><svg><use xlink:href="#iconMore"></use></svg></span></div><div><protyle-html data-content=""></protyle-html><span style="position: absolute">${Constants.ZWSP}</span></div><div class="protyle-attr" contenteditable="false"></div></div>`;
                    } else {
                        editableElement.textContent = textContent;
                        newHTML = protyle.lute.SpinBlockDOM(nodeElement.outerHTML);
                    }
                    nodeElement.outerHTML = newHTML;
                    nodeElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${id}"]`);
                    updateTransaction(protyle, id, newHTML, html);
                } else {
                    let newHTML = protyle.lute.SpinBlockDOM(textContent);
                    if (value === "<div>") {
                        newHTML = `<div data-node-id="${Lute.NewNodeID()}" data-type="NodeHTMLBlock" class="render-node" data-subtype="block"><div class="protyle-icons"><span class="protyle-icon protyle-icon--first protyle-action__edit"><svg><use xlink:href="#iconEdit"></use></svg></span><span class="protyle-icon protyle-action__menu protyle-icon--last"><svg><use xlink:href="#iconMore"></use></svg></span></div><div><protyle-html data-content=""></protyle-html><span style="position: absolute">${Constants.ZWSP}</span></div><div class="protyle-attr" contenteditable="false"></div></div>`;
                    }
                    nodeElement.insertAdjacentHTML("afterend", newHTML);
                    const newId = newHTML.substr(newHTML.indexOf('data-node-id="') + 14, 22);
                    transaction(protyle, [{
                        data: nodeElement.outerHTML,
                        id,
                        action: "update"
                    }, {
                        data: newHTML,
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
                    nodeElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${newId}"]`);
                }
                if (value === "<div>" || value === "$$" || (value.indexOf("```") > -1 && value.length > 3)) {
                    protyle.toolbar.showRender(protyle, nodeElement);
                } else if (value.startsWith("```")) {
                    highlightRender(nodeElement);
                } else if (value.startsWith("<iframe") || value.startsWith("<video") || value.startsWith("<audio")) {
                    protyle.gutter.renderMenu(protyle, nodeElement);
                    window.siyuan.menus.menu.element.classList.remove("fn__none");
                    const rect = nodeElement.getBoundingClientRect();
                    setPosition(window.siyuan.menus.menu.element, rect.left - window.siyuan.menus.menu.element.clientWidth, rect.top);
                    window.siyuan.menus.menu.element.querySelector('[data-id="assetSubMenu"]').classList.add("b3-menu__item--show");
                    window.siyuan.menus.menu.element.querySelectorAll("input")[0].focus();
                } else if (value === "---") {
                    focusSideBlock(nodeElement);
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
                        emoji = unicode2Emoji(unicode, true) + " ";
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
                    this.fill(mark, protyle);
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
            upDownHint(this.element, event);
            event.preventDefault();
            event.stopPropagation();
            return true;
        }
        return false;
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
        if (this.splitChar === ":" && (
            /\d/.test(currentLineValue.substr(this.lastIndex - 1, 1)) ||
            currentLineValue.substr(this.lastIndex - 1, 2) === "::"
        )) {
            this.enableEmoji = false;
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
