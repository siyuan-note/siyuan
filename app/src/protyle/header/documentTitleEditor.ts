import {Constants} from "../../constants";
import {fetchSyncPost} from "../../util/fetch";
import {showMessage} from "../../dialog/message";
import {Dialog} from "../../dialog";
import {escapeHtml} from "../../util/escape";
import {isMobile} from "../../util/functions";
import {hintRef, hintSlash, hintTag} from "../hint/extend";
import {registerBuiltinSlashHint} from "../hint/builtinSlash";
import {mountProtyleLiteFragment, ProtyleLiteFragment} from "../lite/fragmentEditor";
import {setMobileToolbarUndo} from "../lite/mobileToolbar";
import {getDefaultToolbar} from "../toolbar/defaults";
import {getAgentLute} from "../render/setLute";
import {mathRender} from "../render/mathRender";
import {highlightRender} from "../render/highlightRender";
import {renderImageDisplay} from "../render/imageDisplay";
import {queueTransaction} from "../util/transactionQueue";
import {focusByOffset} from "../util/selection";
import {getSelectionOffset} from "../util/selectionOffsets";
import {matchHotKey} from "../util/hotKey";
import {isCaretAtVerticalBoundary} from "../wysiwyg/verticalCaret";
import {focusFirstVerticalRegion, prepareVerticalNavigation} from "../wysiwyg/verticalNavigation";
import {enterDocumentFromTitle} from "./titleEnter";
import {isDocumentTitleBlockHotkey} from "./documentTitleKeys";
import {acknowledgeDocumentTitleReload} from "../util/editorSave";
import {buildBlockDOMClipboardData} from "../util/blockDOMClipboard";
import {writeClipboardData} from "../util/compatibility";
import {prepareExternalClipboardHTML} from "../util/richClipboard";
import {isCommittedTextInput} from "../wysiwyg/compositionInput";
import {getDocumentTitleDOMFingerprint, getDocumentTitleLute, getDocumentTitleUnsupportedPasteBlocks,
    prepareDocumentTitleBlockDOM, prepareDocumentTitleInitialDOM} from "./documentTitleDOM";

export interface DocumentTitleEditorValue {
    id: string;
    notebook: string;
    blockDOM: string;
    revision: string;
    text: string;
    empty: boolean;
}

const INLINE_SLASH_IDS = new Set([
    "ref", "link", "bold", "italic", "underline", "strike", "mark", "sup", "sub",
    "inlineCode", "kbd", "tag", "inlineMath", "emoji",
]);

export class DocumentTitleEditor {
    public readonly fragment: ProtyleLiteFragment;
    private timer: number;
    private composing = false;
    private disposed = false;
    private revision: string;
    private saved: string;
    private saving?: Promise<void>;
    private refreshing?: Promise<void>;
    private refreshVersion = 0;
    private refreshPending = false;
    private applying = false;
    private conflictDialog?: Dialog;
    private updateConflict?: () => Promise<void>;
    private readonly blockID = Lute.NewNodeID();

