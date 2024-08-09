import {Constants} from "../constants";
import {Hint} from "./hint";
import {setLute} from "./render/setLute";
import {Preview} from "./preview";
import {addLoading, initUI, removeLoading} from "./ui/initUI";
import {Undo} from "./undo";
import {Upload} from "./upload";
import {Options} from "./util/Options";
import {destroy} from "./util/destroy";
import {Scroll} from "./scroll";
import {Model} from "../layout/Model";
import {genUUID} from "../util/genID";
import {WYSIWYG} from "./wysiwyg";
import {Toolbar} from "./toolbar";
import {Gutter} from "./gutter";
import {Breadcrumb} from "./breadcrumb";
import {
    onTransaction,
    transaction,
    turnsIntoOneTransaction, turnsIntoTransaction,
    updateBatchTransaction,
    updateTransaction
} from "./wysiwyg/transaction";
import {fetchPost} from "../util/fetch";
/// #if !MOBILE
import {updatePanelByEditor} from "../editor/util";
import {setPanelFocus} from "../layout/util";
/// #endif
import {Title} from "./header/Title";
import {Background} from "./header/Background";
import {onGet, setReadonlyByConfig} from "./util/onGet";
import {reloadProtyle} from "./util/reload";
import {renderBacklink} from "./wysiwyg/renderBacklink";
import {setEmpty} from "../mobile/util/setEmpty";
import {resize} from "./util/resize";
import {getDocByScroll} from "./scroll/saveScroll";
import {App} from "../index";
import {insertHTML} from "./util/insertHTML";
import {avRender} from "./render/av/render";
import {focusBlock, getEditorRange} from "./util/selection";
import {hasClosestBlock} from "./util/hasClosest";
import {setStorageVal} from "./util/compatibility";
import {merge} from "./util/merge";

export class Protyle {

    public readonly version: string;
    public protyle: IProtyle;

