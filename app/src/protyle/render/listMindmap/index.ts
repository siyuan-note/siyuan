import {toggleMenu} from "../../../menus/menuToggle";
import {Constants} from "../../../constants";
import {showMessage} from "../../../dialog/message";
import {fetchSyncPost} from "../../../util/fetch";
import {normalizeHTMLAssetIFrameBlockDOM} from "../../../asset/html";
import {updateTransaction, transaction} from "../../wysiwyg/transaction";
import {genListItemElement, setTaskListItemMarker} from "../../wysiwyg/list";
import {getListConversionType, type TListSubtype} from "../../wysiwyg/listContext";
import {nextTaskListMarker, nextTaskListStatus} from "../../wysiwyg/taskListMarker";
import {getTaskStatusItems} from "../../wysiwyg/taskStatusDialog";
import {getTabTask} from "../tabsRender";
import {focusBlock} from "../../util/selection";
import {Menu} from "../../../plugin/Menu";
import {completeTabsListSource} from "../../wysiwyg/tabsList";
import {waitForPendingTransactions} from "../../util/transactionQueue";
import {hideAllElements, hideElements} from "../../ui/hideElements";
import {globalClickHideMenu} from "../../../menus/menuClick";
import {countBlockWord} from "../../../layout/status";
import {openLink} from "../../../editor/openLink";
import {previewDocImage} from "../../preview/image";
import {suspendBlockPopover} from "../../../block/popover";
import {matchHotKey} from "../../util/hotKey";
import {setFullscreen} from "../../breadcrumb/action";
import {getCurrentInlineStyleMode, getInlineStylesCache} from "../../toolbar/inlineStyle";
import {openInlineStyleDialog} from "../../toolbar/inlineStyleDialog";
import {
    addListMindmapNode, cleanListMindmapHTML, deleteListMindmapNode,
    moveListMindmapNode, readListMindmap, replaceListMindmapContent,
    writeListMindmapMetadata, getListMindmapTabItem, retagMindmapBranch, normalizeListMindmapSummaryMetadata,
    convertListMindmapToList, hasListMindmapRootTitle, clearListMindmapHeight, initializeListMindmapConnectorStyle,
} from "./model";
import {prepareListMindmapConversion} from "./conversion";
import type {ListMindmapMetadata, ListMindmapModel} from "./model";
import {applyListMindmapListInput, getListMindmapListInputTarget} from "./listInput";
import type {ListMindmapListInput} from "./listInput";
import {getListMindmapElements, registerListMindmapRoot, registerListMindmapView} from "./render";
import {syncListMindmapHeight} from "./height";
import {bindListMindmapResize} from "./resize";
import {setBlockHeight} from "../../gutter/height";
import {ListMindmapView} from "./view";
import {flushListMindmapViewports, getListMindmapViewport, saveListMindmapViewport} from "./viewport";
import {getListMindmapLineColors, getListMindmapNodeColors, getListMindmapNodeColorMenu} from "./colors";
import {openListMindmapEditor} from "./editor";
import {focusListMindmap} from "./create";
import {getListMindmapFoldStates, getListMindmapSiblingFoldStates} from "./fold";
import {getListMindmapFoldMenuItems} from "./foldMenu";
import {isMobile} from "../../../util/functions";
import {addListMindmapSummaryRanges, getListMindmapSiblingIDs,
    getListMindmapSummarySnapshot} from "./summary";
import {getProtyleTransactionOwner, isProtyleListItemFragment} from "../../runtimeCapabilities";
import {isFoldedRenderContent} from "../foldedContent";
import {disposeCustomBlocksInElement} from "../../../plugin/customBlockRender";
import {processRender} from "../../util/processCode";
import {highlightRender} from "../highlightRender";
import {avRender} from "../av/render";
import {blockRender} from "../blockRender";
import {getListMindmapConnectorMenuItem} from "./connectorMenu";
import {getDefaultListMindmapConnectorStyle, setDefaultListMindmapConnectorStyle} from "./preferences";
import {assignListMindmapBranchColors, getListMindmapAppearanceMenu} from "./appearance";
import {getEmbedChildOperationContext} from "../../wysiwyg/getBlock";
import {requestRedo, requestUndo} from "../../undo/globalUndo";
/// #if MOBILE
import {showFullscreenDocumentBar} from "../../../mobile/util/documentBar";
/// #endif
import {preserveUndoViewport} from "../../undo/viewport";
import {buildBlockDOMClipboardData} from "../../util/blockDOMClipboard";
import {buildWebClipboardHTML, getTextSiyuanFromTextHTML} from "../../util/clipboardData";
import {readClipboard, writeClipboardData} from "../../util/compatibility";
import {prepareExternalClipboardHTML} from "../../util/richClipboard";
import {canCutMindmapBranches, copyMindmapBranches, pasteMindmapBranches, readMindmapClipboard,
    removeMindmapBranches} from "./clipboard";

const roots = new WeakMap<IProtyle, {refresh: () => void, mountNew: (list: HTMLElement) => void,
    restoreFocus: (listID: string, candidateIDs: string[], selection?: Record<string, string>, source?: HTMLElement) => void, focusRevision: number,
    interactionRevision?: number, focusGuard?: () => boolean, undoPending?: boolean,
    finish: () => Promise<boolean>, destroy: () => void}>();

const hasMindmapFocusOverlay = () => {
    const active = document.activeElement;
    return !!active?.closest(".b3-dialog, #commonMenu, #keyboardToolbar") &&
        !active.closest('[data-type="undo"], [data-type="redo"]');
};

export const finishListMindmaps = async (owner: IProtyle) => roots.get(owner)?.finish() ?? true;

export const mountNewListMindmap = (owner: IProtyle, list: HTMLElement) => roots.get(owner)?.mountNew(list);

const canToggleView = (owner: IProtyle, list: HTMLElement) => !owner.disabled &&
    (!owner.lite || isProtyleListItemFragment(owner)) &&
    list.isConnected && !!list.dataset.nodeId &&
    !owner.options.action.includes(Constants.CB_GET_HISTORY) &&
    list.closest(".protyle-wysiwyg") === owner.wysiwyg.element;

const canEdit = (owner: IProtyle, list: HTMLElement) => canToggleView(owner, list) &&
    (!list.closest(".protyle-wysiwyg__embed") ||
        !!getEmbedChildOperationContext(list)?.resultElement.dataset.rootId);