    constructor(private owner: IProtyle, private host: HTMLElement, initial: DocumentTitleEditorValue,
                private onEditable: (element: HTMLElement) => void,
                private onSummary: (text: string, empty: boolean) => void) {
        this.revision = initial.revision;
        host.classList.add("protyle-title__rich");
        host.dataset.protyleLiteRender = "safe";
        const toolbar = getDefaultToolbar(isMobile()).filter(item =>
            !["block-type", "ai"].includes(typeof item === "string" ? item : item.name));
        const slash = registerBuiltinSlashHint((key: string, protyle: IProtyle, source: THintSource) =>
            hintSlash(key, protyle, source).filter(item => INLINE_SLASH_IDS.has(item.id)));
        const hint: IProtyleOptions["hint"] = {
            extend: [{key: "((", hint: hintRef}, {key: "【【", hint: hintRef}, {key: "（（", hint: hintRef},
                {key: "[[", hint: hintRef}, {key: "#", hint: hintTag}, {key: "/", hint: slash},
                {key: "、", hint: slash}, {key: ":"}],
        };
        const lute = getDocumentTitleLute(getAgentLute({
            emojiSite: "/emojis", emojis: {}, headingAnchor: false, listStyle: false,
            paragraphBeginningSpace: true, sanitize: true,
        }), () => this.fragment?.wysiwyg);
        this.fragment = mountProtyleLiteFragment(host, {
            app: owner.app,
            initialBlockHTML: prepareDocumentTitleInitialDOM(initial.blockDOM, this.blockID),
            placeholder: window.siyuan.languages._kernel[16],
            protyleOptions: {notebookId: owner.notebookId, toolbar, hint,
                click: {preventInsetEmptyBlock: true}},
            runtimeCapabilities: {
                upload: true, websocket: false, pluginExtensions: false, customBlockRender: false,
                lute, lockedOptions: {toolbar, hint}, richHTMLPaste: true,
                sanitizeBlockDOM: prepareDocumentTitleBlockDOM,
                getUnsupportedPasteBlocks: getDocumentTitleUnsupportedPasteBlocks,
                getUnsupportedPasteMessage: () => window.siyuan.languages.documentTitleInlineOnly,
            },
            afterSetContent: (_protyle, element) => {
                mathRender(element);
                highlightRender(element);
                renderImageDisplay(element);
            },
            onChange: () => this.changed(),
            observeAttributes: true,
        });
        this.fragment.protyle.block.rootID = owner.block.rootID;
        this.fragment.protyle.block.parentID = owner.block.rootID;
        this.fragment.protyle.path = owner.path;
        this.saved = this.fingerprint();
        this.updateEditable();
        this.setReadonly(owner.disabled);
        // 标题与正文共享内核撤销栈；临时段落的本地操作不能形成另一套历史。
        this.fragment.protyle.undo = {
            undo: () => this.undo(false), redo: () => this.undo(true), add: () => {}, clear: () => {},
        };
        setMobileToolbarUndo(this.fragment.protyle, owner, redo => void this.undo(redo).catch((): void => {}));
        const events = ["input", "copy", "cut", "paste", "pointerdown", "pointerup", "mousedown", "mouseup",
            "click", "dblclick", "contextmenu", "dragstart", "dragover", "drop", "keyup"];
        events.forEach(type => host.addEventListener(type, event => event.stopPropagation()));
        host.addEventListener("compositionstart", () => {
            clearTimeout(this.timer);
            this.composing = true;
        }, true);
        host.addEventListener("compositionend", () => {
            this.composing = false;
            this.changed();
        }, true);
        host.addEventListener("input", (event: InputEvent) => {
            if (this.composing && isCommittedTextInput(event)) {
                this.composing = false;
                this.changed();
            }
        }, true);
        host.addEventListener("beforeinput", (event: InputEvent) => {
            if (owner.disabled || event.inputType === "historyUndo" || event.inputType === "historyRedo") {
                event.preventDefault();
                event.stopImmediatePropagation();
                if (!owner.disabled) {
                    void this.undo(event.inputType === "historyRedo").catch((): void => {});
                }
            } else if (!event.isComposing && !this.composing && event.inputType === "insertParagraph" &&
                this.fragment.hintElement.classList.contains("fn__none")) {
                event.preventDefault();
                event.stopImmediatePropagation();
                void this.enter().catch((): void => {});
            }
        }, true);
        host.addEventListener("keydown", event => this.keydown(event), true);
        host.addEventListener("focusout", () => {
            if (!this.composing) {
                void this.flush().catch(() => {});
            }
        });
    }

    public get editable() {
        return this.fragment.wysiwyg.querySelector<HTMLElement>('[data-type="NodeParagraph"] > [contenteditable]');
    }

    private updateEditable() {
        const editable = this.editable;
        if (editable) {
            if (!editable.classList.contains("protyle-title__input")) {
                editable.classList.add("protyle-title__input");
            }
            this.onEditable(editable);
        }
    }

    private fingerprint() {
        return getDocumentTitleDOMFingerprint(this.fragment.getBlockHTML());
    }

    private changed() {
        this.updateEditable();
        if (this.disposed || this.applying || this.composing || this.owner.disabled) {
            return;
        }
        clearTimeout(this.timer);
        this.timer = window.setTimeout((): void => { void this.flush().catch((): void => {}); }, Constants.TIMEOUT_INPUT);
    }

