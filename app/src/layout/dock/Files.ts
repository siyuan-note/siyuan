import {escapeAriaLabel, escapeHtml, escapeLessThans} from "../../util/escape";
import {Tab} from "../Tab";
import {Model} from "../Model";
import {setPanelFocus} from "../util";
import {getDockByType} from "../tabUtil";
import {Constants} from "../../constants";
import {getDocDisplayName, pathPosix, setNoteBook} from "../../util/pathName";
import {newFileInTree} from "../../util/newFile";
import {initFileMenu, initNavigationMenu, sortMenu} from "../../menus/navigation";
import {MenuItem} from "../../menus/Menu";
import {showMessage} from "../../dialog/message";
import {
    getPublishAccessLevel,
    getPublishAccessOptionByLevel,
    openPublishAccessDialog
} from "../../protyle/util/publishAccess";
import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {openEmojiPanel, unicode2Emoji} from "../../emoji";
import {newEncryptedNotebook, newNotebook, openEncryptedNotebook} from "../../util/mount";
import {isNotCtrl, isOnlyMeta, setStorageVal, updateHotkeyAfterTip} from "../../protyle/util/compatibility";
import {openFileById} from "../../editor/util";
import {
    hasClosestByAttribute,
    hasClosestByClassName,
    hasClosestByTag,
    hasTopClosestByTag
} from "../../protyle/util/hasClosest";
import {App} from "../../index";
import {refreshFileTree} from "../../dialog/processSystem";
/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif
import {hideTooltip, showTooltip} from "../../dialog/tooltip";
import {selectOpenTab} from "./util";
import {hideDragTip, showDragTip, transparentImgSrc} from "../../protyle/util/dragTip";
import {
    cancelFileTreeCollapse,
    collapseFileTree,
    expandFileTree,
    isFileTreeCollapsing
} from "./fileTreeAnimation";

export class Files extends Model {
    public element: HTMLElement;
    public parent: Tab;
    public closeElement: HTMLElement;
    public lastSelectedElement: Element = null;
    private actionsElement: HTMLElement;
    private reloadNotebookInfoTimeout: number;

