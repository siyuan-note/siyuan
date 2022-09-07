import {Constants} from "../constants";
import {Hint} from "./hint";
import {setLute} from "./markdown/setLute";
import {Preview} from "./preview";
import {initUI, setPadding} from "./ui/initUI";
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
import {onTransaction} from "./wysiwyg/transaction";
import {fetchPost} from "../util/fetch";
/// #if !MOBILE
import {Title} from "./header/Title";
import {updatePanelByEditor} from "../editor/util";
import {setPanelFocus} from "../layout/util";
/// #endif
import {Background} from "./header/Background";
import {getDisplayName} from "../util/pathName";
import {onGet} from "./util/onGet";
import {reloadProtyle} from "./util/reload";

class Protyle {

    public readonly version: string;
    public protyle: IProtyle;

    /**
     * @param id 要挂载 Protyle 的元素或者元素 ID。
     * @param options Protyle 参数
     */
    constructor(id: HTMLElement, options?: IOptions) {
        this.version = Constants.SIYUAN_VERSION;
        const getOptions = new Options(options);
        const mergedOptions = getOptions.merge();

        this.protyle = {
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
        /// #if !MOBILE
        if (mergedOptions.render.title) {
            this.protyle.title = new Title(this.protyle);
        }
        /// #endif
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
        this.protyle.scroll = new Scroll(this.protyle);
        if (this.protyle.options.render.gutter) {
            this.protyle.gutter = new Gutter(this.protyle);
        }
        if (mergedOptions.upload.url || mergedOptions.upload.handler) {
            this.protyle.upload = new Upload();
        }

        this.init();
        if (!options.action.includes(Constants.CB_GET_HISTORY)) {
            this.protyle.ws = new Model({
                id: this.protyle.id,
                type: "protyle",
                msgCallback: (data) => {
                    switch (data.cmd) {
                        case "transactions":
                            data.data[0].doOperations.forEach((item: IOperation) => {
                                onTransaction(this.protyle, item, false);
                            });
                            break;
                        case "heading2doc":
                        case "li2doc":
                            if (this.protyle.block.rootID === data.data.srcRootBlockID) {
                                if (this.protyle.block.showAll && data.cmd === "heading2doc") {
                                    fetchPost("/api/filetree/getDoc", {
                                        id: this.protyle.block.rootID,
                                        size: Constants.SIZE_GET,
                                    }, getResponse => {
                                        onGet(getResponse, this.protyle);
                                    });
                                } else {
                                    reloadProtyle(this.protyle);
                                }
                                /// #if !MOBILE
                                if (data.cmd === "heading2doc") {
                                    // 文档标题互转后，需更新大纲
                                    updatePanelByEditor(this.protyle, false, false, true);
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
                                if (getSelection().rangeCount > 0 && this.protyle.element.contains(getSelection().getRangeAt(0).startContainer)) {
                                    // 编辑中的不用更新
                                } else {
                                    this.protyle.title.setTitle(data.data.title);
                                }
                            }
                            // update ref
                            this.protyle.wysiwyg.element.querySelectorAll(`[data-type="block-ref"][data-id="${data.data.id}"]`).forEach(item => {
                                if (item.getAttribute("data-subtype") === "d") {
                                    item.textContent = data.data.title;
                                }
                            });
                            break;
                        case "moveDoc":
                            if (data.data.fromNotebook === this.protyle.notebookId && this.protyle.path === data.data.fromPath) {
                                this.protyle.path = data.data.newPath;
                                this.protyle.notebookId = data.data.toNotebook;
                            }
                            break;
                        case "unmount":
                            if (this.protyle.model && this.protyle.notebookId === data.data.box) {
                                this.protyle.model.parent.parent.removeTab(this.protyle.model.parent.id, false, false);
                            }
                            break;
                        case "remove":
                            if (this.protyle.model && (this.protyle.notebookId === data.data.box &&
                                (!data.data.path || this.protyle.path.indexOf(getDisplayName(data.data.path, false, true)) === 0))) {
                                this.protyle.model.parent.parent.removeTab(this.protyle.model.parent.id, false, false);
                            }
                            break;
                    }
                }
            });
            fetchPost("/api/filetree/getDoc", {
                id: options.blockId,
                k: options.key || "",
                mode: (options.action && options.action.includes(Constants.CB_GET_CONTEXT)) ? 3 : 0, // 0: 仅当前 ID（默认值），1：向上 2：向下，3：上下都加载，4：加载最后
                size: options.action?.includes(Constants.CB_GET_ALL) ? Constants.SIZE_GET_MAX : Constants.SIZE_GET,
            }, getResponse => {
                onGet(getResponse, this.protyle, options.action, options.scrollAttr);
                if (this.protyle.model) {
                    /// #if !MOBILE
                    if (options.action?.includes(Constants.CB_GET_FOCUS)) {
                        setPanelFocus(this.protyle.model.element.parentElement.parentElement);
                    }
                    updatePanelByEditor(this.protyle, false);
                    /// #endif
                }

                // 需等待 getDoc 完成后再执行，否则在无页签的时候 updatePanelByEditor 会执行2次
                // 只能用 focusin，否则点击表格无法执行
                /// #if !MOBILE
                this.protyle.wysiwyg.element.addEventListener("focusin", () => {
                    if (this.protyle && this.protyle.model) {
                        let needUpdate = true;
                        if (this.protyle.model.element.parentElement.parentElement.classList.contains("layout__wnd--active") && this.protyle.model.headElement.classList.contains("item--focus")) {
                            needUpdate = false;
                        }
                        if (!needUpdate) {
                            return;
                        }
                        setPanelFocus(this.protyle.model.element.parentElement.parentElement);
                        updatePanelByEditor(this.protyle, false);
                    } else {
                        // 悬浮层应移除其余面板高亮，否则按键会被面板监听到
                        document.querySelectorAll(".block__icons--active").forEach(item => {
                            item.classList.remove("block__icons--active");
                        });
                        document.querySelectorAll(".layout__wnd--active").forEach(item => {
                            item.classList.remove("layout__wnd--active");
                        });
                    }
                });
                /// #endif
                // 需等渲染完后再回调，用于定位搜索字段 https://github.com/siyuan-note/siyuan/issues/3171
                if (mergedOptions.after) {
                    mergedOptions.after(this);
                }
            });
            setPadding(this.protyle);
        }
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
}

export default Protyle;