    public async flush(acceptedRevision?: string): Promise<void> {
        clearTimeout(this.timer);
        if (this.disposed) {
            return this.saving;
        }
        if (this.owner.disabled) {
            await this.saving;
            if (this.disposed) {
                return;
            }
            // 只读切换不能把尚未确认的草稿当成已保存，普通关闭和导航必须保留恢复机会。
            if (this.composing || this.fragment.protyle.upload?.isUploading || this.fingerprint() !== this.saved) {
                throw new Error(window.siyuan.languages.settingsPendingSaveError);
            }
            return;
        }
        if (this.fragment.protyle.upload?.isUploading) {
            throw new Error(window.siyuan.languages.uploading);
        }
        if (this.composing) {
            this.editable?.blur();
            await Promise.resolve();
            if (this.composing) {
                throw new Error(window.siyuan.languages.settingsPendingSaveError);
            }
        }
        await this.fragment.protyle.wysiwyg.flushPendingInput();
        if (this.disposed) {
            return this.saving;
        }
        if (this.owner.disabled) {
            return this.flush(acceptedRevision);
        }
        if (this.saving) {
            await this.saving;
            return this.flush(acceptedRevision);
        }
        let html: string;
        let fingerprint: string;
        try {
            html = prepareDocumentTitleBlockDOM(this.fragment.getBlockHTML());
            fingerprint = getDocumentTitleDOMFingerprint(html);
        } catch (error) {
            showMessage(window.siyuan.languages.documentTitleInlineOnly);
            throw error;
        }
        if (fingerprint === this.saved && !acceptedRevision) {
            if (this.refreshPending) {
                await this.refresh();
                // 摘要查询期间也可继续输入，交接前必须确认最后一段输入已经持久化。
                if (!this.disposed && (this.composing || this.saving || this.fragment.protyle.upload?.isUploading ||
                    this.fingerprint() !== this.saved)) {
                    return this.flush();
                }
            }
            return;
        }
        const operation: IOperation = {
            action: "setDocTitle", id: this.owner.block.rootID,
            data: {blockDOM: html, expectedRevision: acceptedRevision || this.revision},
        };
        this.saving = queueTransaction(this.owner, async () => {
            if (this.disposed) {
                return;
            }
            const response = await fetchSyncPost("/api/transactions", {
                app: Constants.SIYUAN_APPID, session: this.owner.id, reqId: Date.now(),
                transactions: [{doOperations: [operation]}],
            });
            if (this.disposed) {
                return;
            }
            const result = response.code === 0 && Array.isArray(response.data) ?
                response.data[0]?.doOperations?.find(item => item.action === "setDocTitle" && item.id === operation.id) : undefined;
            if (!result || typeof result.retData !== "string") {
                if (response.code === -409) {
                    this.showConflict();
                }
                throw new Error(response.msg || window.siyuan.languages.settingsPendingSaveError);
            }
            const sourceChanged = this.revision !== result.retData;
            this.revision = result.retData;
            this.saved = fingerprint;
            if (sourceChanged) {
                this.owner.updated = true;
                this.owner.undo.add([operation], [], this.owner);
            }
            this.refreshPending = true;
        });
        try {
            await this.saving;
        } finally {
            this.saving = undefined;
        }
        if (!this.disposed) {
            await this.flush();
        }
    }

    public async refresh() {
        const request = ++this.refreshVersion;
        this.refreshPending = true;
        if (this.disposed || this.composing || this.saving || this.fingerprint() !== this.saved) {
            return;
        }
        if (this.refreshing) {
            return this.refreshing;
        }
        this.refreshing = (async () => {
            const response = await fetchSyncPost("/api/block/getDocTitle", {
                id: this.owner.block.rootID, notebook: this.owner.notebookId,
            });
            if (response.code !== 0 || !response.data) {
                return;
            }
            if (this.disposed || this.composing || this.saving || this.fingerprint() !== this.saved || request !== this.refreshVersion) {
                return;
            }
            if (response.data.revision === this.revision) {
                // 自己的保存回执只更新摘要，不能把正在输入的半段语法变成已有的字面文字。
                this.refreshPending = false;
                this.onSummary(response.data.text, response.data.empty);
                this.refreshDynamicAnchors(response.data.blockDOM);
            } else {
                this.applyValue(response.data);
            }
        })();
        try {
            await this.refreshing;
        } finally {
            this.refreshing = undefined;
        }
        if (request !== this.refreshVersion && !this.disposed) {
            await this.refresh();
        }
    }