    /**
     * @param id 要挂载 Protyle 的元素或者元素 ID。
     * @param options Protyle 参数
     */
    constructor(app: App, id: HTMLElement, options?: IOptions) {
        this.version = Constants.SIYUAN_VERSION;
        let pluginsOptions: IOptions = options;
        app.plugins.forEach(item => {
            if (item.protyleOptions) {
                pluginsOptions = merge(pluginsOptions, item.protyleOptions);
            }
        });
        const getOptions = new Options(pluginsOptions);
        const mergedOptions = getOptions.merge();
        this.protyle = {
            getInstance: () => this,
            app,
            transactionTime: new Date().getTime(),
            id: genUUID(),
            disabled: false,
            updated: false,
            element: id,
            options: mergedOptions,
            block: {},
        };

        this.protyle.hint = new Hint(this.protyle);
        if (mergedOptions.render.breadcrumb) {
            this.protyle.breadcrumb = new Breadcrumb(this.protyle);
        }
        if (mergedOptions.render.title) {
            this.protyle.title = new Title(this.protyle);
        }
        if (mergedOptions.render.background) {
            this.protyle.background = new Background(this.protyle);
        }

        this.protyle.element.innerHTML = "";
        this.protyle.element.classList.add("protyle");
        if (mergedOptions.render.breadcrumb) {
            this.protyle.element.appendChild(this.protyle.breadcrumb.element.parentElement);
        }
        this.protyle.undo = new Undo();
        this.protyle.wysiwyg = new WYSIWYG(this.protyle);
        this.protyle.toolbar = new Toolbar(this.protyle);
        this.protyle.scroll = new Scroll(this.protyle); // 不能使用 render.scroll 来判读是否初始化，除非重构后面用到的相关变量
        if (this.protyle.options.render.gutter) {
            this.protyle.gutter = new Gutter(this.protyle);
        }
        if (mergedOptions.upload.url || mergedOptions.upload.handler) {
            this.protyle.upload = new Upload();
        }

        this.init();
        if (!mergedOptions.action.includes(Constants.CB_GET_HISTORY)) {
            this.protyle.ws = new Model({
                app,
                id: this.protyle.id,
                type: "protyle",
                msgCallback: (data) => {
                    switch (data.cmd) {
                        case "reload":
                            if (data.data === this.protyle.block.rootID) {
                                reloadProtyle(this.protyle, false);
                            }
                            break;
                        case "refreshAttributeView":
                            Array.from(this.protyle.wysiwyg.element.querySelectorAll(`[data-av-id="${data.data.id}"]`)).forEach((item: HTMLElement) => {
                                item.removeAttribute("data-render");
                                avRender(item, this.protyle);
                            });
                            break;
                        case "addLoading":
                            if (data.data === this.protyle.block.rootID) {
                                addLoading(this.protyle, data.msg);
                            }
                            break;
                        case "transactions":
                            data.data[0].doOperations.forEach((item: IOperation) => {
                                if (!this.protyle.preview.element.classList.contains("fn__none") &&
                                    item.action !== "updateAttrs"   // 预览模式下点击只读
                                ) {
                                    this.protyle.preview.render(this.protyle);
                                } else {
                                    onTransaction(this.protyle, item, false);
                                }
                            });
                            break;
                        case "readonly":
                            window.siyuan.config.editor.readOnly = data.data;
                            setReadonlyByConfig(this.protyle, true);
                            break;
                        case "heading2doc":
                        case "li2doc":
                            if (this.protyle.block.rootID === data.data.srcRootBlockID) {
                                if (this.protyle.block.showAll && data.cmd === "heading2doc" && !this.protyle.options.backlinkData) {
                                    fetchPost("/api/filetree/getDoc", {
                                        id: this.protyle.block.rootID,
                                        size: window.siyuan.config.editor.dynamicLoadBlocks,
                                    }, getResponse => {
                                        onGet({data: getResponse, protyle: this.protyle});
                                    });
                                } else {
                                    reloadProtyle(this.protyle, false);
                                }
                                /// #if !MOBILE
                                if (data.cmd === "heading2doc") {
                                    // 文档标题互转后，需更新大纲
                                    updatePanelByEditor({
                                        protyle: this.protyle,
                                        focus: false,
                                        pushBackStack: false,
                                        reload: true,
                                        resize: false
                                    });
                                }
                                /// #endif
                            }
                            break;
                        case "rename":
                            if (this.protyle.path === data.data.path) {
                                if (this.protyle.model) {
                                    this.protyle.model.parent.updateTitle(data.data.title);
                                }
                                if (this.protyle.background) {
                                    this.protyle.background.ial.title = data.data.title;
                                }
                            }
                            if (this.protyle.options.render.title && this.protyle.block.parentID === data.data.id) {
                                if (!document.body.classList.contains("body--blur") && getSelection().rangeCount > 0 &&
                                    this.protyle.title.editElement?.contains(getSelection().getRangeAt(0).startContainer)) {
                                    // 标题编辑中的不用更新 https://github.com/siyuan-note/siyuan/issues/6565
                                } else {
                                    this.protyle.title.setTitle(data.data.title);
                                }
                            }
                            // update ref
                            this.protyle.wysiwyg.element.querySelectorAll(`[data-type~="block-ref"][data-id="${data.data.id}"]`).forEach(item => {
                                if (item.getAttribute("data-subtype") === "d") {
                                    // 同 updateRef 一样处理 https://github.com/siyuan-note/siyuan/issues/10458
                                    item.innerHTML = data.data.refText;
                                }
                            });
                            break;
                        case "moveDoc":
                            if (this.protyle.path === data.data.fromPath) {
                                this.protyle.path = data.data.newPath;
                                this.protyle.notebookId = data.data.toNotebook;
                            }
                            break;
                        case "unmount":
                            if (this.protyle.notebookId === data.data.box) {
                                /// #if MOBILE
                                setEmpty(app);
                                /// #else
                                if (this.protyle.model) {
                                    this.protyle.model.parent.parent.removeTab(this.protyle.model.parent.id, false);
                                }
                                /// #endif
                            }
                            break;
                        case "removeDoc":
                            if (data.data.ids.includes(this.protyle.block.rootID)) {
                                /// #if MOBILE
                                setEmpty(app);
                                /// #else
                                if (this.protyle.model) {
                                    this.protyle.model.parent.parent.removeTab(this.protyle.model.parent.id, false);
                                }
                                /// #endif
                                delete window.siyuan.storage[Constants.LOCAL_FILEPOSITION][this.protyle.block.rootID];
                                setStorageVal(Constants.LOCAL_FILEPOSITION, window.siyuan.storage[Constants.LOCAL_FILEPOSITION]);
                            }
                            break;
                    }
                }
            });
            if (options.backlinkData) {
                this.protyle.block.rootID = options.blockId;
                renderBacklink(this.protyle, options.backlinkData);
                // 为了满足 eventPath0.style.paddingLeft 从而显示块标 https://github.com/siyuan-note/siyuan/issues/11578
                this.protyle.wysiwyg.element.style.paddingLeft = "16px";
                return;
            }
            if (!options.blockId) {
                // 搜索页签需提前初始化
                removeLoading(this.protyle);
                return;
            }

            if (this.protyle.options.mode !== "preview" &&
                options.rootId && window.siyuan.storage[Constants.LOCAL_FILEPOSITION][options.rootId] &&
                (
                    mergedOptions.action.includes(Constants.CB_GET_SCROLL) ||
                    (mergedOptions.action.includes(Constants.CB_GET_ROOTSCROLL) && options.rootId === options.blockId)
                )
            ) {
                getDocByScroll({
                    protyle: this.protyle,
                    scrollAttr: window.siyuan.storage[Constants.LOCAL_FILEPOSITION][options.rootId],
                    mergedOptions,
                    cb: () => {
                        this.afterOnGet(mergedOptions);
                    }
                });
            } else {
                this.getDoc(mergedOptions);
            }
        } else {
            this.protyle.contentElement.classList.add("protyle-content--transition");
        }
    }