export const toggleListMindmap = async (owner: IProtyle, list: HTMLElement) => {
    if (!["NodeList", "NodeMindmap"].includes(list.dataset.type) || !canToggleView(owner, list)) {
        return;
    }
    const exiting = list.dataset.type === "NodeMindmap" || list.getAttribute(Constants.CUSTOM_SY_LIST_MINDMAP) === "1";
    if (exiting && canEdit(owner, list) && hasListMindmapRootTitle(list)) {
        const source = await prepareListMindmapConversion(owner, list);
        if (!source || !canEdit(owner, list)) {
            return;
        }
        const type = getListConversionType("u", source.getAttribute("data-subtype") as TListSubtype) ||
            getListConversionType("o", "u");
        const html = convertListMindmapToList(source, type, owner.lute);
        const template = list.ownerDocument.createElement("template");
        template.innerHTML = html;
        const converted = template.content.firstElementChild;
        const before = cleanListMindmapHTML(source.outerHTML);
        Array.from(list.attributes).forEach(attr => list.removeAttribute(attr.name));
        Array.from(converted.attributes).forEach(attr => list.setAttribute(attr.name, attr.value));
        list.replaceChildren(...Array.from(converted.childNodes));
        hideElements(["gutter", "toolbar", "hint"], owner);
        updateTransaction(owner, list, before);
        roots.get(owner)?.refresh();
        return;
    }
    if (list.dataset.type === "NodeMindmap" || list.getAttribute(Constants.CUSTOM_SY_LIST_MINDMAP) == null) {
        const before = cleanListMindmapHTML(list.outerHTML);
        const toMindmap = list.dataset.type === "NodeList";
        if (toMindmap) {
            initializeListMindmapConnectorStyle(list, getDefaultListMindmapConnectorStyle());
        }
        retagMindmapBranch(list, toMindmap);
        if (!toMindmap) {
            list.removeAttribute(Constants.CUSTOM_SY_LIST_MINDMAP);
        }
        hideElements(["gutter", "toolbar", "hint"], owner);
        updateTransaction(owner, list, before);
        roots.get(owner)?.refresh();
        return;
    }
    const previous = list.getAttribute(Constants.CUSTOM_SY_LIST_MINDMAP) || "";
    const next = previous === "1" ? "" : "1";
    if (next) {
        try {
            readListMindmap(list);
        } catch (error) {
            console.error(error);
            showMessage(window.siyuan.languages.listMindmapInvalid);
            return;
        }
    }
    hideElements(["gutter", "toolbar", "hint"], owner);
    const previousStyle = list.getAttribute("style") || "";
    const previousMetadata = list.getAttribute(Constants.CUSTOM_SY_LIST_MINDMAP_DATA) || "";
    if (!next) {
        initializeListMindmapConnectorStyle(list, "bezier");
        clearListMindmapHeight(list);
    }
    const nextStyle = list.getAttribute("style") || "";
    const doAttrs: Record<string, string> = {[Constants.CUSTOM_SY_LIST_MINDMAP]: next};
    const undoAttrs: Record<string, string> = {[Constants.CUSTOM_SY_LIST_MINDMAP]: previous};
    const nextMetadata = list.getAttribute(Constants.CUSTOM_SY_LIST_MINDMAP_DATA) || "";
    if (nextMetadata !== previousMetadata) {
        doAttrs[Constants.CUSTOM_SY_LIST_MINDMAP_DATA] = nextMetadata;
        undoAttrs[Constants.CUSTOM_SY_LIST_MINDMAP_DATA] = previousMetadata;
    }
    if (nextStyle !== previousStyle) {
        doAttrs.style = nextStyle;
        undoAttrs.style = previousStyle;
    }
    list.setAttribute(Constants.CUSTOM_SY_LIST_MINDMAP, next);
    transaction(owner, [{action: "setAttrs", id: list.dataset.nodeId,
        data: JSON.stringify(doAttrs)}], [{action: "setAttrs", id: list.dataset.nodeId,
        data: JSON.stringify(undoAttrs)}]);
    roots.get(owner)?.refresh();
};

class ListMindmapController {
    public readonly list: HTMLElement;
    private readonly owner: IProtyle;
    private readonly host: HTMLElement;
    private readonly view: ListMindmapView;
    private model: ListMindmapModel;
    private snapshot = "";
    private activeEditor?: ReturnType<typeof openListMindmapEditor>;
    private newNodeOrigins?: WeakMap<HTMLElement, {id: string; html: string}>;
    private editRequest = 0;
    private disposed = false;
    private taskChanges: Promise<void> = Promise.resolve();
    private unregisterVisible?: () => void;
    private resize: ReturnType<typeof bindListMindmapResize>;