    private applyValue(value: DocumentTitleEditorValue) {
        const selection = getSelection();
        const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
        const offsets = range && this.editable?.contains(range.commonAncestorContainer) ?
            getSelectionOffset(this.editable, undefined, range) : undefined;
        this.applying = true;
        try {
            this.fragment.setBlockHTML(prepareDocumentTitleInitialDOM(value.blockDOM, this.blockID));
            this.updateEditable();
            this.revision = value.revision;
            this.saved = this.fingerprint();
            this.refreshPending = false;
            this.onSummary(value.text, value.empty);
            this.setReadonly(this.owner.disabled);
            if (offsets && this.editable) {
                focusByOffset(this.editable, offsets.start, offsets.end);
            }
        } finally {
            this.applying = false;
        }
    }

    private refreshDynamicAnchors(blockDOM: string) {
        const template = document.createElement("template");
        template.innerHTML = blockDOM;
        const selector = '[data-type~="block-ref"][data-subtype="d"]';
        const labels = new Map(Array.from(template.content.querySelectorAll<HTMLElement>(selector),
            element => [element.dataset.id, element.textContent]));
        this.fragment.wysiwyg.querySelectorAll<HTMLElement>(selector).forEach(element => {
            const label = labels.get(element.dataset.id);
            if (label !== undefined && element.textContent !== label) {
                element.textContent = label;
            }
        });
        this.saved = this.fingerprint();
    }

    private showConflict() {
        if (this.disposed) {
            return;
        }
        if (this.conflictDialog) {
            void this.updateConflict?.().catch(error => console.error(error));
            return;
        }
        const dialog = new Dialog({
            title: window.siyuan.languages.rename,
            content: `<div class="b3-dialog__content">${escapeHtml(window.siyuan.languages.documentTitleConflict)}
<div class="fn__hr"></div><div class="ft__secondary">${escapeHtml(window.siyuan.languages.documentTitleLatest)}</div>
<div class="b3-typography document-title-conflict__preview" data-type="latest"></div></div>
<div class="b3-dialog__action"><button class="b3-button b3-button--cancel" data-type="cancel">${escapeHtml(window.siyuan.languages.cancel)}</button>
<div class="fn__space"></div><button class="b3-button b3-button--text" data-type="reload">${escapeHtml(window.siyuan.languages.documentTitleCopyReload)}</button>
<div class="fn__space"></div><button class="b3-button b3-button--text" data-type="local" disabled>${escapeHtml(window.siyuan.languages.documentTitleKeepLocal)}</button></div>`,
            destroyCallback: () => { this.conflictDialog = undefined; this.updateConflict = undefined; },
        });
        this.conflictDialog = dialog;
        const local = dialog.element.querySelector<HTMLButtonElement>('[data-type="local"]');
        const preview = dialog.element.querySelector<HTMLElement>('[data-type="latest"]');
        let displayed: DocumentTitleEditorValue;
        this.updateConflict = async () => {
            local.disabled = true;
            const response = await fetchSyncPost("/api/block/getDocTitle", {id: this.owner.block.rootID, notebook: this.owner.notebookId});
            if (response.code !== 0 || !response.data || this.disposed || this.conflictDialog !== dialog) return;
            displayed = response.data;
            preview.innerHTML = displayed.blockDOM;
            preview.querySelectorAll("[contenteditable]").forEach(element => element.setAttribute("contenteditable", "false"));
            mathRender(preview);
            renderImageDisplay(preview);
            local.disabled = this.owner.disabled;
        };
        void this.updateConflict().catch(error => console.error(error));
        local.addEventListener("click", () => {
            if (!displayed || this.owner.disabled) return;
            local.disabled = true;
            // 只使用用户刚看到的版本；若此后又有修改，内核仍会拒绝并重新展示冲突。
            void this.flush(displayed.revision).then(() => dialog.destroy()).catch(error => console.error(error))
                .finally(() => { local.disabled = this.owner.disabled; });
        });
        dialog.element.querySelector('[data-type="cancel"]').addEventListener("click", () => dialog.destroy());
        const reload = dialog.element.querySelector<HTMLButtonElement>('[data-type="reload"]');
        reload.addEventListener("click", () => {
            reload.disabled = true;
            void this.copyDraftAndReload().then(reloaded => {
                if (reloaded) dialog.destroy();
            }).catch(error => console.error(error)).finally(() => { reload.disabled = false; });
        });
    }

