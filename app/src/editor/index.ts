import {Tab} from "../layout/Tab";
import {Protyle} from "../protyle";
import {Model} from "../layout/Model";
/// #if !BROWSER
import {setModelsHash} from "../window/setHeader";
/// #endif
import {countBlockWord} from "../layout/status";
import type {App} from "../index";
import {fetchPost} from "../util/fetch";
import {BottomBacklinkPanel} from "../layout/dock/BottomBacklinkPanel";
import type {IDatabaseRowOpenData} from "../protyle/render/av/openDatabaseRow";

export class Editor extends Model {
    public element: HTMLElement;
    public editor: Protyle;
    public headElement: HTMLElement;
    public databaseRow?: IDatabaseRowOpenData;
    private bottomBacklinkPanel?: BottomBacklinkPanel;

    public get backlink() {
        return this.bottomBacklinkPanel?.backlink;
    }

    constructor(options: {
        app: App,
        tab: Tab,
        blockId: string,
        rootId: string,
        notebookId?: string,
        mode?: TEditorMode,
        action?: TProtyleAction[],
        afterInitProtyle?: (editor: Protyle) => void,
        scrollPosition?: ScrollLogicalPosition,
        scrollAttr?: IScrollAttr,
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
        scrollAttr?: IScrollAttr,
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
            scrollAttr: options.scrollAttr,
            after: (editor) => {
                if (window.siyuan.editorIsFullscreen) {
                    editor.setFullscreen(true);
                }
                countBlockWord([], editor.protyle);
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

    public updateBacklinkPanel(reset = false) {
        this.bottomBacklinkPanel ??= new BottomBacklinkPanel(this.editor.protyle);
        this.bottomBacklinkPanel.update(reset);
    }

    public refreshBottomBacklinkPanel() {
        this.bottomBacklinkPanel?.refresh();
    }

    public destroy() {
        this.bottomBacklinkPanel?.destroy();
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
}