    constructor(owner: IProtyle, list: HTMLElement) {
        this.owner = owner;
        this.list = list;
        this.model = readListMindmap(list);
        list.querySelectorAll(":scope > .mindmap-view").forEach(host => host.remove());
        this.host = document.createElement("div");
        this.host.className = "mindmap-view";
        syncListMindmapHeight(list, this.host);
        this.host.contentEditable = "false";
        // 节点编辑器和画布隔离 keyup，捕获阶段同步全局修饰键释放状态。
        this.host.addEventListener("keyup", () => {
            window.siyuan.ctrlIsPressed = false;
            window.siyuan.shiftIsPressed = false;
            window.siyuan.altIsPressed = false;
            document.body.classList.remove("body--shift-pressed");
        }, {capture: true});
        const renderGutter = (event: PointerEvent) => {
            if (!owner.options.render.gutter ||
                !owner.gutter || this.host.classList.contains("fullscreen") ||
                (event.target as Element).closest(".mindmap-view__editor, .protyle-toolbar, .protyle-util")) {
                return;
            }
            // 脑图内部的指针事件不冒泡到编辑器，块标仍定位到原列表块。
            owner.gutter.render(owner, list, this.host);
        };
        this.host.addEventListener("pointermove", event => {
            if (event.pointerType === "mouse" && !event.buttons) {
                renderGutter(event);
            }
        });
        this.host.addEventListener("pointerup", event => {
            if (event.pointerType !== "mouse" && event.isPrimary) {
                renderGutter(event);
            }
        });
        this.host.addEventListener("pointerdown", event => {
            const target = event.target as HTMLElement;
            // 脑图阻止事件冒泡，主动复用公共收起逻辑，并保留内嵌编辑器浮层的交互。
            globalClickHideMenu(target);
            if (!target.closest(".protyle-toolbar, .protyle-util, [data-sub-element-source]")) {
                hideAllElements(["toolbar", "util", "gutter"]);
                hideElements(["hint"], this.owner);
                // 进入脑图交互时清除外层块选区，同时保留多选工具栏的操作上下文。
                if (event.button === 0 && !this.owner.toolbar.isMultiSelectMode() &&
                    this.owner.wysiwyg.element.querySelector(".protyle-wysiwyg--select, .protyle-wysiwyg--select-mode")) {
                    hideElements(["select"], this.owner);
                    countBlockWord([], this.owner);
                }
            }
        }, {capture: true});
        this.host.addEventListener("keydown", event => {
            if (this.view?.isLocked() || event.isComposing || (event.target instanceof Element &&
                (event.target.closest("input, textarea, select") ||
                    this.host.contains(event.target.closest(".mindmap-view__editor"))))) {
                return;
            }
            const keys = owner.options?.action && window.siyuan.config.keymap.editor.general;
            if (keys && (matchHotKey(keys.undo, event) || matchHotKey(keys.redo, event))) {
                event.preventDefault();
                event.stopImmediatePropagation();
                void this.undo(matchHotKey(keys.redo, event));
            }
        }, {capture: true});
        list.appendChild(this.host);
        let restoreFullscreenChrome: () => void;
        /// #if MOBILE
        let restoreDocumentBar: () => void;
        /// #endif
        this.view = new ListMindmapView({
            viewport: getListMindmapViewport(owner, list),
            onViewportChange: state => saveListMindmapViewport(owner, list, state),
            host: this.host, model: this.model, labels: window.siyuan.languages,
            onOpenLink: (href, event) => openLink(owner.app, href, event, event.ctrlKey || event.metaKey),
            onPreviewImage: (src, video) => previewDocImage(src, owner.block.rootID, video),
            onInteractionStart: event => suspendBlockPopover(this.host, event),
            readOnly: !canEdit(owner, list),
            onLockChange: locked => canEdit(owner, list) ? this.metadata(metadata => {
                metadata.viewLocked = locked;
            }) : Promise.resolve(true),
            onSettingsMenu: (anchor, expand, pan) => {
                toggleMenu({
                    target: anchor,
                    build: (_menu, session) => {
                        let previewing = false;
                        let closed = false;
                        const preview = (update?: (metadata: ListMindmapMetadata) => void) => {
                            if (this.disposed || closed) {
                                return;
                            }
                            if (update) {
                                // 预览只替换视图模型，源块和撤销记录仍使用已保存的数据。
                                const metadata = JSON.parse(JSON.stringify(this.model.metadata)) as ListMindmapMetadata;
                                update(metadata);
                                previewing = true;
                                this.view.update({...this.model, metadata});
                            } else if (previewing) {
                                previewing = false;
                                this.view.update(this.model);
                            }
                        };
                        const cancelPreview = (event: KeyboardEvent) => {
                            if (event.key === "Escape") {
                                preview();
                            }
                        };
                        const menu = new Menu(undefined, () => {
                            window.removeEventListener("keydown", cancelPreview, true);
                            preview();
                            closed = true;
                        });
                        if (!isMobile()) {
                            window.addEventListener("keydown", cancelPreview, true);
                        }
                        if (pan) {
                            menu.addItem({
                                id: "pan", icon: "iconPan", label: window.siyuan.languages.cursorHand,
                                checked: pan.active, click: pan.toggle,
                            });
                        }
                        if (canEdit(owner, list)) {
                            const current = readListMindmap(list).metadata;
                            menu.addItem(getListMindmapAppearanceMenu(current,
                                update => void this.metadata(update), window.siyuan.languages,
                                getListMindmapConnectorMenuItem(current.connectorStyle || "bezier",
                                style => {
                                    void this.metadata(metadata => {
                                        if ((metadata.connectorStyle || "bezier") === style) {
                                            return false;
                                        }
                                        if (style === "bezier") {
                                            delete metadata.connectorStyle;
                                        } else {
                                            metadata.connectorStyle = style;
                                        }
                                    });
                                }, window.siyuan.languages), isMobile() ? undefined : preview));
                            menu.addItem(getListMindmapConnectorMenuItem(getDefaultListMindmapConnectorStyle(), style => {
                                if (canEdit(owner, list)) {
                                    setDefaultListMindmapConnectorStyle(style);
                                }
                            }, window.siyuan.languages, "default"));
                        }
                        if (expand) {
                            menu.addItem({
                                id: "expandLevel", icon: "iconExpandLevel", label: window.siyuan.languages.expandLevel,
                                submenu: getListMindmapFoldMenuItems(expand, window.siyuan.languages),
                            });
                        }
                        if (isMobile()) {
                            session.show(() => menu.fullscreen("bottom"));
                        } else {
                            const rect = anchor.getBoundingClientRect();
                            session.show(() => menu.open({x: rect.left, y: rect.bottom, h: rect.height}));
                        }
                    },
                });
            },
            onExpandLevelMenu: (anchor, select) => {
                toggleMenu({
                    target: anchor,
                    build: (_menu, session) => {
                        const menu = new Menu();
                        getListMindmapFoldMenuItems(select, window.siyuan.languages).forEach(item => menu.addItem(item));
                        if (isMobile()) {
                            session.show(() => menu.fullscreen("bottom"));
                        } else {
                            const rect = anchor.getBoundingClientRect();
                            session.show(() => menu.open({x: rect.left, y: rect.bottom, h: rect.height}));
                        }

                    },
                });
            },
            onFoldLevel: level => this.change(() => {
                const model = readListMindmap(list);
                getListMindmapFoldStates(model.root, level).forEach((collapsed, id) => {
                    const node = model.nodes.get(id);
                    if (node.element && node.collapsed !== collapsed) {
                        node.element.setAttribute("fold", collapsed ? "1" : "0");
                    }
                });
            }),
            onFullscreen: (enter, button) => {
                /// #if MOBILE
                if (enter) {
                    restoreDocumentBar = showFullscreenDocumentBar(this.owner, this.host);
                } else {
                    restoreDocumentBar?.();
                    restoreDocumentBar = undefined;
                }
                /// #endif
                if (enter) {
                    const drag = document.getElementById("drag");
                    const controls = document.getElementById("windowControls");
                    const dragHidden = drag?.classList.contains("fn__hidden");
                    const controlsZIndex = controls?.style.zIndex;
                    // 脑图可以从全屏编辑器中打开，退出后恢复原窗口控件状态。
                    restoreFullscreenChrome = () => {
                        drag?.classList.toggle("fn__hidden", !!dragHidden);
                        if (controls) {
                            controls.style.zIndex = controlsZIndex;
                        }
                    };
                }
                setFullscreen(this.host, enter, button);
                if (!enter) {
                    restoreFullscreenChrome?.();
                    restoreFullscreenChrome = undefined;
                }
            },
            colors: () => getListMindmapLineColors(getInlineStylesCache(), window.siyuan.languages, getCurrentInlineStyleMode()),
            nodeColors: () => getListMindmapNodeColors(getInlineStylesCache(), window.siyuan.languages, getCurrentInlineStyleMode()),
            onManageNodeColors: anchor => toggleMenu({target: anchor, build: (_menu, session) => {
                const menu = new Menu();
                getListMindmapNodeColorMenu(window.siyuan.languages, type => openInlineStyleDialog(type))
                    .forEach(item => menu.addItem(item));
                if (isMobile()) {
                    session.show(() => menu.fullscreen("bottom"));
                } else {
                    const rect = anchor.getBoundingClientRect();
                    session.show(() => menu.open({x: rect.left, y: rect.bottom, h: rect.height}));
                }
            }}),
            onManageLineColors: () => openInlineStyleDialog("color"),
            finishEdit: () => this.activeEditor?.finish(),
            onExit: async () => {
                if (this.activeEditor && !await this.activeEditor.finish()) {
                    return;
                }
                if (canToggleView(owner, list)) {
                    toggleListMindmap(owner, list);
                } else {
                    this.destroy();
                }
            },
            onEdit: (id, contentHost, replaceFirstParagraph) => this.edit(id, contentHost, replaceFirstParagraph),
            onCopy: (ids, cut, event) => void this.copyNodes(ids, cut, event),
            onPaste: (id, kind, data) => void this.pasteNodes(id, kind, data),
            onDeleteNodes: ids => void this.removeNodes(ids),
            onClipboardMenu: (anchor, ids) => {
                toggleMenu({target: anchor, build: (_menu, session) => {
                    const menu = new Menu();
                    if (canEdit(owner, list) && canCutMindmapBranches(readListMindmap(list), ids)) {
                        menu.addItem({label: window.siyuan.languages.cut, icon: "iconCut",
                            click: () => void this.copyNodes(ids, true)});
                    }
                    menu.addItem({label: window.siyuan.languages.copy, icon: "iconCopy",
                        click: () => void this.copyNodes(ids, false)});
                    if (ids.length === 1 && canEdit(owner, list)) {
                        menu.addItem({label: window.siyuan.languages.mindmapPasteChild, icon: "iconPaste",
                            click: () => void this.pasteNodes(ids[0], "child")});
                        if (!this.model.nodes.get(ids[0])?.virtual) {
                            menu.addItem({label: window.siyuan.languages.mindmapPasteSibling, icon: "iconPaste",
                                click: () => void this.pasteNodes(ids[0], "sibling")});
                        }
                    }
                    const marker = ids.length === 1 ? this.model.nodes.get(ids[0])?.taskMarker : undefined;
                    if (marker !== undefined && canEdit(owner, list)) {
                        menu.addItem({label: window.siyuan.languages.checkToggle, icon: "iconCheck",
                            submenu: getTaskStatusItems(marker, next => this.setTask(ids[0], () => next))});
                    }
                    const rect = anchor.getBoundingClientRect();
                    if (isMobile()) {
                        session.show(() => menu.fullscreen("bottom"));
                    } else {
                        session.show(() => menu.open({x: rect.left, y: rect.bottom, h: rect.height}));
                    }
                }});
            },
            isAddSiblingShortcut: event => {
                const key = window.siyuan.config.keymap.editor.list?.mindmapAddSibling;
                return !!key && matchHotKey(key, event);
            },
            isAddChildShortcut: event => {
                const key = window.siyuan.config.keymap.editor.list?.mindmapAddChild;
                return !!key && matchHotKey(key, event);
            },
            onTaskToggle: (id, cycle) => this.setTask(id, cycle ? nextTaskListStatus : nextTaskListMarker),
            onTabTaskToggle: (id, itemId) => this.setTabTask(id, itemId, nextTaskListMarker),
            onTabTaskMenu: (id, itemId, anchor) => {
                toggleMenu({
                    target: anchor,
                    build: (_menu, session) => {
                        const item = getListMindmapTabItem(list, id, itemId);
                        const marker = item && getTabTask(item);
                        if (!canEdit(owner, list) || marker == null) {
                            return;
                        }
                        const menu = new Menu();
                        getTaskStatusItems(marker, next => this.setTabTask(id, itemId, () => next)).forEach(entry => menu.addItem(entry));
                        const rect = anchor.getBoundingClientRect();
                        session.show(() => menu.open({x: rect.left, y: rect.bottom, h: rect.height}));

                    },
                });
            },
            onTaskMenu: (id, anchor) => {
                toggleMenu({
                    target: anchor,
                    build: (_menu, session) => {
                        if (!canEdit(owner, list)) {
                            return;
                        }
                        const marker = readListMindmap(list).nodes.get(id)?.taskMarker;
                        if (marker === undefined) {
                            return;
                        }
                        const menu = new Menu();
                        getTaskStatusItems(marker, next => this.setTask(id, () => next)).forEach(item => menu.addItem(item));
                        const rect = anchor.getBoundingClientRect();
                        session.show(() => menu.open({x: rect.left, y: rect.bottom, h: rect.height}));

                    },
                });
            },
            isTaskCycle: event => matchHotKey(window.siyuan.config.keymap.editor.list.checkToggle, event),
            isTaskCompletionToggle: event => matchHotKey(window.siyuan.config.keymap.editor.list.taskCompletionToggle, event),
            onRootTitleChange: title => this.metadata(metadata => {
                metadata.rootTitle = title;
            }),
            onMove: (id, target, placement) => this.change(() => moveListMindmapNode(list, id, target, placement)),
            onAdd: (id, kind) => this.add(id, kind),
            onDelete: id => this.deleteNode(id),
            onFold: id => this.change(() => {
                const node = this.model.nodes.get(id);
                if (node?.element && !node.virtual) {
                    node.element.setAttribute("fold", node.collapsed ? "0" : "1");
                }
            }),
            onFoldSiblings: id => this.change(() => {
                const model = readListMindmap(list);
                getListMindmapSiblingFoldStates(model, id).forEach((collapsed, siblingID) => {
                    const node = model.nodes.get(siblingID);
                    if (node.element && node.collapsed !== collapsed) {
                        node.element.setAttribute("fold", collapsed ? "1" : "0");
                    }
                });
            }),
            onNodeStyle: (id, patch) => this.metadata(metadata => {
                metadata.nodes[id] = {...metadata.nodes[id], ...patch};
            }),
            onNodesStyle: (ids, patch) => this.metadata(metadata => {
                const nodes = readListMindmap(list).nodes;
                ids.filter(id => nodes.has(id)).forEach(id => {
                    metadata.nodes[id] = {...metadata.nodes[id], ...patch};
                });
            }),
            onNodeWidths: (widths, expected) => this.metadata(metadata => {
                const nodes = readListMindmap(list).nodes;
                const current = widths.map(({id}) => ({id, width: metadata.nodes[id]?.width || 0}));
                if (JSON.stringify(current) !== expected || widths.some(({id, width}) =>
                    !nodes.has(id) || !Number.isFinite(width) || width < 0)) {
                    showMessage(window.siyuan.languages.listMindmapStale);
                    return false;
                }
                widths.forEach(({id, width}) => metadata.nodes[id] = {...metadata.nodes[id], width});
            }),
            onRelationAdd: (from, to) => this.metadata(metadata => {
                if (from !== to && !metadata.relations.some(relation => relation.from === from && relation.to === to)) {
                    metadata.relations.push({id: Lute.NewNodeID(), from, to, label: ""});
                }
            }),
            onRelationChange: (id, patch, expected) => this.metadata(metadata => {
                const relation = metadata.relations.find(item => item.id === id);
                if (!relation || (expected !== undefined && JSON.stringify(relation) !== expected)) {
                    showMessage(window.siyuan.languages.listMindmapStale);
                    return false;
                }
                if (patch.from !== undefined || patch.to !== undefined) {
                    const from = patch.from ?? relation.from;
                    const to = patch.to ?? relation.to;
                    const nodes = readListMindmap(this.list).nodes;
                    if (!nodes.has(from) || !nodes.has(to) || from === to || metadata.relations.some(item =>
                        item.id !== id && item.from === from && item.to === to)) {
                        return false;
                    }
                }
                Object.assign(relation, patch);
                for (const key of ["route", "fromAnchor", "toAnchor"] as const) {
                    if (key in patch && patch[key] === undefined) {
                        delete relation[key];
                    }
                }
            }),
            onRelationDelete: id => this.metadata(metadata => {
                metadata.relations = metadata.relations.filter(item => item.id !== id);
            }),
            onSummaryBatchAdd: async (ranges, expected) => {
                let ids: string[];
                const saved = await this.change(() => {
                    const model = readListMindmap(list);
                    if (getListMindmapSummarySnapshot(model) !== expected) {
                        showMessage(window.siyuan.languages.listMindmapStale);
                        return false;
                    }
                    ids = addListMindmapSummaryRanges(model, ranges, () => Lute.NewNodeID(),
                        window.siyuan.languages.listMindmapSummary);
                    if (!ids) {
                        return false;
                    }
                    writeListMindmapMetadata(list, model.metadata);
                });
                return saved ? ids : undefined;
            },
            onSummaryChange: (id, patch, expected) => this.metadata(metadata => {
                const summary = metadata.summaries?.find(item => item.id === id);
                if (!summary || (expected !== undefined && JSON.stringify(summary) !== expected)) {
                    showMessage(window.siyuan.languages.listMindmapStale);
                    return false;
                }
                Object.assign(summary, patch);
            }),
            onSummaryDelete: id => this.metadata(metadata => {
                metadata.summaries = metadata.summaries?.filter(item => item.id !== id) || [];
            }),
        });
        list.dataset.mindmapViewRendered = "true";
        this.resize = bindListMindmapResize({
            block: list, host: this.host,
            labels: {width: window.siyuan.languages.width, height: window.siyuan.languages.height},
            canResize: () => canEdit(owner, list) && !this.view.isLocked(),
            prepare: () => this.finish(),
            commit: size => this.change(() => {
                if (size.width !== undefined && !list.parentElement?.classList.contains("sb")) {
                    list.style.width = `${size.width}px`;
                    list.style.flex = "none";
                }
                if (size.height !== undefined) {
                    setBlockHeight(list, `${size.height}px`);
                }
            }),
        });
        this.unregisterVisible = registerListMindmapView(list, this.view, this.host);
        this.snapshot = cleanListMindmapHTML(list.outerHTML);
        if (canEdit(owner, list)) {
            const focusSource = getSelection()?.anchorNode;
            let focusedID: string;
            for (let element = focusSource instanceof Element ? focusSource : focusSource?.parentElement;
                 element && list.contains(element); element = element.parentElement) {
                const id = (element as HTMLElement).dataset.nodeId;
                if (id && this.model.nodes.has(id)) {
                    focusedID = id;
                    break;
                }
            }
            const range = focusListMindmap(list, this.host);
            if (range) {
                if (focusedID) {
                    this.view.focusNode(focusedID);
                }
                owner.toolbar.range = range;
            }
        }
    }

