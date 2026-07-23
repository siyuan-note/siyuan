import {Tab} from "../layout/Tab";
import {Protyle} from "../protyle";
import {Model} from "../layout/Model";
import {setPadding} from "../protyle/ui/initUI";
/// #if !BROWSER
import {setModelsHash} from "../window/setHeader";
/// #endif
import {countBlockWord} from "../layout/status";
import {App} from "../index";
import {fullscreen} from "../protyle/breadcrumb/action";
import {fetchPost} from "../util/fetch";
import {Backlink} from "../layout/dock/Backlink";

export class Editor extends Model {
    public element: HTMLElement;
    public editor: Protyle;
    public headElement: HTMLElement;
    public backlink?: Backlink;
    private backlinkElement?: HTMLElement;
    private backlinkIntersectionObserver?: IntersectionObserver;
    private backlinkMutationObserver?: MutationObserver;
    private backlinkEmpty = false;

    constructor(options: {
        app: App,
        tab: Tab,
        blockId: string,
        rootId: string,
        notebookId?: string,
        mode?: TEditorMode,
        action?: TProtyleAction[],
        afterInitProtyle?: (editor: Protyle) => void,
        scrollPosition?: ScrollLogicalPosition
    }) {
        super({
            app: options.app,
        });
        if (window.siyuan.config.fileTree.openFilesUseCurrentTab) {
            options.tab.headElement.classList.add("item--unupdate");
        }
        this.headElement = options.tab.headElement;
        this.element = options.tab.panelElement;
        this.initProtyle(options);
        // 当文档第一次加载到页签时更新 openAt 时间
        fetchPost("/api/storage/updateRecentDocOpenTime", {rootID: options.rootId});
    }

    private initProtyle(options: {
        blockId: string,
        action?: TProtyleAction[]
        rootId: string,
        notebookId?: string,
        mode?: TEditorMode,
        scrollPosition?: ScrollLogicalPosition,
        afterInitProtyle?: (editor: Protyle) => void,
    }) {
        this.editor = new Protyle(this.app, this.element, {
            databaseAttr: true,
            action: options.action || [],
            blockId: options.blockId,
            rootId: options.rootId,
            notebookId: options.notebookId,
            mode: options.mode,
            render: {
                title: true,
                background: true,
                scroll: true,
            },
            typewriterMode: true,
            scrollPosition: options.scrollPosition,
            after: (editor) => {
                if (window.siyuan.editorIsFullscreen) {
                    fullscreen(editor.protyle.element);
                    setPadding(editor.protyle);
                }
                countBlockWord([], editor.protyle.block.rootID);
                /// #if !BROWSER
                setModelsHash();
                /// #endif
                if (options.afterInitProtyle) {
                    options.afterInitProtyle(editor);
                }
                this.updateBacklinkPanel();
            },
        });
        // 需在 after 回调之前，否则不会聚焦 https://github.com/siyuan-note/siyuan/issues/5303
        this.editor.protyle.model = this;
    }

    public updateBacklinkPanel() {
        if (!window.siyuan.config.editor.backlinkShowBottom) {
            this.destroyBacklinkPanel();
            return;
        }
        if (this.backlinkElement) {
            this.updateBacklinkVisibility();
            return;
        }

        const backlinkElement = document.createElement("div");
        backlinkElement.className = "fn__none sy__backlink--bottom sy__backlink--pending";
        this.backlinkElement = backlinkElement;
        this.editor.protyle.wysiwyg.element.after(backlinkElement);
        setPadding(this.editor.protyle);

        this.backlinkIntersectionObserver = new IntersectionObserver((entries) => {
            if (this.backlinkElement !== backlinkElement || !entries[0].isIntersecting ||
                backlinkElement.classList.contains("fn__none")) {
                return;
            }
            if (!this.backlink) {
                this.backlink = new Backlink({
                    app: this.app,
                    blockId: this.getBacklinkBlockId(),
                    rootId: this.editor.protyle.block.rootID,
                    type: "bottom",
                    element: backlinkElement,
                    ownerProtyle: this.editor.protyle,
                    emptyChange: (empty) => {
                        if (this.backlinkElement !== backlinkElement) {
                            return;
                        }
                        const pending = backlinkElement.classList.contains("sy__backlink--pending");
                        if (!pending && this.backlinkEmpty === empty) {
                            return;
                        }
                        const contentElement = this.editor.protyle.contentElement;
                        contentElement.classList.add("protyle-content--backlink-reveal");
                        backlinkElement.classList.remove("sy__backlink--pending");
                        this.backlinkEmpty = empty;
                        this.updateBacklinkVisibility(pending);
                        contentElement.getBoundingClientRect();
                        requestAnimationFrame(() => {
                            contentElement.classList.remove("protyle-content--backlink-reveal");
                        });
                    },
                });
            } else {
                this.backlink.refreshDirty();
            }
        }, {
            root: this.editor.protyle.contentElement,
            rootMargin: "640px 0px",
        });
        this.backlinkIntersectionObserver.observe(backlinkElement);

        this.backlinkMutationObserver = new MutationObserver(() => {
            this.updateBacklinkVisibility();
        });
        this.backlinkMutationObserver.observe(this.editor.protyle.wysiwyg.element, {
            attributes: true,
            attributeFilter: ["data-eof"],
            childList: true,
            subtree: true,
        });
        this.updateBacklinkVisibility();
    }

    public destroy() {
        this.destroyBacklinkPanel();
        this.editor.destroy();
    }

    public getCurrentProtyle(range?: Range) {
        if (range) {
            const backlinkEditor = this.backlink?.editors.find(item => item.protyle.element.contains(range.startContainer));
            if (backlinkEditor) {
                return backlinkEditor.protyle;
            }
        }
        return this.editor.protyle;
    }

    private getBacklinkBlockId() {
        const protyle = this.editor.protyle;
        return protyle.block.showAll ? protyle.block.id : (protyle.block.parentID || protyle.block.rootID);
    }

    private updateBacklinkVisibility(forcePadding = false) {
        if (!this.backlinkElement) {
            return;
        }
        const lastElement = this.editor.protyle.wysiwyg.element.lastElementChild;
        const hidden = this.backlinkEmpty || (!this.editor.protyle.block.showAll && this.editor.protyle.block.scroll &&
            lastElement?.getAttribute("data-eof") !== "2");
        if (this.backlinkElement.classList.contains("fn__none") !== hidden || forcePadding) {
            this.backlinkElement.classList.toggle("fn__none", hidden);
            setPadding(this.editor.protyle);
        }
    }

    private destroyBacklinkPanel() {
        const hasBacklinkElement = !!this.backlinkElement;
        this.backlinkIntersectionObserver?.disconnect();
        this.backlinkMutationObserver?.disconnect();
        this.backlink?.destroy();
        this.backlinkElement?.remove();
        this.backlinkIntersectionObserver = undefined;
        this.backlinkMutationObserver = undefined;
        this.backlink = undefined;
        this.backlinkElement = undefined;
        this.backlinkEmpty = false;
        if (hasBacklinkElement) {
            setPadding(this.editor.protyle);
        }
    }
}
