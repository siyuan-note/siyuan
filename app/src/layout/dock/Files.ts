import {DocTreeController, getActiveDocTreeController} from "./docTree/DocTreeController";
import type {IDocTreeItem} from "./docTree/types";
import {createDocTreeSelectionProgress} from "./docTree/selectionProgress";
import {config as configApi} from "../../config/util/configApi";
import {escapeHtml, escapeHtmlTextAndAttr} from "../../util/escape";
import {genFileTreeDocAriaLabel} from "../../util/fileTreeTooltip";
import {Tab} from "../Tab";
import {Model} from "../Model";
import {getInstanceById, setPanelFocus} from "../util";
import {getDockByType} from "../tabUtil";
import {Constants} from "../../constants";
import {getDocDisplayName, isMoveTargetAllowed, pathPosix, setNoteBook} from "../../util/pathName";
import {newFileInTree} from "../../util/newFile";
import {initFileMenu, initNavigationMenu, sortMenu} from "../../menus/navigation";
import {getDocTreeActionItems, getDocTreeTopPaths} from "../../menus/navigationSelection";
import {toggleMenu} from "../../menus/menuToggle";
import {MenuItem} from "../../menus/Menu";
import {showMessage} from "../../dialog/message";
import {
    getPublishAccessLevel,
    getPublishAccessOptionByLevel,
    openPublishAccessDialog
} from "../../protyle/util/publishAccess";
import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {restoreDocTreeState, saveDocTreeState} from "../../util/docTreeState";
import {openEmojiPanel} from "../../emoji";
import {
    getFileTreeDefaultIconAttr,
    getFileTreeIconHTML,
} from "../../emoji/fileTreeIcon";
import {importNotebook, newEncryptedNotebook, newNotebook, openEncryptedNotebook} from "../../util/mount";
import {isNotCtrl, isOnlyMeta, isPhablet, setStorageVal, updateHotkeyAfterTip} from "../../protyle/util/compatibility";
import {openFileById} from "../../editor/util";
import {hasClosestByClassName} from "../../protyle/util/hasClosest";
import type {App} from "../../index";
import {refreshFileTree} from "../../dialog/processSystem";
import {confirmDialog} from "../../dialog/confirmDialog";
import {emitToPlugins} from "../../plugin/EventBusCore";
/// #if !BROWSER
import {ipcRenderer} from "electron";
/// #endif
import {hideTooltip, showTooltip} from "../../dialog/tooltip";
import {selectOpenTab} from "./util";
import {hideDragTip, setDragTipGhost, showDragTip} from "../../protyle/util/dragTip";
import {parseBlockDragData} from "../../protyle/util/dragDocument";
import {
    getRelativeReorderRequest,
    IDocumentTabDragData,
    parseDocumentTabDragData
} from "../../util/fileTreeMove";
import {
    FILE_TREE_CHILDREN_SORT_MODE,
    type IDocSortModeChanged,
    updateFileTreeSortMode
} from "../../util/fileTreeSort";
import {clearDocumentTabMovePreview} from "../tabDrag";
import {reorderSortedFileTree} from "../../util/fileTreeReorder";
import {getHostCapabilities} from "../../util/hostCapabilities";
import {PinnedDocs} from "./PinnedDocs";
import {ParentDocClick} from "./parentDocClick";
import {stopScrollAnimation} from "../../boot/globalEvent/dragover";

export class Files extends Model {
    public element: HTMLElement;
    public parent: Tab;
    public closeElement: HTMLElement;
    public docTree: DocTreeController;
    private saveStateTimeout: number;
    private selectionProgress = createDocTreeSelectionProgress();
    private dragSelection: {version: number, items: IDocTreeItem[], key: string};
    private cancelDrag: (event?: DragEvent) => void;
    private disposed = false;

    public get lastSelectedElement(): Element {
        const item = this.docTree?.getFocusedItem();
        return item ? this.docTree.getMountedElement(item.occurrenceKey) ||
            Array.from(this.docTree.getSelectionElements()).find(row => row.dataset.treeKey === item.occurrenceKey) || null : null;
    }

    public set lastSelectedElement(element: Element) {
        const item = this.docTree?.getItemFromElement(element);
        this.docTree?.setFocused(item?.occurrenceKey);
    }

    public getSelectedItems(): {id: string, path: string, notebookId: string}[] {
        const controller = getActiveDocTreeController(this.element.parentElement) || this.docTree;
        return getDocTreeActionItems(controller.getSelectedItems()).map(({id, path, notebookId}) => ({id, path, notebookId}));
    }