    private metadata(change: (metadata: ListMindmapMetadata) => void | false) {
        return this.change(() => {
            const metadata = readListMindmap(this.list).metadata;
            if (change(metadata) === false) {
                return false;
            }
            writeListMindmapMetadata(this.list, metadata);
        });
    }

    private setTask(id: string, next: (marker: string) => string) {
        return this.queueTask(() => {
            const node = readListMindmap(this.list).nodes.get(id);
            if (node?.taskMarker === undefined) {
                return;
            }
            const marker = next(node.taskMarker);
            if (marker !== node.taskMarker) {
                setTaskListItemMarker(this.owner, node.element, marker);
                this.refresh();
            }
        });
    }

    private setTabTask(id: string, itemId: string, next: (marker: string) => string) {
        return this.queueTask(async () => {
            await this.change(() => {
                const item = getListMindmapTabItem(this.list, id, itemId);
                const marker = item && getTabTask(item);
                if (marker == null) {
                    return false;
                }
                const value = next(marker);
                if (value === marker) {
                    return false;
                }
                item.setAttribute("tabs-task", value);
            }, true);
        });
    }

    private queueTask(change: () => void | Promise<void>) {
        // 连续操作串行提交，正文保存后重新查找源节点，避免使用过期状态覆盖任务。
        this.taskChanges = this.taskChanges.then(async () => {
            if (this.disposed || !this.list.isConnected || !canEdit(this.owner, this.list) ||
                (this.activeEditor && !await this.activeEditor.finish())) {
                return;
            }
            if (this.disposed || !this.list.isConnected || !canEdit(this.owner, this.list)) {
                return;
            }
            await change();
        }).catch(error => {
            console.error(error);
            showMessage(window.siyuan.languages.listMindmapInvalid);
        });
        return this.taskChanges;
    }

