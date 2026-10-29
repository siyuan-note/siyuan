import {DocTreeController, getActiveDocTreeController} from "../../layout/dock/docTree/DocTreeController";
import type {IDocTreeItem} from "../../layout/dock/docTree/types";
import {createDocTreeSelectionProgress} from "../../layout/dock/docTree/selectionProgress";
import {saveDocTreeState, restoreDocTreeState} from "../../util/docTreeState";
import {config as configApi} from "../../config/util/configApi";
import {escapeHtml, escapeHtmlTextAndAttr} from "../../util/escape";
import {getTreeItemTailHTML} from "../../util/treeItemTail";
import {Model} from "../../layout/Model";
import {Constants} from "../../constants";
import {getDocDisplayName, isMoveTargetAllowed, setNoteBook} from "../../util/pathName";
import {initFileMenu, initNavigationMenu, sortMenu} from "../../menus/navigation";
import {getDocTreeActionItems} from "../../menus/navigationSelection";
import {toggleMenu, type IMenuSession} from "../../menus/menuToggle";
import {
    getPublishAccessLevel,
    getPublishAccessOptionByLevel,
    openPublishAccessDialog
} from "../../protyle/util/publishAccess";
import {fetchPost, fetchSyncPost} from "../../util/fetch";
import {reorderSortedFileTree} from "../../util/fileTreeReorder";
import {genUUID} from "../../util/genID";
import {openMobileFileById} from "../editor";
import {
    getFileTreeDefaultIconAttr,
    getFileTreeIconHTML,
} from "../../emoji/fileTreeIcon";
import {newNotebook, openEncryptedNotebook} from "../../util/mount";
import {newFileInTree} from "../../util/newFile";
import {MenuItem} from "../../menus/Menu";
import type {App} from "../../index";
import {refreshFileTree} from "../../dialog/processSystem";
import {confirmDialog} from "../../dialog/confirmDialog";
import {showMessage} from "../../dialog/message";
import {dragOverScroll, stopScrollAnimation} from "../../boot/globalEvent/dragover";
import {bindMousePointerTouchBridge, isMousePointerTouchEvent} from "../util/mousePointerTouchBridge";
import {getRelativeReorderRequest} from "../../util/fileTreeMove";
import {
    FILE_TREE_CHILDREN_SORT_MODE,
    type IDocSortModeChanged,
    updateFileTreeSortMode
} from "../../util/fileTreeSort";
import {MobileOpenedFileSelection} from "./mobileOpenedFileSelection";
import {insertMobileMultiSelectMenu, renderMultiSelectToolbar, updateMultiSelectToolbar} from "../util/multiSelectToolbar";
import {PinnedDocs} from "../../layout/dock/PinnedDocs";
import {ParentDocClick} from "../../layout/dock/parentDocClick";
import {emitToPlugins} from "../../plugin/EventBusCore";

export class MobileFiles extends Model {
    public element: HTMLElement;
    public docTree: DocTreeController;

    public getSelectedItems(): {id: string, path: string, notebookId: string}[] {
        const controller = getActiveDocTreeController(this.element.parentElement) || this.docTree;
        return getDocTreeActionItems(controller.getSelectedItems()).map(({id, path, notebookId}) => ({id, path, notebookId}));
    }

    public getSelectionElements(): NodeListOf<HTMLElement> {
        return (getActiveDocTreeController(this.element.parentElement) || this.docTree).getSelectionElements();
    }

    private saveStateTimeout: number;
    private selectionProgress = createDocTreeSelectionProgress();
    private publishAccessKey = "";
    private publishAccessGeneration = 0;
    private publishAccessTimeout: number;
    private actionsElement: HTMLElement;
    private selectionElement: HTMLElement;

    private multiSelect = false;
    private pinnedDocs: PinnedDocs;
    private closeElement: HTMLElement;
    private reloadNotebookInfoTimeout: number;
    private lifecycleEvents = new AbortController();
    private disposed = false;
    private cancelTouchDrag: () => void;

    private openedFileSelection = new MobileOpenedFileSelection();
    private parentDocClick = new ParentDocClick();
    private touchDragState: {
        selectedElement: HTMLElement;
        startX: number;
        startY: number;
        pointerX: number;
        pointerY: number;
        isDragging: boolean;
        ghostElement: HTMLElement;
        startTime: number;
        source?: IDocTreeItem;
        selectionVersion?: number;
    };

