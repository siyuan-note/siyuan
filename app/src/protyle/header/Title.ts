import {escapeHtmlTextAndAttr} from "../../util/escape";
import type {BlockQueryRequestInput} from "../../types/api";
import {
    focusByOffset,
    getEditorRange,
} from "../util/selection";
import {focusByRange, getSelectionOffset} from "../util/selectionOffsets";
import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {normalizeDocumentTitle, truncateDocumentTitle, validateName} from "../../editor/rename";
import {MenuItem} from "../../menus/Menu";
import {openFileAttr,} from "../../menus/commonMenuItem";
import {Constants} from "../../constants";
import {matchHotKey} from "../util/hotKey";
import {isMac, readText} from "../util/compatibility";
import dayjs from "dayjs";
/// #if !MOBILE
import {openFileById} from "../../editor/util";
/// #endif
import {getDocDisplayName, isEncryptedBox} from "../../util/pathName";
import {commonHotkey} from "../wysiwyg/commonHotkey";
import {nbsp2space} from "../util/normalizeText";
import {hideTooltip} from "../../dialog/tooltip";
import {commonClick} from "../wysiwyg/commonClick";
import {openTitleMenu} from "./openTitleMenu";
import {electronUndo} from "../undo";
import {enableLuteMarkdownSyntax, restoreLuteMarkdownSyntax} from "../util/paste";
import {addSpellcheckMenuItems, requestSpellcheckContext} from "../../menus/spellcheck";
import {isCaretAtVerticalBoundary} from "../wysiwyg/verticalCaret";
import {focusFirstVerticalRegion, prepareVerticalNavigation} from "../wysiwyg/verticalNavigation";
import {scheduleCaretScroll} from "../wysiwyg/caretScroll";
import {getParentDocumentID} from "../util/parentDocument";
import {getTextSiyuanFromClipboardData} from "../util/clipboardData";
import {enterDocumentFromTitle} from "./titleEnter";
import {setTitleAutoDirection} from "../render/autoDirection";
import {DocumentTitleEditor} from "./documentTitleEditor";
import {waitForPendingTransactions} from "../util/transactionQueue";

export class Title {
    public element: HTMLElement;
    public editElement: HTMLElement;
    private timeout: number;
    private pendingRename?: () => void;
    private composing = false;
    private richEditor?: DocumentTitleEditor;
    private plainEditElement?: HTMLElement;
    private sourceLoading?: Promise<void>;
    private sourceRequest = 0;
    private destroyed = false;
    private summary = "";