    private async change(change: () => unknown, editing = false, focusID?: string,
                         selection?: {undo?: Record<string, string>, redo?: Record<string, string>}) {
        if (this.disposed || !this.list.isConnected || !canEdit(this.owner, this.list)) {
            return false;
        }
        if (!editing && this.activeEditor && !await this.activeEditor.finish()) {
            return false;
        }
        if (this.disposed || !this.list.isConnected || !canEdit(this.owner, this.list)) {
            return false;
        }
        const before = cleanListMindmapHTML(this.list.outerHTML);
        try {
            const model = readListMindmap(this.list);
            // 文本保存可能晚于画布选择变化，撤销定位始终使用本次编辑的节点。
            const selectedID = editing && model.nodes.has(focusID) ? focusID : this.view.getSelectedId() || model.root.id;
            const selected = model.nodes.get(selectedID);
            const siblings = selected?.parentId ? model.nodes.get(selected.parentId)?.children || [] : [];
            const index = siblings.findIndex(node => node.id === selectedID);
            const previous = getListMindmapSiblingIDs(model);
            const focusContext = (id: string, source: ListMindmapModel): Record<string, string> => {
                const embed = this.list.closest(".protyle-wysiwyg__embed");
                if (!embed) {
                    return {};
                }
                const element = source.nodes.get(id)?.element || this.list;
                const index = Array.from(this.owner.wysiwyg.element.querySelectorAll(`[data-node-id="${id}"]`))
                    .indexOf(element);
                const query = embed.closest<HTMLElement>('[data-type="NodeBlockQueryEmbed"]');
                return {...(index >= 0 ? {undoFocusIndex: String(index)} : {}),
                    ...(query?.dataset.nodeId ? {undoFocusEmbedId: query.dataset.nodeId} : {})};
            };
            const undoFocus = focusContext(selectedID, model);
            if (change() === false) {
                return false;
            }
            normalizeListMindmapSummaryMetadata(this.list, previous);
            const next = readListMindmap(this.list);
            if (next.metadata.appearance?.palette.length && assignListMindmapBranchColors(next)) {
                writeListMindmapMetadata(this.list, next.metadata);
            }
            if (cleanListMindmapHTML(this.list.outerHTML) !== before) {
                const nextID = [focusID, selectedID, siblings[index + 1]?.id, siblings[index - 1]?.id,
                    selected?.parentId].find(id => next.nodes.has(id)) || next.root.id;
                // 将操作前后的节点分别记录在事务中，重做时可定位到重新插入的节点。
                updateTransaction(this.owner, this.list, before, {
                    undoFocusId: selectedID, undoFocusStart: "0", undoFocusEnd: "0",
                    mindmapSnapshotId: this.list.dataset.nodeId,
                    ...undoFocus,
                    ...(selection?.undo ? {undoFocusMindmapSelection: JSON.stringify(selection.undo)} : {}),
                }, {doOperations: [], undoOperations: [], context: {
                    undoFocusId: nextID, undoFocusStart: "0", undoFocusEnd: "0",
                    mindmapSnapshotId: this.list.dataset.nodeId,
                    ...focusContext(nextID, next),
                    ...(selection?.redo ? {undoFocusMindmapSelection: JSON.stringify(selection.redo)} : {}),
                }});
            }
            this.refresh();
            return true;
        } catch (error) {
            console.error(error);
            showMessage(window.siyuan.languages.listMindmapInvalid);
            return false;
        }
    }

    private async copyNodes(ids: string[], cut: boolean, event?: ClipboardEvent) {
        try {
            if (this.disposed || !this.list.isConnected || this.activeEditor ||
                cut && (!canEdit(this.owner, this.list) || !canCutMindmapBranches(this.model, ids))) {
                return;
            }
            const before = cleanListMindmapHTML(this.list.outerHTML);
            const source = copyMindmapBranches(this.list, ids);
            if (!source) {
                return;
            }
            const data = buildBlockDOMClipboardData(this.owner.lute, source);
            data.textHTML = prepareExternalClipboardHTML(data.textHTML);
            if (event?.clipboardData) {
                event.clipboardData.setData("text/plain", data.textPlain);
                event.clipboardData.setData("text/html", buildWebClipboardHTML(data.textHTML, data.textSiyuan));
                event.clipboardData.setData("text/siyuan", data.textSiyuan);
                return;
            }
            const result = await writeClipboardData(data, {fallbackToPlainText: !cut});
            if (result.status === "failed" || cut && result.status !== "rich") {
                showMessage(window.siyuan.languages.clipboardPermissionDenied);
                return;
            }
            if (cut && cleanListMindmapHTML(this.list.outerHTML) === before) {
                await this.removeNodes(ids, before);
            }
        } catch (error) {
            console.error(error);
            showMessage(window.siyuan.languages.listMindmapInvalid);
        }
    }

    private async removeNodes(ids: string[], expected?: string) {
        return this.change(() => {
            if (expected !== undefined && cleanListMindmapHTML(this.list.outerHTML) !== expected) {
                return false;
            }
            const copy = removeMindmapBranches(this.list, ids);
            if (!copy) {
                return false;
            }
            this.replaceClipboardSource(copy);
        });
    }

    private replaceClipboardSource(source: HTMLElement) {
        this.replaceSourceChildren(source);
        const metadata = source.getAttribute(Constants.CUSTOM_SY_LIST_MINDMAP_DATA);
        if (metadata !== null) {
            this.list.setAttribute(Constants.CUSTOM_SY_LIST_MINDMAP_DATA, metadata);
        }
    }

    private replaceSourceChildren(source: HTMLElement) {
        // 全屏时画布位于 body，保留原位置标记，退出全屏时仍能还原。
        const retained = Array.from(this.list.childNodes).filter(child => child === this.host ||
            child.nodeType === Node.COMMENT_NODE && child.nodeValue === "mindmap-view");
        Array.from(this.list.childNodes).forEach(child => {
            if (!retained.includes(child)) {
                if (child instanceof Element) {
                    disposeCustomBlocksInElement(child);
                }
                child.remove();
            }
        });
        const children = Array.from(source.childNodes);
        children.forEach(child => this.list.insertBefore(child, retained[0] || null));
        children.forEach(child => {
            if (child instanceof Element) {
                processRender(child);
                highlightRender(child);
                avRender(child, this.owner);
                blockRender(this.owner, child);
            }
        });
    }