    constructor(options: { tab: Tab, app: App }) {
        super({app: options.app});
        this.connect({
            type: "filetree",
            id: options.tab.id,
            msgCallback: this.handleMsgCallback.bind(this)
        });
        options.tab.panelElement.classList.add("fn__flex-column", "file-tree", "sy__file", "dockPanel");
        options.tab.panelElement.innerHTML = `<div class="block__icons">
    <div class="block__logo fn__flex-1">${window.siyuan.languages.fileTree}</div>
    <span data-type="focus" class="block__icon ariaLabel" data-position="north" aria-label="${window.siyuan.languages.selectOpen1}${updateHotkeyAfterTip(window.siyuan.config.keymap.general.selectOpen1.custom)}"><svg><use xlink:href='#iconFocus'></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="collapse" class="block__icon ariaLabel" data-position="north" aria-label="${window.siyuan.languages.collapse}${updateHotkeyAfterTip(window.siyuan.config.keymap.editor.general.collapse.custom)}">
        <svg><use xlink:href="#iconContract"></use></svg>
    </span>
    <div class="fn__space${window.siyuan.config.readonly ? " fn__none" : ""}"></div>
    <div data-type="more" class="ariaLabel block__icon${window.siyuan.config.readonly ? " fn__none" : ""}" data-position="north" aria-label="${window.siyuan.languages.more}">
        <svg><use xlink:href="#iconMore"></use></svg>
    </div> 
    <span class="fn__space"></span>
    <span data-type="min" class="block__icon ariaLabel" data-position="north" aria-label="${window.siyuan.languages.min}${updateHotkeyAfterTip(window.siyuan.config.keymap.general.closeTab.custom)}"><svg><use xlink:href='#iconMin'></use></svg></span>
</div>
<div class="fn__flex-1" style="padding-top: 2px;"></div>
<ul class="b3-list fn__flex-column" style="min-height: auto;height:30px;transition: height  .2s cubic-bezier(0, 0, .2, 1) 0ms">
    <li class="b3-list-item" data-type="toggle">
        <span class="b3-list-item__toggle">
            <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
        </span>
        <span class="b3-list-item__text">${window.siyuan.languages.closeNotebook}</span>
        <span class="counter" style="cursor: auto"></span>
    </li>
    <ul class="fn__none fn__flex-1"></ul>
</ul>`;
        this.actionsElement = options.tab.panelElement.firstElementChild as HTMLElement;
        this.element = this.actionsElement.nextElementSibling as HTMLElement;
        this.closeElement = options.tab.panelElement.lastElementChild as HTMLElement;
        this.closeElement.addEventListener("click", (event) => {
            setPanelFocus(this.element.parentElement);
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(this.closeElement)) {
                const type = target.getAttribute("data-type");
                if (target.classList.contains("b3-list-item__icon")) {
                    event.preventDefault();
                    event.stopPropagation();
                    const rect = target.getBoundingClientRect();
                    openEmojiPanel(target.parentElement.getAttribute("data-url"), "notebook", {
                        x: rect.left,
                        y: rect.bottom,
                        h: rect.height,
                        w: rect.width,
                    }, undefined, target.querySelector("img"));
                    break;
                } else if (type === "toggle") {
                    const svgElement = target.querySelector("svg");
                    if (svgElement.classList.contains("b3-list-item__arrow--open")) {
                        this.closeElement.style.height = "30px";
                        svgElement.classList.remove("b3-list-item__arrow--open");
                        this.closeElement.lastElementChild.classList.add("fn__none");
                    } else {
                        this.closeElement.style.height = "40%";
                        svgElement.classList.add("b3-list-item__arrow--open");
                        this.closeElement.lastElementChild.classList.remove("fn__none");
                    }
                    window.siyuan.menus.menu.remove();
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (type === "open") {
                    const notebookId = target.getAttribute("data-url");
                    const liElement = target.closest("li");
                    // 加密笔记本关闭（锁定）时点"打开"先弹解锁框，解锁成功后再挂载
                    if (liElement && liElement.getAttribute("data-encrypted") === "true") {
                        openEncryptedNotebook(this.app, notebookId, liElement.querySelector(".b3-list-item__text").textContent);
                    } else {
                        fetchPost("/api/notebook/openNotebook", {
                            notebook: notebookId
                        });
                    }
                    window.siyuan.menus.menu.remove();
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                }
                target = target.parentElement;
            }
        });
        // 为了快捷键的 dispatch
        this.actionsElement.querySelector('[data-type="collapse"]').addEventListener("click", () => {
            Array.from(this.element.children).forEach(item => {
                const liElement = item.firstElementChild;
                const toggleElement = liElement.querySelector(".b3-list-item__arrow");
                if (toggleElement.classList.contains("b3-list-item__arrow--open")) {
                    toggleElement.classList.remove("b3-list-item__arrow--open");
                    liElement.nextElementSibling.remove();
                }
            });
            window.siyuan.storage[Constants.LOCAL_FILESPATHS] = [];
            setStorageVal(Constants.LOCAL_FILESPATHS, []);
        });
        this.actionsElement.addEventListener("click", (event: MouseEvent & { target: HTMLElement }) => {
            let target = event.target as HTMLElement;
            let isFocus = true;
            while (target && !target.isEqualNode(this.actionsElement)) {
                const type = target.getAttribute("data-type");
                if (type === "min") {
                    getDockByType("file").toggleModel("file", false, true);
                    event.preventDefault();
                    event.stopPropagation();
                    window.siyuan.menus.menu.remove();
                    isFocus = false;
                    break;
                } else if (type === "focus") {
                    selectOpenTab();
                    event.preventDefault();
                    break;
                } else if (type === "more") {
                    this.initMoreMenu().popup({x: event.clientX, y: event.clientY});
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                }
                target = target.parentElement;
            }
            if (isFocus) {
                setPanelFocus(this.element.parentElement);
            }
        });
        this.element.addEventListener("mousedown", (event) => {
            // 点击鼠标滚轮关闭
            if (event.button !== 1 || !window.siyuan.config.fileTree.openFilesUseCurrentTab) {
                return;
            }
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(this.element)) {
                if (target.tagName === "LI" && target.getAttribute("data-node-id") && !target.getAttribute("data-opening")) {
                    target.setAttribute("data-opening", "true");
                    openFileById({
                        app: options.app,
                        removeCurrentTab: false,
                        id: target.getAttribute("data-node-id"),
                        action: [Constants.CB_GET_FOCUS, Constants.CB_GET_SCROLL],
                        afterOpen() {
                            target.removeAttribute("data-opening");
                        }
                    });
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                }
                target = target.parentElement;
            }
        });
        this.element.addEventListener("click", (event) => {
            let target = event.target as HTMLElement;
            const ulElement = hasTopClosestByTag(target, "UL");
            let needFocus = true;
            if (ulElement) {
                const notebookId = ulElement.getAttribute("data-url");
                while (target && !target.isEqualNode(this.element)) {
                    if (isNotCtrl(event) && target.classList.contains("b3-list-item__icon") && window.siyuan.config.system.container !== "ios") {
                        event.preventDefault();
                        event.stopPropagation();
                        const liElement = target.parentElement;
                        const isFile = liElement.getAttribute("data-type") === "navigation-file";
                        const isBoxDoc = liElement.getAttribute("data-type") === "navigation-root" && liElement.getAttribute("data-node-id");
                        if ((isFile || isBoxDoc) && window.siyuan.config.fileTree.docIconClickExpand) {
                            if (Number(liElement.getAttribute("data-count")) > 0) {
                                this.getLeaf(liElement, notebookId);
                            } else {
                                needFocus = false;
                                if (!liElement.getAttribute("data-opening")) {
                                    this.lastSelectedElement = liElement;
                                    this.setCurrent(liElement, false);
                                    liElement.setAttribute("data-opening", "true");
                                    openFileById({
                                        app: options.app,
                                        id: liElement.getAttribute("data-node-id"),
                                        action: [Constants.CB_GET_FOCUS, Constants.CB_GET_SCROLL],
                                        afterOpen() {
                                            liElement.removeAttribute("data-opening");
                                        }
                                    });
                                }
                            }
                            break;
                        }
                        const rect = target.getBoundingClientRect();
                        if (isFile) {
                            openEmojiPanel(liElement.getAttribute("data-node-id"), "doc", {
                                x: rect.left,
                                y: rect.bottom,
                                h: rect.height,
                                w: rect.width,
                            }, undefined, target.querySelector("img"));
                        } else {
                            openEmojiPanel(target.parentElement.parentElement.getAttribute("data-url"), "notebook", {
                                x: rect.left,
                                y: rect.bottom,
                                h: rect.height,
                                w: rect.width,
                            }, undefined, target.querySelector("img"));
                        }
                        break;
                    } else if (isNotCtrl(event) && target.classList.contains("b3-list-item__toggle")) {
                        const liElement = target.parentElement;
                        if (liElement.querySelector(".b3-list-item__arrow--open")) {
                            collapseFileTree(liElement, () => this.getOpenPaths());
                        } else if (!isFileTreeCollapsing(liElement)) {
                            this.getLeaf(liElement, notebookId);
                        }
                        event.preventDefault();
                        event.stopPropagation();
                        window.siyuan.menus.menu.remove();
                        break;
                    } else if (target.classList.contains("b3-list-item__switch")) {
                        event.preventDefault();
                        event.stopPropagation();
                        const rect = target.getBoundingClientRect();
                        openPublishAccessDialog(target.parentElement.getAttribute("data-type") === "navigation-root" ?
                            notebookId : target.parentElement.getAttribute("data-node-id"), {
                            x: rect.left,
                            y: rect.bottom,
                            h: rect.height,
                            w: rect.width,
                        }, (access) => {
                            target.innerHTML = access.iconHTML;
                            fetchPost("/api/filetree/setPublishAccess", {
                                id: access.id,
                                visible: access.visible,
                                password: access.password,
                                disable: access.disable,
                            });
                        });
                        break;
                    } else if (isNotCtrl(event) && target.classList.contains("b3-list-item__action")) {
                        const type = target.getAttribute("data-type");
                        const pathString = target.parentElement.getAttribute("data-path");
                        if (!window.siyuan.config.readonly) {
                            if (type === "new") {
                                newFileInTree(options.app, notebookId, pathString);
                            } else if (type === "more-root") {
                                initNavigationMenu(options.app, target.parentElement).popup({
                                    x: event.clientX,
                                    y: event.clientY
                                });
                            }
                        }
                        if (type === "more-file") {
                            initFileMenu(options.app, notebookId, pathString, target.parentElement).popup({
                                x: event.clientX,
                                y: event.clientY
                            });
                        }
                        event.preventDefault();
                        event.stopPropagation();
                        break;
                    } else if (event.button === 0 && isNotCtrl(event) && !event.altKey && !event.shiftKey &&
                        target.classList.contains("b3-list-item__text") &&
                        (target.parentElement.getAttribute("data-type") === "navigation-file" ||
                            (target.parentElement.getAttribute("data-type") === "navigation-root" && target.parentElement.getAttribute("data-node-id"))) &&
                        window.siyuan.config.fileTree.parentDocClickExpand &&
                        Number(target.parentElement.getAttribute("data-count")) > 0) {
                        this.getLeaf(target.parentElement, notebookId);
                        event.preventDefault();
                        event.stopPropagation();
                        window.siyuan.menus.menu.remove();
                        break;
                    } else if (target.tagName === "LI") {
                        if (isOnlyMeta(event) && !event.altKey && !event.shiftKey) {
                            target.classList.toggle("b3-list-item--focus");
                            this.lastSelectedElement = target;
                        } else if (event.shiftKey && !event.altKey && isNotCtrl(event)) {
                            // Shift+click 多选文档
                            if (!document.contains(this.lastSelectedElement)) {
                                this.lastSelectedElement = null;
                            }
                            if (!this.lastSelectedElement) {
                                this.lastSelectedElement = this.element.querySelector(".b3-list-item--focus");
                            }
                            if (!this.lastSelectedElement) {
                                this.lastSelectedElement = target.parentElement.firstElementChild;
                            }
                            this.element.querySelectorAll(".b3-list-item--focus").forEach(item => {
                                item.classList.remove("b3-list-item--focus");
                            });

                            // 获取所有文档项
                            const allFiles = Array.from(this.element.querySelectorAll("li.b3-list-item"));

                            // 获取起始和结束索引
                            const startIndex = allFiles.indexOf(this.lastSelectedElement);
                            const endIndex = allFiles.indexOf(target);

                            // 确定选择范围
                            const start = Math.min(startIndex, endIndex);
                            const end = Math.max(startIndex, endIndex);

                            // 添加新选择
                            for (let i = start; i <= end; i++) {
                                (allFiles[i] as HTMLElement).classList.add("b3-list-item--focus");
                            }
                        } else {
                            this.lastSelectedElement = target;
                            this.setCurrent(target, false);
                            if (target.getAttribute("data-type") === "navigation-file" ||
                                (target.getAttribute("data-type") === "navigation-root" && target.getAttribute("data-node-id"))) {
                                // 更新最后点击的文档项
                                needFocus = false;
                                if (target.getAttribute("data-opening")) {
                                    return;
                                }
                                target.setAttribute("data-opening", "true");
                                if (event.altKey && isNotCtrl(event) && !event.shiftKey) {
                                    openFileById({
                                        app: options.app,
                                        id: target.getAttribute("data-node-id"),
                                        position: "right",
                                        action: [Constants.CB_GET_FOCUS, Constants.CB_GET_SCROLL],
                                        afterOpen() {
                                            target.removeAttribute("data-opening");
                                        }
                                    });
                                } else if (!event.altKey && isOnlyMeta(event) && event.shiftKey) {
                                    openFileById({
                                        app: options.app,
                                        id: target.getAttribute("data-node-id"),
                                        position: "bottom",
                                        action: [Constants.CB_GET_FOCUS, Constants.CB_GET_SCROLL],
                                        afterOpen() {
                                            target.removeAttribute("data-opening");
                                        }
                                    });
                                } else if (window.siyuan.config.fileTree.openFilesUseCurrentTab &&
                                    event.altKey && isOnlyMeta(event) && !event.shiftKey) {
                                    openFileById({
                                        app: options.app,
                                        removeCurrentTab: false,
                                        id: target.getAttribute("data-node-id"),
                                        action: [Constants.CB_GET_FOCUS, Constants.CB_GET_SCROLL],
                                        afterOpen() {
                                            target.removeAttribute("data-opening");
                                        }
                                    });
                                } else {
                                    openFileById({
                                        app: options.app,
                                        id: target.getAttribute("data-node-id"),
                                        action: [Constants.CB_GET_FOCUS, Constants.CB_GET_SCROLL],
                                        afterOpen() {
                                            target.removeAttribute("data-opening");
                                        }
                                    });
                                }
                            } else if (target.getAttribute("data-type") === "navigation-root") {
                                this.getLeaf(target, notebookId);
                            }
                        }
                        this.element.querySelector('[select-end="true"]')?.removeAttribute("select-end");
                        this.element.querySelector('[select-start="true"]')?.removeAttribute("select-start");
                        window.siyuan.menus.menu.remove();
                        event.stopPropagation();
                        event.preventDefault();
                        break;
                    }
                    target = target.parentElement;
                }
            }
            if (needFocus) {
                setPanelFocus(this.element.parentElement);
            }
        });
        this.element.addEventListener("dragstart", (event: DragEvent & { target: HTMLElement }) => {
            if (window.siyuan.config.readonly) return;
            window.getSelection().removeAllRanges();
            hideTooltip();
            const liElement = hasClosestByTag(event.target, "LI");
            if (liElement) {
                this.parent.panelElement.classList.add("sy__file--disablehover");
                let selectElements: Element[] = Array.from(this.element.querySelectorAll(".b3-list-item--focus"));
                if (!liElement.classList.contains("b3-list-item--focus")) {
                    selectElements.forEach((item) => {
                        item.classList.remove("b3-list-item--focus");
                    });
                    liElement.classList.add("b3-list-item--focus");
                    selectElements = [liElement];
                }
                let ids = "";
                const ghostElement = document.createElement("ul");
                selectElements.forEach((item: HTMLElement, index) => {
                    ghostElement.append(item.cloneNode(true));
                    item.style.opacity = "0.38";
                    const itemNodeId = item.dataset.nodeId ||
                        item.dataset.path; // 拖拽笔记本时值不能为空，否则 drop 就不会继续排序
                    if (itemNodeId) {
                        ids += itemNodeId;
                        if (index < selectElements.length - 1) {
                            ids += ",";
                        }
                    }
                });
                ghostElement.setAttribute("style", `width: 219px;position: fixed;top:-${selectElements.length * 30}px`);
                ghostElement.setAttribute("class", "b3-list b3-list--background");
                document.body.append(ghostElement);
                if (window.siyuan.touchDragActive) {
                    // 触屏保留 DOM ghost 供 touchDragBridge 跟随手指
                    event.dataTransfer.setDragImage(ghostElement, 16, 16);
                    window.siyuan.touchDragGhost = ghostElement;
                } else {
                    // 桌面端隐藏原生 ghost，改用自定义双区跟随框
                    const transparentImg = new Image();
                    transparentImg.src = transparentImgSrc;
                    event.dataTransfer.setDragImage(transparentImg, 0, 0);
                    setTimeout(() => {
                        ghostElement.remove();
                    });
                }
                event.dataTransfer.setData(Constants.SIYUAN_DROP_FILE, ids);
                event.dataTransfer.dropEffect = "move";
                window.siyuan.dragTitle = (selectElements[0] as HTMLElement)?.querySelector(".b3-list-item__text")?.textContent?.trim() || "";
                window.siyuan.dragElement = document.createElement("div");
                window.siyuan.dragElement.innerText = ids;
            }
        });
        const dragOverLastObj: {
            element: HTMLElement,
            positionY: number,
            rafId: number,
            sourceOnlyRoot: boolean,
        } = {
            element: null,
            positionY: null,
            rafId: null,
            sourceOnlyRoot: null
        };
        this.element.addEventListener("dragend", (event) => {
            if (dragOverLastObj.rafId) {
                cancelAnimationFrame(dragOverLastObj.rafId);
                dragOverLastObj.rafId = null;
            }
            dragOverLastObj.element = null;
            dragOverLastObj.positionY = null;
            dragOverLastObj.sourceOnlyRoot = null;
            this.element.querySelectorAll(".dragover, .dragover__bottom, .dragover__top").forEach((item: HTMLElement) => {
                item.classList.remove("dragover", "dragover__bottom", "dragover__top");
            });
            this.parent.panelElement.classList.remove("sy__file--disablehover");
            this.element.querySelectorAll('.b3-list-item[style*="opacity: 0.38;"]').forEach((item: HTMLElement, index) => {
                item.style.opacity = "";
                // https://github.com/siyuan-note/siyuan/issues/11587
                if (index === 0 && hasClosestByClassName(document.elementFromPoint(event.clientX, event.clientY), "sy__file")) {
                    const ariaLabelElement = item.querySelector(".ariaLabel");
                    if (ariaLabelElement) {
                        showTooltip(ariaLabelElement.getAttribute("aria-label"), ariaLabelElement);
                    }
                }
            });
            window.siyuan.dragElement = undefined;
            hideDragTip();
            window.siyuan.dragTitle = "";
            /// #if !BROWSER
            ipcRenderer.send(Constants.SIYUAN_SEND_WINDOWS, {cmd: "resetTabsStyle", data: "rmDragStyle"});
            /// #else
            document.querySelectorAll(".layout-tab-bars--drag").forEach(item => {
                item.classList.remove("layout-tab-bars--drag");
            });
            /// #endif
        });
        this.element.addEventListener("dragover", (event: DragEvent & { target: HTMLElement }) => {
            if (window.siyuan.config.readonly || !window.siyuan.dragElement || event.dataTransfer.types.includes(Constants.SIYUAN_DROP_TAB)) {
                event.preventDefault();
                return;
            }
            if (dragOverLastObj.rafId) {
                event.preventDefault();
                return;
            }
            let gutterType = "";
            for (const item of event.dataTransfer.items) {
                if (item.type.startsWith(Constants.SIYUAN_DROP_GUTTER)) {
                    gutterType = item.type;
                }
            }
            // 标题/列表项等块标源拖到文档树的提示在下方 rAF 回调中根据高亮类判定
            // 其余无法转换的块标源（如段落）不显示提示
            if (gutterType) {
                const gutterTypes = gutterType.replace(Constants.SIYUAN_DROP_GUTTER, "").split(Constants.ZWSP);
                if (!["nodelistitem", "nodeheading"].includes(gutterTypes[0])) {
                    hideDragTip();
                }
            }
            // 文档→文档拖拽的提示在下方 rAF 回调中根据高亮类判定（需等高亮类确定后再显示）
            dragOverLastObj.rafId = requestAnimationFrame(() => {
                dragOverLastObj.rafId = null;
                let liElement = event.target.closest("li");
                if (!liElement) {
                    liElement = document.elementFromPoint(event.clientX, event.clientY - 1).closest("li");
                }
                if (!liElement) {
                    dragOverLastObj.element = null;
                    hideDragTip();
                    event.preventDefault();
                    return;
                }
                const targetType = liElement.getAttribute("data-type");
                if (dragOverLastObj.element !== liElement) {
                    dragOverLastObj.element?.classList.remove("dragover", "dragover__bottom", "dragover__top");
                    if (gutterType) {
                        // 块标拖拽
                        const gutterTypes = gutterType.replace(Constants.SIYUAN_DROP_GUTTER, "").split(Constants.ZWSP);
                        if (!["nodelistitem", "nodeheading"].includes(gutterTypes[0])) {
                            event.preventDefault();
                            return;
                        }
                    } else if (liElement.classList.contains("b3-list-item--focus")) {
                        // 选中的文档不能拖拽到自己上，但允许标题拖拽到文档树的选中文档上 https://github.com/siyuan-note/siyuan/issues/6552
                        hideDragTip();
                        event.preventDefault();
                        return;
                    }

                    dragOverLastObj.sourceOnlyRoot = gutterType ? false : true;
                    if (dragOverLastObj.sourceOnlyRoot) {
                        const focusItems = this.element.querySelectorAll(".b3-list-item--focus");
                        for (let i = 0; i < focusItems.length; i++) {
                            if (focusItems[i].getAttribute("data-type") === "navigation-file") {
                                dragOverLastObj.sourceOnlyRoot = false;
                                break;
                            }
                        }
                    }
                    if (dragOverLastObj.sourceOnlyRoot && targetType !== "navigation-root") {
                        hideDragTip();
                        event.preventDefault();
                        return;
                    }
                }
                if (dragOverLastObj.element && dragOverLastObj.element === liElement && dragOverLastObj.positionY !== event.clientY) {
                    const notebookElement = hasClosestByAttribute(liElement, "data-sortmode", null);
                    if (!notebookElement) {
                        hideDragTip();
                        event.preventDefault();
                        return;
                    }
                    const notebookSort = notebookElement.getAttribute("data-sortmode");
                    if ((dragOverLastObj.sourceOnlyRoot && targetType === "navigation-root" && window.siyuan.config.fileTree.sort === 6) ||
                        (!dragOverLastObj.sourceOnlyRoot && targetType !== "navigation-root" &&
                            (notebookSort === "6" || (window.siyuan.config.fileTree.sort === 6 && notebookSort === "15")))
                    ) {
                        const nodeRect = liElement.getBoundingClientRect();
                        const dragHeight = nodeRect.height * .2;
                        liElement.classList.remove("dragover__top", "dragover__bottom", "dragover");
                        if (targetType === "navigation-root" && dragOverLastObj.sourceOnlyRoot) {
                            if (event.clientY > nodeRect.top + nodeRect.height / 2) {
                                liElement.classList.add("dragover__bottom");
                            } else {
                                liElement.classList.add("dragover__top");
                            }
                        } else if (event.clientY > nodeRect.bottom - dragHeight) {
                            liElement.classList.add("dragover__bottom");
                        } else if (event.clientY < nodeRect.top + dragHeight) {
                            liElement.classList.add("dragover__top");
                        }
                    }
                    if (liElement.classList.contains("dragover__top") || liElement.classList.contains("dragover__bottom") ||
                        (targetType === "navigation-root" && dragOverLastObj.sourceOnlyRoot)) {
                        // do nothing
                    } else {
                        liElement.classList.add("dragover");
                    }
                }
                if (dragOverLastObj.element !== liElement) {
                    dragOverLastObj.element = liElement;
                }
                dragOverLastObj.positionY = event.clientY;
                // 文档→文档拖拽：依据当前高亮类显示对应操作提示（带目标文档名）
                if (!gutterType) {
                    const name = liElement.querySelector(".b3-list-item__text")?.textContent || "";
                    const title = window.siyuan.dragTitle || "";
                    if (liElement.classList.contains("dragover__top")) {
                        showDragTip(title, window.siyuan.languages.dragTipMoveBefore.replace("${x}", name), event.clientX, event.clientY);
                    } else if (liElement.classList.contains("dragover__bottom")) {
                        showDragTip(title, window.siyuan.languages.dragTipMoveAfter.replace("${x}", name), event.clientX, event.clientY);
                    } else if (liElement.classList.contains("dragover")) {
                        showDragTip(title, window.siyuan.languages.dragTipMoveChild.replace("${x}", name), event.clientX, event.clientY);
                    } else {
                        hideDragTip();
                    }
                } else {
                    // 块标（标题/列表项）→文档树：结合“转换为文档”和位置（带目标文档名）
                    const gutterTypes = gutterType.replace(Constants.SIYUAN_DROP_GUTTER, "").split(Constants.ZWSP);
                    if (["nodelistitem", "nodeheading"].includes(gutterTypes[0])) {
                        const name = liElement.querySelector(".b3-list-item__text")?.textContent || "";
                        const title = window.siyuan.dragTitle || "";
                        let action: string;
                        if (liElement.classList.contains("dragover__top")) {
                            action = window.siyuan.languages.dragTip2DocBefore.replace("${x}", name);
                        } else if (liElement.classList.contains("dragover__bottom")) {
                            action = window.siyuan.languages.dragTip2DocAfter.replace("${x}", name);
                        } else {
                            action = window.siyuan.languages.dragTip2DocChild.replace("${x}", name);
                        }
                        showDragTip(title, action, event.clientX, event.clientY);
                    }
                }
                event.preventDefault();
            });
            event.preventDefault();
        });
        let counter = 0;
        this.element.addEventListener("dragleave", () => {
            counter--;
            if (counter === 0) {
                this.element.querySelectorAll(".dragover, .dragover__bottom, .dragover__top").forEach((item: HTMLElement) => {
                    item.classList.remove("dragover", "dragover__bottom", "dragover__top");
                });
                hideDragTip();
            }
        });
        this.element.addEventListener("dragenter", (event) => {
            event.preventDefault();
            counter++;
        });
        this.element.addEventListener("drop", async (event: DragEvent & { target: HTMLElement }) => {
            counter = 0;
            hideDragTip();
            window.siyuan.dragTitle = "";
            const newElement = this.element.querySelector(".dragover, .dragover__bottom, .dragover__top");
            if (!newElement) {
                return;
            }
            const newUlElement = hasTopClosestByTag(newElement, "UL");
            if (!newUlElement) {
                return;
            }
            const oldScrollTop = this.element.scrollTop;
            const toURL = newUlElement.getAttribute("data-url");
            const toPath = newElement.getAttribute("data-path");
            let gutterType = "";
            for (const item of event.dataTransfer.items) {
                if (item.type.startsWith(Constants.SIYUAN_DROP_GUTTER)) {
                    gutterType = item.type;
                }
            }
            // 块标拖拽
            if (gutterType) {
                const gutterTypes = gutterType.replace(Constants.SIYUAN_DROP_GUTTER, "").split(Constants.ZWSP);
                if (["nodelistitem", "nodeheading"].includes(gutterTypes[0])) {
                    const toDocOptions: {
                        targetNoteBook: string;
                        pushMode: number;
                        toTop?: boolean;
                        srcHeadingID?: string;
                        srcListItemID?: string;
                        targetPath?: string;
                        previousPath?: string;
                    } = {
                        targetNoteBook: toURL,
                        pushMode: 0,
                    };
                    if (newElement.classList.contains("dragover")) {
                        toDocOptions.targetPath = toPath;
                    } else if (newElement.classList.contains("dragover__bottom")) {
                        toDocOptions.previousPath = toPath;
                    } else if (newElement.classList.contains("dragover__top")) {
                        if (newElement.previousElementSibling) {
                            toDocOptions.previousPath = newElement.previousElementSibling.getAttribute("data-path");
                        } else {
                            // 拖到第一个子文档上方，作为父文档的第一个子文档
                            const parentLi = newElement.parentElement.previousElementSibling as HTMLElement;
                            toDocOptions.targetPath = parentLi.getAttribute("data-path");
                            toDocOptions.toTop = true;
                        }
                    }
                    if (gutterTypes[0] === "nodeheading") {
                        toDocOptions.srcHeadingID = gutterTypes[2].split(",")[0];
                        fetchPost("/api/filetree/heading2Doc", toDocOptions);
                    } else {
                        toDocOptions.srcListItemID = gutterTypes[2].split(",")[0];
                        fetchPost("/api/filetree/li2Doc", toDocOptions);
                    }
                }
                newElement.classList.remove("dragover", "dragover__bottom", "dragover__top");
                window.siyuan.dragElement = undefined;
                return;
            }
            window.siyuan.dragElement = undefined;
            if (!event.dataTransfer.getData(Constants.SIYUAN_DROP_FILE)) {
                newElement.classList.remove("dragover", "dragover__bottom", "dragover__top");
                return;
            }
            const selectRootElements: HTMLElement[] = [];
            const selectFileElements: HTMLElement[] = [];
            const fromPaths: string[] = [];
            this.element.querySelectorAll(".b3-list-item--focus").forEach((item: HTMLElement) => {
                if (item.getAttribute("data-type") === "navigation-root") {
                    selectRootElements.push(item);
                } else {
                    const dataPath = item.getAttribute("data-path");
                    const isChild = fromPaths.find(itemPath => {
                        if (dataPath.startsWith(itemPath.replace(".sy", ""))) {
                            return true;
                        }
                    });
                    if (!isChild) {
                        // 禁止父节点移动到子节点 https://github.com/siyuan-note/siyuan/issues/12539
                        if (newElement.getAttribute("data-path").startsWith(item.dataset.path.replace(".sy", ""))) {
                            return;
                        }
                        selectFileElements.push(item);
                        fromPaths.push(dataPath);
                    }
                }
            });
            if (newElement.classList.contains("dragover")) {
                fetchPost("/api/filetree/moveDocs", {
                    toNotebook: toURL,
                    fromPaths,
                    toPath,
                });
                newElement.classList.remove("dragover", "dragover__bottom", "dragover__top");
                return;
            }
            if (newElement.classList.contains("dragover__bottom") || newElement.classList.contains("dragover__top")) {
                const ulSort = newUlElement.getAttribute("data-sortmode");
                if (window.siyuan.config.fileTree.sort === 6 && selectRootElements.length > 0 &&
                    newElement.getAttribute("data-path") === "/") {
                    if (newElement.classList.contains("dragover__top")) {
                        selectRootElements.forEach(item => {
                            newElement.parentElement.before(item.parentElement);
                        });
                    } else {
                        selectRootElements.reverse().forEach(item => {
                            newElement.parentElement.after(item.parentElement);
                        });
                    }
                    const notebooks: string[] = [];
                    Array.from(this.element.children).forEach(item => {
                        notebooks.push(item.getAttribute("data-url"));
                    });
                    fetchPost("/api/notebook/changeSortNotebook", {
                        notebooks,
                    });
                } else if ((ulSort === "6" || (window.siyuan.config.fileTree.sort === 6 && ulSort === "15")) && selectFileElements.length > 0) {
                    let hasMove = false;
                    const toDir = pathPosix().dirname(toPath);
                    const newElementClassList = newElement.getAttribute("class");
                    if (fromPaths.length > 0) {
                        await fetchSyncPost("/api/filetree/moveDocs", {
                            toNotebook: toURL,
                            fromPaths,
                            toPath: toDir === "/" ? "/" : toDir + ".sy",
                            callback: Constants.CB_MOVE_NOLIST,
                        });
                        selectFileElements.forEach(item => {
                            item.setAttribute("data-path", pathPosix().join(toDir, item.getAttribute("data-node-id") + ".sy"));
                        });
                        hasMove = true;
                    }
                    if (newElementClassList.includes("dragover__top")) {
                        selectFileElements.forEach(item => {
                            let nextULElement;
                            if (item.nextElementSibling && item.nextElementSibling.tagName === "UL") {
                                nextULElement = item.nextElementSibling;
                            }
                            newElement.before(item);
                            if (nextULElement) {
                                item.after(nextULElement);
                            }
                        });
                    } else if (newElementClassList.includes("dragover__bottom")) {
                        selectFileElements.reverse().forEach(item => {
                            let nextULElement;
                            if (item.nextElementSibling && item.nextElementSibling.tagName === "UL") {
                                nextULElement = item.nextElementSibling;
                            }
                            if (newElement.nextElementSibling && newElement.nextElementSibling.tagName === "UL") {
                                newElement.nextElementSibling.after(item);
                            } else {
                                newElement.after(item);
                            }
                            if (nextULElement) {
                                item.after(nextULElement);
                            }
                        });
                    }
                    const paths: string[] = [];
                    Array.from(newElement.parentElement.children).forEach(item => {
                        if (item.tagName === "LI") {
                            paths.push(item.getAttribute("data-path"));
                        }
                    });
                    fetchPost("/api/filetree/changeSort", {
                        paths,
                        notebook: toURL
                    }, () => {
                        if (hasMove) {
                            fetchPost("/api/filetree/listDocsByPath", {
                                notebook: toURL,
                                path: toDir === "/" ? "/" : toDir + ".sy",
                                app: Constants.SIYUAN_APPID,
                            }, response => {
                                if (response.data.path === "/" && response.data.files.length === 0) {
                                    showMessage(window.siyuan.languages.emptyContent);
                                    return;
                                }
                                this.onLsHTML(response.data, oldScrollTop);
                            });
                        }
                    });
                }
            }
            newElement.classList.remove("dragover", "dragover__bottom", "dragover__top");
        });
        this.init();
    }

    private handleMsgCallback(data: IWebSocketData) {
        if (data) {
            switch (data.cmd) {
                case "reloadDocInfo":
                    this.updateDocInfo(data);
                    break;
                case "moveDoc":
                    this.onMove(data);
                    break;
                case "reloadFiletree":
                    setNoteBook(() => {
                        this.init(false);
                    });
                    break;
                case "reloadNotebookInfo":
                    window.clearTimeout(this.reloadNotebookInfoTimeout);
                    this.reloadNotebookInfoTimeout = window.setTimeout(() => {
                        setNoteBook((notebooks) => {
                            notebooks.forEach((notebook) => {
                                const liElement = this.element.querySelector<HTMLElement>(
                                    `ul[data-url="${notebook.id}"] > li[data-type="navigation-root"]`
                                );
                                if (liElement) {
                                    this.updateSubFileCount(liElement, notebook.subFileCount);
                                }
                            });
                        });
                    }, 128);
                    break;
                case "mount":
                    this.onMount(data);
                    this.app.plugins.forEach((item) => {
                        item.eventBus.emit("opened-notebook", data);
                    });
                    break;
                case "createnotebook":
                    setNoteBook((notebooks) => {
                        let previousId: string;
                        notebooks.find(item => {
                            if (!item.closed) {
                                if (item.id === data.data.box.id) {
                                    if (previousId) {
                                        this.element.querySelector(`.b3-list[data-url="${previousId}"]`).insertAdjacentHTML("afterend", this.genNotebook(data.data.box));
                                    } else {
                                        this.element.insertAdjacentHTML("afterbegin", this.genNotebook(data.data.box));
                                    }
                                    return true;
                                }
                                previousId = item.id;
                            }
                        });
                    });
                    break;
                case "closeBox":
                case "removeBox":
                    this.onRemove(data);
                    this.app.plugins.forEach((item) => {
                        item.eventBus.emit("closed-notebook", data);
                    });
                    break;
                case "removeDoc":
                    this.onRemove(data);
                    break;
                case "create":
                    if (data.data.listDocTree) {
                        this.selectItem(data.data.box.id, data.data.path);
                    } else {
                        this.updateItemArrow(data.data.box.id, data.data.path);
                    }
                    break;
                case "createdailynote":
                case "heading2doc":
                case "li2doc":
                    this.selectItem(data.data.box.id, data.data.path);
                    break;
                case "renamenotebook": {
                    const notebook = window.siyuan.notebooks.find((item) => item.id === data.data.box);
                    if (notebook) {
                        notebook.name = data.data.name;
                    }
                    this.element.querySelector(`[data-url="${data.data.box}"] .b3-list-item__text`).innerHTML = escapeHtml(data.data.name);
                    break;
                }
                case "rename":
                    this.onRename(data.data);
                    break;
            }
        }
    }

    private updateDocInfo(data: IWebSocketData) {
        const notebook = window.siyuan.notebooks.find((item) => item.id === data.data.rootID);
        const subFileCount = notebook && window.siyuan.isPublish ? notebook.subFileCount : data.data.subFileCount;
        if (notebook) {
            notebook.subFileCount = subFileCount;
        }
        const liElement = this.element.querySelector(
            `li[data-node-id="${data.data.rootID}"][data-type="navigation-file"], ` +
            `li[data-node-id="${data.data.rootID}"][data-type="navigation-root"]`
        );
        if (liElement) {
            if (liElement.getAttribute("data-type") === "navigation-file") {
                liElement.querySelector(".b3-list-item__text.ariaLabel")?.setAttribute("aria-label", this.genDocAriaLabel(data.data, escapeLessThans));
            }
            this.updateSubFileCount(liElement as HTMLElement, subFileCount);
        }
    }

    private updateSubFileCount(liElement: HTMLElement, subFileCount: number) {
        liElement.setAttribute("data-count", subFileCount.toString());
        if (subFileCount === 0) {
            liElement.querySelector(".b3-list-item__toggle")?.classList.add("fn__hidden");
            liElement.querySelector(".b3-list-item__arrow")?.classList.remove("b3-list-item__arrow--open");
            if (liElement.nextElementSibling?.tagName === "UL") {
                liElement.nextElementSibling.remove();
            }
        } else {
            liElement.querySelector(".b3-list-item__toggle")?.classList.remove("fn__hidden");
        }
        this.updateDocActionElement(liElement);
    }

    private updateDocActionElement(liElement: HTMLElement) {
        const iconElement = liElement.querySelector<HTMLElement>(".b3-list-item__icon");
        if (!iconElement) {
            return;
        }
        const isFile = liElement.getAttribute("data-type") === "navigation-file";
        const isBoxDoc = liElement.getAttribute("data-type") === "navigation-root" &&
            Boolean(liElement.getAttribute("data-node-id"));
        const hasChildren = (isFile || isBoxDoc) && Number(liElement.getAttribute("data-count")) > 0;
        const iconUsesDocAction = window.siyuan.config.fileTree.docIconClickExpand && (isFile || isBoxDoc);
        const editingPublishAccess = this.element.classList.contains("file-tree__publish-access--active");
        iconElement.setAttribute("aria-label", iconUsesDocAction ?
            (hasChildren ? window.siyuan.languages.docIconClickExpand : window.siyuan.languages.openDocument) :
            window.siyuan.languages.changeIcon);
        liElement.classList.toggle("file-tree__item--icon-expand", hasChildren && iconUsesDocAction &&
            !editingPublishAccess);
        liElement.classList.toggle("file-tree__item--icon-open", (isFile || isBoxDoc) && !hasChildren && iconUsesDocAction &&
            !editingPublishAccess);
        liElement.classList.toggle("file-tree__item--title-expand", hasChildren &&
            window.siyuan.config.fileTree.parentDocClickExpand);
    }

    public updateDocActions() {
        this.element.querySelectorAll<HTMLElement>(
            'li[data-type="navigation-file"], li[data-type="navigation-root"]'
        ).forEach((item) => {
            this.updateDocActionElement(item);
        });
    }

    private updateItemArrow(notebookId: string, filePath: string) {
        const treeElement = this.element.querySelector(`[data-url="${notebookId}"]`);
        if (!treeElement) {
            return;
        }
        let currentPath = filePath;
        let liElement;
        while (!liElement) {
            liElement = treeElement.querySelector(`[data-path="${currentPath}"]`);
            if (!liElement) {
                const dirname = pathPosix().dirname(currentPath);
                if (dirname === "/") {
                    const rootElement = treeElement.firstElementChild as HTMLElement;
                    if (rootElement.querySelector(".b3-list-item__arrow--open")) {
                        this.getLeaf(rootElement, notebookId, true);
                    }
                    break;
                } else {
                    currentPath = dirname + ".sy";
                }
            } else {
                const hiddenElement = liElement.querySelector(".fn__hidden");
                if (hiddenElement) {
                    // 原先无子文档：显示展开箭头
                    hiddenElement.classList.remove("fn__hidden");
                } else if (liElement.querySelector(".b3-list-item__arrow--open")) {
                    // 父文档已展开：刷新子列表
                    this.getLeaf(liElement, notebookId, true);
                }
                break;
            }
        }
    }

    private genNotebook(item: INotebook) {
        const editingPublishAccess = this.element.classList.contains("file-tree__publish-access--active");
        // 加密笔记本关闭（锁定）时用 🔒 提示需解锁；打开（解锁）后恢复正常 emoji
        const iconContent = (item.encrypted && item.closed)
            ? "🔒️"
            : unicode2Emoji(item.icon || window.siyuan.storage[Constants.LOCAL_IMAGES].note);
        const isBoxDoc = !item.closed && window.siyuan.config.fileTree.boxDocEnabled;
        const hasChildren = isBoxDoc && item.subFileCount > 0;
        const iconUsesDocAction = isBoxDoc && window.siyuan.config.fileTree.docIconClickExpand;
        const iconAriaLabel = iconUsesDocAction ?
            (hasChildren ? window.siyuan.languages.docIconClickExpand : window.siyuan.languages.openDocument) :
            window.siyuan.languages.changeIcon;
        const actionClasses = `${iconUsesDocAction && hasChildren && !editingPublishAccess ? " file-tree__item--icon-expand" : ""}${
            iconUsesDocAction && !hasChildren && !editingPublishAccess ? " file-tree__item--icon-open" : ""}${
            hasChildren && window.siyuan.config.fileTree.parentDocClickExpand ? " file-tree__item--title-expand" : ""}`;
        const emojiHTML = `<span class="b3-list-item__icon ariaLabel${isBoxDoc ? " popover__block" : ""}${editingPublishAccess ? " fn__none" : ""}" data-position="8east"${isBoxDoc ? ` data-id="${item.id}"` : ""} aria-label="${iconAriaLabel}">${iconContent}</span>`;
        const switchHTML = `<span class="b3-list-item__switch b3-tooltips b3-tooltips__e${editingPublishAccess ? "" : " fn__none"}" aria-label="${window.siyuan.languages.publishAccess}">${getPublishAccessOptionByLevel("public").iconHTML}</span>`;
        if (item.closed) {
            return `<li data-url="${item.id}" class="b3-list-item b3-list-item--hide-action"${item.encrypted ? ' data-encrypted="true"' : ""}>
    <span class="b3-list-item__toggle fn__hidden">
        <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
    </span>
    ${emojiHTML}
    ${switchHTML}
    <span class="b3-list-item__text" style="cursor: default;">${escapeHtml(item.name)}</span>
    <span data-type="open" data-url="${item.id}" class="b3-list-item__action b3-tooltips b3-tooltips__w${(window.siyuan.config.readonly) ? " fn__none" : ""}" aria-label="${window.siyuan.languages.openBy}">
        <svg><use xlink:href="#iconOpen"></use></svg>
    </span>
</li>`;
        } else {
            return `<ul class="b3-list b3-list--background" data-url="${item.id}" data-sort="${item.sort}" data-sortmode="${item.sortMode}">
<li class="b3-list-item b3-list-item--hide-action${actionClasses}" ${window.siyuan.config.fileTree.sort === 6 ? 'draggable="true"' : ""}
style="--file-toggle-width:22px;--file-action-offset:22px"
data-type="navigation-root" data-path="/" data-count="${item.subFileCount || 0}" data-node-id="${window.siyuan.config.fileTree.boxDocEnabled ? item.id : ""}">
    <span class="b3-list-item__toggle b3-list-item__toggle--hl${isBoxDoc && !hasChildren ? " fn__hidden" : ""}">
        <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
    </span>
    ${emojiHTML}
    ${switchHTML}
    <span class="b3-list-item__text ariaLabel" data-position="parentE">${escapeHtml(item.name)}</span>
    <span data-type="more-root" class="b3-list-item__action b3-tooltips b3-tooltips__w${(window.siyuan.config.readonly) ? " fn__none" : ""}" aria-label="${window.siyuan.languages.more}">
        <svg><use xlink:href="#iconMore"></use></svg>
    </span>
    <span data-type="new" class="b3-list-item__action b3-tooltips b3-tooltips__w${(window.siyuan.config.readonly) ? " fn__none" : ""}" aria-label="${window.siyuan.languages.newSubDoc}">
        <svg><use xlink:href="#iconAdd"></use></svg>
    </span>
</li></ul>`;
        }
    }

    public init(init = true) {
        let html = "";
        let closeHtml = "";
        let closeCounter = 0;
        const scrollTop = this.element.scrollTop;
        window.siyuan.notebooks.forEach((item) => {
            if (item.closed) {
                closeCounter++;
                closeHtml += this.genNotebook(item);
            } else {
                html += this.genNotebook(item);
            }
        });
        this.element.innerHTML = html;
        this.closeElement.lastElementChild.innerHTML = closeHtml;
        const counterElement = this.closeElement.querySelector(".counter");
        counterElement.textContent = closeCounter.toString();
        if (closeCounter) {
            this.closeElement.classList.remove("fn__none");
        } else {
            this.closeElement.classList.add("fn__none");
        }
        window.siyuan.storage[Constants.LOCAL_FILESPATHS].forEach(async (item: IFilesPath) => {
            for (const openPath of item.openPaths) {
                await this.selectItem(item.notebookId, openPath, undefined, false, false);
            }
            this.element.scrollTop = scrollTop;
        });
        this.refreshPublishAccessSwitch();
        if (!init) {
            return;
        }
        const svgElement = this.closeElement.querySelector("svg");
        if (html !== "") {
            this.closeElement.style.height = "30px";
            svgElement.classList.remove("b3-list-item__arrow--open");
            this.closeElement.lastElementChild.classList.add("fn__none");
        } else {
            this.closeElement.style.height = "40%";
            svgElement.classList.add("b3-list-item__arrow--open");
            this.closeElement.lastElementChild.classList.remove("fn__none");
        }
    }

    private onRemove(data: IWebSocketData) {
        // "doc2heading" 后删除文件或挂载帮助文档前的 unmount
        if (data.cmd === "closeBox" || data.cmd === "removeBox") {
            setNoteBook((notebooks) => {
                const targetElement = this.element.querySelector(`ul[data-url="${data.data.box}"] li[data-path="${"/"}"]`);
                if (targetElement) {
                    targetElement.parentElement.remove();
                    if (data.cmd === "closeBox") {
                        let closeHTML = "";
                        notebooks.find(item => {
                            if (item.closed) {
                                closeHTML += this.genNotebook(item);
                            }
                        });
                        this.closeElement.lastElementChild.innerHTML = closeHTML;
                        const counterElement = this.closeElement.querySelector(".counter");
                        counterElement.textContent = (parseInt(counterElement.textContent) + 1).toString();
                        this.closeElement.classList.remove("fn__none");
                    }
                }
            });
            if (data.cmd === "removeBox") {
                const removeElement = this.closeElement.querySelector(`li[data-url="${data.data.box}"]`);
                if (removeElement) {
                    removeElement.remove();
                    const counterElement = this.closeElement.querySelector(".counter");
                    counterElement.textContent = (parseInt(counterElement.textContent) - 1).toString();
                    if (counterElement.textContent === "0") {
                        this.closeElement.classList.add("fn__none");
                    }
                }
            }
            return;
        }
        data.data.ids.forEach((item: string) => {
            const targetElement = this.element.querySelector(`li.b3-list-item[data-node-id="${item}"]`);
            if (targetElement) {
                // 子节点展开则删除
                if (targetElement.nextElementSibling?.tagName === "UL") {
                    targetElement.nextElementSibling.remove();
                }
                // 移除当前节点
                const parentElement = targetElement.parentElement.previousElementSibling as HTMLElement;
                if (targetElement.parentElement.childElementCount === 1) {
                    if (parentElement) {
                        const iconElement = parentElement.querySelector("svg");
                        iconElement.classList.remove("b3-list-item__arrow--open");
                        if (parentElement.dataset.type !== "navigation-root" || parentElement.dataset.nodeId) {
                            iconElement.parentElement.classList.add("fn__hidden");
                        }
                        parentElement.setAttribute("data-count", "0");
                        this.updateDocActionElement(parentElement);
                        const emojiElement = iconElement.parentElement.nextElementSibling;
                        if (emojiElement.innerHTML === unicode2Emoji(window.siyuan.storage[Constants.LOCAL_IMAGES].folder)) {
                            emojiElement.innerHTML = unicode2Emoji(window.siyuan.storage[Constants.LOCAL_IMAGES].file);
                        }
                    }
                    targetElement.parentElement.remove();
                } else {
                    targetElement.remove();
                }
            }
        });
    }

    private onMount(data: IWebSocketData) {
        if (data.data.existed) {
            return;
        }
        const liElement = this.closeElement.querySelector(`li[data-url="${data.data.box.id}"]`) as HTMLElement;
        if (liElement) {
            const counterElement = this.closeElement.querySelector(".counter");
            counterElement.textContent = (parseInt(counterElement.textContent) - 1).toString();
            if (counterElement.textContent === "0") {
                this.closeElement.classList.add("fn__none");
            }
            liElement.remove();
        }
        setNoteBook((notebooks: INotebook[]) => {
            const notebook = notebooks.find((item) => item.id === data.data.box.id) || data.data.box;
            const html = this.genNotebook(notebook);
            if (this.element.childElementCount === 0) {
                this.element.innerHTML = html;
            } else {
                let previousId;
                notebooks.find((item, index) => {
                    if (item.id === data.data.box.id) {
                        while (index > 0) {
                            if (!notebooks[index - 1].closed) {
                                previousId = notebooks[index - 1].id;
                                break;
                            } else {
                                index--;
                            }
                        }
                        return true;
                    }
                });
                if (previousId) {
                    this.element.querySelector(`[data-url="${previousId}"]`).insertAdjacentHTML("afterend", html);
                } else {
                    this.element.insertAdjacentHTML("afterbegin", html);
                }
            }
        });
    }

    public onRename(data: { path: string, title: string, box: string }) {
        const fileItemElement = this.element.querySelector(`ul[data-url="${data.box}"] li[data-path="${data.path}"]`);
        if (!fileItemElement) {
            return;
        }
        fileItemElement.setAttribute("data-name", data.title);
        fileItemElement.querySelector(".b3-list-item__text").innerHTML = escapeHtml(data.title);
    }

    private onMove(response: IWebSocketData) {
        const sourceElement = this.element.querySelector(`ul[data-url="${response.data.fromNotebook}"] li[data-path="${response.data.fromPath}"]`) as HTMLElement;
        if (sourceElement) {
            if (sourceElement.nextElementSibling && sourceElement.nextElementSibling.tagName === "UL") {
                sourceElement.nextElementSibling.remove();
            }
            if (sourceElement.parentElement.childElementCount === 1) {
                if (sourceElement.parentElement.previousElementSibling) {
                    const parentLiElement = sourceElement.parentElement.previousElementSibling as HTMLElement;
                    if (parentLiElement.getAttribute("data-type") !== "navigation-root" || parentLiElement.dataset.nodeId) {
                        parentLiElement.querySelector(".b3-list-item__toggle").classList.add("fn__hidden");
                    }
                    parentLiElement.querySelector(".b3-list-item__arrow").classList.remove("b3-list-item__arrow--open");
                    parentLiElement.setAttribute("data-count", "0");
                    this.updateDocActionElement(parentLiElement);
                    const emojiElement = parentLiElement.querySelector(".b3-list-item__icon");
                    if (emojiElement.innerHTML === unicode2Emoji(window.siyuan.storage[Constants.LOCAL_IMAGES].folder)) {
                        emojiElement.innerHTML = unicode2Emoji(window.siyuan.storage[Constants.LOCAL_IMAGES].file);
                    }
                }
                sourceElement.parentElement.remove();
            } else {
                sourceElement.remove();
            }
        } else {
            const parentElement = this.element.querySelector(`ul[data-url="${response.data.fromNotebook}"] li[data-path="${pathPosix().dirname(response.data.fromPath)}.sy"]`) as HTMLElement;
            if (parentElement && parentElement.getAttribute("data-count") === "1") {
                parentElement.querySelector(".b3-list-item__toggle").classList.add("fn__hidden");
                parentElement.querySelector(".b3-list-item__arrow").classList.remove("b3-list-item__arrow--open");
            }
        }
        const newElement = this.element.querySelector(`[data-url="${response.data.toNotebook}"] li[data-path="${response.data.toPath}"]`) as HTMLElement;
        // 更新移动到的新文件夹
        if (newElement) {
            newElement.querySelector(".b3-list-item__toggle").classList.remove("fn__hidden");
            if (newElement.getAttribute("data-type") === "navigation-root") {
                newElement.setAttribute("data-count", Math.max(1, Number(newElement.getAttribute("data-count"))).toString());
                this.updateDocActionElement(newElement);
            }
            const emojiElement = newElement.querySelector(".b3-list-item__icon");
            if (emojiElement.innerHTML === unicode2Emoji(window.siyuan.storage[Constants.LOCAL_IMAGES].file)) {
                emojiElement.innerHTML = unicode2Emoji(window.siyuan.storage[Constants.LOCAL_IMAGES].folder);
            }
            const arrowElement = newElement.querySelector(".b3-list-item__arrow");
            if (arrowElement.classList.contains("b3-list-item__arrow--open") && response.callback !== Constants.CB_MOVE_NOLIST) {
                this.getLeaf(newElement, response.data.toNotebook, true);
            }
        }
    }

    private onLsHTML(data: { files: IFile[], box: string, path: string }, scrollTop?: number) {
        if (data.files.length === 0) {
            return;
        }
        const liElement = this.element.querySelector(`ul[data-url="${data.box}"] li[data-path="${data.path}"]`);
        if (!liElement) {
            return;
        }
        let fileHTML = "";
        data.files.forEach((item: IFile) => {
            fileHTML += this.genFileHTML(item);
        });
        let nextElement = liElement.nextElementSibling;
        if (nextElement && nextElement.tagName === "UL") {
            // 文件展开时，刷新
            const tempElement = document.createElement("template");
            tempElement.innerHTML = fileHTML;
            // 保持文件夹展开状态
            nextElement.querySelectorAll(":scope > .b3-list-item > .b3-list-item__toggle> .b3-list-item__arrow--open").forEach(item => {
                const openLiElement = hasClosestByClassName(item, "b3-list-item");
                if (openLiElement) {
                    const tempOpenLiElement = tempElement.content.querySelector(`.b3-list-item[data-node-id="${openLiElement.getAttribute("data-node-id")}"]`);
                    tempOpenLiElement.after(openLiElement.nextElementSibling);
                    tempOpenLiElement.querySelector(".b3-list-item__arrow").classList.add("b3-list-item__arrow--open");
                }
            });
            nextElement.innerHTML = tempElement.innerHTML;
            if (typeof scrollTop === "number") {
                this.element.scroll({top: scrollTop, behavior: "smooth"});
            }
            this.refreshPublishAccessSwitch();
            return;
        }
        liElement.querySelector(".b3-list-item__arrow").classList.add("b3-list-item__arrow--open");
        liElement.insertAdjacentHTML("afterend", `<ul>${fileHTML}</ul>`);
        nextElement = liElement.nextElementSibling;
        nextElement.setAttribute("style", "top: -1px;position: relative;");
        expandFileTree(nextElement as HTMLElement, () => {
            nextElement.removeAttribute("style");
            if (typeof scrollTop === "number") {
                this.element.scroll({top: scrollTop, behavior: "smooth"});
            }
        });
        this.refreshPublishAccessSwitch();
    }

    private async onLsSelect(data: {
        files: IFile[],
        box: string,
        path: string
    }, filePath: string, setStorage: boolean, isSetCurrent: boolean) {
        let fileHTML = "";
        data.files.forEach((item: IFile) => {
            fileHTML += this.genFileHTML(item);
        });
        if (fileHTML === "") {
            return;
        }
        const liElement = this.element.querySelector(`ul[data-url="${data.box}"] li[data-path="${data.path}"]`);
        if (!liElement) {
            return;
        }
        if (liElement.nextElementSibling && liElement.nextElementSibling.tagName === "UL") {
            // 文件展开时，刷新
            liElement.nextElementSibling.remove();
        }
        const arrowElement = liElement.querySelector(".b3-list-item__arrow");
        arrowElement.classList.add("b3-list-item__arrow--open");
        arrowElement.parentElement.classList.remove("fn__hidden");
        const emojiElement = liElement.querySelector(".b3-list-item__icon");
        if (emojiElement.textContent === unicode2Emoji(window.siyuan.storage[Constants.LOCAL_IMAGES].file)) {
            emojiElement.textContent = unicode2Emoji(window.siyuan.storage[Constants.LOCAL_IMAGES].folder);
        }
        liElement.insertAdjacentHTML("afterend", `<ul>${fileHTML}</ul>`);
        let newLiElement;
        for (let i = 0; i < data.files.length; i++) {
            const item = data.files[i];
            if (filePath === item.path) {
                newLiElement = await this.selectItem(data.box, filePath, undefined, setStorage, isSetCurrent);
            } else if (filePath.startsWith(item.path.replace(".sy", ""))) {
                const response = await fetchSyncPost("/api/filetree/listDocsByPath", {
                    notebook: data.box,
                    path: item.path,
                    app: Constants.SIYUAN_APPID,
                });
                newLiElement = await this.selectItem(response.data.box, filePath, response.data, setStorage, isSetCurrent);
            }
        }
        if (isSetCurrent) {
            this.setCurrent(newLiElement);
        }
        return newLiElement;
    }

    public setCurrent(target: HTMLElement, isScroll = true) {
        if (!target) {
            return;
        }
        this.element.querySelectorAll("li.b3-list-item--focus").forEach((liItem) => {
            liItem.classList.remove("b3-list-item--focus");
        });
        target.classList.add("b3-list-item--focus");

        if (isScroll) {
            const elementRect = this.element.getBoundingClientRect();
            this.element.scrollTop = this.element.scrollTop + (target.getBoundingClientRect().top - (elementRect.top + elementRect.height / 2));
        }
    }

    public getLeaf(liElement: Element, notebookId: string, focusUpdate = false) {
        const toggleElement = liElement.querySelector(".b3-list-item__arrow");
        if (cancelFileTreeCollapse(liElement)) {
            this.getOpenPaths();
            if (!focusUpdate) {
                return;
            }
        }
        const leafElement = liElement.nextElementSibling as HTMLElement;
        if (toggleElement.classList.contains("b3-list-item__arrow--open") && !focusUpdate) {
            toggleElement.classList.remove("b3-list-item__arrow--open");
            if (leafElement?.tagName === "UL") {
                leafElement.remove();
                this.getOpenPaths();
            } else {
                // 没有UL，直接更新路径
                this.getOpenPaths();
            }
            return;
        }
        fetchPost("/api/filetree/listDocsByPath", {
            notebook: notebookId,
            path: liElement.getAttribute("data-path"),
            app: Constants.SIYUAN_APPID,
        }, response => {
            if (response.data.path === "/" && response.data.files.length === 0) {
                newFileInTree(this.app, notebookId, "/");
                return;
            }
            this.onLsHTML(response.data);
            this.getOpenPaths();
        });
    }

    public async selectItem(notebookId: string, filePath: string, data?: {
        files: IFile[],
        box: string,
        path: string
    }, setStorage = true, isSetCurrent = true) {
        filePath = filePath.replace(/\/\/+/g, "/");
        const treeElement = this.element.querySelector(`[data-url="${notebookId}"]`);
        if (!treeElement) {
            // 有文件树和编辑器的布局初始化时，文件树还未挂载
            return;
        }
        const boxDocID = window.siyuan.config.fileTree.boxDocEnabled ? notebookId : "";
        if (boxDocID && filePath === `/${boxDocID}.sy`) {
            const boxDocElement = treeElement.querySelector("[data-type=\"navigation-root\"]") as HTMLElement;
            if (isSetCurrent) {
                this.setCurrent(boxDocElement);
            }
            return boxDocElement;
        }
        let currentPath = filePath;
        let liElement: HTMLElement;
        const visitedPaths = new Set<string>();
        while (!liElement) {
            if (visitedPaths.has(currentPath)) {
                return;
            }
            visitedPaths.add(currentPath);
            liElement = treeElement.querySelector(`[data-path="${currentPath}"]`);
            if (!liElement) {
                const dirname = pathPosix().dirname(currentPath);
                if (dirname === "/") {
                    currentPath = dirname;
                } else {
                    currentPath = dirname + ".sy";
                }
            }
        }

        if (liElement.getAttribute("data-path") === filePath) {
            if (setStorage) {
                this.getOpenPaths();
            }
            if (isSetCurrent) {
                this.setCurrent(liElement);
            }
            return liElement;
        }

        if (data && data.path === currentPath) {
            liElement = await this.onLsSelect(data, filePath, setStorage, isSetCurrent);
        } else {
            const response = await fetchSyncPost("/api/filetree/listDocsByPath", {
                notebook: notebookId,
                path: currentPath,
                app: Constants.SIYUAN_APPID,
            });
            liElement = await this.onLsSelect(response.data, filePath, setStorage, isSetCurrent);
        }
        this.refreshPublishAccessSwitch();
        return liElement;
    }

    private getOpenPaths() {
        const filesPaths: IFilesPath[] = [];
        this.element.querySelectorAll(".b3-list[data-url]").forEach((item: HTMLElement) => {
            const notebookPaths: IFilesPath = {
                notebookId: item.getAttribute("data-url"),
                openPaths: []
            };
            item.querySelectorAll(".b3-list-item__arrow--open").forEach((openItem) => {
                const liElement = hasClosestByTag(openItem, "LI");
                if (liElement) {
                    notebookPaths.openPaths.push(liElement.getAttribute("data-path"));
                }
            });
            if (notebookPaths.openPaths.length > 0) {
                for (let i = 0; i < notebookPaths.openPaths.length; i++) {
                    for (let j = i + 1; j < notebookPaths.openPaths.length; j++) {
                        if (notebookPaths.openPaths[j].startsWith(notebookPaths.openPaths[i].replace(".sy", ""))) {
                            notebookPaths.openPaths.splice(i, 1);
                            j--;
                        }
                    }
                }
                notebookPaths.openPaths.forEach((openPath, index) => {
                    const nextPath = this.element.querySelector(`[data-url="${notebookPaths.notebookId}"] li[data-path="${openPath}"]`)?.nextElementSibling?.firstElementChild?.getAttribute("data-path");
                    if (nextPath) {
                        notebookPaths.openPaths[index] = nextPath;
                    }
                });
                filesPaths.push(notebookPaths);
            }
        });
        window.siyuan.storage[Constants.LOCAL_FILESPATHS] = filesPaths;
        setStorageVal(Constants.LOCAL_FILESPATHS, filesPaths);
    }

    private genDocAriaLabel(item: IFile, escapeMethod: (text: string) => string) {
        return `${escapeMethod(getDocDisplayName(item.name, item.titleEmpty))} <small class='ft__on-surface'>${item.hSize}</small>${item.bookmark ? "<br>" + window.siyuan.languages.bookmark + " " + escapeMethod(item.bookmark) : ""}${item.name1 ? "<br>" + window.siyuan.languages.name + " " + escapeMethod(item.name1) : ""}${item.alias ? "<br>" + window.siyuan.languages.alias + " " + escapeMethod(item.alias) : ""}${item.memo ? "<br>" + window.siyuan.languages.memo + " " + escapeMethod(item.memo) : ""}${item.subFileCount !== 0 ? window.siyuan.languages.includeSubFile.replace("x", item.subFileCount) : ""}<br>${window.siyuan.languages.modifiedAt} ${item.hMtime}<br>${window.siyuan.languages.createdAt} ${item.hCtime}`;
    }

    private genFileHTML(item: IFile) {
        let countHTML = "";
        if (item.count && item.count > 0) {
            countHTML = `<span class="popover__block counter b3-tooltips b3-tooltips__nw" aria-label="${window.siyuan.languages.ref}">${item.count}</span>`;
        }
        const ariaLabel = this.genDocAriaLabel(item, escapeAriaLabel);
        const paddingLeft = (item.path.split("/").length - 1) * 18;
        const editingPublishAccess = this.element.classList.contains("file-tree__publish-access--active");
        const iconExpands = window.siyuan.config.fileTree.docIconClickExpand;
        const iconAriaLabel = iconExpands ?
            (item.subFileCount > 0 ? window.siyuan.languages.docIconClickExpand : window.siyuan.languages.openDocument) :
            window.siyuan.languages.changeIcon;
        const actionClasses = `${iconExpands && item.subFileCount > 0 && !editingPublishAccess ? " file-tree__item--icon-expand" : ""}${
            iconExpands && item.subFileCount === 0 && !editingPublishAccess ? " file-tree__item--icon-open" : ""}${
            window.siyuan.config.fileTree.parentDocClickExpand && item.subFileCount > 0 ? " file-tree__item--title-expand" : ""}`;
        return `<li data-node-id="${item.id}" data-name="${Lute.EscapeHTMLStr(item.name)}" draggable="true" data-count="${item.subFileCount}" 
data-type="navigation-file" 
style="--file-toggle-width:${paddingLeft + 18}px;--file-action-offset:${paddingLeft + 20}px"
class="b3-list-item b3-list-item--hide-action${actionClasses}" data-path="${item.path}">
    <span style="padding-left: ${paddingLeft}px" class="b3-list-item__toggle b3-list-item__toggle--hl${item.subFileCount === 0 ? " fn__hidden" : ""}">
        <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
    </span>
    <span class="b3-list-item__icon ariaLabel popover__block${editingPublishAccess ? " fn__none" : ""}" data-position="8east" data-id="${item.id}" aria-label="${iconAriaLabel}">${unicode2Emoji(item.icon || (item.subFileCount === 0 ? window.siyuan.storage[Constants.LOCAL_IMAGES].file : window.siyuan.storage[Constants.LOCAL_IMAGES].folder))}</span>
    <span class="b3-list-item__switch b3-tooltips b3-tooltips__n${editingPublishAccess ? "" : " fn__none"}" aria-label="${window.siyuan.languages.publishAccess}">${getPublishAccessOptionByLevel("public").iconHTML}</span>
    <span class="b3-list-item__text ariaLabel" data-delay="200" data-position="parentE"
aria-label="${ariaLabel}">${getDocDisplayName(item.name, item.titleEmpty, true)}</span>
    <span data-type="more-file" class="b3-list-item__action b3-tooltips b3-tooltips__nw" aria-label="${window.siyuan.languages.more}">
        <svg><use xlink:href="#iconMore"></use></svg>
    </span>
    <span data-type="new" class="b3-list-item__action b3-tooltips b3-tooltips__nw${window.siyuan.config.readonly ? " fn__none" : ""}" aria-label="${window.siyuan.languages.newSubDoc}">
        <svg><use xlink:href="#iconAdd"></use></svg>
    </span>
    ${countHTML}
</li>`;
    }

    private initMoreMenu() {
        window.siyuan.menus.menu.remove();
        if (!window.siyuan.config.readonly) {
            window.siyuan.menus.menu.append(new MenuItem({
                icon: "iconNewNoteBook",
                label: window.siyuan.languages.newNotebook,
                click: () => {
                    newNotebook();
                }
            }).element);
            if (window.siyuan.config.notebookCrypto?.enabled) {
                window.siyuan.menus.menu.append(new MenuItem({
                    icon: "iconLock",
                    label: window.siyuan.languages.newEncryptedNotebook,
                    click: () => {
                        newEncryptedNotebook();
                    }
                }).element);
            }
        }
        window.siyuan.menus.menu.append(new MenuItem({
            icon: "iconRefresh",
            label: window.siyuan.languages.rebuildDataIndex,
            click: () => {
                if (!this.element.getAttribute("disabled")) {
                    this.element.setAttribute("disabled", "disabled");
                    refreshFileTree(() => {
                        this.element.removeAttribute("disabled");
                        this.init(false);
                    });
                }
            }
        }).element);
        if (!window.siyuan.config.readonly) {
            const subMenu = sortMenu("notebooks", window.siyuan.config.fileTree.sort, (sort: number) => {
                fetchPost("/api/setting/setFiletree", {
                    ...window.siyuan.config.fileTree,
                    sort,
                }, (response) => {
                    window.siyuan.config.fileTree = response.data;
                    setNoteBook(() => {
                        this.init(false);
                    });
                });
            });
            window.siyuan.menus.menu.append(new MenuItem({
                icon: "iconSort",
                label: window.siyuan.languages.sort,
                type: "submenu",
                submenu: subMenu,
            }).element);
        }
        if (!window.siyuan.config.readonly && window.siyuan.config.publish.enable) {
            window.siyuan.menus.menu.append(new MenuItem({
                icon: "iconEye",
                label: window.siyuan.languages.publishAccess,
                checked: this.element.classList.contains("file-tree__publish-access--active"),
                click: () => {
                    this.element.classList.toggle("file-tree__publish-access--active");
                    const editingPublishAccess = this.element.classList.contains("file-tree__publish-access--active");
                    this.element.querySelectorAll(".b3-list-item__icon").forEach(item => {
                        item.classList.toggle("fn__none", editingPublishAccess);
                        item.nextElementSibling.classList.toggle("fn__none", !editingPublishAccess);
                    });
                    this.updateDocActions();
                    this.refreshPublishAccessSwitch();
                }
            }).element);
        }
        return window.siyuan.menus.menu;
    }

    private refreshPublishAccessSwitch() {
        if (window.siyuan.config.readonly || window.siyuan.isPublish ||
            !this.element.classList.contains("file-tree__publish-access--active")) {
            return;
        }
        const ids: string[] = [];
        this.element.querySelectorAll("[data-url]").forEach((element: HTMLElement) => ids.push(element.getAttribute("data-url")));
        this.element.querySelectorAll("[data-type=\"navigation-file\"][data-node-id]").forEach((element: HTMLElement) => ids.push(element.getAttribute("data-node-id")));
        fetchPost("/api/filetree/getPublishAccess", {
            ids
        }, response => {
            response.data.publishAccess.forEach((item: IPublishAccessItem) => {
                const element = this.element.querySelector(`[data-url="${item.id}"] .b3-list-item__switch`) || this.element.querySelector(`[data-node-id="${item.id}"] .b3-list-item__switch`);
                if (element) {
                    element.innerHTML = getPublishAccessOptionByLevel(getPublishAccessLevel(item.visible, item.password, item.disable)).iconHTML;
                }
            });
        });
    }
}