    private async copyDraftAndReload() {
        const response = await fetchSyncPost("/api/block/getDocTitle", {id: this.owner.block.rootID, notebook: this.owner.notebookId});
        if (response.code !== 0 || !response.data || this.disposed) {
            return false;
        }
        const html = prepareDocumentTitleBlockDOM(this.fragment.getBlockHTML());
        const data = buildBlockDOMClipboardData(this.fragment.protyle.lute, html);
        const copied = await writeClipboardData({...data, textHTML: prepareExternalClipboardHTML(data.textHTML)},
            {fallbackToPlainText: false});
        if (copied.status !== "rich") {
            showMessage(window.siyuan.languages.clipboardPermissionDenied);
            return false;
        }
        if (this.disposed || getDocumentTitleDOMFingerprint(html) !== this.fingerprint()) {
            return false;
        }
        this.applyValue(response.data);
        acknowledgeDocumentTitleReload(this.owner);
        return true;
    }

    public setReadonly(readonly: boolean) {
        if (readonly) {
            this.fragment.instance.disable();
        } else {
            this.fragment.instance.enable();
        }
    }

    public focus() {
        this.fragment.focus();
    }

    private async undo(redo: boolean) {
        if (this.owner.disabled) {
            return;
        }
        await this.flush();
        await (redo ? this.owner.undo.redo(this.owner) : this.owner.undo.undo(this.owner));
        await this.refresh();
    }

    private async enter() {
        await this.flush();
        if (this.owner.element.classList.contains("document-title-dialog")) {
            this.owner.element.closest(".b3-dialog")?.querySelector<HTMLElement>('[data-type="confirm"]')?.click();
        } else {
            await enterDocumentFromTitle(this.owner);
        }
    }

    private keydown(event: KeyboardEvent) {
        if (event.isComposing || this.composing || this.owner.disabled) {
            return;
        }
        if (matchHotKey("⌘Z", event) || matchHotKey("⇧⌘Z", event) || matchHotKey("⌘Y", event)) {
            event.preventDefault();
            event.stopImmediatePropagation();
            void this.undo(event.shiftKey || event.key.toLowerCase() === "y").catch((): void => {});
            return;
        }
        if (isDocumentTitleBlockHotkey(event) || event.key === "Enter" && (event.ctrlKey || event.metaKey || event.altKey)) {
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }
        if (event.key === "Enter" && event.shiftKey && this.fragment.hintElement.classList.contains("fn__none")) {
            event.preventDefault();
            event.stopImmediatePropagation();
            document.execCommand("insertLineBreak");
            this.changed();
            return;
        }
        if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey &&
            this.fragment.hintElement.classList.contains("fn__none")) {
            event.preventDefault();
            event.stopImmediatePropagation();
            void this.enter().catch((): void => {});
            return;
        }
        if (!this.owner.element.classList.contains("document-title-dialog") &&
            event.key === "ArrowDown" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
            const selection = getSelection();
            const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
            if (range?.collapsed && this.editable && isCaretAtVerticalBoundary(this.editable, range, "down")) {
                const goalX = prepareVerticalNavigation(this.owner.wysiwyg.element, event, range, this.editable);
                if (focusFirstVerticalRegion(this.owner, goalX) === "moved") {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                }
            }
        }
    }

    public destroy() {
        this.disposed = true;
        clearTimeout(this.timer);
        // 笔记本失效时不能让冲突对话框的关闭动画继续展示已解密标题。
        this.conflictDialog?.element.querySelector('[data-type="latest"]')?.replaceChildren();
        this.conflictDialog?.destroy();
        this.fragment.destroy();
        this.fragment.wysiwyg.replaceChildren();
    }
}