    private async pasteNodes(id: string, kind: "child" | "sibling", data?: IClipboardData) {
        const rootID = this.owner.block.rootID;
        const before = cleanListMindmapHTML(this.list.outerHTML);
        const current = () => !this.disposed && canEdit(this.owner, this.list) &&
            this.owner.block.rootID === rootID && this.view.getSelectedId() === id &&
            this.view.getSelectedIds().length === 1 && cleanListMindmapHTML(this.list.outerHTML) === before;
        try {
            data ||= await readClipboard();
            if (!current() || !data) {
                return;
            }
            const html = data.siyuanHTML || getTextSiyuanFromTextHTML(data.textHTML || "").textSiyuan;
            const source = html && readMindmapClipboard(html);
            if (source) {
                const result = pasteMindmapBranches(this.list, source, id, kind === "child" ? "child" : "after", this.owner.lute);
                if (result && await this.change(() => {
                    if (!current()) {
                        return false;
                    }
                    this.replaceClipboardSource(result.list);
                }, false, result.ids[0])) {
                    this.view.focusNode(result.ids[0]);
                }
            } else if (data.textPlain || data.textHTML || data.siyuanHTML || data.files?.length || data.localFiles?.length) {
                await this.add(id, kind, data);
            }
        } catch (error) {
            console.error(error);
            showMessage(window.siyuan.languages.listMindmapInvalid);
        }
    }

    private async add(id: string, kind: "child" | "sibling", clipboard?: IClipboardData) {
        if (!canEdit(this.owner, this.list)) {
            return;
        }
        const target = this.model.nodes.get(id);
        if (!target) {
            return;
        }
        const firstItem = Array.from(this.list.children).find(child =>
            ["NodeListItem", "NodeMindmapItem"].includes(child.getAttribute("data-type")));
        const start = target.element ? undefined : Number.parseInt(firstItem?.getAttribute("data-marker") || "", 10) || 1;
        const item = genListItemElement(target.element || this.list, 0, false, start);
        if (this.list.dataset.type === "NodeMindmap") {
            item.dataset.type = "NodeMindmapItem";
            item.classList.replace("li", "mindmap-item");
        }
        if (!await this.change(() => addListMindmapNode(this.list, id, kind === "child" ? "child" : "after", item),
            false, item.dataset.nodeId)) {
            return;
        }
        this.view.focusNode(item.dataset.nodeId);
        if (clipboard) {
            const content = this.view.getContentHost(item.dataset.nodeId);
            if (content) {
                await this.edit(item.dataset.nodeId, content, undefined, clipboard);
            }
        } else {
            // 仅在当前源节点未编辑、未被回放替换时，记住取消新建应返回的位置。
            this.newNodeOrigins ||= new WeakMap();
            this.newNodeOrigins.set(item, {id, html: cleanListMindmapHTML(item.outerHTML)});
        }
    }

    private async deleteNode(id: string) {
        const element = this.model.nodes.get(id)?.element;
        const origin = element && this.list.contains(element) && this.newNodeOrigins?.get(element);
        const sourceID = origin && this.view.getSelectedId() === id && this.model.nodes.has(origin.id) &&
            cleanListMindmapHTML(element.outerHTML) === origin.html ? origin.id : undefined;
        const deleted = await this.change(() => deleteListMindmapNode(this.list, id), false, sourceID);
        if (deleted) {
            if (element) {
                this.newNodeOrigins?.delete(element);
            }
            if (sourceID && this.model.nodes.has(sourceID) && !this.model.nodes.has(id) &&
                (!this.view.getSelectedId() || this.view.getSelectedId() === id)) {
                this.view.focusNode(sourceID);
            }
        }
        return deleted;
    }

    private async listInput(id: string, input: ListMindmapListInput, selection?: Record<string, string>) {
        const request = this.editRequest;
        const rootID = this.owner.block.rootID;
        if (input.kind !== "split" && input.kind !== "before" &&
            !getListMindmapListInputTarget(this.model.nodes.get(id), input.kind)) {
            return;
        }
        if (!canEdit(this.owner, this.list) || this.activeEditor && !await this.activeEditor.finish() ||
            request !== this.editRequest || rootID !== this.owner.block.rootID || this.disposed || !canEdit(this.owner, this.list)) {
            return;
        }
        // 结构编辑只克隆源内容，画布实例和全屏返回标记由当前控制器保留。
        const template = this.list.ownerDocument.createElement("template");
        template.innerHTML = cleanListMindmapHTML(this.list.outerHTML);
        const source = template.content.firstElementChild as HTMLElement;
        const node = readListMindmap(source).nodes.get(id);
        if (!node?.element) {
            return;
        }
        let item: HTMLElement;
        if (input.kind === "split" || input.kind === "before") {
            item = genListItemElement(node.element, 0, false);
            if (source.dataset.type === "NodeMindmap") {
                item.dataset.type = "NodeMindmapItem";
                item.classList.replace("li", "mindmap-item");
            }
        }
        const result = applyListMindmapListInput(source, id, input, item);
        const before = cleanListMindmapHTML(this.list.outerHTML);
        if (!result || !await this.change(() => {
            if (cleanListMindmapHTML(this.list.outerHTML) !== before) {
                return false;
            }
            this.replaceClipboardSource(source);
        }, false, result.id, {undo: selection, redo: result.selection || selection})) {
            return;
        }
        this.view.focusNode(result.id);
        const host = this.view.getContentHost(result.id);
        if (host) {
            await this.edit(result.id, host, undefined, undefined, result.selection || selection);
        }
    }

    private async edit(id: string, host: HTMLElement, replaceFirstParagraph?: string, clipboard?: IClipboardData,
                       selection?: Record<string, string>, guard?: () => boolean) {
        if (guard && !guard()) {
            return;
        }
        if (!guard && roots.has(this.owner)) {
            roots.get(this.owner).interactionRevision = (roots.get(this.owner).interactionRevision || 0) + 1;
        }
        const request = ++this.editRequest;
        if (!canEdit(this.owner, this.list) || (this.activeEditor && !await this.activeEditor.finish()) ||
            request !== this.editRequest || this.disposed || !host?.isConnected || guard && !guard()) {
            return;
        }
        const node = this.model.nodes.get(id);
        if (!node || node.virtual) {
            return;
        }
        this.newNodeOrigins?.delete(node.element);
        this.view.setEditing(id);
        const editor = openListMindmapEditor({
            owner: this.owner, node, host, replaceFirstParagraph, selection,
            rootID: this.list.closest<HTMLElement>(".protyle-wysiwyg__embed")?.dataset.rootId,
            canEdit: () => !this.disposed && this.list.isConnected && canEdit(this.owner, this.list),
            onSave: (html, undo, redo) => this.change(() => replaceListMindmapContent(this.list, id, html), true, id, {undo, redo}),
            onResize: () => this.view.refreshLayout(),
            onAdd: kind => this.add(id, kind),
            onListInput: (input, selection) => this.listInput(id, input, selection),
            isPanTarget: event => this.view.isPanTarget(event),
            onFinish: () => {
                if (this.activeEditor !== editor) {
                    return;
                }
                this.activeEditor = undefined;
                this.view.setEditing(undefined);
                if (!this.disposed) {
                    this.view.update(this.model);
                }
            },
            onUndo: (redo, currentSelection) => this.undo(redo, id, currentSelection),
        });
        this.activeEditor = editor;
        if (!this.activeEditor) {
            this.view.setEditing(undefined);
            this.view.update(this.model);
        } else if (clipboard) {
            await this.activeEditor.pasteClipboard(clipboard);
        }
    }

