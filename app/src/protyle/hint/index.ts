import {isTableLikeView} from "../render/av/viewType";
import {Constants} from "../../constants";
import {isBuiltinSlashHint} from "./builtinSlash";
import {getSuperBlockCommandLayout} from "../../block/superBlock";
import {genEmptySuperBlock} from "../../block/insertSuperBlock";
import {
    hasClosestBlock,
    hasClosestByAttribute,
    hasClosestByClassName,
    hasClosestByTag,
    isInEmbedBlock
} from "../util/hasClosest";
import {
    focusBlock,
    focusByWbr,
    getEditorRange,
    getSelectionPosition,
    getUndoFocusContext,
} from "../util/selection";
import {focusByRange, getSelectionOffset} from "../util/selectionOffsets";
import {genHintItemHTML, hintEmbed, hintRef, hintSlash, hintTag} from "./extend";
import {searchRef} from "./searchRef";
import {getSlashEntryKey, TSlashMenuItem} from "./slashMenu";
import {getFrequentSlashItems, recordSlashExecution} from "./frequentSlashStorage";
import {escapeAttr} from "../../util/escape";
import {createDailyNoteReference} from "./dailyNote";
import {captureDailyNoteSelection, insertDailyNoteReference} from "./dailyNoteSelection";
import {
    getBlockRefAnchorText,
    getDocCreateTemplatePath,
    isConfiguredCreateTargetCurrentSubDoc,
    newFileAtPath,
    newFileByRefHint,
    newFileByRefHintAtPath,
    newFileBySelectRange,
    newFileInProtyle,
    newSubDocByRefHint
} from "../../util/newFile";
import {isAbnormalItem, upDownHint} from "../../util/upDownHint";
import {setPosition} from "../../util/setPosition";
import {getContenteditableElement, hasNextSibling, hasPreviousSibling} from "../wysiwyg/getBlock";
import {transaction, updateTransaction} from "../wysiwyg/transaction";
import {insertHTML} from "../util/insertHTML";
import {highlightRender} from "../render/highlightRender";
import {renderIFrameResize} from "../render/iframeResize";
import {spinListMindmapDOM} from "../render/listMindmap/create";
import {mountNewListMindmap} from "../render/listMindmap";
import {assetMenu, imgMenu} from "../../menus/protyle";
import {hideElements} from "../ui/hideElements";
import {fetchSyncPost} from "../../util/fetch";
import {escapeHtml, escapeSearchHighlight, stripSearchMark} from "../../util/escape";
import {isEncryptedBox} from "../../util/pathName";
import {createdDocumentID, documentCreateRequest} from "../../util/documentCreate";
import {
    addEmoji,
    EmojiPanelController,
    genEmojiCategoryButtons,
    openEmojiPanel,
    unicode2Emoji,
} from "../../emoji";
import {blockRender} from "../render/blockRender";
import {getUploadInsertRange, uploadFiles} from "../upload";
import {canPickIOSPhotos, pickIOSPhotos} from "../upload/iosPhotos";
import {showMessage} from "../../dialog/message";
import {captureUploadDocument, createUploadInsertPosition, isUploadDocumentAvailable} from "../upload/insertPosition";
/// #if !MOBILE
import {openFileById} from "../../editor/util";
/// #endif
import {openMobileFileById} from "../../mobile/editor";
import {processRender} from "../util/processCode";
import {AIChat} from "../../ai/chat";
import {isMobile} from "../../util/functions";
import {isNotCtrl, isOnlyMeta} from "../util/compatibility";
import {avRender} from "../render/av/render";
import {genIconHTML} from "../render/util";
import {updateAttrViewCellAnimation} from "../render/av/action";
import {getAVBindingCell, getAVBindingOperations} from "../render/av/binding";
import {bindCreatedAVDocument} from "../render/av/bindCreatedDocument";
import {isRangeInEditor} from "../../util/newFileSelection";
import {genCellValueByElement} from "../render/av/cell";
import {setFold} from "../util/blockFold";
import {getIconValueKind} from "../../emoji/iconValue";
import {getCreateTargetContext, isSameCreateTargetContext} from "./createTargetContext";
import {
    endsWithMultiCharHintPrefix,
    getBlockHintTriggerOffset,
    getBlockRefStaticText,
    isBlockHintQueryAtCaret,
    shouldCaptureHintUndoFocus,
    shouldIgnoreHintTrigger,
    shouldAutoCloseRefBrackets,
    stripBlockHintCloseKey,
} from "./blockHintRange";
import {getMobileHintPosition} from "./mobileHintPosition";
import {getLiteSlashMenuHTML} from "../../mobile/util/liteSlashMenu";
import {getVisibleViewportBounds} from "../../mobile/util/visibleViewport";
import {getTopBarHeight} from "../../layout/getTopBarHeight";
import {getSemanticInlineVisibleText, stripSemanticMarkersFromRangeText} from "../util/inlineElementMarker";
import {areProtylePluginExtensionsEnabled, isProtyleListItemFragment} from "../runtimeCapabilities";

const genEmojiInsertHTML = (value: string) => {
    const kind = getIconValueKind(value);
    if (kind === "custom") {
        return `:${value.split(".")[0]}: `;
    }
    return unicode2Emoji(value, kind === "dynamic" || kind === "network" ? "emoji" : "") + " ";
};

type TCreateTargetType = "doc" | "ref";

type TCreateTargetState = {
    promise: Promise<boolean>;
    result?: boolean;
};

type TCreateTargetSession = {
    id: number;
    notebookId: string;
    path: string;
    renderID: number;
    targets: Partial<Record<TCreateTargetType, TCreateTargetState>>;
};

const getWholeTextOffset = (textNode: Text, offset: number) => {
    let previousSibling = textNode.previousSibling;
    while (previousSibling?.nodeType === 3) {
        offset += previousSibling.textContent.length;
        previousSibling = previousSibling.previousSibling;
    }
    return offset;
};

export class Hint {
    public timeId: number;
    public element: HTMLDivElement;
    public enableSlash = true;
    private enableEmoji = true;
    public enableExtend = false;
    public splitChar = "";
    // 当前查询末尾是否包含完整闭合符（如 ]]）
    public closeKeyTyped = false;
    private refBracketRange?: Range;
    private refBracketOrigin?: {notebookID: string; rootID: string; blockID: string; prefix: string; splitChar: string};
    private refCloseContext?: {range: Range; text: string; notebookID: string; rootID: string};
    // 选中候选项时是否一并替换光标后自动补全的闭合符
    private consumeCloseKey = false;
    public lastIndex = -1;
    public hashTagSearchElement?: HTMLElement;
    private source: THintSource;
    private createTargetSessionID = 0;
    private createTargetRenderID = 0;
    private createTargetSession?: TCreateTargetSession;
    private emojiPanel?: EmojiPanelController;
    private emojiBrowseMode = false;
    private loadingAnimation?: Animation;
    private loadingID = 0;
    private bindingDismissController?: AbortController;

    constructor(protyle: IProtyle) {
        this.element = document.createElement("div");
        this.element.setAttribute("data-close", "false");
        this.element.className = "protyle-hint b3-list b3-list--background fn__none";
        this.element.addEventListener("click", (event) => {
            if (this.element.closest("#keyboardToolbar")) {
                return;
            }
            const eventTarget = event.target as HTMLElement;
            if (eventTarget.tagName === "INPUT") {
                event.stopPropagation();
                return;
            }
            const btnElement = hasClosestByTag(eventTarget, "BUTTON");
            if (btnElement && btnElement.hasAttribute("data-value") && !btnElement.classList.contains("emojis__item") && !btnElement.classList.contains("emojis__type")) {
                this.fill(decodeURIComponent(btnElement.getAttribute("data-value")), protyle, false,
                    this.source === "search" ? isNotCtrl(event) : isOnlyMeta(event), btnElement.dataset.slashEntryKey);
                event.preventDefault();
                event.stopPropagation(); // https://github.com/siyuan-note/siyuan/issues/3710
                return;
            }
            const typeElement = hasClosestByClassName(eventTarget, "emojis__type");
            if (typeElement) {
                this.emojiPanel?.renderCategory(typeElement.dataset.type);
                return;
            }
            const emojiElement = hasClosestByClassName(eventTarget, "emojis__item");
            if (emojiElement) {
                const unicode = emojiElement.getAttribute("data-unicode");
                if (this.emojiBrowseMode) {
                    // /emoji 后会自动添加冒号，导致 range 无法计算，因此不依赖 this.fill
                    const range = getSelection().getRangeAt(0);
                    if (range.endContainer.nodeType !== 3) {
                        range.endContainer.childNodes[range.endOffset - 1]?.remove();
                    } else if (range.endContainer.textContent === ":") {
                        // iphone
                        range.endContainer.textContent = "";
                    }
                    addEmoji(unicode);
                    insertHTML(protyle.lute.SpinBlockDOM(genEmojiInsertHTML(unicode)), protyle, false, true);
                    this.element.classList.add("fn__none");
                    this.emojiPanel?.deactivate();
                } else {
                    this.emojiPanel?.deactivate();
                    this.fill(unicode, protyle);
                }
            }
        });
    }

    public deactivateEmojiPanel() {
        this.emojiPanel?.deactivate();
    }

    public destroy() {
        this.loadingID++;
        this.bindingDismissController?.abort();
        this.cancelLoadingAnimation();
        this.destroyEmojiPanel();
    }

    // 新建空标签后进入标签搜索状态，输入过程中弹出候选标签列表
    public startHashTagSearch(protyle: IProtyle, tagElement: HTMLElement) {
        if (!protyle.options.hint.extend.some((item) => item.hint === hintTag)) {
            return;
        }
        this.hashTagSearchElement = tagElement;
        this.splitChar = "";
        this.lastIndex = -1;
        hintTag("", protyle);
    }