    public getSelectionElements(): NodeListOf<HTMLElement> {
        return (getActiveDocTreeController(this.element.parentElement) || this.docTree).getSelectionElements();
    }
    private actionsElement: HTMLElement;
    private pinnedDocs: PinnedDocs;
    private parentDocClick = new ParentDocClick();
    private reloadNotebookInfoTimeout: number;
    private publishAccessTimeout: number;
    private publishAccessKey = "";
    private publishAccessGeneration = 0;

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
    <div data-type="more" data-menu="true" class="ariaLabel block__icon${window.siyuan.config.readonly ? " fn__none" : ""}" data-position="north" aria-label="${window.siyuan.languages.more}">
        <svg><use xlink:href="#iconMore"></use></svg>
    </div>
    <span class="fn__space"></span>
    <span data-type="min" class="block__icon ariaLabel" data-position="north" aria-label="${window.siyuan.languages.min}${updateHotkeyAfterTip(window.siyuan.config.keymap.general.closeTab.custom)}"><svg><use xlink:href='#iconMin'></use></svg></span>
</div>
<div class="file-tree__items fn__flex-1" style="padding-top: 2px;"></div>
<ul class="b3-list fn__flex-column" style="min-height: auto;height:30px;border-top: 1px solid var(--b3-border-color);transition: height  .2s cubic-bezier(0, 0, .2, 1) 0ms">
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
        this.docTree = new DocTreeController({
            element: this.element,
            roots: [],
            renderRow: item => this.renderTreeRow(item),
            onSelectionChange: () => {
                if (this.docTree?.getSelectedItems().length) { this.pinnedDocs?.clearSelection(); }
            },
            onExpansionChange: () => this.getOpenPaths(),
            onSelectionProgress: this.selectionProgress.update,
            onRowsRendered: () => this.refreshPublishAccessSwitch(),
        });
        this.element.addEventListener("scroll", () => {
            window.clearTimeout(this.saveStateTimeout);
            this.saveStateTimeout = window.setTimeout(() => this.getOpenPaths(), 250);
        }, {passive: true});
        this.pinnedDocs = new PinnedDocs(options.app, this.element, (id) => {
            openFileById({app: options.app, id, action: [Constants.CB_GET_FOCUS, Constants.CB_GET_SCROLL]});
        }, false, this.parentDocClick);
        this.closeElement.addEventListener("click", (event) => {
            setPanelFocus(this.element.parentElement);
            let target = event.target as HTMLElement;
            while (target && !target.isEqualNode(this.closeElement)) {
                const type = target.getAttribute("data-type");
                if (target.classList.contains("b3-list-item__icon")) {
                    event.preventDefault();
                    event.stopPropagation();
                    const notebookElement = target.closest("li[data-encrypted=true]");
                    if (notebookElement) {
                        openEncryptedNotebook(this.app, notebookElement.getAttribute("data-url"), notebookElement.querySelector(".b3-list-item__text").textContent);
                        break;
                    }
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
            this.parentDocClick.cancel();
            this.pinnedDocs.collapse();
            this.docTree.collapseAll();
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
                    toggleMenu({
                        target: target, build: () => {
                            const rect = target.getBoundingClientRect();
                            this.initMoreMenu().popup({x: rect.left, y: rect.bottom, h: rect.height});
                        }
                    });
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
                        action: isPhablet() ? [Constants.CB_GET_SCROLL] : [Constants.CB_GET_FOCUS, Constants.CB_GET_SCROLL],
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
            if (!target.closest(".b3-list-item__text") || !isNotCtrl(event) || event.altKey || event.shiftKey) {
                this.parentDocClick.cancel();
            }
            const ulElement = target.closest<HTMLElement>("li[data-notebook-id]");
            let needFocus = true;
            if (ulElement) {
                const notebookId = ulElement.dataset.notebookId;
                while (target && !target.isEqualNode(this.element)) {
                    if (isNotCtrl(event) && !event.shiftKey && target.classList.contains("b3-list-item__icon") && window.siyuan.config.system.container !== "ios") {
                        event.preventDefault();
                        event.stopPropagation();
                        const liElement = target.parentElement;
                        const isFile = liElement.getAttribute("data-type") === "navigation-file";
                        // 单击文档图标展开或折叠下级，笔记本图标始终用于修改图标
                        if (isFile && window.siyuan.config.fileTree.docIconClickMode === 1) {
                            if (Number(liElement.getAttribute("data-count")) > 0) {
                                this.lastSelectedElement = liElement;
                                this.setCurrent(liElement, false);
                                this.toggleLeaf(liElement, notebookId);
                                break;
                            }
                            needFocus = false;
                            if (!liElement.getAttribute("data-opening")) {
                                this.lastSelectedElement = liElement;
                                this.setCurrent(liElement, false);
                                liElement.setAttribute("data-opening", "true");
                                openFileById({
                                    app: options.app,
                                    id: liElement.getAttribute("data-node-id"),
                                    action: isPhablet() ? [Constants.CB_GET_SCROLL] : [Constants.CB_GET_FOCUS, Constants.CB_GET_SCROLL],
                                    afterOpen() {
                                        liElement.removeAttribute("data-opening");
                                    }
                                });
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
                            openEmojiPanel(notebookId, "notebook", {
                                x: rect.left,
                                y: rect.bottom,
                                h: rect.height,
                                w: rect.width,
                            }, undefined, target.querySelector("img"));
                        }
                        break;
                    } else if (isNotCtrl(event) && target.classList.contains("b3-list-item__toggle")) {
                        const liElement = target.parentElement;
                        this.toggleLeaf(liElement, notebookId);
                        event.preventDefault();
                        event.stopPropagation();
                        window.siyuan.menus.menu.remove();
                        break;
                    } else if (target.classList.contains("b3-list-item__switch")) {
                        event.preventDefault();
                        event.stopPropagation();
                        if (target.closest("[data-encrypted=true]")) {
                            break;
                        }
                        const rect = target.getBoundingClientRect();
                        openPublishAccessDialog(target.parentElement.getAttribute("data-type") === "navigation-root" ?
                            notebookId : target.parentElement.getAttribute("data-node-id"), {
                            x: rect.left,
                            y: rect.bottom,
                            h: rect.height,
                            w: rect.width,
                        }, (access) => {
                            target.innerHTML = access.iconHTML;
                            this.publishAccessKey = "";
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
                                toggleMenu({
                                    target: target, build: () => {
                                        const rect = target.getBoundingClientRect();
                                        initNavigationMenu(options.app, target.parentElement).popup({
                                            x: rect.left,
                                            y: rect.bottom,
                                            h: rect.height,
                                        });
                                    }
                                });
                            }
                        }
                        if (type === "more-file") {
                            toggleMenu({
                                target: target, build: () => {
                                    const rect = target.getBoundingClientRect();
                                    initFileMenu(options.app, notebookId, pathString, target.parentElement).popup({
                                        x: rect.left,
                                        y: rect.bottom,
                                        h: rect.height,
                                    });
                                }
                            });
                        }
                        event.preventDefault();
                        event.stopPropagation();
                        break;
                    } else if (event.button === 0 && isNotCtrl(event) && !event.altKey && !event.shiftKey &&
                        target.classList.contains("b3-list-item__text") &&
                        (target.parentElement.getAttribute("data-type") === "navigation-file" ||
                            (target.parentElement.getAttribute("data-type") === "navigation-root" && target.parentElement.getAttribute("data-node-id"))) &&
                        window.siyuan.config.fileTree.parentDocTitleClickMode !== 0 &&
                        Number(target.parentElement.getAttribute("data-count")) > 0) {
                        this.lastSelectedElement = target.parentElement;
                        this.setCurrent(target.parentElement, false);
                        const row = target.parentElement;
                        // 单击展开且不双击打开时立即切换，无需等待双击判定
                        if (window.siyuan.config.fileTree.parentDocTitleClickMode !== 2) {
                            this.toggleLeaf(row, notebookId);
                            event.preventDefault();
                            event.stopPropagation();
                            window.siyuan.menus.menu.remove();
                            break;
                        }
                        this.parentDocClick.click(row, async () => {
                            const item = this.docTree.getItemFromElement(row);
                            if (!item) { return; }
                            const key = item.occurrenceKey;
                            const expanded = this.docTree.isExpanded(key);
                            if (!expanded && !await this.docTree.itemAtDirectoryIndex(key, 0)) { return; }
                            return () => {
                                if (this.docTree.getItem(key)?.path === item.path &&
                                    this.docTree.isExpanded(key) === expanded &&
                                    window.siyuan.config.fileTree.parentDocTitleClickMode === 2) {
                                    void this.docTree.toggle(key);
                                }
                            };
                        }, () => {
                            openFileById({
                                app: options.app,
                                id: row.getAttribute("data-node-id"),
                                action: isPhablet() ? [Constants.CB_GET_SCROLL] : [Constants.CB_GET_FOCUS, Constants.CB_GET_SCROLL],
                            });
                        });
                        event.preventDefault();
                        event.stopPropagation();
                        window.siyuan.menus.menu.remove();
                        break;
                    } else if (target.tagName === "LI") {
                        this.parentDocClick.cancel();
                        if (isOnlyMeta(event) && !event.altKey && !event.shiftKey) {
                            const item = this.docTree.getItemFromElement(target);
                            if (item) { void this.docTree.select(item.occurrenceKey, {toggle: true}); }
                        } else if (event.shiftKey && !event.altKey && isNotCtrl(event)) {
                            const item = this.docTree.getItemFromElement(target);
                            if (item) { void this.docTree.select(item.occurrenceKey, {range: true}); }
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
                                        action: isPhablet() ? [Constants.CB_GET_SCROLL] : [Constants.CB_GET_FOCUS, Constants.CB_GET_SCROLL],
                                        afterOpen() {
                                            target.removeAttribute("data-opening");
                                        }
                                    });
                                } else if (!event.altKey && isOnlyMeta(event) && event.shiftKey) {
                                    openFileById({
                                        app: options.app,
                                        id: target.getAttribute("data-node-id"),
                                        position: "bottom",
                                        action: isPhablet() ? [Constants.CB_GET_SCROLL] : [Constants.CB_GET_FOCUS, Constants.CB_GET_SCROLL],
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
                                        action: isPhablet() ? [Constants.CB_GET_SCROLL] : [Constants.CB_GET_FOCUS, Constants.CB_GET_SCROLL],
                                        afterOpen() {
                                            target.removeAttribute("data-opening");
                                        }
                                    });
                                } else {
                                    openFileById({
                                        app: options.app,
                                        id: target.getAttribute("data-node-id"),
                                        action: isPhablet() ? [Constants.CB_GET_SCROLL] : [Constants.CB_GET_FOCUS, Constants.CB_GET_SCROLL],
                                        afterOpen() {
                                            target.removeAttribute("data-opening");
                                        }
                                    });
                                }
                            } else if (target.getAttribute("data-type") === "navigation-root") {
                                this.toggleLeaf(target, notebookId);
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
        this.element.addEventListener("dragstart", (event: DragEvent & {target: HTMLElement}) => {
            this.parentDocClick.cancel();
            if (window.siyuan.config.readonly) { event.preventDefault(); return; }
            const row = event.target.closest<HTMLElement>("li[data-tree-key]");
            const item = this.docTree.getItemFromElement(row);
            if (!item) { event.preventDefault(); return; }
            window.getSelection().removeAllRanges();
            hideTooltip();
            if (!this.docTree.getSelectedItems().some(value => value.occurrenceKey === item.occurrenceKey)) {
                this.setCurrent(row, false);
            }
            const selected = this.docTree.getSelectedItems();
            if (!selected.length || selected.some(value => value.kind !== item.kind)) {
                event.preventDefault();
                return;
            }
            this.docTree.setFocused(item.occurrenceKey);
            this.docTree.retain(item.occurrenceKey);
            this.dragSelection = {version: this.docTree.selectionVersion, items: selected, key: item.occurrenceKey};
            this.parent.panelElement.classList.add("sy__file--disablehover");
            const ids = selected.map(value => value.id).join(",");
            const ghost = document.createElement("ul");
            selected.slice(0, 8).forEach(value => ghost.append(this.renderTreeRow(value)));
            selected.forEach(value => {
                const mounted = this.docTree.getMountedElement(value.occurrenceKey);
                if (mounted) { mounted.style.opacity = "0.38"; }
            });
            ghost.style.cssText = "width:219px;position:fixed;top:-10000px";
            ghost.className = "b3-list b3-list--background";
            document.body.append(ghost);
            setDragTipGhost(ghost, 16, 16);
            event.dataTransfer.setDragImage(ghost, 16, 16);
            if (window.siyuan.touchDragActive) { window.siyuan.touchDragGhost = ghost; }
            else { setTimeout(() => ghost.remove()); }
            event.dataTransfer.setData(Constants.SIYUAN_DROP_FILE, ids);
            if (item.kind === "document") {
                event.dataTransfer.setData(Constants.SIYUAN_DROP_DOCUMENTS, JSON.stringify({ids: selected.map(value => value.id)}));
            }
            event.dataTransfer.dropEffect = "move";
            window.siyuan.dragTitle = selected.length > 1 ?
                (item.kind === "document" ? window.siyuan.languages.dragTipSelectedDocs :
                    window.siyuan.languages.dragTipSelectedNotebooks).replace("${count}", selected.length.toString()) : item.name;
            window.siyuan.dragElement = document.createElement("div");
            window.siyuan.dragElement.innerText = ids;
        });
        const dragOverLastObj: {
            element: HTMLElement,
            positionY: number,
            rafId: number,
            sourceOnlyRoot: boolean,
            update?: () => void,
            refresh?: () => void,
        } = {
            element: null,
            positionY: null,
            rafId: null,
            sourceOnlyRoot: null
        };
        let counter = 0;
        this.element.addEventListener("scroll", () => {
            if (dragOverLastObj.refresh && !dragOverLastObj.rafId) {
                dragOverLastObj.rafId = requestAnimationFrame(() => {
                    dragOverLastObj.rafId = null;
                    dragOverLastObj.refresh?.();
                });
            }
        }, {passive: true});
        this.cancelDrag = (event?: DragEvent) => {
            const ownsSource = Boolean(this.dragSelection);
            const hasHover = Boolean(dragOverLastObj.refresh || dragOverLastObj.element);
            if (ownsSource || hasHover) { stopScrollAnimation(); }
            if (this.dragSelection) { this.docTree.release(this.dragSelection.key); }
            this.dragSelection = undefined;
            counter = 0;
            if (dragOverLastObj.rafId) {
                cancelAnimationFrame(dragOverLastObj.rafId);
                dragOverLastObj.rafId = null;
            }
            dragOverLastObj.update = undefined;
            dragOverLastObj.refresh = undefined;
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
                if (event && index === 0 && hasClosestByClassName(document.elementFromPoint(event.clientX, event.clientY), "sy__file")) {
                    const ariaLabelElement = item.querySelector(".ariaLabel");
                    if (ariaLabelElement) {
                        showTooltip(ariaLabelElement.getAttribute("aria-label"), ariaLabelElement);
                    }
                }
            });
            if (!ownsSource && !event) {
                if (hasHover) { hideDragTip(); }
                return;
            }
            window.siyuan.touchDragGhost?.remove();
            window.siyuan.touchDragGhost = undefined;
            window.siyuan.dragElement = undefined;
            hideDragTip();
            window.siyuan.dragTitle = "";
            clearDocumentTabMovePreview();
            /// #if !BROWSER
            ipcRenderer.send(Constants.SIYUAN_SEND_WINDOWS, {cmd: "resetTabsStyle", data: "rmDragStyle"});
            /// #else
            document.querySelectorAll(".layout-tab-bars--drag").forEach(item => {
                item.classList.remove("layout-tab-bars--drag");
            });
            /// #endif
        };
        this.element.addEventListener("dragend", event => this.cancelDrag(event));
        this.element.addEventListener("dragover", (event: DragEvent & { target: HTMLElement }) => {
            const isDocumentTab = event.dataTransfer.types.includes(Constants.SIYUAN_DROP_DOCUMENT_TAB);
            let gutterType = "";
            for (const item of event.dataTransfer.items) {
                if (item.type.startsWith(Constants.SIYUAN_DROP_GUTTER)) {
                    gutterType = item.type;
                }
            }
            const isForeignFileDrag = event.dataTransfer.types.includes(Constants.SIYUAN_DROP_FILE) &&
                !window.siyuan.dragElement;
            if (window.siyuan.config.readonly || (!window.siyuan.dragElement && !gutterType) ||
                (event.dataTransfer.types.includes(Constants.SIYUAN_DROP_TAB) && !isDocumentTab)) {
                if (isForeignFileDrag) {
                    this.element.querySelectorAll(".dragover, .dragover__bottom, .dragover__top").forEach((item) => {
                        item.classList.remove("dragover", "dragover__bottom", "dragover__top");
                    });
                    hideDragTip();
                }
                event.preventDefault();
                return;
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
            const updateDragOver = () => {
                const hitElement = document.elementFromPoint(event.clientX, event.clientY);
                let liElement = hitElement?.closest("li") as HTMLElement;
                if (!liElement) {
                    liElement = document.elementFromPoint(event.clientX, event.clientY - 1)?.closest("li") as HTMLElement;
                }
                if (!liElement || !this.element.contains(liElement)) {
                    dragOverLastObj.element?.classList.remove("dragover", "dragover__bottom", "dragover__top");
                    dragOverLastObj.element = null;
                    dragOverLastObj.positionY = null;
                    hideDragTip();
                    event.preventDefault();
                    return;
                }
                const targetType = liElement.getAttribute("data-type");
                const targetChanged = dragOverLastObj.element !== liElement;
                if (targetChanged) {
                    dragOverLastObj.element?.classList.remove("dragover", "dragover__bottom", "dragover__top");
                    if (gutterType) {
                        // 块标拖拽
                        const gutterTypes = gutterType.replace(Constants.SIYUAN_DROP_GUTTER, "").split(Constants.ZWSP);
                        if (!["nodelistitem", "nodeheading"].includes(gutterTypes[0])) {
                            event.preventDefault();
                            return;
                        }
                    } else if (isDocumentTab && liElement.dataset.nodeId ===
                        window.siyuan.dragElement.dataset.dragDocumentId) {
                        hideDragTip();
                        event.preventDefault();
                        return;
                    } else if (!isDocumentTab && liElement.classList.contains("b3-list-item--focus")) {
                        // 选中的文档不能拖拽到自己上，但允许标题拖拽到文档树的选中文档上 https://github.com/siyuan-note/siyuan/issues/6552
                        hideDragTip();
                        event.preventDefault();
                        return;
                    }

                    dragOverLastObj.sourceOnlyRoot = !gutterType && !isDocumentTab &&
                        this.docTree.getSelectedItems().every(item => item.kind === "notebook");
                    if (dragOverLastObj.sourceOnlyRoot && targetType !== "navigation-root") {
                        hideDragTip();
                        event.preventDefault();
                        return;
                    }
                }
                if (targetChanged || dragOverLastObj.positionY !== event.clientY || !event.isTrusted) {
                    const targetListElement = liElement.parentElement;
                    if (!targetListElement) {
                        hideDragTip();
                        event.preventDefault();
                        return;
                    }
                    if ((dragOverLastObj.sourceOnlyRoot && targetType === "navigation-root" && window.siyuan.config.fileTree.sort === 6) ||
                        (!dragOverLastObj.sourceOnlyRoot && targetType !== "navigation-root" &&
                            (this.docTree.getItemFromElement(liElement)?.effectiveSortMode === 6 || !gutterType))
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
                if (targetChanged) {
                    dragOverLastObj.element = liElement;
                }
                dragOverLastObj.positionY = event.clientY;
                // 文档→文档拖拽：依据当前高亮类显示对应操作提示（带目标文档名）
                if (!gutterType) {
                    const name = liElement.querySelector(".b3-list-item__text")?.textContent || "";
                    const title = window.siyuan.dragTitle || "";
                    if (liElement.classList.contains("dragover__top")) {
                        showDragTip(title, window.siyuan.languages.dragTipMoveBefore, event.clientX, event.clientY, name);
                    } else if (liElement.classList.contains("dragover__bottom")) {
                        showDragTip(title, window.siyuan.languages.dragTipMoveAfter, event.clientX, event.clientY, name);
                    } else if (liElement.classList.contains("dragover")) {
                        showDragTip(title, window.siyuan.languages.dragTipMoveChild, event.clientX, event.clientY, name);
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
                            action = window.siyuan.languages.dragTip2DocBefore;
                        } else if (liElement.classList.contains("dragover__bottom")) {
                            action = window.siyuan.languages.dragTip2DocAfter;
                        } else {
                            action = window.siyuan.languages.dragTip2DocChild;
                        }
                        showDragTip(title, action, event.clientX, event.clientY, name);
                    }
                }
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
            };
            dragOverLastObj.update = updateDragOver;
            dragOverLastObj.refresh = updateDragOver;
            if (!dragOverLastObj.rafId) {
                dragOverLastObj.rafId = requestAnimationFrame(() => {
                    dragOverLastObj.rafId = null;
                    const update = dragOverLastObj.update;
                    dragOverLastObj.update = undefined;
                    update?.();
                });
            }
            event.preventDefault();
        });
        this.element.addEventListener("dragleave", () => {
            counter--;
            if (counter <= 0) {
                counter = 0;
                if (dragOverLastObj.rafId) {
                    cancelAnimationFrame(dragOverLastObj.rafId);
                    dragOverLastObj.rafId = null;
                }
                dragOverLastObj.update = undefined;
                dragOverLastObj.refresh = undefined;
                dragOverLastObj.element = null;
                dragOverLastObj.positionY = null;
                dragOverLastObj.sourceOnlyRoot = null;
                this.element.querySelectorAll(".dragover, .dragover__bottom, .dragover__top").forEach((item: HTMLElement) => {
                    item.classList.remove("dragover", "dragover__bottom", "dragover__top");
                });
                hideDragTip();
            }
        });
        this.element.addEventListener("dragenter", (event: DragEvent) => {
            event.preventDefault();
            if (!event.isTrusted) {
                // 合成拖拽滚动后会重新命中节点，不依赖已被移除节点的 dragleave 来平衡计数。
                counter = 0;
            }
            counter++;
        });
        this.element.addEventListener("drop", async (event: DragEvent & { target: HTMLElement }) => {
            counter = 0;
            if (dragOverLastObj.rafId) {
                cancelAnimationFrame(dragOverLastObj.rafId);
                dragOverLastObj.rafId = null;
            }
            const updateDragOver = dragOverLastObj.update || dragOverLastObj.refresh;
            dragOverLastObj.update = undefined;
            dragOverLastObj.refresh = undefined;
            updateDragOver?.();
            hideDragTip();
            window.siyuan.dragTitle = "";
            if (event.dataTransfer.types.includes(Constants.SIYUAN_DROP_FILE) && !window.siyuan.dragElement) {
                this.element.querySelectorAll(".dragover, .dragover__bottom, .dragover__top").forEach((item) => {
                    item.classList.remove("dragover", "dragover__bottom", "dragover__top");
                });
                return;
            }
            const documentTabData = event.dataTransfer.types.includes(Constants.SIYUAN_DROP_DOCUMENT_TAB) ?
                parseDocumentTabDragData(event.dataTransfer.getData(Constants.SIYUAN_DROP_DOCUMENT_TAB)) : undefined;
            const sourceTab = documentTabData ? getInstanceById(documentTabData.tabId) as Tab : undefined;
            sourceTab?.restoreHeadElementOrder();
            const newElement = this.element.querySelector<HTMLElement>(".dragover, .dragover__bottom, .dragover__top");
            if (!newElement) {
                return;
            }
            const targetItem = this.docTree.getItemFromElement(newElement);
            if (!targetItem) { return; }
            const toURL = targetItem.notebookId;
            const toPath = targetItem.path;
            if (documentTabData) {
                event.preventDefault();
                event.stopPropagation();
                window.siyuan.dragElement = undefined;
                await this.dropDocumentTab(documentTabData, newElement);
                return;
            }
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
                    const sourceNotebookId = window.siyuan.dragElement?.closest("[data-notebook-id]")?.getAttribute("data-notebook-id") ||
                        parseBlockDragData(event.dataTransfer.getData(gutterType)).notebookID;
                    if (!isMoveTargetAllowed([sourceNotebookId], toURL)) {
                        showMessage(window.siyuan.languages._kernel[391]);
                        newElement.classList.remove("dragover", "dragover__bottom", "dragover__top");
                        window.siyuan.dragElement = undefined;
                        return;
                    }
                    const toDocOptions: {
                        targetNoteBook: string;
                        toTop?: boolean;
                        targetPath?: string;
                        previousPath?: string;
                    } = {
                        targetNoteBook: toURL,
                    };
                    if (newElement.classList.contains("dragover")) {
                        toDocOptions.targetPath = toPath;
                    } else if (newElement.classList.contains("dragover__bottom")) {
                        toDocOptions.previousPath = toPath;
                    } else if (newElement.classList.contains("dragover__top")) {
                        const previous = await this.docTree.sibling(targetItem, -1);
                        if (previous) {
                            toDocOptions.previousPath = previous.path;
                        } else {
                            const directory = pathPosix().dirname(targetItem.path);
                            toDocOptions.targetPath = directory === "/" ? "/" : `${directory}.sy`;
                            toDocOptions.toTop = true;
                        }
                    }
                    if (gutterTypes[0] === "nodeheading") {
                        fetchPost("/api/filetree/heading2Doc", {...toDocOptions, srcHeadingID: gutterTypes[2].split(",")[0]});
                    } else {
                        fetchPost("/api/filetree/li2Doc", {...toDocOptions, srcListItemID: gutterTypes[2].split(",")[0]});
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
            if (this.dragSelection && !this.docTree.validateSelection(this.dragSelection.version, this.dragSelection.items)) {
                newElement.classList.remove("dragover", "dragover__bottom", "dragover__top");
                return;
            }
            const selection = this.dragSelection?.items || this.docTree.getSelectedItems();
            const roots = selection.filter(item => item.kind === "notebook");
            const files = selection.filter(item => item.kind === "document");
            const after = newElement.classList.contains("dragover__bottom");
            const asChild = newElement.classList.contains("dragover");
            if (roots.length && files.length) { return; }
            if (roots.length) {
                if (targetItem.kind !== "notebook" || window.siyuan.config.fileTree.sort !== 6) { return; }
                await fetchSyncPost("/api/notebook/reorder", getRelativeReorderRequest(
                    roots.map(item => item.notebookId), toURL, after));
                this.onNotebookSortChanged();
            } else if (files.length) {
                if (!isMoveTargetAllowed(files.map(item => item.notebookId), toURL)) {
                    showMessage(window.siyuan.languages._kernel[391]);
                } else if (asChild) {
                    if (files.some(item => item.notebookId === toURL &&
                        (item.path === toPath || toPath.startsWith(item.path.slice(0, -3) + "/")))) {
                        showMessage(window.siyuan.languages._kernel[87], 7000, "error");
                    } else {
                        await fetchSyncPost("/api/filetree/moveDocs", {
                            toNotebook: toURL, fromPaths: getDocTreeTopPaths(files), toPath,
                        });
                        await this.docTree.reload();
                    }
                } else {
                    await this.reorderSortedDocuments(files.map(item => item.id), targetItem.id, after);
                }
            }
            newElement.classList.remove("dragover", "dragover__bottom", "dragover__top");
        });
        this.init();
    }

    private async reorderSortedDocuments(sourceIDs: string[], targetID: string, after: boolean) {
        const result = await reorderSortedFileTree(sourceIDs, targetID, after);
        if (result) { await this.docTree.reload(); }
    }

    private async dropDocumentTab(documentTabData: IDocumentTabDragData, targetElement: HTMLElement) {
        const target = this.docTree.getItemFromElement(targetElement);
        const asChild = targetElement.classList.contains("dragover");
        const after = targetElement.classList.contains("dragover__bottom");
        targetElement.classList.remove("dragover", "dragover__bottom", "dragover__top");
        if (!target) { return; }
        const response = await fetchSyncPost("/api/filetree/getPathByID", {id: documentTabData.rootId});
        if (response.code !== 0 || !response.data?.path || !response.data?.notebook) { return; }
        const source = response.data;
        if (!isMoveTargetAllowed([source.notebook], target.notebookId)) {
            showMessage(window.siyuan.languages._kernel[391]);
            return;
        }
        if (source.notebook === target.notebookId && (source.path === target.path ||
            target.path.startsWith(source.path.slice(0, -3) + "/"))) { return; }
        if (asChild) {
            await fetchSyncPost("/api/filetree/moveDocs", {
                toNotebook: target.notebookId, fromPaths: [source.path], toPath: target.path,
            });
            await this.docTree.reload();
        } else {
            await this.reorderSortedDocuments([documentTabData.rootId], target.id, after);
        }
    }

    private handleMsgCallback(data: IWebSocketData) {
        if (!data || this.disposed) { return; }
        const notebook = typeof data.data === "string" ? data.data : data.data?.box?.id || data.data?.box || data.data?.id;
        if (["closeBox", "removeBox"].includes(data.cmd) &&
            this.dragSelection?.items.some(item => item.notebookId === notebook)) {
            this.cancelDrag?.();
        }
        this.pinnedDocs?.onFileTreeMessage(data);
        this.docTree?.handleMessage(data);
        switch (data.cmd) {
            case "reloadFiletree":
            case "boxDocFeatureChanged":
            case "notebookIconChanged":
            case "renamenotebook":
            case "reloadNotebookInfo":
            case "createnotebook":
            case "mount":
            case "closeBox":
            case "removeBox":
                window.clearTimeout(this.reloadNotebookInfoTimeout);
                this.reloadNotebookInfoTimeout = window.setTimeout(() => setNoteBook(() => this.init(false)), 100);
                if (data.cmd === "mount") { emitToPlugins("opened-notebook", data); }
                if (data.cmd === "closeBox" || data.cmd === "removeBox") { emitToPlugins("closed-notebook", data); }
                break;
            case "create":
                if (data.data.listDocTree) { void this.selectItem(data.data.box.id, data.data.path); }
                break;
            case "createdailynote":
            case "li2doc":
                void this.selectItem(data.data.box.id, data.data.path);
                break;
        }
    }

    private updateDocActionElement(liElement: HTMLElement) {
        const iconElement = liElement.querySelector<HTMLElement>(".b3-list-item__icon");
        if (!iconElement) {
            return;
        }
        const isFile = liElement.getAttribute("data-type") === "navigation-file";
        const hasChildren = Number(liElement.getAttribute("data-count")) > 0;
        // 单击文档图标展开或折叠下级，笔记本图标不参与
        const iconClickExpands = isFile && window.siyuan.config.fileTree.docIconClickMode === 1;
        const iconExpands = iconClickExpands && hasChildren;
        const iconOpens = iconClickExpands && !hasChildren;
        const editingPublishAccess = this.element.classList.contains("file-tree__publish-access--active");
        // 点击会修改图标时给出提示，展开或打开时不提示
        iconElement.classList.toggle("ariaLabel", !iconClickExpands);
        if (iconClickExpands) {
            iconElement.removeAttribute("aria-label");
        } else {
            iconElement.setAttribute("aria-label", window.siyuan.languages.changeIcon);
        }
        liElement.classList.toggle("file-tree__item--icon-expand", iconExpands && !editingPublishAccess);
        liElement.classList.toggle("file-tree__item--icon-open", iconOpens && !editingPublishAccess);
        liElement.classList.toggle("file-tree__item--title-expand", hasChildren &&
            window.siyuan.config.fileTree.parentDocTitleClickMode !== 0);
    }

    public updateDocActions() {
        this.pinnedDocs?.updateDocActions();
        this.element.querySelectorAll<HTMLElement>(
            'li[data-type="navigation-file"], li[data-type="navigation-root"]'
        ).forEach((item) => {
            this.updateDocActionElement(item);
        });
    }

    private genNotebook(item: INotebook) {
        const editingPublishAccess = this.element.classList.contains("file-tree__publish-access--active");
        const locked = item.encrypted && item.closed;
        const iconContent = locked
            ? getFileTreeIconHTML("", "lock")
            : getFileTreeIconHTML(item.icon, "notebook");
        const defaultIconAttr = getFileTreeDefaultIconAttr(locked ? "" : item.icon, locked ? "lock" : "notebook");
        const isBoxDoc = !item.closed && window.siyuan.config.fileTree.boxDocEnabled;
        const hasChildren = !item.closed && item.subFileCount > 0;
        // 笔记本图标始终用于修改图标
        const actionClasses = `${hasChildren && window.siyuan.config.fileTree.parentDocTitleClickMode !== 0 ?
            " file-tree__item--title-expand" : ""}`;
        const emojiHTML = `<span class="b3-list-item__icon ariaLabel${isBoxDoc ? " popover__block" : ""}${editingPublishAccess && !item.encrypted ? " fn__none" : ""}" data-position="8east"${isBoxDoc ? ` data-id="${item.id}"` : ""} aria-label="${window.siyuan.languages.changeIcon}">${iconContent}</span>`;
        const switchHTML = `<span class="b3-list-item__switch b3-tooltips b3-tooltips__e${editingPublishAccess && !item.encrypted ? "" : " fn__none"}" aria-label="${window.siyuan.languages.publishAccess}">${getPublishAccessOptionByLevel("public").iconHTML}</span>`;
        if (item.closed) {
            return `<li data-url="${item.id}" class="b3-list-item b3-list-item--hide-action"${item.encrypted ? ' data-encrypted="true"' : ""}${defaultIconAttr}>
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
            return `<ul class="b3-list b3-list--background" data-url="${item.id}" data-sort="${item.sort}" data-sortmode="${item.sortMode}"${item.encrypted ? " data-encrypted=\"true\"" : ""}>
<li class="b3-list-item b3-list-item--hide-action${actionClasses}" ${window.siyuan.config.fileTree.sort === 6 ? 'draggable="true"' : ""}
style="--file-toggle-width:22px;--file-action-offset:22px"
data-type="navigation-root" data-path="/" data-count="${item.subFileCount || 0}" data-node-id="${window.siyuan.config.fileTree.boxDocEnabled ? item.id : ""}"${defaultIconAttr}>
    <span class="b3-list-item__toggle b3-list-item__toggle--hl${isBoxDoc && !hasChildren ? " fn__hidden" : ""}">
        <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
    </span>
    ${emojiHTML}
    ${switchHTML}
    <span class="b3-list-item__text ariaLabel" data-position="parentE">${escapeHtml(item.name)}</span>
    <span data-type="more-root" data-menu="true" class="b3-list-item__action b3-tooltips b3-tooltips__w${(window.siyuan.config.readonly) ? " fn__none" : ""}" aria-label="${window.siyuan.languages.more}">
        <svg><use xlink:href="#iconMore"></use></svg>
    </span>
    <span data-type="new" class="b3-list-item__action b3-tooltips b3-tooltips__w${(window.siyuan.config.readonly) ? " fn__none" : ""}" aria-label="${window.siyuan.languages.newSubDoc}">
        <svg><use xlink:href="#iconAdd"></use></svg>
    </span>
</li></ul>`;
        }
    }

    private renderTreeRow(item: IDocTreeItem): HTMLElement {
        const template = document.createElement("template");
        template.innerHTML = item.kind === "notebook" ? this.genNotebook(item.notebook) : this.genFileHTML(item.file);
        const row = template.content.querySelector<HTMLElement>("li");
        const notebook = window.siyuan.notebooks.find(value => value.id === item.notebookId);
        if (notebook?.encrypted) { row.dataset.encrypted = "true"; }
        return row;
    }

    public init(init = true) {
        if (this.disposed) { return; }
        this.pinnedDocs?.scheduleRefresh();
        const notebooks = window.siyuan.notebooks;
        const closed = notebooks.filter(item => item.closed);
        this.docTree.setRoots(notebooks.filter(item => !item.closed).map(item => ({
            id: item.id, notebookId: item.id, kind: "notebook", path: "/", name: item.name,
            subFileCount: item.subFileCount || 0, notebook: item, effectiveSortMode: item.sortMode,
        })));
        this.closeElement.lastElementChild.innerHTML = closed.map(item => this.genNotebook(item)).join("");
        this.closeElement.querySelector(".counter").textContent = closed.length.toString();
        this.closeElement.classList.toggle("fn__none", !closed.length);
        if (init) {
            const hasOpen = notebooks.some(item => !item.closed);
            this.closeElement.style.height = hasOpen ? "30px" : "40%";
            this.closeElement.querySelector("svg").classList.toggle("b3-list-item__arrow--open", !hasOpen);
            this.closeElement.lastElementChild.classList.toggle("fn__none", hasOpen);
            void restoreDocTreeState(this.docTree);
        }
    }

    public onRename(data: {path: string, title: string, box: string}) {
        const parentID = data.path.split("/").slice(0, -1).filter(Boolean).pop() || "";
        void this.docTree.reload({notebook: data.box, parentID});
    }

    public onFiletreeSortChanged(data: {notebook: string, parentPath: string}) {
        const parentID = data.parentPath.split("/").filter(Boolean).pop()?.replace(/\.sy$/, "") || "";
        void this.docTree.reload({notebook: data.notebook, parentID});
    }

    public onDocsImported(data: {notebook: string, parentPath: string, rootIDs: string[]}) {
        this.pinnedDocs?.scheduleRefresh();
        const parentID = data.parentPath.split("/").filter(Boolean).pop()?.replace(/\.sy$/, "") || "";
        void this.docTree.reload({notebook: data.notebook, parentID});
    }

    public onDocSortModeChanged(data: IDocSortModeChanged) {
        this.pinnedDocs?.scheduleRefresh();
        updateFileTreeSortMode(data);
        void this.docTree.reload(data.scope === "global" ? undefined : {notebook: data.box});
        if (data.scope === "global") { setNoteBook(() => this.init(false)); }
    }

    public onNotebookSortChanged() {
        setNoteBook(() => this.init(false));
    }

    private toggleLeaf(liElement: Element, notebookId: string) {
        this.parentDocClick.cancel();
        const item = this.docTree.getItemFromElement(liElement);
        if (item?.kind === "notebook" && !item.subFileCount && !window.siyuan.config.readonly) {
            newFileInTree(this.app, notebookId, "/");
        } else if (item) {
            void this.docTree.toggle(item.occurrenceKey);
        }
    }

    public setCurrent(target: HTMLElement, isScroll = true) {
        const item = this.docTree.getItemFromElement(target);
        if (item) { void this.docTree.select(item.occurrenceKey, {scroll: isScroll}); }
    }

    public getLeaf(liElement: Element, notebookId: string, focusUpdate = false) {
        this.parentDocClick.cancel();
        const item = this.docTree.getItemFromElement(liElement);
        if (!item) { return; }
        if (focusUpdate) {
            void this.docTree.reload({notebook: notebookId, parentID: item.kind === "notebook" ? "" : item.id});
        } else {
            void this.docTree.toggle(item.occurrenceKey);
        }
    }

    public async selectItem(notebookId: string, filePath: string, data?: IFileTreeList,
                            setStorage = true, isSetCurrent = true): Promise<HTMLElement> {
        const id = filePath === "/" ? notebookId : filePath.split("/").filter(Boolean).pop()?.replace(/\.sy$/, "");
        if (!id) { return; }
        const pending = this.docTree.locate(notebookId, id, {select: isSetCurrent, scroll: isSetCurrent});
        const interaction = this.docTree.interactionVersion;
        await pending;
        if (interaction !== this.docTree.interactionVersion) { return; }
        const item = this.docTree.findItem(notebookId, id);
        if (setStorage) { this.getOpenPaths(); }
        return item ? this.docTree.ensureRendered(item.occurrenceKey) : undefined;
    }

    private getOpenPaths() {
        if (this.docTree) { saveDocTreeState(this.docTree); }
    }

    private genFileHTML(item: IFile) {
        let countHTML = "";
        if (item.count && item.count > 0) {
            countHTML = `<span class="popover__block counter b3-tooltips b3-tooltips__nw" aria-label="${window.siyuan.languages.ref}">${item.count}</span>`;
        }
        const ariaLabel = genFileTreeDocAriaLabel(item, true);
        const paddingLeft = (item.path.split("/").length - 1) * 18;
        const editingPublishAccess = this.element.classList.contains("file-tree__publish-access--active");
        const iconExpands = window.siyuan.config.fileTree.docIconClickMode === 1;
        // 点击会修改图标时给出提示，展开或打开时不提示
        const iconChanges = !iconExpands;
        const actionClasses = `${iconExpands && item.subFileCount > 0 && !editingPublishAccess ? " file-tree__item--icon-expand" : ""}${
            iconExpands && item.subFileCount === 0 && !editingPublishAccess ? " file-tree__item--icon-open" : ""}${
            window.siyuan.config.fileTree.parentDocTitleClickMode !== 0 && item.subFileCount > 0 ? " file-tree__item--title-expand" : ""}`;
        const defaultIcon = item.subFileCount === 0 ? "file" : "folder";
        return `<li data-node-id="${item.id}" data-name="${escapeHtmlTextAndAttr(item.name)}" draggable="true" data-count="${item.subFileCount}" ${FILE_TREE_CHILDREN_SORT_MODE}="${item.childrenSortMode ?? ""}"
data-type="navigation-file"
style="--file-toggle-width:${paddingLeft + 18}px;--file-action-offset:${paddingLeft + 20}px"
class="b3-list-item b3-list-item--hide-action${actionClasses}" data-path="${item.path}"${getFileTreeDefaultIconAttr(item.icon, defaultIcon)}>
    <span style="padding-left: ${paddingLeft}px" class="b3-list-item__toggle b3-list-item__toggle--hl${item.subFileCount === 0 ? " fn__hidden" : ""}">
        <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
    </span>
    <span class="b3-list-item__icon${iconChanges ? " ariaLabel" : ""} popover__block${editingPublishAccess ? " fn__none" : ""}" data-position="8east" data-id="${item.id}"${iconChanges ? ` aria-label="${window.siyuan.languages.changeIcon}"` : ""}>${getFileTreeIconHTML(item.icon, defaultIcon)}</span>
    <span class="b3-list-item__switch b3-tooltips b3-tooltips__n${editingPublishAccess ? "" : " fn__none"}" aria-label="${window.siyuan.languages.publishAccess}">${getPublishAccessOptionByLevel("public").iconHTML}</span>
    <span class="b3-list-item__text ariaLabel" data-delay="200" data-position="parentE" data-tooltip-encoding="none"
aria-label="${ariaLabel}">${getDocDisplayName(item.name, item.titleEmpty, true)}</span>
    <span data-type="more-file" data-menu="true" class="b3-list-item__action b3-tooltips b3-tooltips__nw" aria-label="${window.siyuan.languages.more}">
        <svg><use xlink:href="#iconMore"></use></svg>
    </span>
    <span data-type="new" class="b3-list-item__action b3-tooltips b3-tooltips__nw${window.siyuan.config.readonly ? " fn__none" : ""}" aria-label="${window.siyuan.languages.newSubDoc}">
        <svg><use xlink:href="#iconAdd"></use></svg>
    </span>
    ${countHTML}
</li>`;
    }

    public destroy() {
        this.disposed = true;
        this.cancelDrag?.();
        super.destroy();
        window.clearTimeout(this.saveStateTimeout);
        this.getOpenPaths();
        this.parentDocClick.cancel();
        this.pinnedDocs.destroy();
        window.clearTimeout(this.reloadNotebookInfoTimeout);
        window.clearTimeout(this.publishAccessTimeout);
        this.publishAccessGeneration++;
        this.docTree.destroy();
        this.selectionProgress.destroy();
    }

    private initMoreMenu() {
        window.siyuan.menus.menu.remove();
        window.siyuan.menus.menu.element.setAttribute("data-name", Constants.MENU_DOC_TREE_PANEL_MORE);
        if (!window.siyuan.config.readonly) {
            window.siyuan.menus.menu.append(new MenuItem({
                id: "newNotebook",
                icon: "iconNewNoteBook",
                label: window.siyuan.languages.newNotebook,
                click: () => {
                    newNotebook();
                }
            }).element);
            if (window.siyuan.config.notebookCrypto?.enabled) {
                window.siyuan.menus.menu.append(new MenuItem({
                    id: "newEncryptedNotebook",
                    icon: "iconLock",
                    label: window.siyuan.languages.newEncryptedNotebook,
                    click: () => {
                        newEncryptedNotebook();
                    }
                }).element);
            }
            if (getHostCapabilities().documentImportExport) {
                window.siyuan.menus.menu.append(new MenuItem({
                    id: "importNotebook",
                    icon: "iconUpload",
                    label: `${window.siyuan.languages.importNotebook}<input class="b3-form__upload" type="file" accept="application/zip">`,
                    bind: (element) => {
                        element.querySelector<HTMLInputElement>(".b3-form__upload").addEventListener("change", (event) => {
                            const file = (event.target as HTMLInputElement).files?.[0];
                            if (file) {
                                window.siyuan.menus.menu.remove();
                                importNotebook(file);
                            }
                        });
                    },
                }).element);
            }
        }
        window.siyuan.menus.menu.append(new MenuItem({
            id: "rebuildDataIndex",
            icon: "iconRefresh",
            label: window.siyuan.languages.rebuildDataIndex,
            click: () => {
                if (!this.element.getAttribute("disabled")) {
                    this.element.setAttribute("disabled", "disabled");
                    confirmDialog(window.siyuan.languages.rebuildDataIndex, window.siyuan.languages.rebuildDataIndexTip, () => {
                        refreshFileTree(() => {
                            this.element.removeAttribute("disabled");
                            this.init(false);
                        });
                    }, () => {
                        this.element.removeAttribute("disabled");
                    });
                }
            }
        }).element);
        if (!window.siyuan.config.readonly) {
            const subMenu = sortMenu("notebooks", window.siyuan.config.fileTree.sort, (sort) => {
                if (sort === null) {
                    return;
                }
                configApi.set("fileTree.sort", sort, () => {
                    this.onDocSortModeChanged({
                        scope: "global",
                        box: "",
                        id: "",
                        path: "/",
                        sortMode: sort,
                    });
                });
            });
            window.siyuan.menus.menu.append(new MenuItem({
                id: "sort",
                icon: "iconSort",
                label: window.siyuan.languages.sort,
                type: "submenu",
                submenu: subMenu,
            }).element);
        }
        if (!window.siyuan.config.readonly && window.siyuan.config.publish.enable) {
            window.siyuan.menus.menu.append(new MenuItem({
                id: "publishAccess",
                icon: "iconEye",
                label: window.siyuan.languages.publishAccess,
                checked: this.element.classList.contains("file-tree__publish-access--active"),
                click: () => {
                    this.element.classList.toggle("file-tree__publish-access--active");
                    this.updateDocActions();
                    this.refreshPublishAccessSwitch();
                }
            }).element);
        }
        return window.siyuan.menus.menu;
    }

    private updatePublishAccessControls(editingPublishAccess: boolean) {
        this.element.querySelectorAll(".b3-list-item__icon").forEach(item => {
            const encrypted = Boolean(item.closest("[data-encrypted=true]"));
            item.classList.toggle("fn__none", editingPublishAccess && !encrypted);
            const switchElement = item.nextElementSibling;
            if (switchElement) {
                switchElement.classList.toggle("fn__none", !editingPublishAccess || encrypted);
            }
        });
    }

    private refreshPublishAccessSwitch() {
        const editingPublishAccess = this.element.classList.contains("file-tree__publish-access--active");
        this.updatePublishAccessControls(editingPublishAccess);
        if (window.siyuan.config.readonly || window.siyuan.isPublish || !editingPublishAccess) {
            window.clearTimeout(this.publishAccessTimeout);
            this.publishAccessKey = "";
            this.publishAccessGeneration++;
            return;
        }
        const ids: string[] = [];
        this.element.querySelectorAll("[data-url]").forEach((element: HTMLElement) => {
            if (!element.closest("[data-encrypted=true]")) {
                ids.push(element.getAttribute("data-url"));
            }
        });
        this.element.querySelectorAll("[data-type=\"navigation-file\"][data-node-id]").forEach((element: HTMLElement) => {
            if (!element.closest("[data-encrypted=true]")) {
                ids.push(element.getAttribute("data-node-id"));
            }
        });
        const key = ids.sort().join(",");
        if (key === this.publishAccessKey) { return; }
        this.publishAccessKey = key;
        const generation = ++this.publishAccessGeneration;
        window.clearTimeout(this.publishAccessTimeout);
        this.publishAccessTimeout = window.setTimeout(() => {
            fetchPost("/api/filetree/getPublishAccess", {ids}, response => {
                if (generation !== this.publishAccessGeneration || response.code !== 0) { return; }
                response.data.publishAccess.forEach((item: IPublishAccessItem) => {
                    const element = this.element.querySelector(`[data-url="${item.id}"] .b3-list-item__switch`) ||
                        this.element.querySelector(`[data-node-id="${item.id}"] .b3-list-item__switch`);
                    if (element && !element.closest("[data-encrypted=true]")) {
                        element.innerHTML = getPublishAccessOptionByLevel(getPublishAccessLevel(item.visible, item.password, item.disable)).iconHTML;
                    }
                });
            });
        }, 100);
    }
}