    private async undo(redo: boolean, editingID?: string, selection?: Record<string, string>) {
        const root = roots.get(this.owner);
        if (root?.undoPending) {
            return;
        }
        const selectedID = editingID || this.view.getSelectedId();
        const selected = selectedID ? this.model.nodes.get(selectedID) : undefined;
        const siblings = selected?.parentId ? this.model.nodes.get(selected.parentId)?.children || [] : [];
        const index = siblings.findIndex(node => node.id === selectedID);
        const candidateIDs = [selectedID, siblings[index - 1]?.id, siblings[index + 1]?.id,
            selected?.parentId].filter((id): id is string => !!id);
        const interactionRevision = root?.interactionRevision;
        const editorRoot = this.owner.wysiwyg.element;
        const documentID = this.owner.block.rootID;
        const notebookID = this.owner.notebookId;
        const releaseViewport = preserveUndoViewport(editorRoot);
        const guard = () => roots.get(this.owner) === root && editorRoot.isConnected &&
            this.owner.block.rootID === documentID && this.owner.notebookId === notebookID &&
            root?.interactionRevision === interactionRevision && !hasMindmapFocusOverlay();
        if (root) {
            root.undoPending = true;
            root.focusGuard = guard;
        }
        try {
            if (!canEdit(this.owner, this.list) || (this.activeEditor && !await this.activeEditor.finish())) {
                return;
            }
            const before = cleanListMindmapHTML(this.list.outerHTML);
            if (editingID && guard()) {
                this.view.focusNode(editingID, false);
            }
            const focusRevision = root?.focusRevision;
            const sourceRootID = this.list.closest<HTMLElement>(".protyle-wysiwyg__embed")?.dataset.rootId;
            if (sourceRootID) {
                // 全屏视图和节点片段的选区不在嵌入源块内，撤销始终使用源文档和实际提交事务的编辑器。
                const owner = this.owner.lite && getProtyleTransactionOwner(this.owner,
                    [{action: "update", id: this.list.dataset.nodeId, data: before}]) || this.owner;
                if (!owner.lite) {
                    const releaseOwnerViewport = preserveUndoViewport(owner.wysiwyg.element);
                    try {
                        await (redo ? requestRedo(owner, sourceRootID) : requestUndo(owner, sourceRootID));
                    } finally {
                        releaseOwnerViewport();
                    }
                    if (this.owner.lite && this.list.isConnected && !this.disposed) {
                        // 全屏中的片段不在外层编辑器内，按源块补齐撤销结果，并保留等待期间的新修改。
                        const snapshot = cleanListMindmapHTML(this.list.outerHTML);
                        const response = await fetchSyncPost("/api/block/getBlockDOM",
                            {id: this.list.dataset.nodeId, notebook: this.owner.notebookId});
                        if (response.code === 0 && canEdit(this.owner, this.list) && !this.disposed &&
                            cleanListMindmapHTML(this.list.outerHTML) === snapshot) {
                            this.replay(response.data.dom);
                        }
                    }
                }
            } else if (redo) {
                await this.owner.undo.redo(this.owner);
            } else {
                await this.owner.undo.undo(this.owner);
            }
            if (root?.focusRevision === focusRevision && guard()) {
                // 空栈或取消确认时恢复原编辑位置；结构回放仍只恢复节点选择。
                const unchanged = this.list.isConnected && cleanListMindmapHTML(this.list.outerHTML) === before;
                root?.restoreFocus(this.list.dataset.nodeId, candidateIDs, unchanged ? selection : undefined, this.list);
            }
        } finally {
            releaseViewport();
            if (root?.focusGuard === guard) {
                root.focusGuard = undefined;
                root.undoPending = false;
            }
        }
    }

    public focusNode(candidateIDs: string[], selection?: Record<string, string>, guard?: () => boolean) {
        if (guard && !guard()) {
            return;
        }
        const id = candidateIDs.find(id => this.model.nodes.has(id)) || this.model.root.id;
        this.view.focusNode(id, false);
        const node = this.model.nodes.get(id);
        const content = selection && node && !node.virtual && this.view.getContentHost(id);
        const ids = new Set(node?.contentBlocks?.flatMap(block => [block, ...Array.from(block.querySelectorAll("[data-node-id]"))])
            .map(block => block.getAttribute("data-node-id")));
        if (content && ids.has(selection.undoFocusId) && ids.has(selection.undoFocusEndId || selection.undoFocusId)) {
            void this.edit(id, content, undefined, undefined, selection, guard);
        }
    }

    public replay(html: string) {
        if (this.disposed || !this.list.isConnected || this.activeEditor || !canEdit(this.owner, this.list) ||
            this.list.dataset.type !== "NodeMindmap" && this.list.getAttribute(Constants.CUSTOM_SY_LIST_MINDMAP) !== "1") {
            return false;
        }
        const template = this.list.ownerDocument.createElement("template");
        template.innerHTML = cleanListMindmapHTML(normalizeHTMLAssetIFrameBlockDOM(html));
        const next = template.content.firstElementChild as HTMLElement;
        if (template.content.childElementCount !== 1 || next?.dataset.nodeId !== this.list.dataset.nodeId ||
            next.dataset.type !== this.list.dataset.type || next.dataset.type !== "NodeMindmap" &&
            next.getAttribute(Constants.CUSTOM_SY_LIST_MINDMAP) !== "1") {
            return false;
        }
        try {
            readListMindmap(next);
        } catch (_error) {
            return false;
        }
        Array.from(this.list.attributes).forEach(attribute => this.list.removeAttribute(attribute.name));
        Array.from(next.attributes).forEach(attribute => this.list.setAttribute(attribute.name, attribute.value));
        this.list.dataset.mindmapViewRendered = "true";
        this.replaceSourceChildren(next);
        // 即使序列化正文相同，源 Element 已替换，模型也必须重新绑定新节点。
        this.snapshot = "";
        this.refresh();
        return true;
    }

    public async finish() {
        this.view.finishLabels();
        await this.taskChanges;
        return this.activeEditor ? this.activeEditor.finish() : true;
    }

    public refresh() {
        this.view.setReadOnly(!canEdit(this.owner, this.list));
        syncListMindmapHeight(this.list, this.host);
        this.resize.refresh();
        const snapshot = cleanListMindmapHTML(this.list.outerHTML);
        if (snapshot === this.snapshot) {
            return;
        }
        this.model = readListMindmap(this.list);
        this.snapshot = snapshot;
        this.view.update(this.model);
    }

    public destroy() {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        const restoreFocus = this.host.contains(document.activeElement) && this.list.isConnected &&
            this.list.dataset.type !== "NodeMindmap" && this.list.getAttribute(Constants.CUSTOM_SY_LIST_MINDMAP) !== "1";
        this.activeEditor?.destroy();
        this.resize.destroy();
        this.unregisterVisible?.();
        this.view.destroy();
        flushListMindmapViewports();
        this.host.remove();
        this.list.removeAttribute("data-mindmap-view-rendered");
        if (restoreFocus) {
            focusBlock(this.list);
        }
    }
}

// 补齐折叠隐藏的正文后才允许改动列表，避免以局部视图覆盖完整块树。
const completeList = async (owner: IProtyle, list: HTMLElement) => {
    const rootID = owner.block.rootID;
    const notebookId = owner.notebookId;
    const id = list.dataset.nodeId;
    const type = list.dataset.type;
    const isCurrent = () => canEdit(owner, list) && owner.block.rootID === rootID &&
        owner.notebookId === notebookId && list.dataset.nodeId === id && list.dataset.type === type;
    await owner.wysiwyg.flushPendingInput();
    await waitForPendingTransactions(owner);
    if (!isCurrent()) {
        return "failed";
    }
    const before = cleanListMindmapHTML(list.outerHTML);
    const response = await fetchSyncPost("/api/block/getBlockDOM", {id, notebook: notebookId});
    if (response.code !== 0 || !isCurrent()) {
        return "failed";
    }
    if (cleanListMindmapHTML(list.outerHTML) !== before) {
        return "changed";
    }
    const template = document.createElement("template");
    template.innerHTML = normalizeHTMLAssetIFrameBlockDOM(response.data?.dom || "");
    const full = template.content.firstElementChild;
    if (full?.getAttribute("data-type") !== list.dataset.type || full.getAttribute("data-node-id") !== list.dataset.nodeId) {
        return "failed";
    }
    const completed = completeTabsListSource(list, full);
    list.replaceChildren(...Array.from(completed.childNodes));
    return "complete";
};