    private getDoc(mergedOptions: IOptions) {
        fetchPost("/api/filetree/getDoc", {
            id: mergedOptions.blockId,
            isBacklink: mergedOptions.action.includes(Constants.CB_GET_BACKLINK),
            // 0: 仅当前 ID（默认值），1：向上 2：向下，3：上下都加载，4：加载最后
            mode: (mergedOptions.action && mergedOptions.action.includes(Constants.CB_GET_CONTEXT)) ? 3 : 0,
            size: mergedOptions.action?.includes(Constants.CB_GET_ALL) ? Constants.SIZE_GET_MAX : window.siyuan.config.editor.dynamicLoadBlocks,
        }, getResponse => {
            onGet({
                data: getResponse,
                protyle: this.protyle,
                action: mergedOptions.action,
                afterCB: () => {
                    this.afterOnGet(mergedOptions);
                }
            });
        });
    }

    private afterOnGet(mergedOptions: IOptions) {
        if (this.protyle.model) {
            /// #if !MOBILE
            if (mergedOptions.action?.includes(Constants.CB_GET_FOCUS) || mergedOptions.action?.includes(Constants.CB_GET_OPENNEW)) {
                setPanelFocus(this.protyle.model.element.parentElement.parentElement);
            }
            updatePanelByEditor({
                protyle: this.protyle,
                focus: false,
                pushBackStack: false,
                reload: false,
                resize: false
            });
            /// #endif
        }
        resize(this.protyle);   // 需等待 fullwidth 获取后设定完毕再重新计算 padding 和元素
        // 需等待 getDoc 完成后再执行，否则在无页签的时候 updatePanelByEditor 会执行2次
        // 只能用 focusin，否则点击表格无法执行
        this.protyle.wysiwyg.element.addEventListener("focusin", () => {
            /// #if !MOBILE
            if (this.protyle && this.protyle.model) {
                let needUpdate = true;
                if (this.protyle.model.element.parentElement.parentElement.classList.contains("layout__wnd--active") && this.protyle.model.headElement.classList.contains("item--focus")) {
                    needUpdate = false;
                }
                if (!needUpdate) {
                    return;
                }
                setPanelFocus(this.protyle.model.element.parentElement.parentElement);
                updatePanelByEditor({
                    protyle: this.protyle,
                    focus: false,
                    pushBackStack: false,
                    reload: false,
                    resize: false,
                });
            } else {
                // 悬浮层应移除其余面板高亮，否则按键会被面板监听到
                document.querySelectorAll(".layout__tab--active").forEach(item => {
                    item.classList.remove("layout__tab--active");
                });
                document.querySelectorAll(".layout__wnd--active").forEach(item => {
                    item.classList.remove("layout__wnd--active");
                });
            }
            /// #endif
        });
        // 需等渲染完后再回调，用于定位搜索字段 https://github.com/siyuan-note/siyuan/issues/3171
        if (mergedOptions.after) {
            mergedOptions.after(this);
        }
        this.protyle.contentElement.classList.add("protyle-content--transition");
    }