    constructor(app: App, filesElement: HTMLElement) {
        super({app});
        this.connect({
            id: genUUID(),
            type: "filetree",
            msgCallback: this.handleMsgCallback.bind(this)
        });
        filesElement.innerHTML = `<div class="toolbar toolbar--dark">
    <div class="fn__space"></div>
    <div class="toolbar__text">${window.siyuan.languages.fileTree}</div>
    <div class="fn__space"></div>
    <svg data-type="newNotebook" class="toolbar__icon"><use xlink:href="#iconNewNoteBook"></use></svg>
    <svg data-type="refresh" class="toolbar__icon"><use xlink:href="#iconRefresh"></use></svg>
    <svg data-type="focus" class="toolbar__icon"><use xlink:href="#iconFocus"></use></svg>
    <svg data-type="collapse" class="toolbar__icon"><use xlink:href="#iconContract"></use></svg>
    <svg data-type="publish-access" class="toolbar__icon${window.siyuan.config.readonly || !window.siyuan.config.publish.enable ? " fn__none" : ""}"><use xlink:href="#iconEye"></use></svg>
    <svg data-type="sort" class="toolbar__icon${window.siyuan.config.readonly ? " fn__none" : ""}"><use xlink:href="#iconSort"></use></svg>
</div>
<div class="fn__flex-1"></div>
<ul class="b3-list b3-list--background fn__flex-column" style="min-height: auto;height:42px;transition: height .2s cubic-bezier(0, 0, .2, 1) 0ms">
    <li class="b3-list-item" data-type="toggle">
        <span class="b3-list-item__toggle">
            <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
        </span>
        <span class="b3-list-item__text">${window.siyuan.languages.closeNotebook}</span>
        <span class="counter" style="cursor: auto"></span>
    </li>
    <ul class="fn__none fn__flex-1"></ul>
</ul>`;
        this.actionsElement = filesElement.firstElementChild as HTMLElement;
        this.element = this.actionsElement.nextElementSibling as HTMLElement;
        this.docTree = new DocTreeController({
            element: this.element, renderRow: item => this.renderTreeRow(item),
            onSelectionChange: () => {
                if (this.docTree?.getSelectedItems().length) { this.pinnedDocs?.clearSelection(); }
                this.updateMultiSelect();
            },
            onExpansionChange: () => this.getOpenPaths(),
            onSelectionProgress: this.selectionProgress.update,
            onRowsRendered: () => {
                this.refreshPublishAccessSwitch();
                if (this.touchDragState?.isDragging) { this.updateTouchDrop(this.touchDragState); }
            },
        });
        this.element.addEventListener("scroll", () => {
            window.clearTimeout(this.saveStateTimeout);
            this.saveStateTimeout = window.setTimeout(() => this.getOpenPaths(), 250);
        }, {passive: true});
        this.pinnedDocs = new PinnedDocs(app, this.element, (id, notebook) => {
            openMobileFileById(app, id, [Constants.CB_GET_SCROLL], undefined, notebook);
        }, true);
        this.closeElement = this.element.nextElementSibling as HTMLElement;
        this.selectionElement = document.createElement("div");
        this.selectionElement.className = "protyle-util fn__none";
        this.selectionElement.style.cssText = "position:relative;margin:8px;flex-shrink:0";
        this.actionsElement.after(this.selectionElement);

        renderMultiSelectToolbar(this.selectionElement, 0, (_menu, session) => this.showMultiSelectMenu(session), () => this.setMultiSelect(false));
        filesElement.addEventListener("click", (event) => {
            if (!this.multiSelect || this.selectionElement.contains(event.target as Node)) {
                return;
            }
            const target = event.target as HTMLElement;
            const item = target.closest<HTMLElement>('li[data-type="navigation-file"], li[data-type="navigation-root"]');
            const toggle = target.closest(".b3-list-item__toggle:not(.fn__hidden)") ||
                (target.closest(".b3-list-item__icon") ? item?.querySelector(":scope > .b3-list-item__toggle:not(.fn__hidden)") : null);
            if (item && this.element.contains(item) && !this.pinnedDocs.element.contains(item)) {
                if (toggle) {
                    this.toggleTreeItem(item);
                } else {
                    const selected = this.docTree.getItemFromElement(item);
                    if (selected) { void this.docTree.select(selected.occurrenceKey, {toggle: true, scroll: false}); }
                }
            }
            event.preventDefault();
            event.stopPropagation();
        }, true);
        filesElement.addEventListener("touchstart", (event) => {
            if (this.multiSelect && this.pinnedDocs.element.contains(event.target as Node)) {
                event.stopPropagation();
            }
        }, {capture: true, passive: true});
        filesElement.addEventListener("click", (event: MouseEvent & { target: HTMLElement }) => {
            let target = event.target as HTMLElement;
            const parentTitle = target.closest<HTMLElement>(".b3-list-item__text");
            const parentRow = parentTitle?.parentElement;
            const isParentTitle = window.siyuan.config.fileTree.parentDocTitleClickMode !== 0 &&
                !!parentRow?.getAttribute("data-node-id") && Number(parentRow.getAttribute("data-count")) > 0;
            if (!isParentTitle) {
                this.parentDocClick.cancel();
            }
            while (target && !target.isEqualNode(this.actionsElement)) {
                if (target.classList.contains("b3-list-item__icon")) {
                    const notebookElement = target.closest("li[data-encrypted=true]");
                    if (notebookElement && this.closeElement.contains(notebookElement)) {
                        openEncryptedNotebook(this.app, notebookElement.getAttribute("data-url"), notebookElement.querySelector(".b3-list-item__text").textContent);
                        event.preventDefault();
                        event.stopPropagation();
                        break;
                    }
                    target = target.previousElementSibling as HTMLElement;
                }
                const type = target.getAttribute("data-type");
                if (type === "refresh") {
                    if (!target.getAttribute("disabled")) {
                        target.setAttribute("disabled", "disabled");
                        confirmDialog(window.siyuan.languages.rebuildDataIndex, window.siyuan.languages.rebuildDataIndexTip, () => {
                            refreshFileTree(() => {
                                target.removeAttribute("disabled");
                                this.init(false);
                            });
                        }, () => {
                            target.removeAttribute("disabled");
                        });
                    }
                    event.preventDefault();
                    break;
                } else if (type === "focus") {
                    if (window.siyuan.mobile.editor) {
                        this.selectItem(window.siyuan.mobile.editor.protyle.notebookId, window.siyuan.mobile.editor.protyle.path);
                    }
                    event.preventDefault();
                    break;
                } else if (type === "newNotebook") {
                    newNotebook();
                } else if (type === "collapse") {
                    this.pinnedDocs.collapse();
                    this.docTree.collapseAll();
                    event.preventDefault();
                    break;
                } else if (target.classList.contains("b3-list-item__switch")) {
                    if (target.closest("[data-encrypted=true]")) {
                        event.preventDefault();
                        event.stopPropagation();
                        break;
                    }
                    const rect = target.getBoundingClientRect();
                    const rootUL = target.closest<HTMLElement>("[data-notebook-id]");
                    openPublishAccessDialog(target.parentElement.getAttribute("data-type") === "navigation-root" ?
                        rootUL?.dataset.notebookId || "" : target.parentElement.getAttribute("data-node-id"), {
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
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "publish-access") {
                    // 顶部栏中的按钮
                    target.classList.toggle("block__icon--active");
                    this.refreshPublishAccessSwitch();
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "sort") {
                    this.genSort();
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (target.classList.contains("b3-list-item__toggle") && !target.classList.contains("fn__hidden") && target.parentElement.getAttribute("data-type") !== "toggle") {
                    this.toggleTreeItem(target.parentElement);
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (type === "toggle") {
                    const svgElement = target.querySelector("svg");
                    if (svgElement.classList.contains("b3-list-item__arrow--open")) {
                        this.closeElement.style.height = "42px";
                        svgElement.classList.remove("b3-list-item__arrow--open");
                        this.closeElement.lastElementChild.classList.add("fn__none");
                    } else {
                        this.closeElement.style.height = "40%";
                        svgElement.classList.add("b3-list-item__arrow--open");
                        this.closeElement.lastElementChild.classList.remove("fn__none");
                    }
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
                    event.stopPropagation();
                    event.preventDefault();
                    break;
                } else if (target.classList.contains("b3-list-item__action")) {
                    const type = target.getAttribute("data-type");
                    const pathString = target.parentElement.getAttribute("data-path");
                    const ulElement = target.closest<HTMLElement>("[data-notebook-id]");
                    if (ulElement) {
                        const notebookId = ulElement.dataset.notebookId;
                        if (!window.siyuan.config.readonly) {
                            if (type === "new") {
                                newFileInTree(app, notebookId, pathString);
                            } else if (type === "more-root") {
                                toggleMenu({
                                    target: target, build: () => {
                                        initNavigationMenu(app, target.parentElement);
                                        this.insertMultiSelectMenu(target.parentElement);
                                        window.siyuan.menus.menu.fullscreen("bottom");
                                    }
                                });
                            }
                        }
                        if (type === "more-file") {
                            toggleMenu({
                                target: target, build: () => {
                                    initFileMenu(app, notebookId, pathString, target.parentElement);
                                    this.insertMultiSelectMenu(target.parentElement);
                                    window.siyuan.menus.menu.fullscreen("bottom");
                                }
                            });
                        }
                    }
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                } else if (target.tagName === "LI") {
                    this.setCurrent(target, !isParentTitle || parentRow !== target);
                    const ulElement = target.closest<HTMLElement>("[data-notebook-id]");
                    const notebookId = ulElement ? ulElement.dataset.notebookId : "";
                    if (target.getAttribute("data-type") === "navigation-file") {
                        if (window.siyuan.config.fileTree.parentDocTitleClickMode !== 0 && Number(target.getAttribute("data-count")) > 0) {
                            if (parentRow === target) {
                                this.handleParentDocClick(target, notebookId);
                            } else {
                                this.parentDocClick.cancel();
                                this.toggleTreeItem(target);
                            }
                        } else {
                            openMobileFileById(app, target.getAttribute("data-node-id"), [Constants.CB_GET_SCROLL], undefined, notebookId);
                        }
                    } else if (target.getAttribute("data-type") === "navigation-root") {
                        const boxDocID = target.getAttribute("data-node-id");
                        if (boxDocID) {
                            if (window.siyuan.config.fileTree.parentDocTitleClickMode !== 0 && Number(target.getAttribute("data-count")) > 0) {
                                if (parentRow === target) {
                                    this.handleParentDocClick(target, notebookId);
                                } else {
                                    this.parentDocClick.cancel();
                                    this.toggleTreeItem(target);
                                }
                            } else {
                                openMobileFileById(app, boxDocID, [Constants.CB_GET_SCROLL], undefined, notebookId);
                            }
                        } else if (ulElement) {
                            this.getLeaf(target, notebookId);
                        }
                    }
                    event.preventDefault();
                    break;
                }
                target = target.parentElement;
            }
        });
        filesElement.addEventListener("touchstart", (event: TouchEvent) => {
            if (this.multiSelect) return;
            if (window.siyuan.config.readonly) return;
            if (event.touches.length !== 1) return;

            const touch = event.touches[0];
            const target = touch.target as HTMLElement;
            if (this.pinnedDocs.element.contains(target)) return;
            const liElement = target.closest(".b3-list-item") as HTMLElement;
            if (!liElement) return;

            const dataType = liElement.getAttribute("data-type");
            if (dataType !== "navigation-file" && dataType !== "navigation-root") return;

            if (dataType === "navigation-root") {
                if (window.siyuan.config.fileTree.sort !== 6) return;
            }
            this.touchDragState = {
                isDragging: false,
                selectedElement: liElement,
                startX: touch.clientX,
                startY: touch.clientY,
                pointerX: touch.clientX,
                pointerY: touch.clientY,
                ghostElement: null,
                startTime: Date.now() - (isMousePointerTouchEvent(event) ? Constants.TIMEOUT_LONGPRESS : 0),
            };
            if (!isMousePointerTouchEvent(event)) {
                const state = this.touchDragState;
                window.setTimeout(() => {
                    if (this.touchDragState !== state) {
                        return;
                    }
                    this.startTouchDrag(state, state.startX, state.startY, true);
                }, Constants.TIMEOUT_LONGPRESS);
            }
        }, {passive: false});
        this.element.addEventListener("scroll", () => {
            if (this.touchDragState && !this.touchDragState.isDragging) {
                this.touchDragState = null;
            }
        }, {passive: true});

        filesElement.addEventListener("touchmove", (event: TouchEvent) => {
            const state = this.touchDragState;
            if (!state) return;
            const touch = event.touches[0];
            if (!state.isDragging) {
                if (Date.now() - state.startTime < Constants.TIMEOUT_LONGPRESS &&
                    (Math.abs(touch.clientX - state.startX) > 5 || Math.abs(touch.clientY - state.startY) > 5)) {
                    this.touchDragState = null;
                    return;
                }
                if (Math.abs(touch.clientX - state.startX) < Constants.SIZE_DRAG_THRESHOLD &&
                    Math.abs(touch.clientY - state.startY) < Constants.SIZE_DRAG_THRESHOLD) return;
                this.startTouchDrag(state, touch.clientX, touch.clientY, !isMousePointerTouchEvent(event));
                event.preventDefault();
                event.stopPropagation();
            }

            if (state.isDragging) {
                // 进入拖拽后阻止原生滚动，避免列表伴随手指滚动
                event.preventDefault();
                event.stopPropagation();
                state.pointerX = touch.clientX;
                state.pointerY = touch.clientY;
                state.ghostElement.style.left = `${touch.clientX}px`;
                state.ghostElement.style.top = `${touch.clientY}px`;

                // 手指接近列表上下边缘时自动滚动，避免拖拽时触不到屏外目标
                dragOverScroll({clientY: touch.clientY} as MouseEvent, this.element.getBoundingClientRect(), this.element);

                this.updateTouchDrop(state);
            }
        }, {passive: false});

        filesElement.addEventListener("touchend", async (event: TouchEvent) => {
            const state = this.touchDragState;
            if (!state) { return; }
            stopScrollAnimation();
            const ended = event.changedTouches[0];
            if (state.isDragging && ended) {
                state.pointerX = ended.clientX;
                state.pointerY = ended.clientY;
                this.updateTouchDrop(state);
            }
            state.selectedElement.style.opacity = "";
            state.ghostElement?.remove();
            this.docTree.release();
            const source = this.getTouchDragSource(state);
            const targetRow = this.element.querySelector<HTMLElement>(".dragover, .dragover__bottom, .dragover__top");
            const target = this.docTree.getItemFromElement(targetRow);
            const after = targetRow?.classList.contains("dragover__bottom");
            const inside = targetRow?.classList.contains("dragover");
            this.clearDragIndicators();
            this.touchDragState = null;
            if (!state.isDragging || !source) { return; }
            const at = document.elementFromPoint(state.pointerX, state.pointerY);
            if (at && this.pinnedDocs.element.contains(at) && source.kind === "document") {
                await this.pinnedDocs.drop([source.id], state.pointerX, state.pointerY);
                return;
            }
            if (!target || target.id === source.id) { return; }
            if (source.kind === "notebook") {
                if (target.kind === "notebook" && window.siyuan.config.fileTree.sort === 6) {
                    await fetchSyncPost("/api/notebook/reorder", getRelativeReorderRequest([source.id], target.id, after));
                    setNoteBook(() => this.init(false));
                }
                return;
            }
            if (!isMoveTargetAllowed([source.notebookId], target.notebookId)) {
                showMessage(window.siyuan.languages._kernel[391]);
                return;
            }
            if (source.notebookId === target.notebookId && target.path.startsWith(source.path.replace(/\.sy$/, "") + "/")) { return; }
            if (inside) {
                await fetchSyncPost("/api/filetree/moveDocs", {toNotebook: target.notebookId, fromPaths: [source.path], toPath: target.path});
            } else if (target.kind === "document") {
                await reorderSortedFileTree([source.id], target.id, after);
            }
            await this.docTree.reload();
        });

        const cancelTouchDrag = () => {
            stopScrollAnimation();
            this.docTree.release();
            this.touchDragState?.ghostElement?.remove();
            if (this.touchDragState?.selectedElement) {
                this.touchDragState.selectedElement.style.opacity = "";
            }
            this.clearDragIndicators();
            this.touchDragState = null;
        };
        filesElement.addEventListener("touchcancel", cancelTouchDrag);
        filesElement.addEventListener("pointercancel", cancelTouchDrag);
        this.cancelTouchDrag = cancelTouchDrag;
        window.addEventListener("blur", cancelTouchDrag, {signal: this.lifecycleEvents.signal});
        bindMousePointerTouchBridge(filesElement);
        this.init();
    }

    private handleMsgCallback(data: IWebSocketData) {
        if (!data) { return; }
        const notebook = typeof data.data === "string" ? data.data : data.data?.box?.id || data.data?.box || data.data?.id;
        if (["closeBox", "removeBox"].includes(data.cmd) &&
            this.touchDragState?.selectedElement.dataset.notebookId === notebook) {
            this.cancelTouchDrag?.();
        }
        this.pinnedDocs?.onFileTreeMessage(data);
        this.docTree?.handleMessage(data);
        if (["reloadFiletree", "boxDocFeatureChanged", "notebookIconChanged", "reloadNotebookInfo", "mount", "createnotebook", "closeBox", "removeBox", "renamenotebook"].includes(data.cmd)) {
            window.clearTimeout(this.reloadNotebookInfoTimeout);
            this.reloadNotebookInfoTimeout = window.setTimeout(() => setNoteBook(() => this.init(false)), 100);
        }
        if (data.cmd === "mount") { emitToPlugins("opened-notebook", data); }
        if (data.cmd === "closeBox" || data.cmd === "removeBox") { emitToPlugins("closed-notebook", data); }
        if ((data.cmd === "create" && data.data.listDocTree) || data.cmd === "createdailynote" || data.cmd === "li2doc") {
            void this.selectItem(data.data.box.id, data.data.path);
        }
    }

    private updateTouchDrop(state: MobileFiles["touchDragState"]) {
        this.clearDragIndicators();
        const target = document.elementFromPoint(state.pointerX, state.pointerY);
        const source = this.getTouchDragSource(state);
        if (!source) { return; }
        if (target && this.pinnedDocs.element.contains(target)) {
            if (source.kind === "document") {
                this.pinnedDocs.previewDrop(state.pointerX, state.pointerY);
            }
            return;
        }
        this.pinnedDocs.clearDrop();
        const row = target?.closest<HTMLElement>("li[data-tree-key]");
        const item = this.docTree.getItemFromElement(row);
        if (!item || item.occurrenceKey === source.occurrenceKey ||
            (source.kind === "notebook" && item.kind !== "notebook")) { return; }
        if (source.kind === "document" && item.kind === "notebook") {
            row.classList.add("dragover");
            return;
        }
        const rect = row.getBoundingClientRect();
        if (source.kind === "notebook") {
            row.classList.add(state.pointerY > rect.top + rect.height / 2 ? "dragover__bottom" : "dragover__top");
        } else if (state.pointerY > rect.bottom - rect.height * .2) {
            row.classList.add("dragover__bottom");
        } else if (state.pointerY < rect.top + rect.height * .2) {
            row.classList.add("dragover__top");
        } else {
            row.classList.add("dragover");
        }
    }

    private getTouchDragSource(state: MobileFiles["touchDragState"]) {
        const source = state.source;
        const current = source && this.docTree.getItem(source.occurrenceKey);
        if (!current || state.selectionVersion !== this.docTree.selectionVersion || current.id !== source.id ||
            current.notebookId !== source.notebookId || current.path !== source.path) { return; }
        return source;
    }

    private startTouchDrag(state: MobileFiles["touchDragState"], clientX: number, clientY: number, vibrate = false) {
        if (state.isDragging) {
            return;
        }
        const item = this.docTree.getItemFromElement(state.selectedElement);
        if (!item) { return; }
        state.source = {...item};
        state.selectionVersion = this.docTree.selectionVersion;
        this.docTree.retain(item.occurrenceKey);
        state.isDragging = true;
        const ghostElement = document.createElement("ul");
        ghostElement.id = "dragGhost";
        ghostElement.append(state.selectedElement.cloneNode(true));
        ghostElement.setAttribute("style", `background-color: var(--b3-theme-surface);width: 100%;touch-action: none;pointer-events:none;margin-left: -50%;margin-top:20px;z-index:${window.siyuan.zIndex};position: fixed;top:${clientY}px;left:${clientX}px`);
        ghostElement.setAttribute("class", "b3-list b3-list--background");
        document.body.append(ghostElement);
        state.ghostElement = ghostElement;
        state.selectedElement.style.opacity = "0.38";
        if (vibrate) {
            if (window.webkit?.messageHandlers.vibrate) {
                window.webkit.messageHandlers.vibrate.postMessage("");
            } else if (navigator.vibrate) {
                navigator.vibrate(Constants.TIMEOUT_VIBRATION_DURATION);
            }
        }
    }

    private clearDragIndicators = () => {
        this.pinnedDocs.clearDrop();
        if (!this.touchDragState) return;
        this.element.querySelectorAll(".dragover__top, .dragover__bottom, .dragover").forEach(el => {
            el.classList.remove("dragover__top", "dragover__bottom", "dragover");
        });
    };

    public destroy() {
        this.disposed = true;
        super.destroy();
        this.lifecycleEvents.abort();
        this.cancelTouchDrag?.();
        window.clearTimeout(this.saveStateTimeout);
        this.getOpenPaths();
        this.publishAccessGeneration++;
        this.parentDocClick.cancel();
        this.openedFileSelection.cancel();
        this.touchDragState?.ghostElement?.remove();
        window.clearTimeout(this.reloadNotebookInfoTimeout);
        window.clearTimeout(this.publishAccessTimeout);
        this.pinnedDocs.destroy();
        this.docTree.destroy();
        this.selectionProgress.destroy();
    }

    private genSort() {
        toggleMenu({
            target: this.actionsElement.querySelector("[data-type=sort]"),
            build: (_menu, session) => {
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
                subMenu.forEach((item) => {
                    window.siyuan.menus.menu.append(new MenuItem(item).element);
                });
                session.show(() => window.siyuan.menus.menu.fullscreen("bottom"));

            },
        });
    }

    private genNotebook(item: INotebook) {
        const editingPublishAccess = this.actionsElement.querySelector('[data-type="publish-access"]').classList.contains("block__icon--active");
        const locked = item.encrypted && item.closed;
        const iconContent = locked
            ? getFileTreeIconHTML("", "lock")
            : getFileTreeIconHTML(item.icon, "notebook");
        const defaultIconAttr = getFileTreeDefaultIconAttr(locked ? "" : item.icon, locked ? "lock" : "notebook");
        const isBoxDoc = !item.closed && window.siyuan.config.fileTree.boxDocEnabled;
        const hasChildren = isBoxDoc && item.subFileCount > 0;
        const iconAriaLabel = isBoxDoc ?
            (hasChildren ? window.siyuan.languages.docIconClickExpand : window.siyuan.languages.openDocument) :
            window.siyuan.languages.changeIcon;
        const emojiHTML = `<span class="b3-list-item__icon b3-tooltips b3-tooltips__e${editingPublishAccess && !item.encrypted ? " fn__none" : ""}" aria-label="${iconAriaLabel}">${iconContent}</span>`;
        const switchHTML = `<span class="b3-list-item__switch b3-tooltips b3-tooltips__e${editingPublishAccess && !item.encrypted ? "" : " fn__none"}" aria-label="${window.siyuan.languages.publishAccess}">${getPublishAccessOptionByLevel("public").iconHTML}</span>`;
        if (item.closed) {
            return `<li data-url="${item.id}" class="b3-list-item"${item.encrypted ? ' data-encrypted="true"' : ""}${defaultIconAttr}>
    <span class="b3-list-item__toggle fn__hidden">
        <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
    </span>
    ${emojiHTML}
    ${switchHTML}
    <span class="b3-list-item__text">${escapeHtml(item.name)}</span>
    <span data-type="open" data-url="${item.id}" class="b3-list-item__action${(window.siyuan.config.readonly) ? " fn__none" : ""}">
        <svg><use xlink:href="#iconOpen"></use></svg>
    </span>
</li>`;
        } else {
            return `<ul class="b3-list b3-list--background" data-url="${item.id}" data-sortmode="${item.sortMode}"${item.encrypted ? " data-encrypted=\"true\"" : ""}>
<li class="b3-list-item" data-type="navigation-root" data-path="/" data-count="${item.subFileCount || 0}" data-node-id="${window.siyuan.config.fileTree.boxDocEnabled ? item.id : ""}" style="--file-toggle-width:24px"${defaultIconAttr}>
    <span class="b3-list-item__toggle${isBoxDoc && !hasChildren ? " fn__hidden" : ""}">
        <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
    </span>
    ${emojiHTML}
    ${switchHTML}
    <span class="b3-list-item__text${item.closed ? " ft__on-surface" : ""}">${escapeHtml(item.name)}</span>
    <span data-type="more-root" data-menu="true" class="b3-list-item__action${(window.siyuan.config.readonly || item.closed) ? " fn__none" : ""}">
        <svg><use xlink:href="#iconMore"></use></svg>
    </span>
    <span data-type="new" class="b3-list-item__action${(window.siyuan.config.readonly || item.closed) ? " fn__none" : ""}">
        <svg><use xlink:href="#iconAdd"></use></svg>
    </span>
</li></ul>`;
        }
    }

    public init(init = true) {
        if (this.disposed) { return; }
        this.pinnedDocs?.scheduleRefresh();
        const notebooks = window.siyuan.notebooks;
        this.docTree.setRoots(notebooks.filter(item => !item.closed).map(item => ({
            id: item.id, notebookId: item.id, path: "/", name: item.name, kind: "notebook",
            subFileCount: item.subFileCount || 0, effectiveSortMode: item.sortMode, notebook: item,
        })));
        const closed = notebooks.filter(item => item.closed);
        this.closeElement.lastElementChild.innerHTML = closed.map(item => this.genNotebook(item)).join("");
        this.closeElement.querySelector(".counter").textContent = String(closed.length);
        this.closeElement.classList.toggle("fn__none", closed.length === 0);
        if (init) {
            void restoreDocTreeState(this.docTree);
            const hasOpen = notebooks.some(item => !item.closed);
            this.closeElement.style.height = hasOpen ? "42px" : "40%";
            this.closeElement.querySelector("svg").classList.toggle("b3-list-item__arrow--open", !hasOpen);
            this.closeElement.lastElementChild.classList.toggle("fn__none", hasOpen);
        }
        this.refreshPublishAccessSwitch();
    }

    private renderTreeRow(item: IDocTreeItem): HTMLElement {
        const template = document.createElement("template");
        template.innerHTML = item.kind === "notebook" ? this.genNotebook(item.notebook) : this.genFileHTML(item.file);
        const row = template.content.querySelector("li");
        if (window.siyuan.notebooks.find(notebook => notebook.id === item.notebookId)?.encrypted) {
            row.dataset.encrypted = "true";
        }
        return row;
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
        this.pinnedDocs.scheduleRefresh();
        const parentID = data.parentPath.split("/").filter(Boolean).pop()?.replace(/\.sy$/, "") || "";
        void this.docTree.reload({notebook: data.notebook, parentID});
    }

    public onDocSortModeChanged(data: IDocSortModeChanged) {
        this.pinnedDocs.scheduleRefresh();
        updateFileTreeSortMode(data);
        void this.docTree.reload(data.scope === "global" ? undefined : {notebook: data.box});
    }

    public onNotebookSortChanged() { setNoteBook(() => this.init(false)); }

    private toggleTreeItem(row: HTMLElement) {
        const item = this.docTree.getItemFromElement(row);
        if (!item) { return; }
        this.getLeaf(row, item.notebookId);
        this.setCurrent(row, false);
        window.siyuan.menus.menu.remove();
    }

    private handleParentDocClick(row: HTMLElement, notebookId: string) {
        const item = this.docTree.getItemFromElement(row);
        if (!item) { return; }
        if (window.siyuan.config.fileTree.parentDocTitleClickMode !== 2) {
            this.parentDocClick.cancel();
            this.toggleTreeItem(row);
            return;
        }
        this.parentDocClick.click(row, async () => {
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
        }, () => openMobileFileById(this.app, item.id, [Constants.CB_GET_SCROLL], undefined, notebookId));
    }

    private async showMultiSelectMenu(session: IMenuSession) {
        const selected = this.docTree.getSelectedItems();
        if (!selected.length) { return; }
        const version = this.docTree.selectionVersion;
        const item = await this.docTree.ensureRendered(selected[0].occurrenceKey);
        if (!item || !session.isCurrent() || !this.docTree.validateSelection(version, selected)) { return; }
        if (selected[0].kind === "notebook") {
            initNavigationMenu(this.app, item);
        } else {
            initFileMenu(this.app, selected[0].notebookId, selected[0].path, item);
        }
        session.show(() => window.siyuan.menus.menu.fullscreen("bottom"));
    }

    private insertMultiSelectMenu(item: HTMLElement) {
        if (window.siyuan.config.readonly) {
            return;
        }
        const menuItem = new MenuItem({
            id: "multiSelect",
            icon: "iconCheck",
            label: window.siyuan.languages.multiSelect,
            click: () => {
                this.setCurrent(item, false);
                this.setMultiSelect(true);
            }
        }).element;
        insertMobileMultiSelectMenu(window.siyuan.menus.menu.element.lastElementChild, menuItem);
    }

    private setMultiSelect(enabled: boolean) {
        this.parentDocClick.cancel();
        this.multiSelect = enabled;
        this.touchDragState?.ghostElement?.remove();
        this.touchDragState = null;
        this.docTree.release();
        this.openedFileSelection.cancel();
        this.actionsElement.classList.toggle("fn__none", enabled);
        this.selectionElement.classList.toggle("fn__none", !enabled);
        if (enabled) { showMessage(window.siyuan.languages.mobileFileTreeMultiSelectTip); }
        else { this.docTree.clearSelection(); }
        this.updateMultiSelect();
    }

    private updateMultiSelect() {
        if (this.multiSelect) {
            updateMultiSelectToolbar(this.selectionElement, this.docTree.getSelectedItems().length);
        }
    }

    public setCurrent(target: HTMLElement, isScroll = true) {
        if (this.multiSelect) { return; }
        const item = this.docTree.getItemFromElement(target);
        if (item) { void this.docTree.select(item.occurrenceKey, {scroll: isScroll}); }
    }

    public async selectOpenedFile(notebookId: string, filePath: string) {
        if (this.multiSelect) {
            return;
        }
        const selected = this.docTree.getSelectedItems();
        if (selected.some(item => item.notebookId === notebookId && item.path === filePath)) {
            this.openedFileSelection.cancel();
            return;
        }
        const target = await this.openedFileSelection.resolve(
            () => this.selectItem(notebookId, filePath, undefined, true, false),
            () => {
                const protyle = window.siyuan.mobile.editor?.protyle;
                return window.siyuan.config.fileTree.alwaysSelectOpenedFile &&
                    !protyle?.element.classList.contains("fn__none") &&
                    protyle?.notebookId === notebookId && protyle.path === filePath;
            }
        );
        this.setCurrent(target);
    }

    public getLeaf(row: Element, notebookId: string, focusUpdate = false) {
        const item = this.docTree.getItemFromElement(row);
        if (!item) { return; }
        if (focusUpdate) {
            void this.docTree.reload({notebook: notebookId, parentID: item.kind === "notebook" ? "" : item.id});
        } else if (item.kind === "notebook" && !item.subFileCount && !window.siyuan.config.readonly) {
            newFileInTree(this.app, notebookId, "/");
        } else {
            void this.docTree.toggle(item.occurrenceKey);
        }
    }

    public async selectItem(notebookId: string, filePath: string, data?: IFileTreeList,
                            setStorage = true, isSetCurrent = true) {
        const id = filePath === "/" ? notebookId : filePath.split("/").pop().replace(/\.sy$/, "");
        const pending = this.docTree.locate(notebookId, id, {select: isSetCurrent, scroll: isSetCurrent});
        const interaction = this.docTree.interactionVersion;
        await pending;
        if (interaction !== this.docTree.interactionVersion) { return; }
        const item = this.docTree.findItem(notebookId, id);
        const row = item ? await this.docTree.ensureRendered(item.occurrenceKey) : undefined;
        if (setStorage) { this.getOpenPaths(); }
        return row;
    }

    private getOpenPaths() {
        if (this.docTree) { saveDocTreeState(this.docTree); }
    }

    private genFileHTML = (item: IFile) => {
        let countHTML = "";
        if (item.count && item.count > 0) {
            countHTML = `<span class="counter">${item.count}</span>`;
        }
        const paddingLeft = (item.path.split("/").length - 1) * 20;
        const editingPublishAccess = this.actionsElement.querySelector('[data-type="publish-access"]').classList.contains("block__icon--active");
        const defaultIcon = item.subFileCount === 0 ? "file" : "folder";
        const actionHTML = `<span data-type="more-file" data-menu="true" class="b3-list-item__action b3-tooltips b3-tooltips__nw" aria-label="${window.siyuan.languages.more}">
        <svg><use xlink:href="#iconMore"></use></svg>
    </span>
    <span data-type="new" class="b3-list-item__action b3-tooltips b3-tooltips__nw${window.siyuan.config.readonly ? " fn__none" : ""}" aria-label="${window.siyuan.languages.newSubDoc}">
        <svg><use xlink:href="#iconAdd"></use></svg>
    </span>`;
        return `<li data-node-id="${item.id}" data-name="${escapeHtmlTextAndAttr(item.name)}" data-count="${item.subFileCount}" ${FILE_TREE_CHILDREN_SORT_MODE}="${item.childrenSortMode ?? ""}" data-type="navigation-file"
class="b3-list-item" data-path="${item.path}" style="--file-toggle-width:${paddingLeft + 20}px"${getFileTreeDefaultIconAttr(item.icon, defaultIcon)}>
    <span style="padding-left: ${paddingLeft}px" class="b3-list-item__toggle${item.subFileCount === 0 ? " fn__hidden" : ""}">
        <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
    </span>
    <span class="b3-list-item__icon${editingPublishAccess ? " fn__none" : ""}">${getFileTreeIconHTML(item.icon, defaultIcon)}</span>
    <span class="b3-list-item__switch${editingPublishAccess ? "" : " fn__none"}">${getPublishAccessOptionByLevel("public").iconHTML}</span>
    <span class="b3-list-item__text">${getDocDisplayName(item.name, item.titleEmpty, true)}</span>
    ${getTreeItemTailHTML(countHTML, actionHTML, true)}
</li>`;
    };

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
        const editingPublishAccess = this.actionsElement.querySelector('[data-type="publish-access"]').classList.contains("block__icon--active");
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