export const initListMindmaps = (owner: IProtyle) => {
    if (owner.lite && !isProtyleListItemFragment(owner) || roots.has(owner)) {
        return;
    }
    const root = owner.wysiwyg.element;
    const instances = new Map<HTMLElement, ListMindmapController>();
    const loading = new WeakSet<HTMLElement>();
    const placeholders = new Map<HTMLElement, HTMLElement>();
    const failed = new WeakSet<HTMLElement>();
    const newlyCreated = new WeakSet<HTMLElement>();
    const completeSources = new WeakSet<HTMLElement>();
    const needsCompleteSource = (list: HTMLElement) =>
        (!owner.lite || !!list.closest(".protyle-wysiwyg__embed")) && canEdit(owner, list) &&
        !newlyCreated.has(list) && !completeSources.has(list);
    let pendingFocus: {list: HTMLElement, candidateIDs: string[], selection?: Record<string, string>, guard?: () => boolean};
    let frame = 0;
    let disposed = false;
    const clearPlaceholder = (list: HTMLElement) => {
        placeholders.get(list)?.remove();
        placeholders.delete(list);
        if (!instances.has(list)) {
            list.removeAttribute("data-mindmap-view-rendered");
        }
    };
    const prepare = () => {
        const lists = new Set(getListMindmapElements(root));
        placeholders.forEach((host, list) => {
            if (!lists.has(list)) {
                clearPlaceholder(list);
            }
        });
        lists.forEach(list => {
            if (instances.has(list) || failed.has(list) || placeholders.has(list) || isFoldedRenderContent(list, true)) {
                return;
            }
            // 在浏览器绘制正文前占位，补齐源块期间沿用脑图的尺寸和公共加载动画。
            list.querySelectorAll(":scope > .mindmap-view").forEach(host => host.remove());
            const host = document.createElement("div");
            host.className = "mindmap-view";
            host.contentEditable = "false";
            host.setAttribute("aria-busy", "true");
            host.innerHTML = '<div class="fn__loading"><span class="b3-loading" aria-hidden="true"></span></div>';
            syncListMindmapHeight(list, host);
            placeholders.set(list, host);
            list.appendChild(host);
            list.dataset.mindmapViewRendered = "true";
        });
    };
    const refresh = () => {
        if (disposed) {
            return;
        }
        const lists = new Set(getListMindmapElements(root));
        instances.forEach((instance, list) => {
            if (!lists.has(list) || needsCompleteSource(list)) {
                instance.destroy();
                instances.delete(list);
            } else if (!isFoldedRenderContent(list, true)) {
                try {
                    instance.refresh();
                } catch (error) {
                    console.error(error);
                    failed.add(list);
                    instance.destroy();
                    instances.delete(list);
                }
            }
        });
        prepare();
        lists.forEach(list => {
            if (instances.has(list) || loading.has(list) || failed.has(list) || isFoldedRenderContent(list, true)) {
                return;
            }
            const mount = () => {
                if (disposed || !root.contains(list) || isFoldedRenderContent(list, true) ||
                    list.dataset.type !== "NodeMindmap" && list.getAttribute(Constants.CUSTOM_SY_LIST_MINDMAP) !== "1") {
                    return;
                }
                try {
                    const instance = new ListMindmapController(owner, list);
                    instances.set(list, instance);
                    placeholders.delete(list);
                    if (pendingFocus?.list === list) {
                        instance.focusNode(pendingFocus.candidateIDs, pendingFocus.selection, pendingFocus.guard);
                        pendingFocus = undefined;
                    }
                } catch (error) {
                    console.error(error);
                    failed.add(list);
                    clearPlaceholder(list);
                    list.querySelector(":scope > .mindmap-view")?.remove();
                    list.removeAttribute("data-mindmap-view-rendered");
                }
            };
            if (needsCompleteSource(list)) {
                loading.add(list);
                let retry = false;
                void completeList(owner, list).then(complete => {
                    if (complete === "complete") {
                        completeSources.add(list);
                        mount();
                    } else if (complete === "changed") {
                        retry = true;
                    } else {
                        failed.add(list);
                        clearPlaceholder(list);
                    }
                }).catch(error => {
                    console.error(error);
                    failed.add(list);
                    clearPlaceholder(list);
                }).finally(() => {
                    loading.delete(list);
                    if (retry) {
                        schedule();
                    }
                });
            } else {
                if (newlyCreated.has(list)) {
                    completeSources.add(list);
                }
                newlyCreated.delete(list);
                mount();
            }
        });
    };
    const schedule = () => {
        if (!disposed) {
            prepare();
        }
        if (!frame && !disposed) {
            frame = requestAnimationFrame(() => {
                frame = 0;
                refresh();
            });
        }
    };
    const restoreFocus = (listID: string, candidateIDs: string[], selection?: Record<string, string>, source?: HTMLElement) => {
        const state = roots.get(owner);
        const revision = state?.interactionRevision;
        const requestGuard = state?.focusGuard;
        const guard = () => !disposed && roots.get(owner) === state && state?.interactionRevision === revision &&
            !hasMindmapFocusOverlay() && (!requestGuard || requestGuard());
        if (guard && !guard()) {
            state.focusRevision++;
            return;
        }
        const lists = getListMindmapElements(root);
        const list = source && lists.includes(source) ? source : lists.find(item => item.dataset.nodeId === listID &&
            !item.closest(".protyle-wysiwyg__embed"));
        if (!list) {
            return;
        }
        roots.get(owner).focusRevision++;
        pendingFocus = {list, candidateIDs, selection, guard};
        refresh();
        const instance = instances.get(list);
        if (instance) {
            instance.focusNode(candidateIDs, selection, guard);
            pendingFocus = undefined;
        }
    };
    const unregister = registerListMindmapRoot(root, schedule, restoreFocus,
        (source, html) => instances.get(source as HTMLElement)?.replay(html) ?? false);
    const interactions = new AbortController();
    const invalidateFocus = (event: Event) => {
        if (event.target instanceof Element) {
            if (event.target.closest(".b3-dialog")?.querySelector('[data-undo-confirmation="true"]') ||
                event.target.closest("#keyboardToolbar") && event.target.closest('[data-type="undo"], [data-type="redo"]')) {
                return;
            }
        }
        if (event instanceof KeyboardEvent &&
            (matchHotKey(window.siyuan.config.keymap.editor.general.undo, event) ||
                matchHotKey(window.siyuan.config.keymap.editor.general.redo, event))) {
            return;
        }
        const state = roots.get(owner);
        if (state) {
            state.interactionRevision = (state.interactionRevision || 0) + 1;
        }
    };
    document.addEventListener("pointerdown", invalidateFocus, {capture: true, signal: interactions.signal});
    document.addEventListener("keydown", invalidateFocus, {capture: true, signal: interactions.signal});
    const observer = new MutationObserver(records => {
        if (records.some(record => {
            const element = record.target instanceof Element ? record.target : record.target.parentElement;
            return !root.contains(element?.closest(".mindmap-view")) && !(record.type === "attributes" &&
                ["data-mindmap-view-rendered", Constants.ATTRIBUTE_EDITING].includes(record.attributeName));
        })) {
            schedule();
        }
    });
    observer.observe(root, {childList: true, subtree: true, attributes: true, characterData: true});
    roots.set(owner, {refresh: schedule, finish: async () => {
        for (const instance of instances.values()) {
            if (!await instance.finish()) {
                return false;
            }
        }
        return true;
    }, mountNew: list => {
        if (root.contains(list)) {
            newlyCreated.add(list);
            refresh();
        }
    }, restoreFocus,
    focusRevision: 0, interactionRevision: 0, destroy: () => {
        disposed = true;
        interactions.abort();
        unregister();
        observer.disconnect();
        cancelAnimationFrame(frame);
        instances.forEach(instance => instance.destroy());
        instances.clear();
        placeholders.forEach((host, list) => clearPlaceholder(list));
    }});
    schedule();
};

export const destroyListMindmaps = (owner: IProtyle) => {
    roots.get(owner)?.destroy();
    roots.delete(owner);
};