    constructor(private protyle: IProtyle) {
        this.element = document.createElement("div");
        this.element.className = "protyle-title";
        if (window.siyuan.config.editor.displayBookmarkIcon) {
            this.element.classList.add("protyle-wysiwyg--attr");
        }
        if (protyle.options.render?.titleShowTop) {
            this.element.innerHTML = '<div class="protyle-attr"></div>';
        } else {
            // 标题内需要一个空格，避免首次加载出现`请输入文档名`干扰
            this.element.innerHTML = `<span aria-label="${isMac() ? window.siyuan.languages.gutterTip2 : window.siyuan.languages.gutterTip2.replace("⇧", "Shift+")}" data-position="west" class="protyle-title__icon ariaLabel"><svg><use xlink:href="#iconFile"></use></svg></span>
<div contenteditable="true" spellcheck="${window.siyuan.config.editor.spellcheck}" class="protyle-title__input" data-tip="${window.siyuan.languages._kernel[16]}"> </div><div class="protyle-attr"></div>`;
            this.editElement = this.element.querySelector(".protyle-title__input");
            setTitleAutoDirection(this.editElement, window.siyuan.config.editor.autoDirection);
            this.editElement.addEventListener("paste", (event: ClipboardEvent) => {
                event.stopPropagation();
                event.preventDefault();
                // 不能使用 range.insertNode，否则无法撤销
                let text = getTextSiyuanFromClipboardData(event.clipboardData);
                if (text) {
                    try {
                        JSON.parse(text);
                        text = event.clipboardData.getData("text/plain");
                    } catch (e) {
                        // 不为数据库，保持 text 不变
                    }
                    text = protyle.lute.BlockDOM2Content(text);
                } else {
                    text = event.clipboardData.getData("text/plain");
                }
                // 阻止右键复制菜单报错
                setTimeout(function () {
                    document.execCommand("insertText", false, normalizeDocumentTitle(text));
                }, 0);
                this.rename(protyle);
            });
            this.editElement.addEventListener("click", () => {
                protyle.toolbar?.element.classList.add("fn__none");
                if (protyle.block.rootID !== protyle.notebookId) {
                    void this.openEditor().catch(error => console.error(error));
                }
            });
            this.editElement.addEventListener("input", (event: InputEvent) => {
                if (event.isComposing) {
                    this.composing = true;
                    return;
                }
                if (this.editElement.textContent === "") {
                    this.editElement.querySelectorAll("br").forEach(item => {
                        item.remove();
                    });
                }
                this.rename(protyle);
            });
            this.editElement.addEventListener("compositionend", () => {
                this.composing = false;
                this.rename(protyle);
            });
            this.editElement.addEventListener("drop", (event: DragEvent) => {
                // https://ld246.com/article/1661911210429
                event.stopPropagation();
                event.preventDefault();
            });
            this.editElement.addEventListener("keydown", async (event: KeyboardEvent) => {
                if (event.isComposing) {
                    return;
                }

                if (commonHotkey(protyle, event)) {
                    return true;
                }
                if (matchHotKey("⇧⌘V", event)) {
                    event.preventDefault();
                    event.stopPropagation();
                    let textPlain = await readText() || "";
                    if (textPlain) {
                        // 对 <<assets/...>> 进行内部转义 https://github.com/siyuan-note/siyuan/issues/11992
                        textPlain = textPlain.replace(/<<assets\//g, "__@lt2assets/@__").replace(/>>/g, "__@gt2@__");
                        // 对 HTML 标签进行内部转义，避免被 Lute 解析以后变为小写 https://github.com/siyuan-note/siyuan/issues/10620
                        textPlain = textPlain.replace(/</g, ";;;lt;;;").replace(/>/g, ";;;gt;;;");
                        // 反转义 <<assets/...>>
                        textPlain = textPlain.replace(/__@lt2assets\/@__/g, "<<assets/").replace(/__@gt2@__/g, ">>");
                        enableLuteMarkdownSyntax(protyle);
                        let content = protyle.lute.BlockDOM2EscapeMarkerContent(protyle.lute.Md2BlockDOM(textPlain));
                        restoreLuteMarkdownSyntax(protyle);
                        // 移除 ;;;lt;;; 和 ;;;gt;;; 转义及其包裹的内容
                        content = content.replace(/;;;lt;;;[^;]+;;;gt;;;/g, "");
                        document.execCommand("insertText", false, normalizeDocumentTitle(content));
                        this.rename(protyle);
                    }
                    return;
                }
                if (matchHotKey(window.siyuan.config.keymap.general.enterBack, event)) {
                    const parentDocumentID = getParentDocumentID({
                        path: protyle.path,
                        notebookID: protyle.notebookId,
                        rootID: protyle.block.rootID,
                        boxDocEnabled: window.siyuan.config.fileTree.boxDocEnabled,
                    });
                    if (parentDocumentID) {
                        /// #if !MOBILE
                        openFileById({
                            app: protyle.app,
                            id: parentDocumentID,
                            action: [Constants.CB_GET_FOCUS, Constants.CB_GET_SCROLL]
                        });
                        /// #endif
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    return;
                }
                if (electronUndo(event)) {
                    return;
                }
                if (event.key === "ArrowDown") {
                    if (protyle.disabled || event.altKey || event.shiftKey || event.ctrlKey || event.metaKey) {
                        return;
                    }
                    const selection = getSelection();
                    const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : undefined;
                    if (range?.collapsed && isCaretAtVerticalBoundary(this.editElement, range, "down")) {
                        const goalX = prepareVerticalNavigation(protyle.wysiwyg.element, event, range, this.editElement);
                        if (focusFirstVerticalRegion(protyle, goalX) === "moved") {
                            protyle.wysiwyg.preventKeyup = true;
                            scheduleCaretScroll(protyle, "down");
                        }
                        event.preventDefault();
                        event.stopPropagation();
                    }
                } else if (event.key === "Enter") {
                    enterDocumentFromTitle(protyle);
                    event.preventDefault();
                    event.stopPropagation();
                } else if (matchHotKey(window.siyuan.config.keymap.editor.general.attr, event)) {
                    const docInfoParam: BlockQueryRequestInput = {
                        id: protyle.block.rootID
                    };
                    if (isEncryptedBox(protyle.notebookId)) {
                        docInfoParam.notebook = protyle.notebookId;
                    }
                    fetchPost("/api/block/getDocInfo", docInfoParam, (response) => {
                        openFileAttr(response.data.ial, "bookmark", protyle);
                    });
                    event.preventDefault();
                    event.stopPropagation();
                } else if (matchHotKey("⌘A", event)) {
                    getEditorRange(this.editElement).selectNodeContents(this.editElement);
                    event.preventDefault();
                    event.stopPropagation();
                }
            });
            const iconElement = this.element.querySelector(".protyle-title__icon") as HTMLElement;
            iconElement.addEventListener("click", (event) => {
                // 不使用 window.siyuan.shiftIsPressed ，否则窗口未激活时按 Shift 点击块标无法打开属性面板 https://github.com/siyuan-note/siyuan/issues/15075
                if (event.shiftKey) {
                    const docInfoParam: BlockQueryRequestInput = {
                        id: protyle.block.rootID
                    };
                    if (isEncryptedBox(protyle.notebookId)) {
                        docInfoParam.notebook = protyle.notebookId;
                    }
                    fetchPost("/api/block/getDocInfo", docInfoParam, (response) => {
                        openFileAttr(response.data.ial, "bookmark", protyle);
                    });
                } else {
                    const iconRect = iconElement.getBoundingClientRect();
                    openTitleMenu(protyle, {target: iconElement, x: iconRect.left, y: iconRect.bottom, h: iconRect.height}, Constants.MENU_FROM_TITLE_PROTYLE);
                }
            });
            this.element.addEventListener("contextmenu", async (event) => {
                if (event.shiftKey) {
                    return;
                }
                if (iconElement.contains(event.target as Node)) {
                    event.preventDefault();
                    event.stopPropagation();
                    const iconRect = iconElement.getBoundingClientRect();
                    openTitleMenu(protyle, {x: iconRect.left, y: iconRect.bottom, h: iconRect.height}, Constants.MENU_FROM_TITLE_PROTYLE);
                    return;
                }
                if (getSelection().rangeCount === 0) {
                    openTitleMenu(protyle, {x: event.clientX, y: event.clientY}, Constants.MENU_FROM_TITLE_PROTYLE);
                    return;
                }
                event.stopPropagation();
                /// #if BROWSER
                event.preventDefault();
                /// #endif
                const spellcheckContext = await requestSpellcheckContext(event.clientX, event.clientY);
                if (spellcheckContext === null) {
                    return;
                }
                protyle.toolbar?.element.classList.add("fn__none");
                window.siyuan.menus.menu.remove();
                const range = getEditorRange(this.editElement);
                if (range.toString() !== "") {
                    window.siyuan.menus.menu.append(new MenuItem({
                        id: "copy",
                        icon: "iconCopy",
                        accelerator: "⌘C",
                        label: window.siyuan.languages.copy,
                        click: () => {
                            focusByRange(getEditorRange(this.editElement));
                            document.execCommand("copy");
                        }
                    }).element);
                    window.siyuan.menus.menu.append(new MenuItem({
                        id: "cut",
                        icon: "iconCut",
                        accelerator: "⌘X",
                        label: window.siyuan.languages.cut,
                        click: () => {
                            focusByRange(getEditorRange(this.editElement));
                            document.execCommand("cut");
                            setTimeout(() => {
                                this.rename(protyle);
                            }, Constants.TIMEOUT_INPUT);
                        }
                    }).element);
                    window.siyuan.menus.menu.append(new MenuItem({
                        id: "delete",
                        icon: "iconTrashcan",
                        accelerator: "⌫",
                        label: window.siyuan.languages.delete,
                        click: () => {
                            const range = getEditorRange(this.editElement);
                            range.extractContents();
                            focusByRange(range);
                            setTimeout(() => {
                                this.rename(protyle);
                            }, Constants.TIMEOUT_INPUT);
                        }
                    }).element);
                }
                window.siyuan.menus.menu.append(new MenuItem({
                    id: "paste",
                    label: window.siyuan.languages.paste,
                    icon: "iconPaste",
                    accelerator: "⌘V",
                    click: async () => {
                        focusByRange(getEditorRange(this.editElement));
                        if (document.queryCommandSupported("paste")) {
                            document.execCommand("paste");
                        } else {
                            try {
                                const text = await readText() || "";
                                document.execCommand("insertText", false, normalizeDocumentTitle(text));
                                this.rename(protyle);
                            } catch (e) {
                                console.log(e);
                            }
                        }
                    }
                }).element);
                window.siyuan.menus.menu.append(new MenuItem({
                    id: "pasteAsPlainText",
                    label: window.siyuan.languages.pasteAsPlainText,
                    accelerator: "⇧⌘V",
                    click: async () => {
                        let textPlain = await readText() || "";
                        textPlain = textPlain.replace(/<<assets\//g, "__@lt2assets/@__").replace(/>>/g, "__@gt2@__");
                        textPlain = textPlain.replace(/</g, ";;;lt;;;").replace(/>/g, ";;;gt;;;");
                        textPlain = textPlain.replace(/__@lt2assets\/@__/g, "<<assets/").replace(/__@gt2@__/g, ">>");
                        enableLuteMarkdownSyntax(protyle);
                        let content = protyle.lute.BlockDOM2EscapeMarkerContent(protyle.lute.Md2BlockDOM(textPlain));
                        restoreLuteMarkdownSyntax(protyle);
                        // 移除 ;;;lt;;; 和 ;;;gt;;; 转义及其包裹的内容
                        content = content.replace(/;;;lt;;;[^;]+;;;gt;;;/g, "");
                        document.execCommand("insertText", false, normalizeDocumentTitle(content));
                        this.rename(protyle);
                    }
                }).element);
                window.siyuan.menus.menu.append(new MenuItem({
                    id: "selectAll",
                    label: window.siyuan.languages.selectAll,
                    icon: "iconSelectAll",
                    accelerator: "⌘A",
                    click: () => {
                        range.selectNodeContents(this.editElement);
                        focusByRange(range);
                    }
                }).element);
                addSpellcheckMenuItems(spellcheckContext);
                window.siyuan.menus.menu.popup({x: event.clientX, y: event.clientY});
            });
        }
        this.element.querySelector(".protyle-attr").addEventListener("click", (event: MouseEvent & {
            target: HTMLElement
        }) => {
            /// #if MOBILE
            if (event.target.closest(".protyle-attr--refcount") && commonClick(event, protyle)) {
                return;
            }
            /// #endif
            const docInfoParam: BlockQueryRequestInput = {
                id: protyle.block.rootID
            };
            if (isEncryptedBox(protyle.notebookId)) {
                docInfoParam.notebook = protyle.notebookId;
            }
            fetchPost("/api/block/getDocInfo", docInfoParam, (response) => {
                commonClick(event, protyle, response.data.ial);
            });
        });
    }

    private rename(protyle: IProtyle) {
        if (this.needsSourceEditor()) {
            return false;
        }
        clearTimeout(this.timeout);
        this.pendingRename = undefined;
        if (!validateName(this.editElement.textContent, this.editElement)) {
            const original = this.editElement.textContent;
            // 字数过长会导致滚动
            const offset = getSelectionOffset(this.editElement);
            this.setTitle(truncateDocumentTitle(this.editElement.textContent));
            focusByOffset(this.editElement, offset.start, offset.end);
            if (this.editElement.textContent === original ||
                !validateName(this.editElement.textContent, this.editElement)) {
                return false;
            }
        }
        hideTooltip();
        this.pendingRename = () => {
            this.pendingRename = undefined;
            this.timeout = undefined;
            const fileName = normalizeDocumentTitle(this.editElement.textContent);
            fetchPost("/api/filetree/renameDoc", {
                notebook: protyle.notebookId,
                path: protyle.path,
                title: fileName,
            });
            if (fileName !== this.editElement.textContent) {
                const offset = getSelectionOffset(this.editElement);
                this.setTitle(fileName);
                focusByOffset(this.editElement, offset.start, offset.end);
            }
        };
        this.timeout = window.setTimeout(this.pendingRename, Constants.TIMEOUT_INPUT);
    }

    public flushPendingInput() {
        if (this.richEditor) {
            return this.richEditor.flush();
        }
        if (this.composing) {
            this.rename(this.protyle);
        }
        const rename = this.pendingRename;
        this.cancelPendingInput();
        rename?.();
    }

    public cancelPendingInput() {
        clearTimeout(this.timeout);
        this.timeout = undefined;
        this.pendingRename = undefined;
        this.composing = false;
    }

    public setTitle(title: string, empty = false) {
        this.summary = empty ? "" : title;
        if (this.richEditor) {
            this.setSummary(title, empty);
            void this.richEditor.refresh().catch(error => console.error(error));
            return;
        }
        /// #if MOBILE
        if (this.editElement) {
            if (nbsp2space(title) !== nbsp2space(this.editElement.textContent)) {
                this.editElement.textContent = empty ? "" : title;
            }
        } else {
            const inputElement = document.getElementById("toolbarName") as HTMLInputElement;
            if (nbsp2space(title) !== nbsp2space(inputElement.value)) {
                inputElement.value = empty ? "" : title;
            }
            document.getElementById("toolbarNameReadonly").textContent = inputElement.value;
        }
        /// #else
        if (nbsp2space(title) !== nbsp2space(this.editElement.textContent)) {
            this.editElement.textContent = empty ? "" : title;
        }
        /// #endif
        if (this.element && this.element.dataset.nodeId === this.protyle.block?.rootID) {
            void this.loadSource().catch(error => console.error(error));
        }
    }

    private setSummary(title: string, empty: boolean) {
        this.summary = empty ? "" : title;
        if (this.protyle.model?.parent) {
            this.protyle.model.parent.updateTitle(getDocDisplayName(title, empty));
        }
        /// #if MOBILE
        if (window.siyuan.mobile.editor?.protyle === this.protyle) {
            const input = document.getElementById("toolbarName") as HTMLInputElement;
            input.value = empty ? "" : title;
            document.getElementById("toolbarNameReadonly").textContent = input.value;
        }
        /// #endif
    }

    public getText() {
        return this.richEditor ? this.summary : this.editElement?.textContent || this.summary;
    }

    public isUploading() {
        return this.richEditor?.fragment.protyle.upload?.isUploading || false;
    }

    public prepareForDocumentSwitch(rootID: string) {
        const editor = this.richEditor;
        if (!editor || !rootID || rootID === this.element.dataset.nodeId) {
            return;
        }
        return (async () => {
            await editor.flush();
            await this.protyle.wysiwyg.flushPendingInput();
            await waitForPendingTransactions(this.protyle);
            if (this.destroyed || this.richEditor !== editor) {
                throw new Error(window.siyuan.languages.settingsPendingSaveError);
            }
            // 正文事务排空期间仍可继续输入，交接前再次确认标题源。
            await editor.flush();
        })();
    }

    private async loadSource() {
        const id = this.protyle.block.rootID;
        if (this.richEditor || !id || id === this.protyle.notebookId || !this.editElement ||
            this.destroyed) {
            return;
        }
        if (this.sourceLoading) {
            return this.sourceLoading;
        }
        const request = ++this.sourceRequest;
        // 完整源到达之前禁止旧纯文本监听器保存，避免覆盖尚未读取的行级内容。
        this.editElement.contentEditable = "false";
        this.sourceLoading = (async () => {
            const response = await fetchSyncPost("/api/block/getDocTitle", {id, notebook: this.protyle.notebookId});
            if (response.code !== 0 || !response.data || request !== this.sourceRequest || this.destroyed ||
                this.protyle.block.rootID !== id) {
                return;
            }
            this.cancelPendingInput();
            const host = document.createElement("div");
            this.plainEditElement = this.editElement;
            const selection = getSelection();
            const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
            const offsets = range && this.editElement.contains(range.commonAncestorContainer) ?
                getSelectionOffset(this.editElement, undefined, range) : undefined;
            this.editElement.replaceWith(host);
            this.richEditor = new DocumentTitleEditor(this.protyle, host, response.data,
                element => {
                    this.editElement = element;
                    setTitleAutoDirection(element, window.siyuan.config.editor.autoDirection);
                }, (text, empty) => this.setSummary(text, empty));
            this.setSummary(response.data.text, response.data.empty);
            if (offsets) {
                focusByOffset(this.editElement, offsets.start, offsets.end);
            }
        })();
        try {
            await this.sourceLoading;
        } finally {
            if (request === this.sourceRequest) {
                this.sourceLoading = undefined;
            }
        }
    }

    public async refresh() {
        if (this.richEditor) {
            return this.richEditor.refresh();
        }
        return this.loadSource();
    }

    public setReadonly(readonly: boolean) {
        if (this.richEditor) {
            this.richEditor.setReadonly(readonly);
            return;
        }
        if (this.editElement) {
            this.editElement.setAttribute("contenteditable", String(!readonly && !this.needsSourceEditor()));
            this.editElement.style.userSelect = readonly ? "text" : "";
        }
    }

    private needsSourceEditor() {
        return !this.richEditor && !!this.protyle.block?.rootID && this.protyle.block.rootID !== this.protyle.notebookId;
    }

    public async openEditor(isValid?: () => boolean) {
        const id = this.protyle.block.rootID;
        const notebook = this.protyle.notebookId;
        let sourceRequest = this.sourceRequest;
        const canOpen = () => !this.destroyed && !this.protyle.disabled && !window.siyuan.isPublish &&
            !window.siyuan.config.readonly && !this.protyle.options.history?.created &&
            !this.protyle.options.history?.snapshot && this.protyle.element.isConnected &&
            this.protyle.block.rootID === id && this.protyle.notebookId === notebook &&
            this.sourceRequest === sourceRequest && (!isValid || isValid());
        if (!canOpen()) {
            return;
        }
        if (!this.editElement) {
            const {openDocumentTitleDialog} = await import("./documentTitleDialog");
            if (canOpen()) {
                openDocumentTitleDialog({id, notebook, app: this.protyle.app});
            }
            return;
        }
        const loading = this.loadSource();
        sourceRequest = this.sourceRequest;
        await loading;
        if (canOpen()) {
            this.richEditor?.focus();
        }
    }

    public destroy() {
        this.destroyed = true;
        this.sourceRequest++;
        this.cancelPendingInput();
        this.richEditor?.destroy();
        this.richEditor = undefined;
    }

    public render(protyle: IProtyle, response: IWebSocketData) {
        if (this.element.dataset.nodeId && this.element.dataset.nodeId !== protyle.block.rootID) {
            this.sourceRequest++;
            this.sourceLoading = undefined;
            if (this.richEditor) {
                const host = this.richEditor.fragment.protyle.element;
                this.richEditor.destroy();
                this.richEditor = undefined;
                host.replaceWith(this.plainEditElement);
                this.editElement = this.plainEditElement;
                this.plainEditElement = undefined;
            }
        }
        if (protyle.options.render.hideTitleOnZoom) {
            if (protyle.block.showAll) {
                this.element.classList.add("fn__none");
            } else {
                this.element.classList.remove("fn__none");
            }
        }
        if (this.element.getAttribute("data-render") === "true" && this.element.dataset.nodeId === protyle.block.rootID) {
            return false;
        }
        this.element.setAttribute("data-node-id", protyle.block.rootID);
        if (response.data.ial[Constants.CUSTOM_RIFF_DECKS]) {
            this.element.setAttribute(Constants.CUSTOM_RIFF_DECKS, response.data.ial[Constants.CUSTOM_RIFF_DECKS]);
        }
        protyle.background?.render(response.data.ial, protyle.block.rootID);
        protyle.wysiwyg.renderCustom(response.data.ial);
        this.element.setAttribute("data-render", "true");
        this.setTitle(response.data.ial.title, response.data.ial[Constants.CUSTOM_SY_TITLE_EMPTY] === "true");
        if (protyle.model?.parent) {
            protyle.model.parent.updateTitle(getDocDisplayName(response.data.name, response.data.ial[Constants.CUSTOM_SY_TITLE_EMPTY] === "true"));
        }
        let nodeAttrHTML = "";
        if (response.data.ial.bookmark) {
            nodeAttrHTML += `<div class="protyle-attr--bookmark">${escapeHtmlTextAndAttr(response.data.ial.bookmark)}</div>`;
        }
        if (response.data.ial.name) {
            nodeAttrHTML += `<div class="protyle-attr--name"><svg><use xlink:href="#iconN"></use></svg>${escapeHtmlTextAndAttr(response.data.ial.name)}</div>`;
        }
        if (response.data.ial.alias) {
            nodeAttrHTML += `<div class="protyle-attr--alias"><svg><use xlink:href="#iconA"></use></svg>${escapeHtmlTextAndAttr(response.data.ial.alias)}</div>`;
        }
        if (response.data.ial.memo) {
            nodeAttrHTML += `<div class="protyle-attr--memo ariaLabel" aria-label="${escapeHtmlTextAndAttr(response.data.ial.memo)}" data-position="north"><svg><use xlink:href="#iconM"></use></svg></div>`;
        }
        if (response.data.ial["custom-avs"]) {
            let avTitle = "";
            response.data.attrViews.forEach((item: { id: string, name: string }) => {
                avTitle += `<span data-av-id="${item.id}" data-popover-url="/api/av/getMirrorDatabaseBlocks" class="popover__block">${escapeHtmlTextAndAttr(item.name)}</span>&nbsp;`;
            });
            if (avTitle) {
                avTitle = avTitle.substring(0, avTitle.length - 6);
            }
            nodeAttrHTML += `<div class="protyle-attr--av"><svg><use xlink:href="#iconDatabase"></use></svg>${avTitle}</div>`;
        }
        this.element.querySelector(":scope > .protyle-attr").innerHTML = nodeAttrHTML;
        if (response.data.refCount !== 0) {
            this.element.querySelector(":scope > .protyle-attr").insertAdjacentHTML("beforeend", `<div class="protyle-attr--refcount popover__block">${response.data.refCount}</div>`);
        }
        // 存在设置新建文档名模板，不能使用 Untitled 进行判断，https://ld246.com/article/1649301009888
        if (this.editElement && Date.now() - dayjs(response.data.id.split("-")[0]).toDate().getTime() < 2000) {
            const range = this.editElement.ownerDocument.createRange();
            range.selectNodeContents(this.editElement);
            focusByRange(range);
        }
    }
}