    public prepareCreateTarget(protyle: IProtyle, type: TCreateTargetType) {
        const {notebookId, path} = getCreateTargetContext(protyle);
        if (this.element.classList.contains("fn__none") || !this.createTargetSession ||
            this.createTargetSession.notebookId !== notebookId || this.createTargetSession.path !== path) {
            this.createTargetSession = {
                id: ++this.createTargetSessionID,
                notebookId,
                path,
                renderID: 0,
                targets: {},
            };
        }
        const session = this.createTargetSession;
        const renderID = ++this.createTargetRenderID;
        session.renderID = renderID;
        let targetState = session.targets[type];
        if (!targetState) {
            const sessionID = session.id;
            targetState = {
                promise: isConfiguredCreateTargetCurrentSubDoc(protyle, type).catch(() => false),
            };
            session.targets[type] = targetState;
            targetState.promise.then((result) => {
                if (this.createTargetSession?.id === sessionID) {
                    targetState.result = result;
                }
            });
        }
        return {
            result: targetState.result,
            promise: targetState.promise,
            isCurrent: () => this.createTargetSession === session && session.renderID === renderID &&
                isSameCreateTargetContext(session, protyle) &&
                !this.element.classList.contains("fn__none"),
        };
    }

    public render(protyle: IProtyle) {
        if (!window.getSelection().focusNode) {
            this.element.classList.add("fn__none");
            clearTimeout(this.timeId);
            return;
        }
        // 新建的空标签处于搜索状态，输入时按标签内容过滤候选
        if (this.hashTagSearchElement) {
            const selection = getSelection();
            if (!this.hashTagSearchElement.isConnected ||
                !protyle.wysiwyg.element.contains(this.hashTagSearchElement) ||
                !selection.focusNode || !this.hashTagSearchElement.contains(selection.focusNode)) {
                this.hashTagSearchElement = undefined;
            } else {
                clearTimeout(this.timeId);
                const tagKey = getSemanticInlineVisibleText(this.hashTagSearchElement);
                this.timeId = window.setTimeout(() => {
                    hintTag(tagKey, protyle);
                }, protyle.options.hint.delay);
                return;
            }
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
        let textAfterCaret = "";
        if (protyle.toolbar.range.startContainer.nodeType === 3) {
            const textNode = protyle.toolbar.range.startContainer as Text;
            const caretOffset = getWholeTextOffset(textNode, protyle.toolbar.range.startOffset);
            textAfterCaret = textNode.wholeText.substring(caretOffset);
        }
        const key = this.getKey(currentLineValue, textAfterCaret, protyle.options.hint.extend);
        if (typeof key === "undefined" ||
            hasClosestByAttribute(protyle.toolbar.range.startContainer, "data-type", "code") ||
            hasClosestByAttribute(protyle.toolbar.range.startContainer, "data-type", "NodeCodeBlock") ||
            (["/", "、"].includes(this.splitChar) &&
                hasClosestByAttribute(protyle.toolbar.range.startContainer, "data-type", "tag"))) {
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
            const blockElement = hasClosestBlock(protyle.toolbar.range.startContainer);
            if (!this.enableSlash || !blockElement || isInEmbedBlock(blockElement)) {
                return;
            }
            if (protyle.lite) {
                protyle.options.hint.extend.find((item) => {
                    if (item.key === "/" && item.hint) {
                        this.genHTML(item.hint(key, protyle, "hint"), protyle, false, "hint");
                        return true;
                    }
                });
            } else {
                if (isMobile()) {
                    protyle.toolbar.range = protyle.toolbar.range.cloneRange();
                }
                const slashData = hintSlash(key, protyle);
                if (slashData.length === 0) {
                    if (endsWithMultiCharHintPrefix(key, protyle.options.hint.extend.map((item) => item.key))) {
                        this.enableExtend = false;
                    }
                    this.genHTML(slashData, protyle, true, "hint");
                    return;
                }
                const createTarget = this.prepareCreateTarget(protyle, "doc");
                if (createTarget.result !== undefined) {
                    this.genHTML(hintSlash(key, protyle, createTarget.result), protyle, true, "hint");
                } else {
                    this.genLoading(protyle, 200);
                    createTarget.promise.then((isCurrentSubDoc) => {
                        if (createTarget.isCurrent()) {
                            this.genHTML(hintSlash(key, protyle, isCurrentSubDoc), protyle, true, "hint");
                        }
                    });
                }
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

    // 输入引用触发符后补全对应闭合符，保留输入法已补全的括号，光标保持在括号内
    public autoCloseRefBrackets(protyle: IProtyle, range: Range) {
        const context = this.getRefBracketContext(protyle, range);
        const splitChar = context && ["[[", "【【"].find(key => context.textBeforeCaret.endsWith(key));
        if (splitChar && (shouldAutoCloseRefBrackets(context.textBeforeCaret, context.textAfterCaret, splitChar) ||
            splitChar === "【【")) {
            const closeKey = Constants.BLOCK_HINT_CLOSE_KEYS[splitChar];
            const suppliedLength = splitChar === "【【" ?
                (context.textAfterCaret.startsWith(closeKey) ? 2 : context.textAfterCaret.startsWith("】") ? 1 : 0) : 0;
            context.textNode.insertData(range.startOffset, closeKey.substring(suppliedLength));
            this.refBracketRange = range.cloneRange();
            this.refBracketRange.setStart(context.textNode, range.startOffset - 2);
            this.refBracketRange.setEnd(context.textNode, range.startOffset + 2);
            this.refBracketOrigin = {notebookID: protyle.notebookId, rootID: protyle.block.rootID,
                blockID: (hasClosestBlock(range.startContainer) || undefined)?.getAttribute("data-node-id"),
                prefix: context.textBeforeCaret, splitChar};
            this.refCloseContext = undefined;
            this.enableExtend = true;
        }
    }

    // 输入法提交闭合符后移除重复输入，并沿用跳过闭合符的流程，组合输入期间不修改候选文本
    public handleRefBracketInput(protyle: IProtyle, range: Range, data: string) {
        if (data && /^】{1,2}$/.test(data)) {
            if (this.getRefCloseContext(protyle)) {
                return true;
            }
            const context = this.getRefBracketContext(protyle, range, data.length);
            const pair = this.refBracketRange;
            const remaining = pair && pair.endOffset - range.startOffset;
            if (context && pair?.startContainer === context.textNode && pair.endContainer === context.textNode &&
                pair.toString().startsWith("【【") && pair.toString().endsWith("】】") &&
                remaining >= data.length && remaining <= 2 && context.textBeforeCaret.endsWith(data) &&
                this.splitChar === "【【" && this.canResumeBlockHint(protyle, range)) {
                const offset = range.startOffset - data.length;
                context.textNode.deleteData(offset, data.length);
                range.setStart(context.textNode, offset);
                range.collapse(true);
                focusByRange(range);
                return this.handleRefBracketBeforeInput(protyle,
                    new InputEvent("beforeinput", {inputType: "insertText", data}));
            }
        }
        if (data?.endsWith("[") || data?.endsWith("【") || data === "【】") {
            this.autoCloseRefBrackets(protyle, range);
        }
        return false;
    }

    // 输入闭合符时跳过已补全的括号，全部跳过后完成引用；在空括号对之间退格时删除整个括号对
    // 返回 true 表示已处理并需要阻止默认输入
    public handleRefBracketBeforeInput(protyle: IProtyle, event: InputEvent) {
        if (event.isComposing || getSelection().rangeCount === 0) {
            return false;
        }
        const range = getSelection().getRangeAt(0);
        const context = this.getRefBracketContext(protyle, range);
        const pair = this.refBracketRange;
        const splitChar = this.refBracketOrigin?.splitChar;
        const closeKey = Constants.BLOCK_HINT_CLOSE_KEYS[splitChar];
        if (!context || !pair || pair.startContainer !== context.textNode || pair.endContainer !== context.textNode ||
            !splitChar || !pair.toString().startsWith(splitChar) || !pair.toString().endsWith(closeKey)) {
            return false;
        }
        if (["insertText", "insertReplacementText"].includes(event.inputType) && event.data &&
            (event.data === closeKey || event.data === closeKey[0]) && context.textAfterCaret.startsWith(event.data) &&
            range.startOffset >= pair.endOffset - 2 && range.startOffset + event.data.length <= pair.endOffset &&
            this.splitChar === splitChar && this.canResumeBlockHint(protyle, range)) {
            range.setStart(context.textNode, range.startOffset + event.data.length);
            range.collapse(true);
            focusByRange(range);
            if (range.startOffset === pair.endOffset) {
                this.refCloseContext = {range: pair.cloneRange(), text: pair.toString(),
                    notebookID: protyle.notebookId, rootID: protyle.block.rootID};
                this.enableExtend = true;
                this.render(protyle);
            }
            return true;
        }
        if (event.inputType === "deleteContentBackward" && pair.toString() === splitChar + closeKey &&
            range.startOffset === pair.startOffset + 2) {
            const block = hasClosestBlock(range.startContainer);
            if (!block) {
                return false;
            }
            const html = block.outerHTML;
            const undoContext = getUndoFocusContext(protyle.wysiwyg.element, range, true);
            const offset = pair.startOffset;
            pair.deleteContents();
            range.setStart(context.textNode, offset);
            range.collapse(true);
            focusByRange(range);
            this.refBracketRange = undefined;
            this.refBracketOrigin = undefined;
            this.refCloseContext = undefined;
            hideElements(["hint"], protyle);
            updateTransaction(protyle, block, html, undoContext);
            protyle.wysiwyg.preventKeyup = true;
            return true;
        }
        return false;
    }

    public getRefCloseContext(protyle: IProtyle) {
        return this.refCloseContext && this.isRefCloseContextCurrent(protyle, this.refCloseContext) ?
            this.refCloseContext : undefined;
    }

    public isRefCloseContextCurrent(protyle: IProtyle, context: typeof this.refCloseContext) {
        if (!context || !window.siyuan.config.editor.autoCloseRefBrackets || protyle.disabled ||
            window.siyuan.config.readonly || window.siyuan.isPublish ||
            protyle.notebookId !== context.notebookID || protyle.block.rootID !== context.rootID ||
            !protyle.wysiwyg.element.contains(context.range.startContainer) ||
            !protyle.wysiwyg.element.contains(context.range.endContainer) ||
            context.range.toString() !== context.text || getSelection().rangeCount === 0) {
            return false;
        }
        const range = getSelection().getRangeAt(0);
        return range.collapsed && range.startContainer === context.range.endContainer &&
            range.startOffset === context.range.endOffset;
    }

    public fillRefClose(value: string, protyle: IProtyle, context: typeof this.refCloseContext) {
        if (!this.isRefCloseContextCurrent(protyle, context)) {
            return;
        }
        protyle.toolbar.range = context.range.cloneRange();
        this.lastIndex = context.range.startOffset;
        this.fill(value, protyle, false);
    }

    private consumeRefBracketClose(range: Range) {
        if (this.consumeCloseKey && Constants.BLOCK_HINT_KEYS.includes(this.splitChar)) {
            const closeKey = Constants.BLOCK_HINT_CLOSE_KEYS[this.splitChar];
            range.endContainer.parentNode?.normalize();
            if (range.endContainer.nodeType === 3 && range.endContainer.textContent.startsWith(closeKey, range.endOffset)) {
                range.setEnd(range.endContainer, range.endOffset + closeKey.length);
            } else if (["[[", "【【"].includes(this.splitChar) && this.refBracketRange?.endContainer === range.endContainer &&
                this.refBracketRange.toString().endsWith(closeKey) &&
                range.endOffset === this.refBracketRange.endOffset - 1) {
                range.setEnd(range.endContainer, this.refBracketRange.endOffset);
            }
        }
        this.refBracketRange = undefined;
        this.refBracketOrigin = undefined;
        this.refCloseContext = undefined;
    }

    private getRefBracketContext(protyle: IProtyle, range: Range, insertedCloseLength = 0) {
        if (!window.siyuan.config.editor?.autoCloseRefBrackets || protyle.disabled ||
            window.siyuan.config.readonly || window.siyuan.isPublish || !range.collapsed ||
            range.startContainer.nodeType !== 3 || !protyle.wysiwyg.element.contains(range.startContainer) ||
            hasClosestByAttribute(range.startContainer, "data-type", "code") ||
            hasClosestByAttribute(range.startContainer, "data-type", "inline-math") ||
            hasClosestByAttribute(range.startContainer, "data-type", "NodeCodeBlock")) {
            return undefined;
        }
        // 输入过程中文本可能被拆分为多个相邻文本节点，合并后才能判断光标前后的括号
        range.startContainer.parentNode?.normalize();
        if (range.startContainer.nodeType !== 3) {
            return undefined;
        }
        const textNode = range.startContainer as Text;
        const origin = this.refBracketOrigin;
        // 块重绘后按原块和触发符前缀恢复括号范围，不将其他位置的括号视为自动补全。
        if (origin && this.refBracketRange?.startContainer !== textNode &&
            protyle.notebookId === origin.notebookID && protyle.block.rootID === origin.rootID &&
            (hasClosestBlock(textNode) || undefined)?.getAttribute("data-node-id") === origin.blockID &&
            textNode.data.startsWith(origin.prefix)) {
            const end = textNode.data.indexOf(Constants.BLOCK_HINT_CLOSE_KEYS[origin.splitChar], origin.prefix.length);
            const pairEnd = end + 2 + insertedCloseLength;
            if (end > -1 && pairEnd <= textNode.length && range.startOffset >= origin.prefix.length &&
                range.startOffset <= pairEnd) {
                this.refBracketRange = range.cloneRange();
                this.refBracketRange.setStart(textNode, origin.prefix.length - 2);
                this.refBracketRange.setEnd(textNode, pairEnd);
            }
        }
        return {
            textNode,
            textBeforeCaret: textNode.data.substring(0, range.startOffset),
            textAfterCaret: textNode.data.substring(range.startOffset),
        };
    }

    public canResumeBlockHint(protyle: IProtyle, range: Range) {
        if (!range.collapsed || !protyle.wysiwyg.element.contains(range.startContainer) ||
            !Constants.BLOCK_HINT_KEYS.includes(this.splitChar) ||
            hasClosestByAttribute(range.startContainer, "data-type", "code") ||
            hasClosestByAttribute(range.startContainer, "data-type", "NodeCodeBlock")) {
            return false;
        }
        const start = getSelectionOffset(range.startContainer, protyle.wysiwyg.element, range).start;
        const textBeforeCaret = range.startContainer.textContent.substring(0, start) || "";
        let textAfterCaret = "";
        if (range.startContainer.nodeType === 3) {
            const textNode = range.startContainer as Text;
            const caretOffset = getWholeTextOffset(textNode, range.startOffset);
            textAfterCaret = textNode.wholeText.substring(caretOffset);
        }
        return isBlockHintQueryAtCaret(textBeforeCaret, textAfterCaret, this.splitChar,
            Constants.BLOCK_HINT_CLOSE_KEYS[this.splitChar], Constants.SIZE_TITLE);
    }

    private getMobileSelectionBounds(protyle: IProtyle) {
        const range = getEditorRange(protyle.wysiwyg.element);
        const position = getSelectionPosition(protyle.wysiwyg.element, range);
        if (range.startContainer.nodeType === 3 && range.startContainer.textContent.length > 0) {
            const textLength = range.startContainer.textContent.length;
            const offset = Math.min(range.startOffset, textLength);
            const textRange = range.cloneRange();
            if (offset > 0) {
                textRange.setStart(range.startContainer, offset - 1);
                textRange.setEnd(range.startContainer, offset);
            } else {
                textRange.setStart(range.startContainer, 0);
                textRange.setEnd(range.startContainer, 1);
            }
            const rects = textRange.getClientRects();
            const rect = rects[rects.length - 1];
            if (rect?.height > 0) {
                return {
                    top: rect.top,
                    bottom: rect.bottom,
                };
            }
        }
        return {
            top: position.top,
            bottom: position.top + 26,
        };
    }

    private setMobilePosition(anchorTop: number, anchorBottom: number) {
        const viewportBounds = getVisibleViewportBounds();
        const viewportTop = Math.max(viewportBounds.top, getTopBarHeight());
        let viewportBottom = viewportBounds.bottom;
        const keyboardToolbarElement = document.getElementById("keyboardToolbar");
        if (keyboardToolbarElement && !keyboardToolbarElement.classList.contains("fn__none")) {
            viewportBottom = Math.min(viewportBottom, keyboardToolbarElement.getBoundingClientRect().top);
        }
        viewportBottom = Math.max(viewportTop, viewportBottom);
        const heightLimit = (viewportBottom - viewportTop) / 3;
        const gap = 8;
        let position = getMobileHintPosition(anchorTop, anchorBottom, this.element.scrollHeight, viewportTop,
            viewportBottom, heightLimit, gap);
        const hintStyle = getComputedStyle(this.element);
        const verticalInset = parseFloat(hintStyle.paddingTop) + parseFloat(hintStyle.paddingBottom) +
            parseFloat(hintStyle.borderTopWidth) + parseFloat(hintStyle.borderBottomWidth);
        this.element.style.maxHeight = `${Math.max(0, position.maxHeight - verticalInset)}px`;
        position = getMobileHintPosition(anchorTop, anchorBottom, this.element.getBoundingClientRect().height,
            viewportTop, viewportBottom, heightLimit, gap);
        this.element.style.left = "0";
        this.element.style.top = `${position.top}px`;
    }

    private cancelLoadingAnimation() {
        this.loadingAnimation?.cancel();
        this.loadingAnimation = undefined;
    }

    public genLoading(protyle: IProtyle, delay = 0, source = this.source) {
        const loadingID = ++this.loadingID;
        const context = getCreateTargetContext(protyle);
        const rootID = protyle.block.rootID;
        this.source = source;
        this.bindingDismissController?.abort();
        if (source === "av" && getAVBindingCell(protyle.toolbar.range)?.dataset.rowId) {
            // 独立条目面板没有编辑器的空白点击处理，使用捕获事件兼容鼠标和触摸。
            const controller = new AbortController();
            this.bindingDismissController = controller;
            document.addEventListener("pointerdown", event => {
                if (this.element.contains(event.target as Node)) {
                    return;
                }
                this.element.classList.add("fn__none");
                controller.abort();
            }, {capture: true, signal: controller.signal});
        }
        const delayPanel = this.loadingAnimation?.playState === "running" &&
            (this.loadingAnimation.effect as KeyframeEffect)?.target === this.element;
        this.cancelLoadingAnimation();
        this.destroyEmojiPanel();
        const wasHidden = this.element.classList.contains("fn__none");
        if (this.element.classList.contains("fn__none")) {
            this.element.innerHTML = '<div class="fn__loading" style="height: 128px;position: initial"><span class="b3-loading" aria-hidden="true"></span></div>';
            this.element.classList.remove("fn__none");
            if (this.source === "av") {
                const cellElement = getAVBindingCell(protyle.toolbar.range);
                if (cellElement) {
                    const cellRect = cellElement.getBoundingClientRect();
                    /// #if !MOBILE
                    setPosition(this.element, cellRect.left, cellRect.bottom, cellRect.height);
                    /// #else
                    this.setMobilePosition(cellRect.top, cellRect.bottom);
                    /// #endif
                }
            } else {
                const textareaPosition = getSelectionPosition(protyle.wysiwyg.element);
                /// #if !MOBILE
                setPosition(this.element, textareaPosition.left, textareaPosition.top + 26, 30);
                /// #else
                const selectionBounds = this.getMobileSelectionBounds(protyle);
                this.setMobilePosition(selectionBounds.top, selectionBounds.bottom);
                /// #endif
            }
        } else if (!this.element.querySelector(".fn__loading")) {
            this.element.insertAdjacentHTML("beforeend", '<div class="fn__loading"><span class="b3-loading" aria-hidden="true"></span></div>');
        }
        if (delay > 0) {
            // 首次打开时延迟显示整个占位面板，更新候选项时只延迟显示加载遮罩
            const loadingElement = wasHidden || delayPanel ? this.element : this.element.querySelector(".fn__loading");
            this.loadingAnimation = loadingElement.animate([
                {visibility: "hidden"},
                {visibility: "hidden"},
            ], {duration: delay});
        }
        const loadingElement = this.element.querySelector(".fn__loading");
        // 仅允许当前文档中仍可见的本次加载更新候选，避免旧请求影响后续面板。
        return () => this.loadingID === loadingID && isSameCreateTargetContext(context, protyle) &&
            protyle.block.rootID === rootID && this.element.isConnected &&
            !this.element.classList.contains("fn__none") && this.element.contains(loadingElement);
    }

    public bindUploadEvent(protyle: IProtyle, element: HTMLElement) {
        element.querySelectorAll('input[type="file"]').forEach(item => {
            const captureInsertPosition = () => {
                let range = protyle.toolbar.range;
                if (!range || !protyle.wysiwyg.element.contains(range.startContainer) ||
                    !protyle.wysiwyg.element.contains(range.endContainer)) {
                    range = getEditorRange(protyle.wysiwyg.element);
                }
                range = range.cloneRange();
                if (this.lastIndex > -1) {
                    range.setStart(range.startContainer, this.lastIndex);
                }
                return createUploadInsertPosition(range,
                    getUndoFocusContext(protyle.wysiwyg.element, range, true));
            };
            let insertPosition = captureInsertPosition();
            let uploadDocument = captureUploadDocument(protyle);
            item.addEventListener("click", event => {
                insertPosition = captureInsertPosition();
                uploadDocument = captureUploadDocument(protyle);
                if ((item as HTMLInputElement).dataset.nativePhotos === "true" && canPickIOSPhotos()) {
                    event.preventDefault();
                    const position = insertPosition;
                    const target = uploadDocument;
                    hideElements(["hint", "toolbar"], protyle);
                    void pickIOSPhotos().then(({files, pairs}) => {
                        if (files.length === 0) {
                            return;
                        }
                        const range = isUploadDocumentAvailable(protyle, target) ? getUploadInsertRange(protyle, position) : undefined;
                        if (!range || protyle.disabled || window.siyuan.isPublish ||
                            protyle.options.history?.created || protyle.options.history?.snapshot) {
                            showMessage(window.siyuan.languages.uploadInsertTargetUnavailable);
                            return;
                        }
                        range.deleteContents();
                        range.collapse(true);
                        uploadFiles(protyle, files, undefined, undefined, undefined, {
                            document: target,
                            insertPosition: createUploadInsertPosition(range,
                                getUndoFocusContext(protyle.wysiwyg.element, range, true)),
                            livePhotoPairs: pairs,
                            allowedInputKinds: ["files"],
                            requiredFileCount: files.length,
                            source: "file-picker",
                            target: "editor",
                        });
                    }).catch(() => showMessage(window.siyuan.languages.uploadError));
                }
            });
            item.addEventListener("change", (event: InputEvent & { target: HTMLInputElement }) => {
                if (event.target.files.length === 0) {
                    return;
                }
                const range = isUploadDocumentAvailable(protyle, uploadDocument) ?
                    getUploadInsertRange(protyle, insertPosition) : undefined;
                if (!range) {
                    event.target.value = "";
                    showMessage(window.siyuan.languages.uploadInsertTargetUnavailable);
                    return;
                }
                range.deleteContents();
                range.collapse(true);
                recordSlashExecution(item.closest<HTMLElement>("[data-slash-entry-key]")?.dataset.slashEntryKey);
                uploadFiles(protyle, event.target.files, event.target, undefined, undefined, {
                    document: uploadDocument,
                    htmlAsIframe: event.target.dataset.uploadMode === "html-iframe",
                    insertPosition: createUploadInsertPosition(range,
                        getUndoFocusContext(protyle.wysiwyg.element, range, true)),
                    source: "file-picker",
                    target: "editor",
                });
                hideElements(["hint", "toolbar"], protyle);
            });
        });
    }

    private getHTMLByData(data: IHintData[]) {
        if (this.source === "hint") {
            // 所有上下文过滤完成后再选常用项，保留原列表及搜索结果顺序。
            const frequent = getFrequentSlashItems(data.filter(item => item.html !== "separator" &&
                (item as TSlashMenuItem).frequentEligible === true), getSlashEntryKey);
            if (frequent.length > 0) {
                data = [...frequent, {html: "separator", entryKey: "__frequent_separator__"} as TSlashMenuItem, ...data];
            }
        }
        if (this.source === "hint" && this.element.closest("#keyboardToolbar")) {
            return getLiteSlashMenuHTML(data);
        }
        let hintsHTML = '<div style="flex: 1;overflow:auto;">';
        if (this.source !== "hint") {
            hintsHTML = '<input spellcheck="false" style="margin:0 8px 4px 8px" class="b3-text-field"><div style="flex: 1;overflow:auto;">';
        }
        const focusIndex = data.findIndex(item => item.focus);
        data.forEach((hintData, i) => {
            // https://github.com/siyuan-note/siyuan/issues/1229 提示时，新建文件不应默认选中
            const focusClass = i === (focusIndex > -1 ? focusIndex : 0) ? " b3-list-item--focus" : "";
            if (hintData.html === "separator") {
                hintsHTML += `<button data-id="${hintData.id || ""}" class="b3-menu__separator"></button>`;
            } else {
                const entryKey = getSlashEntryKey(hintData);
                hintsHTML += `<button data-id="${hintData.id || ""}"${entryKey ? ` data-slash-entry-key="${escapeAttr(entryKey)}"` : ""} style="width: calc(100% - 16px)" class="b3-list-item b3-list-item--two${focusClass}" data-value="${encodeURIComponent(hintData.value)}">${hintData.html}</button>`;
            }
        });
        return `${hintsHTML}</div>`;
    }

    public genHTML(data: IHintData[], protyle: IProtyle, hide = false, source: THintSource) {
        this.cancelLoadingAnimation();
        this.source = source;
        this.destroyEmojiPanel();
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
        if (this.source === "av") {
            const cellElement = getAVBindingCell(protyle.toolbar.range);
            if (cellElement) {
                const cellRect = cellElement.getBoundingClientRect();
                /// #if !MOBILE
                setPosition(this.element, cellRect.left, cellRect.bottom, cellRect.height);
                /// #else
                this.setMobilePosition(cellRect.top, cellRect.bottom);
                /// #endif
            }
        } else {
            const textareaPosition = getSelectionPosition(protyle.wysiwyg.element);
            /// #if !MOBILE
            setPosition(this.element, textareaPosition.left, textareaPosition.top + 26, 30);
            /// #else
            const selectionBounds = this.getMobileSelectionBounds(protyle);
            this.setMobilePosition(selectionBounds.top, selectionBounds.bottom);
            /// #endif
        }
        this.element.scrollTop = 0;
        let currentHintElement = this.element.querySelector(".b3-list-item--focus") as HTMLElement;
        while (isAbnormalItem(currentHintElement, "b3-list-item")) {
            currentHintElement.classList.remove("b3-list-item--focus");
            currentHintElement = currentHintElement.nextElementSibling as HTMLElement;
            currentHintElement?.classList.add("b3-list-item--focus");
        }
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
                    this.fill(decodeURIComponent(this.element.querySelector(".b3-list-item--focus").getAttribute("data-value")), protyle, false, isNotCtrl(event));
                    event.preventDefault();
                } else if (event.key === "Escape") {
                    this.bindingDismissController?.abort();
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
                this.genSearchHTML(protyle, searchElement, nodeElement, oldValue, source);
            });
            searchElement.addEventListener("compositionend", (event: InputEvent) => {
                event.stopPropagation();
                this.genSearchHTML(protyle, searchElement, nodeElement, oldValue, source);
            });
        }
    }

    private genSearchHTML(protyle: IProtyle, searchElement: HTMLInputElement, nodeElement: false | HTMLElement, oldValue: string, source: THintSource) {
        const createTarget = this.prepareCreateTarget(protyle, "ref");
        this.element.lastElementChild.innerHTML = '<div class="ft__center"><span class="b3-loading" aria-hidden="true"></span></div>';
        const searchParam: import("../../types/api").SearchRefBlockRequestInput = {
            k: searchElement.value,
            id: nodeElement ? nodeElement.getAttribute("data-node-id") : protyle.block.parentID,
            beforeLen: Math.floor((Math.max(protyle.element.clientWidth / 2, 320) - 58) / 28.8),
            rootID: source === "av" ? "" : protyle.block.rootID,
            isDatabase: source === "av",
        };
        if (isEncryptedBox(protyle.notebookId)) {
            searchParam.notebook = protyle.notebookId;
        }
        searchRef(searchParam).then((response) => {
            if (!response) {
                if (createTarget.isCurrent()) {
                    this.genHTML([], protyle, true, source);
                }
                return;
            }
            return createTarget.promise.then((hideConfiguredCreate) => {
                if (!createTarget.isCurrent()) {
                    return;
                }
                let searchHTML = "";
                if (response.newDoc && !hideConfiguredCreate) {
                    const blockRefText = `((newFile "${oldValue}"${Constants.ZWSP}'${response.k}${Lute.Caret}'))`;
                    searchHTML += `<button style="width: calc(100% - 16px)" class="b3-list-item b3-list-item--two${response.blocks.length === 0 ? " b3-list-item--focus" : ""}" data-value="${encodeURIComponent(blockRefText)}"><div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconFile"></use></svg>
<span class="b3-list-item__text">${window.siyuan.languages.newFile} <mark>${response.k}</mark></span></div></button>`;
                }
                if (response.newDoc) {
                    const newFileName = Lute.UnEscapeHTMLStr(response.k);
                    const subDocRefText = `((newSubDoc "${oldValue}"${Constants.ZWSP}'${newFileName}${Lute.Caret}'))`;
                    searchHTML += `<button style="width: calc(100% - 16px)" class="b3-list-item b3-list-item--two${hideConfiguredCreate && response.blocks.length === 0 ? " b3-list-item--focus" : ""}" data-value="${encodeURIComponent(subDocRefText)}"><div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconFile"></use></svg>
<span class="b3-list-item__text">${window.siyuan.languages.newSubDoc} <mark>${response.k}</mark></span></div></button>`;
                    const pathRefText = `((newFileAtPath "${oldValue}"${Constants.ZWSP}'${newFileName}${Lute.Caret}'))`;
                    searchHTML += `<button style="width: calc(100% - 16px)" class="b3-list-item b3-list-item--two" data-value="${encodeURIComponent(pathRefText)}"><div class="b3-list-item__first"><svg class="b3-list-item__graphic"><use xlink:href="#iconFolder"></use></svg>
<span class="b3-list-item__text">${window.siyuan.languages.newFileAtPath} <mark>${response.k}</mark></span></div></button>`;
                }
                response.blocks.forEach((item: IBlock, index: number) => {
                    let blockRefHTML;
                    if (source === "av") {
                        // av 搜索时需要获取值 https://github.com/siyuan-note/siyuan/issues/12020
                        let refText = item.name ? stripSearchMark(escapeSearchHighlight(item.name)) : item.refText.replaceAll(Constants.ZWSP, "");
                        if (nodeElement) {
                            refText = escapeHtml(item.ial[Constants.CUSTOM_SY_AV_STATIC_TEXT + nodeElement.getAttribute("data-av-id")] || "") || refText;
                        }
                        blockRefHTML = `<span data-type="block-ref" data-id="${item.id}" data-subtype="s">${refText}</span>`;
                    } else {
                        blockRefHTML = `<span data-type="block-ref" data-id="${item.id}" data-subtype="s">${oldValue}</span>`;
                    }
                    searchHTML += `<button style="width: calc(100% - 16px)" class="b3-list-item b3-list-item--two${index === 0 ? " b3-list-item--focus" : ""}" data-value="${encodeURIComponent(blockRefHTML)}">
${genHintItemHTML(item)}
</button>`;
                });
                if (searchHTML === "") {
                    searchHTML = `<button style="width: calc(100% - 16px)" class="b3-list-item b3-list-item--two" data-value="">${window.siyuan.languages.emptyContent}</button>`;
                }
                this.element.lastElementChild.innerHTML = searchHTML;
                setPosition(this.element, parseInt(this.element.style.left), parseInt(this.element.style.right));
            });
        }).catch(() => {
            if (createTarget.isCurrent()) {
                this.genHTML([], protyle, true, source);
            }
        });
    }

    private genEmojiHTML(protyle: IProtyle, value = "") {
        this.cancelLoadingAnimation();
        if (value && !this.enableEmoji) {
            return;
        }

        const targetElement = hasClosestBlock(protyle.toolbar.range?.startContainer);
        const targetID = targetElement ? targetElement.getAttribute("data-node-id") : protyle.block.rootID;
        let panelElement = this.element.querySelector(".emojis__panel") as HTMLElement;
        if (!panelElement || !this.emojiPanel) {
            this.destroyEmojiPanel();
            // max-height：min(402px,40vh) 和 .protyle-hint 保持一致，否则 emoji 不显示底部导航
            this.element.innerHTML = `<div style="padding:0;max-height:min(402px,40vh);width:366px" class="emojis">
<div class="emojis__panel"></div>
<div class="emojis__types">${genEmojiCategoryButtons()}</div>
</div>`;
            panelElement = this.element.querySelector(".emojis__panel") as HTMLElement;
            this.emojiPanel = new EmojiPanelController(
                panelElement,
                panelElement.nextElementSibling as HTMLElement,
                {targetID},
            );
        } else {
            this.emojiPanel.setOptions({targetID});
        }
        this.emojiBrowseMode = value === "";
        this.emojiPanel.renderSearch(value, 256);
        const firstEmojiElement = this.element.querySelector(".emojis__item");
        if (firstEmojiElement) {
            this.element.classList.remove("fn__none");
            const textareaPosition = getSelectionPosition(protyle.wysiwyg.element);
            setPosition(this.element, textareaPosition.left, textareaPosition.top + 26, 30);
            this.emojiPanel.activate();
        } else {
            this.element.classList.add("fn__none");
            this.emojiPanel.deactivate();
        }
    }

    private openEmojiInsertPanel(protyle: IProtyle, range: Range, undoContext?: Record<string, string>) {
        const targetElement = hasClosestBlock(range.startContainer);
        const targetID = targetElement ? targetElement.getAttribute("data-node-id") : protyle.block.rootID;
        const textareaPosition = getSelectionPosition(protyle.wysiwyg.element);
        protyle.toolbar.range = range.cloneRange();
        openEmojiPanel("", "insert", {
            x: textareaPosition.left,
            y: textareaPosition.top + 26,
            h: 30,
            w: 30,
        }, (unicode) => {
            if (!unicode) {
                return;
            }
            focusByRange(protyle.toolbar.range);
            insertHTML(protyle.lute.SpinBlockDOM(genEmojiInsertHTML(unicode)), protyle, false, true,
                false, undefined, undoContext);
        }, undefined, {targetID, insertRange: range});
    }

    private destroyEmojiPanel() {
        this.emojiPanel?.destroy();
        this.emojiPanel = undefined;
        this.emojiBrowseMode = false;
    }

    // 直接插入命令使用正文选区，不沿用候选面板的来源和触发位置。
    public fillCommand(value: string, protyle: IProtyle, updateRange = true, slashEntryKey?: string) {
        this.source = "hint";
        this.splitChar = "/";
        this.lastIndex = -1;
        this.hashTagSearchElement = undefined;
        this.fill(value, protyle, updateRange, false, slashEntryKey);
    }

    public fill(value: string, protyle: IProtyle, updateRange = true, refIsS = false, slashEntryKey?: string) {
        this.bindingDismissController?.abort();
        hideElements(["hint", "toolbar"], protyle);
        if (updateRange && this.source !== "av") {
            protyle.toolbar.range = getEditorRange(protyle.wysiwyg.element);
        }
        const range = protyle.toolbar.range;
        let nodeElement = hasClosestBlock(protyle.toolbar.range.startContainer) as HTMLElement;
        if (!nodeElement) {
            return;
        }
        if (["/", "、"].includes(this.splitChar) && isProtyleListItemFragment(protyle) &&
            ["- " + Lute.Caret, "1. " + Lute.Caret, "- [ ] " + Lute.Caret].includes(value)) {
            this.enableExtend = false;
            return;
        }
        // 新建标签的搜索状态：用选中的标签替换原空标签
        if (this.hashTagSearchElement && this.source === "hint") {
            const tagElement = this.hashTagSearchElement;
            this.hashTagSearchElement = undefined;
            this.splitChar = "";
            this.lastIndex = -1;
            if (tagElement.isConnected && protyle.wysiwyg.element.contains(tagElement) && value) {
                const tagRange = document.createRange();
                tagRange.setStartBefore(tagElement);
                tagRange.setEndAfter(tagElement);
                tagRange.deleteContents();
                tagRange.collapse(true);
                focusByRange(tagRange);
                protyle.toolbar.range = tagRange;
                insertHTML(protyle.lute.SpinBlockDOM(value), protyle, false, isMobile());
            }
            return;
        }
        if (this.source === "av") {
            let cellElement = getAVBindingCell(protyle.toolbar.range);
            if (!cellElement) {
                cellElement = nodeElement.querySelector(".av__cell--select") as HTMLElement;
            }
            if (!cellElement?.isConnected || protyle.disabled || window.siyuan.isPublish ||
                protyle.options.history?.created || protyle.options.history?.snapshot) {
                return;
            }
            const panelCell = cellElement.hasAttribute("data-row-id");
            const rowElement = panelCell ? cellElement : hasClosestByClassName(cellElement,
                isTableLikeView(nodeElement.getAttribute("data-av-type")) ? "av__row" : "av__gallery-item");
            if (!rowElement) {
                return;
            }
            const previousID = panelCell ? rowElement.dataset.rowId : rowElement.dataset.id;
            const avID = nodeElement.getAttribute("data-av-id");
            const previousValue = genCellValueByElement("block", cellElement);
            const updatePreview = (nextValue: IAVCellValue) => {
                if (!panelCell) {
                    updateAttrViewCellAnimation(cellElement, nextValue);
                }
            };
            const bindingBlockID = nodeElement.dataset.nodeId;
            const savedPrimaryValue = JSON.stringify(previousValue);
            const bindCreatedDoc = async (id: string, title: string) => {
                const bound = await bindCreatedAVDocument(protyle, {
                    avID, itemID: previousID, documentID: id, blockID: bindingBlockID, previousValue,
                    isValid: () => cellElement.isConnected && nodeElement.isConnected &&
                        nodeElement.dataset.nodeId === bindingBlockID &&
                        (panelCell ? rowElement.dataset.rowId : rowElement.dataset.id) === previousID &&
                        JSON.stringify(genCellValueByElement("block", cellElement)) === savedPrimaryValue,
                });
                if (bound) {
                    updatePreview({type: "block", isDetached: false,
                        block: {content: title, id, icon: previousValue.block?.icon}});
                }
            };
            if (value.startsWith("((newFileAtPath ") && value.endsWith(`${Lute.Caret}'))`)) {
                const fileNames = value.substring("((newFileAtPath \"".length, value.length - 4).split(`"${Constants.ZWSP}'`);
                const name = fileNames.length === 1 ? fileNames[0] : fileNames[1];
                const {notebookId, path, block: {rootID}} = protyle;
                const blockID = nodeElement.dataset.nodeId;
                const bindingCell = cellElement;
                const savedValue = JSON.stringify(previousValue);
                const savedRange = range.cloneRange();
                // 选址期间条目可能被删除、换绑或重绘，始终校验原条目及其主键值。
                const isValid = () => protyle.notebookId === notebookId && protyle.path === path &&
                    protyle.block.rootID === rootID && nodeElement.isConnected && bindingCell.isConnected &&
                    (panelCell || protyle.wysiwyg.element.contains(nodeElement)) && nodeElement.contains(rowElement) &&
                    rowElement.contains(bindingCell) && nodeElement.dataset.nodeId === blockID &&
                    nodeElement.getAttribute("data-av-id") === avID &&
                    (panelCell ? rowElement.dataset.rowId : rowElement.dataset.id) === previousID &&
                    JSON.stringify(genCellValueByElement("block", bindingCell)) === savedValue;
                newFileAtPath({
                    notebookId,
                    name,
                    isValid,
                    restoreFocus() {
                        if (isRangeInEditor(protyle.wysiwyg.element, savedRange)) {
                            focusByRange(savedRange);
                        }
                    },
                    onCreated: bindCreatedDoc,
                });
                return;
            }
            let tempElement = document.createElement("div");
            tempElement.innerHTML = value.replace(/<mark>/g, "").replace(/<\/mark>/g, "");
            tempElement = tempElement.firstElementChild as HTMLDivElement;
            const isNewSubDoc = value.startsWith("((newSubDoc ") && value.endsWith(`${Lute.Caret}'))`);
            if ((value.startsWith("((newFile ") || isNewSubDoc) && value.endsWith(`${Lute.Caret}'))`)) {
                const prefix = isNewSubDoc ? "((newSubDoc " : "((newFile ";
                const fileNames = value.substring(prefix.length, value.length - 4).split(`"${Constants.ZWSP}'`);
                const realFileName = fileNames.length === 1 ? fileNames[0] : fileNames[1];
                const newID = Lute.NewNodeID();
                const bindNewDoc = () => bindCreatedDoc(newID, realFileName);
                if (isNewSubDoc) {
                    newSubDocByRefHint(protyle, realFileName, bindNewDoc, newID);
                } else {
                    newFileByRefHint(protyle, realFileName, bindNewDoc, newID);
                }
            } else {
                const sourceId = tempElement.getAttribute("data-id");
                const operations = getAVBindingOperations(avID, previousID, sourceId, nodeElement.dataset.nodeId,
                    previousValue, {protyleID: protyle.id});
                transaction(protyle, operations.doOperations, operations.undoOperations);
                updatePreview({
                    type: "block",
                    isDetached: false,
                    block: {
                        content: tempElement.textContent,
                        id: sourceId
                    }
                });
            }
            return;
        }
        this.enableExtend = value === "emoji";
        let id = "";
        if (nodeElement) {
            id = nodeElement.getAttribute("data-node-id");
        }
        const html = nodeElement.outerHTML;
        const undoContext = shouldCaptureHintUndoFocus(this.splitChar, Constants.BLOCK_HINT_KEYS, value) ?
            getUndoFocusContext(protyle.wysiwyg.element, range, true) : undefined;
        // 自顶向下法新建文档后光标定位问题 https://github.com/siyuan-note/siyuan/issues/299
        if (this.consumeCloseKey && range.collapsed) {
            this.getRefBracketContext(protyle, range);
        }
        if (this.lastIndex > -1) {
            range.setStart(range.startContainer, this.lastIndex);
            focusByRange(range);
        }
        // 自动闭合时，光标后的闭合符随查询一起被替换
        this.consumeRefBracketClose(range);
        if (["[[", "【【"].includes(this.splitChar) && /^daily-note:\d{4}-\d{2}-\d{2}:[a-z0-9-]*$/.test(value)) {
            const [, date, notebookID] = value.split(":");
            const target = captureDailyNoteSelection(protyle, range);
            createDailyNoteReference(protyle, date, notebookID, (id, title) => {
                insertDailyNoteReference(protyle, target, id, title, refIsS, undoContext);
            });
            return;
        }
        if (Constants.BLOCK_HINT_KEYS.includes(this.splitChar) && value.startsWith("((newSubDoc ") &&
            value.endsWith(`${Lute.Caret}'))`)) {
            const prefix = "((newSubDoc ";
            const fileNames = value.substring(prefix.length, value.length - 4).split(`"${Constants.ZWSP}'`);
            const realFileName = fileNames.length === 1 ? fileNames[0] : fileNames[1];
            newFileBySelectRange(protyle, range, "subDoc", refIsS ? "s" : "d", realFileName, undoContext);
            return;
        }
        // 新建文件
        const choosePath = value.startsWith("((newFileAtPath ");
        if (Constants.BLOCK_HINT_KEYS.includes(this.splitChar) && (value.startsWith("((newFile ") || choosePath) && value.endsWith(`${Lute.Caret}'))`)) {
            const prefix = choosePath ? "((newFileAtPath " : "((newFile ";
            const fileNames = value.substring(prefix.length + 1, value.length - 4).split(`"${Constants.ZWSP}'`);
            const realFileName = fileNames.length === 1 ? fileNames[0] : fileNames[1];
            const insertRef = (id: string, insertRange: Range) => {
                // https://github.com/siyuan-note/siyuan/issues/10133
                protyle.toolbar.range = insertRange;
                const refElement = protyle.toolbar.setInlineMark(protyle, "block-ref", "range", {
                    type: "id",
                    color: `${id}${Constants.ZWSP}${refIsS ? "s" : "d"}${Constants.ZWSP}${getBlockRefAnchorText(refIsS ? fileNames[0] : realFileName)}`
                }, true, undoContext);
                if (refElement[0]) {
                    protyle.toolbar.range.setEnd(refElement[0].lastChild, refElement[0].lastChild.textContent.length);
                }
                protyle.toolbar.range.collapse(false);
            };
            if (choosePath) {
                newFileByRefHintAtPath(protyle, realFileName, range, insertRef);
            } else {
                newFileByRefHint(protyle, realFileName, (id) => insertRef(id, range));
            }
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
                const selectedText = stripSemanticMarkersFromRangeText(range).split(Constants.ZWSP).join("");
                const staticText = getBlockRefStaticText(selectedText, this.splitChar, this.lastIndex > -1,
                    Constants.BLOCK_HINT_CLOSE_KEYS[this.splitChar]);
                if (staticText) {
                    tempElement.setAttribute("data-subtype", "s");
                    tempElement.innerText = staticText;
                }
            } else {
                tempElement.setAttribute("data-subtype", "d");
                const dynamicTexts = tempElement.innerText.split(Constants.ZWSP);
                if (dynamicTexts.length === 2) {
                    tempElement.innerText = dynamicTexts[1];
                }
            }
            const refElement = protyle.toolbar.setInlineMark(protyle, "block-ref", "range", {
                type: "id",
                color: `${tempElement.getAttribute("data-id")}${Constants.ZWSP}${tempElement.getAttribute("data-subtype")}${Constants.ZWSP}${tempElement.textContent}`
            }, true, undoContext);
            if (refElement[0]) {
                protyle.toolbar.range.setEnd(refElement[0].lastChild, refElement[0].lastChild.textContent.length);
            }
            protyle.toolbar.range.collapse(false);
            return;
        } else if (this.splitChar === ":") {
            addEmoji(value);
            insertHTML(protyle.lute.SpinBlockDOM(genEmojiInsertHTML(value)), protyle);
        } else if (["「「", "「『", "『「", "『『", "{{"].includes(this.splitChar) || this.splitChar === "#" || this.splitChar === ":") {
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
            if (slashEntryKey && value !== Constants.ZWSP + 3) {
                recordSlashExecution(slashEntryKey);
            }
            // 精简模式的自定义候选按文本插入，内置候选执行命令；块引用保留本地事务和后续提示。
            if (protyle.lite && (Constants.BLOCK_HINT_KEYS.includes(value) ||
                !isBuiltinSlashHint(protyle.options.hint.extend.find((item) => item.key === "/" && item.hint)?.hint,
                    value, protyle))) {
                insertHTML(value, protyle, false, false, false, undefined, undoContext);
                if (Constants.BLOCK_HINT_KEYS.includes(value)) {
                    this.enableExtend = true;
                    this.render(protyle);
                }
            } else if (value === "((" || value === "{{") {
                this.enableExtend = true;
                if (value === "((") {
                    hintRef("", protyle, "hint");
                } else {
                    hintEmbed("", protyle);
                }
                this.splitChar = value;
                this.lastIndex = 0;
                range.deleteContents();
                // 光标位于 block-ref 内末尾时，需调整到 block-ref 的外面，避免把标记符插入到引用内部
                const refElement = hasClosestByAttribute(range.startContainer, "data-type", "block-ref");
                if (refElement && range.startContainer.nodeType === 3 &&
                    range.startOffset === (range.startContainer as Text).textContent.length) {
                    range.setStartAfter(refElement);
                    range.collapse(true);
                }
                const textNode = document.createTextNode(value);
                range.insertNode(textNode);
                range.setEnd(textNode, value.length);
                range.collapse(false);
                focusByRange(range);
                return;
            } else if (value === Constants.ZWSP) {
                range.deleteContents();
                this.fixImageCursor(range);
                protyle.toolbar.showTpl(protyle, nodeElement, range);
                updateTransaction(protyle, nodeElement, html, undoContext);
                return;
            } else if (value === Constants.ZWSP + 1) {
                range.deleteContents();
                this.fixImageCursor(range);
                protyle.toolbar.showWidget(protyle, nodeElement, range);
                updateTransaction(protyle, nodeElement, html, undoContext);
                return;
            } else if (value === Constants.ZWSP + 2) {
                range.deleteContents();
                this.fixImageCursor(range);
                protyle.toolbar.range = range;
                const rangePosition = getSelectionPosition(nodeElement, range);
                assetMenu(protyle, {x: rangePosition.left, y: rangePosition.top + 26, w: 0, h: 26});
                updateTransaction(protyle, nodeElement, html, undoContext);
                return;
            } else if (value === Constants.ZWSP + 3) {
                range.deleteContents();
                return;
            } else if (value === Constants.ZWSP + 4) {
                // 新建文档
                newFileInProtyle(protyle, (createDocId, createDocTitle) => {
                    insertHTML(`<span data-type="block-ref" data-id="${createDocId}" data-subtype="d">${getBlockRefAnchorText(createDocTitle)}</span>`, protyle);
                });
                return;
            } else if (value === Constants.ZWSP + 6) {
                // 新建子文档
                const newSubDocId = Lute.NewNodeID();
                getDocCreateTemplatePath(protyle.notebookId, (docCreateTemplatePath) => {
                    void fetchSyncPost("/api/filetree/createDocByParent", {
                        ...documentCreateRequest(protyle.notebookId, protyle.path, newSubDocId, ""),
                        docCreateTemplatePath,
                    }).then(response => {
                        if (!createdDocumentID(response.data)) {
                            return;
                        }
                        insertHTML(`<span data-type="block-ref" data-id="${newSubDocId}" data-subtype="d">${getBlockRefAnchorText("")}</span>`, protyle);
                        /// #if MOBILE
                        openMobileFileById(protyle.app, newSubDocId, [Constants.CB_GET_CONTEXT, Constants.CB_GET_OPENNEW]);
                        /// #else
                        openFileById({
                            app: protyle.app,
                            id: newSubDocId,
                            action: [Constants.CB_GET_CONTEXT, Constants.CB_GET_OPENNEW]
                        });
                        /// #endif
                    }).catch(error => showMessage(error.message));
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
                // 保留斜杠命令选区，选择表情时由 insertHTML 作为一个事务替换，确保撤销恢复命令文本
                this.openEmojiInsertPanel(protyle, range, undoContext);
                return;
            } else if (value.startsWith("style")) {
                range.deleteContents();
                this.fixImageCursor(range);
                nodeElement.setAttribute("style", value.split(Constants.ZWSP)[1] || "");
                updateTransaction(protyle, nodeElement, html, undoContext);
                return;
            } else if (value.startsWith("plugin") && areProtylePluginExtensionsEnabled(protyle)) {
                protyle.app.plugins.find((plugin) => {
                    const ids = value.split(Constants.ZWSP);
                    if (ids[1] === plugin.name) {
                        plugin.protyleSlash.find((slash) => {
                            if (slash.id === ids[2]) {
                                slash.callback(protyle.getInstance(), nodeElement);
                                return true;
                            }
                        });
                        return true;
                    }
                });
                return;
            } else {
                if (!range.collapsed && hasClosestBlock(range.endContainer) !== nodeElement && value.startsWith("|")) {
                    const template = document.createElement("template");
                    template.innerHTML = protyle.lute.SpinBlockDOM(value);
                    const table = template.content.firstElementChild;
                    if (template.content.childElementCount === 1 && table?.getAttribute("data-type") === "NodeTable") {
                        table.querySelectorAll<HTMLElement>("colgroup col").forEach(item => {
                            item.style.minWidth = "60px";
                        });
                        // 跨块替换使用完整事务，保留所有受影响块的内容与撤销位置。
                        insertHTML(template.innerHTML, protyle, true, true, false, undefined, undoContext);
                        const insertedTable = protyle.wysiwyg.element.querySelector(
                            `[data-node-id="${table.getAttribute("data-node-id")}"]`);
                        if (insertedTable) {
                            focusBlock(insertedTable);
                            this.openNewTableCell(protyle);
                        }
                        return;
                    }
                }
                range.deleteContents();
                if (value !== "![]()") {
                    this.fixImageCursor(range);
                }
                const isMindmap = value === `- ${Lute.Caret}\n{: ${Constants.CUSTOM_SY_LIST_MINDMAP}="1"}`;
                const superBlockLayout = getSuperBlockCommandLayout(value);
                let textContent = isMindmap ? `- ${Lute.Caret}` : value;
                if (value === "```") {
                    textContent = value + (Constants.SIYUAN_RENDER_CODE_LANGUAGES.includes(window.siyuan.storage[Constants.LOCAL_CODELANG]) ? "" : window.siyuan.storage[Constants.LOCAL_CODELANG]) + Lute.Caret + "\n```";
                }
                const editableElement = getContenteditableElement(nodeElement);
                if (value === "![]()") { // https://github.com/siyuan-note/siyuan/issues/4586 1
                    range.insertNode(document.createElement("wbr"));
                    range.insertNode(document.createTextNode(value));
                    nodeElement.insertAdjacentHTML("afterend", protyle.lute.SpinBlockDOM(nodeElement.outerHTML));
                    nodeElement = nodeElement.nextElementSibling as HTMLElement;
                    nodeElement.previousElementSibling.remove();
                    focusByWbr(nodeElement, range);
                    updateTransaction(protyle, nodeElement, html, undoContext);
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
                } else if ((editableElement.textContent === "" ||
                    superBlockLayout && editableElement.textContent.split(Constants.ZWSP).join("") === "") &&
                    nodeElement.getAttribute("data-type") === "NodeParagraph") {
                    let newHTML = "";
                    if (superBlockLayout) {
                        newHTML = genEmptySuperBlock(superBlockLayout, nodeElement).outerHTML;
                    } else if (value === "<div>") {
                        newHTML = `<div data-node-id="${id}" data-type="NodeHTMLBlock" class="render-node" data-subtype="block">${genIconHTML()}<div><protyle-html data-content=""></protyle-html><span style="position: absolute">${Constants.ZWSP}</span></div><div class="protyle-attr" contenteditable="false"></div></div>`;
                    } else {
                        editableElement.textContent = textContent;
                        newHTML = isMindmap ? spinListMindmapDOM(protyle.lute, nodeElement.outerHTML) :
                            protyle.lute.SpinBlockDOM(nodeElement.outerHTML);
                    }
                    // 列表项内创建列表时保留空段落，避免形成 li>list 非法结构 https://github.com/siyuan-note/siyuan/issues/17890
                    const tempCheck = document.createElement("div");
                    tempCheck.innerHTML = newHTML;
                    const keepEmptyInLi = hasClosestByClassName(nodeElement, "li") &&
                        tempCheck.firstElementChild?.getAttribute("data-type") === "NodeList";
                    if (keepEmptyInLi) {
                        // 保留空段落时给新 NodeList 生成新 ID，避免与段落 ID 冲突
                        const newListId = Lute.NewNodeID();
                        tempCheck.firstElementChild.setAttribute("data-node-id", newListId);
                        newHTML = tempCheck.innerHTML;
                    }
                    nodeElement.insertAdjacentHTML("afterend", newHTML);
                    nodeElement = nodeElement.nextElementSibling as HTMLElement;
                    if (!keepEmptyInLi) {
                        nodeElement.previousElementSibling.remove();
                        // https://github.com/siyuan-note/siyuan/issues/6864
                        if (nodeElement.getAttribute("data-type") === "NodeTable") {
                            nodeElement.querySelectorAll("colgroup col").forEach((item: HTMLElement) => {
                                item.style.minWidth = "60px";
                            });
                        }
                        updateTransaction(protyle, nodeElement, html, undoContext);
                    } else {
                        // 保留空段落：原段落清空内容，新列表用 insert 操作
                        editableElement.textContent = "";
                        transaction(protyle, [{
                            action: "update",
                            id: id,
                            data: nodeElement.previousElementSibling.outerHTML
                        }, {
                            action: "insert",
                            id: nodeElement.getAttribute("data-node-id"),
                            data: nodeElement.outerHTML,
                            previousID: id
                        }], [{
                            action: "update",
                            id: id,
                            data: html,
                            context: undoContext,
                        }, {
                            action: "delete",
                            id: nodeElement.getAttribute("data-node-id")
                        }]);
                    }
                } else {
                    let newHTML = superBlockLayout ? genEmptySuperBlock(superBlockLayout).outerHTML :
                        isMindmap ? spinListMindmapDOM(protyle.lute, textContent) :
                        protyle.lute.SpinBlockDOM(textContent);
                    if (value === "<div>") {
                        newHTML = `<div data-node-id="${Lute.NewNodeID()}" data-type="NodeHTMLBlock" class="render-node" data-subtype="block">${genIconHTML()}<div><protyle-html data-content=""></protyle-html><span style="position: absolute">${Constants.ZWSP}</span></div><div class="protyle-attr" contenteditable="false"></div></div>`;
                    }
                    // 列表项内创建列表时保留原内容块，避免 ID 冲突和 li>list 非法结构 https://github.com/siyuan-note/siyuan/issues/17890
                    const insertListInLi = hasClosestByClassName(nodeElement, "li") &&
                        (() => {
                            const tc = document.createElement("div");
                            tc.innerHTML = newHTML;
                            return tc.firstElementChild?.getAttribute("data-type") === "NodeList";
                        })();
                    if (insertListInLi) {
                        const newListId = Lute.NewNodeID();
                        const tc = document.createElement("div");
                        tc.innerHTML = newHTML;
                        tc.firstElementChild.setAttribute("data-node-id", newListId);
                        newHTML = tc.innerHTML;
                        nodeElement.insertAdjacentHTML("afterend", newHTML);
                        const newListEl = nodeElement.nextElementSibling as HTMLElement;
                        transaction(protyle, [{
                            action: "update",
                            id: id,
                            data: nodeElement.outerHTML
                        }, {
                            action: "insert",
                            id: newListId,
                            data: newListEl.outerHTML,
                            previousID: id
                        }], [{
                            action: "update",
                            id: id,
                            data: html,
                            context: undoContext,
                        }, {
                            action: "delete",
                            id: newListId
                        }]);
                        focusByWbr(newListEl, range);
                        return;
                    }
                    const oldHTML = nodeElement.outerHTML;
                    let foldData;
                    if (nodeElement.getAttribute("data-type") === "NodeHeading" &&
                        nodeElement.getAttribute("fold") === "1") {
                        foldData = setFold(protyle, nodeElement, true, false, true);
                    }
                    nodeElement.insertAdjacentHTML("afterend", newHTML);
                    const newId = newHTML.substr(newHTML.indexOf('data-node-id="') + 14, 22);
                    nodeElement.setAttribute(Constants.ATTRIBUTE_EDITING, "true");
                    nodeElement = protyle.wysiwyg.element.querySelector(`[data-node-id="${newId}"]`);
                    // https://github.com/siyuan-note/siyuan/issues/6864
                    if (nodeElement.getAttribute("data-type") === "NodeTable") {
                        nodeElement.querySelectorAll("colgroup col").forEach((item: HTMLElement) => {
                            item.style.minWidth = "60px";
                        });
                    }
                    const doOperations: IOperation[] = [{
                        data: oldHTML,
                        id,
                        action: "update"
                    }, {
                        data: nodeElement.outerHTML,
                        id: newId,
                        previousID: id,
                        action: "insert"
                    }];
                    const undoOperations: IOperation[] = [{
                        id: newId,
                        action: "delete"
                    }, {
                        data: html,
                        context: undoContext,
                        id,
                        action: "update"
                    }];
                    if (foldData) {
                        doOperations.push(...foldData.doOperations);
                        undoOperations.push(...foldData.undoOperations);
                    }
                    transaction(protyle, doOperations, undoOperations);
                }
                if (value === "<div>" || value === "$$" || (value.indexOf("```") > -1 && (value.length > 3 || nodeElement.classList.contains("render-node")))) {
                    protyle.toolbar.showRender(protyle, nodeElement);
                    processRender(nodeElement);
                } else if (value.startsWith("```")) {
                    highlightRender(nodeElement);
                } else if (value.startsWith("<iframe") || value.startsWith("<video") || value.startsWith("<audio")) {
                    renderIFrameResize(nodeElement);
                    protyle.gutter.renderMenu(protyle, nodeElement);
                    const itemElement = window.siyuan.menus.menu.element.querySelector('[data-id="assetVideo"], [data-id="assetAudio"], [data-id="assetIFrame"]');
                    if (isMobile()) {
                        // 移动端将资源子菜单内容提升为底部菜单根内容。
                        const subMenuItemsElement = itemElement.querySelector(":scope > .b3-menu__submenu > .b3-menu__items");
                        window.siyuan.menus.menu.element.lastElementChild.replaceChildren(...Array.from(subMenuItemsElement.children));
                        window.siyuan.menus.menu.fullscreen();
                    } else {
                        const rect = nodeElement.getBoundingClientRect();
                        window.siyuan.menus.menu.popup({
                            x: rect.left,
                            y: rect.top,
                            isLeft: true
                        });
                        itemElement.classList.add("b3-menu__item--show");
                        window.siyuan.menus.menu.showSubMenu(itemElement.querySelector(".b3-menu__submenu"));
                    }
                    window.siyuan.menus.menu.element.querySelector("textarea").focus();
                } else if (value === "---") {
                    focusBlock(nodeElement);
                } else if (nodeElement.classList.contains("av")) {
                    avRender(nodeElement, protyle, () => {
                        const titleHTMLElement = nodeElement.querySelector(".av__title") as HTMLInputElement;
                        titleHTMLElement.focus();
                        range.setStart(titleHTMLElement, 0);
                        range.collapse(true);
                        focusByRange(range);
                    });
                } else {
                    focusByWbr(nodeElement, range);
                    if (isMindmap && nodeElement.dataset.type === "NodeMindmap") {
                        mountNewListMindmap(protyle, nodeElement);
                    }
                }
            }
        }
        this.openNewTableCell(protyle);
    }

    // 新建表格后直接接管当前单元格，后续输入与鼠标点击进入编辑使用相同的限制。
    private openNewTableCell(protyle: IProtyle) {
        const selection = getSelection();
        const focus = selection?.focusNode;
        const focusElement = focus instanceof Element ? focus : focus?.parentElement;
        const cell = focusElement?.closest<HTMLTableCellElement>("td, th");
        if (cell && cell.closest(".protyle-wysiwyg") === protyle.wysiwyg.element &&
            cell.contains(selection.anchorNode)) {
            void import("../render/tableCellRichEditor").then(module => {
                if (cell.contains(getSelection()?.focusNode)) {
                    module.openTableCellRichEditor(protyle, cell);
                }
            });
        }
    }

    public select(event: KeyboardEvent, protyle: IProtyle) {
        const isEmojiPanel = this.element.firstElementChild.classList.contains("emojis");
        if (this.element.querySelectorAll("button").length === 0 && !isEmojiPanel) {
            return false;
        }
        if (event.key === "Enter") {
            if (isEmojiPanel) {
                const currentElement = this.emojiPanel?.getCurrentElement();
                if (!currentElement) {
                    return false;
                }
                const unicode = currentElement.getAttribute("data-unicode");
                if (this.emojiBrowseMode) {
                    // /emoji 后会自动添加冒号，导致 range 无法计算，因此不依赖 this.fill
                    const range = getSelection().getRangeAt(0);
                    if (range.endContainer.nodeType !== 3) {
                        range.endContainer.childNodes[range.endOffset - 1]?.remove();
                    }
                    addEmoji(unicode);
                    insertHTML(protyle.lute.SpinBlockDOM(genEmojiInsertHTML(unicode)), protyle);
                    this.element.classList.add("fn__none");
                    this.emojiPanel?.deactivate();
                } else {
                    this.emojiPanel?.deactivate();
                    this.fill(unicode, protyle);
                }
            } else {
                const mark = decodeURIComponent(this.element.querySelector(".b3-list-item--focus").getAttribute("data-value"));
                if (mark === Constants.ZWSP + 3) {
                    (this.element.querySelector(".b3-list-item--focus input") as HTMLElement).click();
                } else {
                    this.fill(mark, protyle, true, isOnlyMeta(event),
                        (this.element.querySelector(".b3-list-item--focus") as HTMLElement).dataset.slashEntryKey);
                }
            }
            event.preventDefault();
            event.stopPropagation();
            return true;
        }
        if (isEmojiPanel) {
            if (!this.emojiPanel?.getCurrentElement()) {
                return false;
            }
            this.emojiPanel.moveSelection(event.key);
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
            // 不需要 preventDefault https://github.com/siyuan-note/siyuan/issues/11846
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

    private getKey(currentLineValue: string, textAfterCaret: string, extend: IHintExtend[]) {
        const prevSplit = this.splitChar;
        const prevLastIndex = this.lastIndex;
        this.lastIndex = -1;
        this.splitChar = "";
        this.closeKeyTyped = false;
        this.consumeCloseKey = false;
        const disableHashTagSearch = window.siyuan.config.editor.hashTagSearch === false;
        extend.forEach((item) => {
            // 关闭标签搜索后 # 不再作为触发符，避免影响 / 等后续提示
            if (disableHashTagSearch && item.key === "#") {
                return;
            }
            let currentLastIndex = currentLineValue.lastIndexOf(item.key);
            // https://ld246.com/article/1701670704754
            if (Constants.BLOCK_HINT_KEYS.includes(item.key) && currentLastIndex > -1) {
                currentLastIndex = getBlockHintTriggerOffset(currentLineValue, textAfterCaret, item.key,
                    Constants.BLOCK_HINT_CLOSE_KEYS[item.key]);
            }
            if (this.lastIndex < currentLastIndex) {
                if (!shouldIgnoreHintTrigger(this.splitChar, item.key, Constants.BLOCK_HINT_KEYS)) {
                    this.splitChar = item.key;
                    this.lastIndex = currentLastIndex;
                }
            }
        });
        if (this.lastIndex === -1) {
            return undefined;
        }
        // 上一次提示没有结束时不能被其余提示干扰 https://github.com/siyuan-note/siyuan/issues/14324
        if (!this.element.classList.contains("fn__none") && prevSplit && prevSplit !== this.splitChar &&
            prevLastIndex > -1 && currentLineValue.startsWith(prevSplit, prevLastIndex) &&
            !(disableHashTagSearch && prevSplit === "#") &&
            !(["/", "、"].includes(prevSplit) && this.splitChar === ":")) {
            this.splitChar = prevSplit;
            this.lastIndex = prevLastIndex;
        }
        // 冒号前为数字或冒号不进行emoji提示
        if (this.splitChar === ":") {
            this.enableEmoji = !(/\d/.test(currentLineValue.substr(this.lastIndex - 1, 1)) ||
                currentLineValue.substr(this.lastIndex - 1, 2) === "::");

        }
        const lastItem = currentLineValue.substring(this.lastIndex + this.splitChar.length);
        // https://github.com/siyuan-note/siyuan/issues/10637
        if (lastItem.trimStart() === lastItem &&
            lastItem.length < Constants.SIZE_TITLE) {
            // 输入法自动补全 https://github.com/siyuan-note/insider/issues/100
            if (this.splitChar === "【【" && currentLineValue.endsWith("【【】")) {
                return "";
            }
            if (Constants.BLOCK_HINT_KEYS.includes(this.splitChar)) {
                const query = stripBlockHintCloseKey(lastItem, Constants.BLOCK_HINT_CLOSE_KEYS[this.splitChar]);
                this.closeKeyTyped = query !== lastItem;
                this.consumeCloseKey = !!window.siyuan.config.editor.autoCloseRefBrackets;
                return query;
            }
            return lastItem;
        }
        return undefined;
    }
}