    private init() {
        this.protyle.lute = setLute({
            emojiSite: this.protyle.options.hint.emojiPath,
            emojis: this.protyle.options.hint.emoji,
            headingAnchor: false,
            listStyle: this.protyle.options.preview.markdown.listStyle,
            paragraphBeginningSpace: this.protyle.options.preview.markdown.paragraphBeginningSpace,
            sanitize: this.protyle.options.preview.markdown.sanitize,
        });

        this.protyle.preview = new Preview(this.protyle);

        initUI(this.protyle);
    }

    /** 聚焦到编辑器 */
    public focus() {
        this.protyle.wysiwyg.element.focus();
    }

    /** 上传是否还在进行中 */
    public isUploading() {
        return this.protyle.upload.isUploading;
    }

    /** 清空 undo & redo 栈 */
    public clearStack() {
        this.protyle.undo.clear();
    }

    /** 销毁编辑器 */
    public destroy() {
        destroy(this.protyle);
    }

    public resize() {
        resize(this.protyle);
    }

    public reload(focus: boolean) {
        reloadProtyle(this.protyle, focus);
    }

    public insert(html: string, isBlock = false, useProtyleRange = false) {
        insertHTML(html, this.protyle, isBlock, useProtyleRange);
    }

    public transaction(doOperations: IOperation[], undoOperations?: IOperation[]) {
        transaction(this.protyle, doOperations, undoOperations);
    }

    /**
     * 多个块转换为一个块
     * @param {TTurnIntoOneSub} [subType] type 为 "BlocksMergeSuperBlock" 时必传
     */
    public turnIntoOneTransaction(selectsElement: Element[], type: TTurnIntoOne, subType?: TTurnIntoOneSub) {
        turnsIntoOneTransaction({
            protyle: this.protyle,
            selectsElement,
            type,
            level: subType
        });
    }

    /**
     * 多个块转换
     * @param {Element} [nodeElement] 优先使用包含 protyle-wysiwyg--select 的块，否则使用 nodeElement 单块
     * @param {number} [subType] type 为 "Blocks2Hs" 时必传
     */
    public turnIntoTransaction(nodeElement: Element, type: TTurnInto, subType?: number) {
        turnsIntoTransaction({
            protyle: this.protyle,
            nodeElement,
            type,
            level: subType,
        });
    }

    public updateTransaction(id: string, newHTML: string, html: string) {
        updateTransaction(this.protyle, id, newHTML, html);
    }

    public updateBatchTransaction(nodeElements: Element[], cb: (e: HTMLElement) => void) {
        updateBatchTransaction(nodeElements, this.protyle, cb);
    }

    public getRange(element: Element) {
        return getEditorRange(element);
    }

    public hasClosestBlock(element: Node) {
        return hasClosestBlock(element);
    }

    public focusBlock(element: Element, toStart = true) {
        return focusBlock(element, undefined, toStart);
    }
}
