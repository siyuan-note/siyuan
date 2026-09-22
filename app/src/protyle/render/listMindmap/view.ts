import {
    layoutListMindmap,
    ListMindmapLayoutNode,
    ListMindmapModel,
    ListMindmapNodeStyle,
    ListMindmapPosition,
    ListMindmapRelation,
} from "./model";
import {routeMindmapRelation, routeManualMindmapRelation, adjustMindmapRoute,
    MindmapRoutePoint, MindmapManualRoute} from "./routing";
import {mathRender} from "../mathRender";
import {getAVRichTextSafeURL} from "../av/richTextValue";
import {Constants} from "../../../constants";
import {findMindmapDrop} from "./drop";
import {destroyTabsRender, tabsRender} from "../tabsRender";

export interface ListMindmapViewOptions {
    host: HTMLElement;
    model: ListMindmapModel;
    readOnly?: boolean;
    printLayout?: boolean;
    labels?: Record<string, string>;
    cdn?: string;
    onOpenLink?: (href: string, event: MouseEvent) => void;
    colors?: () => {label: string, value: string}[];
    nodeColors?: () => {
        label: string, color: string, backgroundColor: string,
        preview?: {color: string, backgroundColor: string},
    }[];
    onManageNodeColors?: () => void;
    onManageLineColors?: () => void;
    onFullscreen?: (enter: boolean, button: HTMLButtonElement) => void;
    onInteractionStart?: (event: PointerEvent) => () => void;
    onEdit?: (id: string, contentHost: HTMLElement) => void;
    onRootTitleChange?: (title: string) => void;
    finishEdit?: () => boolean | void | Promise<boolean | void>;
    onMove?: (id: string, targetId: string, placement: "before" | "child" | "after") => void;
    onAdd?: (id: string, kind: "child" | "sibling") => void;
    onDelete?: (id: string) => void;
    onFold?: (id: string) => void;
    onTaskToggle?: (id: string, cycle?: boolean) => void;
    onTaskMenu?: (id: string, anchor: HTMLElement) => void;
    onTabTaskToggle?: (id: string, itemId: string) => void;
    onTabTaskMenu?: (id: string, itemId: string, anchor: HTMLElement) => void;
    isTaskCycle?: (event: KeyboardEvent) => boolean;
    onUndo?: () => void;
    onRedo?: () => void;
    onNodeStyle?: (id: string, patch: Partial<ListMindmapNodeStyle>) => void;
    onRelationAdd?: (from: string, to: string) => void;
    onRelationChange?: (id: string, patch: Partial<ListMindmapRelation>, expected?: string) => void;
    onRelationDelete?: (id: string) => void;
    onExit: () => void;
}

interface PointerState {
    pointerId: number;
    rightButton?: boolean;
    id?: string;
    startX: number;
    startY: number;
    x: number;
    y: number;
    moved: boolean;
    targetId?: string;
    placement?: "before" | "child" | "after";
    relation?: {
        id: string;
        segment: number;
        points: MindmapRoutePoint[];
        original: string;
        offset: number;
        valid: boolean;
        handle: MindmapRoutePoint;
        endpoint?: "from" | "to";
        targetId?: string;
        route?: MindmapManualRoute;
    };
}

const createElement = <T extends keyof HTMLElementTagNameMap>(tag: T, className: string) => {
    const element = document.createElement(tag);
    element.className = className;
    return element;
};

export class ListMindmapView {
    private suppressPanContextMenu = false;
    private readonly options: ListMindmapViewOptions;
    private model: ListMindmapModel;
    private readonly viewport: HTMLDivElement;
    private readonly world: HTMLDivElement;
    private readonly canvas: HTMLCanvasElement;
    private readonly toolbar: HTMLDivElement;
    private readonly inspector: HTMLDivElement;
    private readonly zoomLabel: HTMLSpanElement;
    private readonly zoomSlider = createElement("input", "b3-slider");
    private readonly nodeElements = new Map<string, HTMLDivElement>();
    private readonly previewID = `list-mindmap-${Lute.NewNodeID()}-`;
    private readonly relationElements = new Map<string, HTMLButtonElement>();
    private readonly buttons = new Map<string, HTMLButtonElement>();
    private readonly folded = new Map<string, boolean>();
    private readonly tooltip = createElement("div", "tooltip list-mindmap__tooltip");
    private tooltipButton?: HTMLButtonElement;
    private readonly colorProbe = createElement("span", "list-mindmap__color-probe");
    private positions = new Map<string, ListMindmapPosition>();
    private edges: {from: string, to: string}[] = [];
    private bounds = {width: 1, height: 1};
    private selectedId?: string;
    private selectedRelation?: string;
    private selectedEdge?: string;
    private hoveredLine?: string;
    private finishRelationEdit?: (save: boolean) => void;
    private linePaths: {id: string, relation: boolean, path: Path2D, end?: MindmapRoutePoint}[] = [];
    private relationRoutes = new Map<string, MindmapRoutePoint[]>();
    private readonly routeHandles = new Map<string, HTMLButtonElement>();
    private readonly routeStatus = createElement("div", "list-mindmap__route-status");
    private readonly fallbackRoutes = new Set<string>();
    private routeDragFrame = 0;
    private relationFrom?: string;
    private relationPreview?: {x: number, y: number, targetId?: string};
    private editingId?: string;
    private pointer?: PointerState;
    private pointerCapture?: HTMLElement;
    private pendingPointerId?: number;
    private endInteraction?: () => void;
    private linkTimer = 0;
    private suppressLinkClick = false;
    private ghost?: HTMLDivElement;
    private scale = 1;
    private panning = false;
    private offsetX = 0;
    private offsetY = 0;
    private foldAnchor?: {id: string, collapsed: boolean};
    private frame = 0;
    private initialFit = true;
    private destroyed = false;
    private readonly resizeObserver: ResizeObserver;
    private fullscreenMarker?: Comment;
    private readonly disposers: (() => void)[] = [];
    private printTransform?: {scale: number, offsetX: number, offsetY: number};

    constructor(options: ListMindmapViewOptions) {
        this.options = options;
        this.model = options.model;
        this.selectedId = options.model.root.id;
        options.host.classList.add("list-mindmap");
        options.host.contentEditable = "false";
        options.host.setAttribute("role", "group");
        options.host.setAttribute("aria-label", this.label("mindmap"));
        options.host.tabIndex = 0;
        this.toolbar = createElement("div", "list-mindmap__toolbar block__icons");
        this.toolbar.setAttribute("role", "toolbar");
        this.viewport = createElement("div", "list-mindmap__viewport");
        this.viewport.setAttribute("data-prevent-swipe", "true");
        this.canvas = createElement("canvas", "list-mindmap__canvas");
        this.canvas.setAttribute("aria-hidden", "true");
        this.world = createElement("div", "list-mindmap__world");
        this.inspector = createElement("div", "list-mindmap__inspector");
        this.inspector.hidden = true;
        this.zoomLabel = createElement("span", "list-mindmap__zoom");
        this.viewport.append(this.canvas, this.world);
        this.tooltip.hidden = true;
        this.tooltip.setAttribute("role", "tooltip");
        this.colorProbe.setAttribute("aria-hidden", "true");
        this.routeStatus.hidden = true;
        this.routeStatus.setAttribute("role", "status");
        options.host.append(this.toolbar, this.viewport, this.inspector, this.tooltip, this.colorProbe, this.routeStatus);
        this.createToolbar();
        this.listen(document, "pointerdown", this.dismissControls, {capture: true});
        this.listen(options.host, "pointerover", this.showButtonTooltip);
        this.listen(options.host, "focusin", this.showButtonTooltip);
        ["pointerout", "focusout"].forEach(type => this.listen(options.host, type, this.hideButtonTooltip));
        this.listen(options.host, "wheel", () => this.tooltip.hidden = true);
        const themeObserver = new MutationObserver(() => this.refreshLayout());
        themeObserver.observe(document.documentElement, {attributes: true, attributeFilter: ["data-theme-mode", "style"]});
        themeObserver.observe(document.head, {childList: true, subtree: true, characterData: true, attributes: true});
        this.disposers.push(() => themeObserver.disconnect());
        this.listen(document.head, "load", () => this.refreshLayout(), {capture: true});
        this.listen(this.viewport, "pointerdown", this.pointerDown);
        this.listen(this.viewport, "pointermove", this.pointerMove);
        this.listen(this.viewport, "pointerleave", () => this.setHoveredLine());
        this.listen(this.viewport, "pointerup", this.pointerUp);
        this.listen(this.viewport, "contextmenu", (event: MouseEvent) => {
            if (this.suppressPanContextMenu) {
                event.preventDefault();
            }
        });
        this.listen(this.viewport, "pointercancel", this.cancelPointer);
        this.listen(this.viewport, "lostpointercapture", this.cancelPointer);
        this.listen(window, "pointerup", (event: PointerEvent) => {
            if (this.pendingPointerId === event.pointerId && !this.pointer) {
                this.cancelPointer();
            }
        }, {capture: true});
        this.listen(window, "pointercancel", (event: PointerEvent) => {
            if (this.pendingPointerId === event.pointerId) {
                this.cancelPointer();
            }
        }, {capture: true});
        this.listen(window, "blur", this.cancelPointer);
        this.listen(this.viewport, "dblclick", this.doubleClick);
        this.listen(this.viewport, "click", this.contentClick);
        this.listen(this.viewport, "wheel", this.wheel, {passive: false});
        this.listen(this.viewport, "dragstart", (event: Event) => event.preventDefault());
        this.listen(options.host, "keydown", this.keyDown);
        // 脑图内部先处理交互，再阻止外层文档将节点操作识别为列表块编辑。
        ["pointerdown", "pointerup", "pointermove", "pointercancel", "mousedown", "mouseup", "mousemove", "click",
            "dblclick", "contextmenu", "dragstart", "dragover", "drop", "beforeinput", "input", "compositionstart",
            "compositionupdate", "compositionend", "copy", "cut", "paste", "focusin", "focusout", "keydown", "keyup",
            "wheel"].forEach(type => this.listen(options.host, type, event => {
                if (type === "click" && !event.defaultPrevented && !this.options.onOpenLink &&
                    (event.target as Element).closest(".list-mindmap__content a[href]")) {
                    return;
                }
                event.stopPropagation();
            }));
        this.listen(window, "beforeprint", () => {
            if (this.pointer?.relation) {
                this.cancelPointer();
            }
            this.printTransform ||= {scale: this.scale, offsetX: this.offsetX, offsetY: this.offsetY};
            this.fitPrint();
        });
        this.listen(window, "afterprint", () => {
            if (this.printTransform) {
                Object.assign(this, this.printTransform);
                this.printTransform = undefined;
                if (this.options.printLayout) {
                    this.fitPrint();
                } else {
                    this.options.host.style.removeProperty("--list-mindmap-print-height");
                    this.draw();
                }
            }
        });
        this.resizeObserver = new ResizeObserver(() => this.refreshLayout());
        this.resizeObserver.observe(this.viewport);
        this.update(this.model);
    }

    private label(key: string) {
        return this.options.labels?.[key] || window.siyuan?.languages?.[key] || key;
    }

    private listen(target: EventTarget, event: string, handler: EventListener, options?: AddEventListenerOptions) {
        target.addEventListener(event, handler, options);
        this.disposers.push(() => target.removeEventListener(event, handler, options));
    }

    private makeButton(key: string, icon: string, action: () => void, className = "") {
        const button = createElement("button", "block__icon block__icon--show " + className);
        button.type = "button";
        button.setAttribute("aria-label", this.label(key));
        // 图标引用现有图标集，避免复制或生成路径数据。
        if (icon) {
            button.innerHTML = `<svg aria-hidden="true"><use xlink:href="#${icon}"></use></svg>`;
        }
        button.addEventListener("click", (event) => {
            event.stopPropagation();
            this.finishThen(action);
        });
        return button;
    }

    private showButtonTooltip = (event: Event) => {
        const button = (event.target as Element).closest<HTMLButtonElement>("button[aria-label]");
        if (!button || !this.options.host.contains(button) || button.classList.contains("list-mindmap__relation")) {
            this.tooltip.hidden = true;
            return;
        }
        if (this.tooltipButton === button && !this.tooltip.hidden) {
            return;
        }
        this.tooltipButton = button;
        this.tooltip.textContent = button.getAttribute("aria-label");
        this.tooltip.hidden = false;
        const host = this.options.host.getBoundingClientRect();
        const rect = button.getBoundingClientRect();
        const left = rect.left - host.left + (rect.width - this.tooltip.offsetWidth) / 2;
        const below = rect.bottom - host.top + 6;
        this.tooltip.style.left = `${Math.max(4, Math.min(left, host.width - this.tooltip.offsetWidth - 4))}px`;
        this.tooltip.style.top = `${Math.max(4, below + this.tooltip.offsetHeight < host.height ?
            below : rect.top - host.top - this.tooltip.offsetHeight - 6)}px`;
    };

    private hideButtonTooltip = (event: MouseEvent | FocusEvent) => {
        if (event.relatedTarget instanceof Node && this.tooltipButton?.contains(event.relatedTarget)) {
            return;
        }
        this.tooltip.hidden = true;
        this.tooltipButton = undefined;
    };

    private clearSelection() {
        this.inspector.hidden = true;
        if (!this.selectedId && !this.selectedRelation && !this.selectedEdge && !this.relationFrom) {
            return;
        }
        this.selectedId = undefined;
        this.selectedRelation = undefined;
        this.selectedEdge = undefined;
        this.relationFrom = undefined;
        this.updateSelection();
    }

    private dismissControls = (event: PointerEvent) => {
        const target = event.target as Node;
        this.tooltip.hidden = true;
        if (target instanceof Element && target.closest(".list-mindmap__relation-editor, .list-mindmap__route-handle")) {
            return;
        }
        if (this.inspector.contains(target) || this.buttons.get("style")?.contains(target) ||
            this.buttons.get("relation")?.contains(target)) {
            return;
        }
        this.inspector.hidden = true;
        const node = target instanceof Element && target.closest(".list-mindmap__node, .list-mindmap__relation");
        if (!node || !this.options.host.contains(node)) {
            this.clearSelection();
        }
    };

    private finishThen(action: () => void) {
        const finished = this.options.finishEdit?.();
        if (finished instanceof Promise) {
            void finished.then(result => {
                if (result !== false && !this.destroyed) {
                    action();
                }
            }).catch(error => console.error(error));
        } else if (finished !== false && !this.destroyed) {
            action();
        }
    }

    public setReadOnly(value: boolean) {
        if (!!this.options.readOnly === value) {
            return;
        }
        this.options.readOnly = value;
        this.cancelPointer();
        this.relationFrom = undefined;
        this.inspector.hidden = true;
        this.toolbar.replaceChildren();
        this.buttons.clear();
        this.createToolbar();
        if (this.fullscreenMarker) {
            this.fullscreenChange();
        }
        this.nodeElements.forEach(element => {
            const addChild = element.querySelector<HTMLButtonElement>(".list-mindmap__add-child");
            addChild.hidden = value;
            addChild.disabled = value;
            element.querySelector<HTMLElement>(".list-mindmap__add-bridge").hidden = value;
            const task = element.querySelector<HTMLButtonElement>(".list-mindmap__task");
            if (task) {
                task.disabled = value;
            }
        });
        this.update(this.model);
    }

    private createToolbar() {
        const add = (id: string, key: string, icon: string, action: () => void) => {
            const button = this.makeButton(key, icon, action);
            this.buttons.set(id, button);
            this.toolbar.append(button);
        };
        this.toolbar.append(createElement("span", "list-mindmap__spacer fn__flex-1"));
        if (!this.options.readOnly) {
            add("relation", "connect", "iconRoute", () => {
                this.setPanning(false);
                this.inspector.hidden = true;
                this.relationFrom = this.relationFrom ? undefined : this.selectedId;
                this.relationPreview = undefined;
                this.updateSelection();
            });
        }
        add("pan", "cursorHand", "iconHand", () => {
            this.finishThen(() => {
                this.finishRelationEdit?.(true);
                this.cancelPointer();
                this.setPanning(!this.panning);
                this.relationFrom = undefined;
                this.relationPreview = undefined;
                this.inspector.hidden = true;
                this.updateSelection();
            });
        });
        this.setPanning(this.panning);
        const zoomControl = createElement("div", "list-mindmap__zoom-control");
        const zoomActions = createElement("div", "list-mindmap__zoom-actions");
        this.zoomLabel.tabIndex = 0;
        this.zoomLabel.setAttribute("aria-label", this.label("zoom"));
        this.zoomSlider.type = "range";
        this.zoomSlider.min = "15";
        this.zoomSlider.max = "250";
        this.zoomSlider.step = "1";
        this.zoomSlider.setAttribute("aria-label", this.label("zoom"));
        this.zoomSlider.oninput = () => this.zoomAt(Number(this.zoomSlider.value) / 100);
        const reset = this.makeButton("reset", "iconRefresh", () => this.zoomAt(1));
        zoomActions.append(this.zoomSlider, reset);
        zoomControl.append(this.zoomLabel, zoomActions);
        this.toolbar.append(zoomControl);
        add("fit", "listMindmapFit", "iconFocus", () => this.fit());
        add("fullscreen", "fullscreen", "iconFullscreen", () => this.toggleFullscreen());
    }

    private setPanning(value: boolean) {
        this.panning = value;
        this.viewport.classList.toggle("list-mindmap__viewport--pan", value);
        const button = this.buttons.get("pan");
        button?.classList.toggle("block__icon--active", value);
        button?.setAttribute("aria-pressed", String(value));
    }

    public update(model: ListMindmapModel) {
        if (this.pointer?.relation) {
            this.cancelPointer();
        }
        if (this.destroyed) {
            return;
        }
        this.model = model;
        const descendants = new Map<string, number>();
        const ordered = [model.root];
        for (let i = 0; i < ordered.length; i++) {
            ordered.push(...ordered[i].children);
        }
        for (let i = ordered.length - 1; i >= 0; i--) {
            descendants.set(ordered[i].id, ordered[i].children.reduce((count, child) => count + 1 + descendants.get(child.id), 0));
        }
        this.nodeElements.forEach((element, id) => {
            if (!model.nodes.has(id)) {
                destroyTabsRender(this.getContentHost(id));
                this.resizeObserver.unobserve(element);
                element.remove();
                this.nodeElements.delete(id);
            }
        });
        model.nodes.forEach((node, id) => {
            let element = this.nodeElements.get(id);
            if (!element) {
                element = createElement("div", "list-mindmap__node");
                element.dataset.mindmapId = id;
                element.setAttribute("role", "treeitem");
                element.append(createElement("div", "list-mindmap__content"));
                const addBridge = createElement("span", "list-mindmap__add-bridge");
                addBridge.hidden = !!this.options.readOnly;
                addBridge.setAttribute("aria-hidden", "true");
                element.append(addBridge);
                const fold = this.makeButton("collapse", "iconLeft", () => this.toggleFold(id), "list-mindmap__fold");
                fold.append(createElement("span", "list-mindmap__fold-count"));
                element.append(fold);
                const addChild = this.makeButton("listMindmapChild", "iconAdd", () => {
                    if (!this.options.readOnly && this.model.nodes.has(id)) {
                        this.options.onAdd?.(id, "child");
                    }
                }, "list-mindmap__add-child");
                addChild.hidden = !!this.options.readOnly;
                addChild.disabled = !!this.options.readOnly;
                element.append(addChild);
                this.nodeElements.set(id, element);
                this.world.append(element);
                this.resizeObserver.observe(element);
            }
            element.classList.toggle("list-mindmap__node--virtual", node.virtual);
            element.classList.toggle("list-mindmap__node--untitled", node.virtual && !model.metadata.rootTitle);
            if (node.virtual) {
                element.setAttribute("aria-label", model.metadata.rootTitle || this.label("listMindmapRoot"));
            }
            element.classList.toggle("list-mindmap__node--root", id === model.root.id);
            this.renderTask(element, id);
            element.classList.toggle("list-mindmap__node--branch", node.children.length > 0);
            element.style.backgroundColor = model.metadata.nodes[id]?.backgroundColor || "";
            element.style.color = model.metadata.nodes[id]?.textColor || "";
            const collapsed = this.folded.get(id) ?? node.collapsed;
            element.setAttribute("aria-expanded", String(!collapsed));
            const fold = element.querySelector<HTMLButtonElement>(".list-mindmap__fold");
            fold.hidden = !node.children.length;
            fold.classList.toggle("list-mindmap__fold--closed", collapsed);
            fold.setAttribute("aria-label", this.label(collapsed ? "expand" : "collapse"));
            fold.querySelector("span").textContent = String(descendants.get(id));
            if (id !== this.editingId) {
                const content = this.getContentHost(id);
                const activeTabs = new Map<string, string>();
                content.querySelectorAll<HTMLElement>('.tab-item[data-tabs-hidden="false"]').forEach(item => {
                    activeTabs.set(item.parentElement.id, item.id);
                });
                destroyTabsRender(content);
                content.replaceChildren();
                const sourceTabIDs = new Map<string, string>();
                if (node.virtual) {
                    content.textContent = this.model.metadata.rootTitle || "";
                } else {
                    node.contentBlocks.forEach((block) => {
                        const clone = block.cloneNode(true) as HTMLElement;
                        const sourceCanvases = block.querySelectorAll("canvas");
                        clone.querySelectorAll("canvas").forEach((canvas, index) => {
                            const source = sourceCanvases[index];
                            if (source.width && source.height) {
                                canvas.getContext("2d")?.drawImage(source, 0, 0);
                            }
                        });
                        const previewTabIDs = new Map<string, string>();
                        clone.querySelectorAll(".protyle-attr, .protyle-action, .protyle-action__table, .protyle-icons, .list-mindmap")
                            .forEach(item => item.remove());
                        [clone, ...Array.from(clone.querySelectorAll<HTMLElement>("*"))].forEach((item) => {
                            // 页签预览使用独立 DOM 标识切换正文，不携带可提交事务的块身份。
                            if (["NodeTabs", "NodeTabItem"].includes(item.getAttribute("data-type"))) {
                                item.id = this.previewID + item.getAttribute("data-node-id");
                                previewTabIDs.set(item.getAttribute("data-node-id"), item.id);
                                sourceTabIDs.set(item.id, item.getAttribute("data-node-id"));
                            }
                            if (item.hasAttribute("data-node-id")) {
                                item.classList.add("list-mindmap__preview-block");
                            }
                            if (item.hasAttribute("spellcheck")) {
                                item.classList.add("list-mindmap__text");
                                item.classList.toggle("list-mindmap__text--trailing-newline", item.textContent.endsWith("\n"));
                            }
                            item.removeAttribute("contenteditable");
                            item.removeAttribute("data-node-id");
                            item.removeAttribute("spellcheck");
                            item.removeAttribute("draggable");
                            // 画布保留显示快照，实例标识不能使预览刷新或销毁源图表。
                            item.removeAttribute("_echarts_instance_");
                        });
                        [clone, ...Array.from(clone.querySelectorAll<HTMLElement>('[data-type="NodeTabs"]'))]
                            .forEach(tabs => {
                                const active = activeTabs.get(tabs.id) || previewTabIDs.get(tabs.getAttribute("tabs-active-id"));
                                if (active) {
                                    tabs.setAttribute("tabs-active-id", active);
                                }
                            });
                        content.append(clone);
                    });
                }
                const hasBlankLines = node.contentBlocks.length > 1 || content.textContent.includes("\n") ||
                    content.querySelectorAll("br").length > 1;
                const empty = !node.virtual && !hasBlankLines && !content.textContent.replace(/[\u200b\ufeff]/g, "").trim() &&
                    !content.querySelector("img, svg, video, audio, iframe, canvas, hr, [data-content]");
                content.classList.toggle("list-mindmap__content--empty", empty);
                content.dataset.placeholder = this.label("listMindmapPlaceholder");
                if (content.querySelector('.tabs[data-type="NodeTabs"]')) {
                    tabsRender(content, {
                        readonly: () => true,
                        taskReadonly: () => !!this.options.readOnly || !this.options.onTabTaskToggle,
                        taskLabel: this.label("taskList"),
                        task: item => {
                            const itemId = sourceTabIDs.get(item.id);
                            if (!this.options.readOnly && itemId) {
                                this.options.onTabTaskToggle?.(id, itemId);
                            }
                        },
                        taskMenu: item => {
                            const itemId = sourceTabIDs.get(item.id);
                            const anchor = content.querySelector<HTMLElement>(`.tabs-task[data-tab-id="${item.id}"]`);
                            if (!this.options.readOnly && itemId && anchor) {
                                this.options.onTabTaskMenu?.(id, itemId, anchor);
                            }
                        },
                        shown: () => this.refreshLayout(),
                    });
                }
                // 副本独立渲染公式，避免源节点的异步渲染完成后脑图仍保留未渲染内容。
                void mathRender(content, this.options.cdn)?.then(() => this.refreshLayout()).catch(error => console.error(error));
            }
        });
        if (this.selectedId && !model.nodes.has(this.selectedId)) {
            this.selectedId = undefined;
            this.inspector.hidden = true;
        }
        if (this.selectedRelation && !model.metadata.relations.some(relation => relation.id === this.selectedRelation)) {
            this.selectedRelation = undefined;
            this.inspector.hidden = true;
        }
        if (this.selectedEdge && !model.nodes.has(this.selectedEdge)) {
            this.selectedEdge = undefined;
            this.inspector.hidden = true;
        }
        this.updateRelations();
        this.updateSelection();
        this.renderInspector();
        this.refreshLayout();
    }

    public getContentHost(id: string): HTMLElement | undefined {
        return this.nodeElements.get(id)?.querySelector<HTMLElement>(".list-mindmap__content");
    }

    public setEditing(id?: string) {
        if (this.editingId) {
            this.nodeElements.get(this.editingId)?.classList.remove("list-mindmap__node--editing");
        }
        this.editingId = id;
        if (id) {
            destroyTabsRender(this.getContentHost(id));
            this.selectNode(id);
            this.nodeElements.get(id)?.classList.add("list-mindmap__node--editing");
        }
        this.refreshLayout();
    }

    public refreshLayout() {
        if (this.destroyed || this.frame || this.pointer?.relation) {
            return;
        }
        this.frame = requestAnimationFrame(() => {
            this.frame = 0;
            if (this.pointer?.relation) {
                return;
            }
            if (!this.viewport.clientWidth || !this.viewport.clientHeight) {
                return;
            }
            // 同一帧内先恢复测量，布局完成后再隐藏折叠后代，避免展开时读取到零尺寸。
            this.nodeElements.forEach(element => element.hidden = false);
            const makeLayoutNode = (id: string): ListMindmapLayoutNode => {
                const node = this.model.nodes.get(id);
                const element = this.nodeElements.get(id);
                return {
                    id,
                    width: Math.max(1, element.offsetWidth),
                    height: Math.max(1, element.offsetHeight),
                    collapsed: this.folded.get(id) ?? node.collapsed,
                    children: node.children.map(child => makeLayoutNode(child.id)),
                };
            };
            const anchorId = this.editingId || this.foldAnchor?.id ||
                this.model.metadata.relations.find(relation => relation.id === this.selectedRelation)?.from;
            const previous = anchorId ? this.positions.get(anchorId) : undefined;
            const layoutRoot = makeLayoutNode(this.model.root.id);
            let result = layoutListMindmap(layoutRoot);
            const horizontalGaps = new Map<string, number>();
            const verticalGaps = new Map<string, number>();
            const reserve = (gaps: Map<string, number>, id: string, size: number) => {
                gaps.set(id, Math.max(gaps.get(id) || 0, size));
            };
            const ancestors = (id: string) => {
                const path: string[] = [];
                while (id) {
                    path.unshift(id);
                    id = result.nodes.get(id)?.parentId;
                }
                return path;
            };
            // 只撑开关系线两端之间的分支边界，其他节点保留默认间距。
            this.model.metadata.relations.forEach(relation => {
                if (!relation.label?.trim() || !result.nodes.has(relation.from) || !result.nodes.has(relation.to)) {
                    return;
                }
                const label = this.relationElements.get(relation.id);
                if (label) {
                    label.hidden = false;
                    const from = result.nodes.get(relation.from);
                    const to = result.nodes.get(relation.to);
                    const fromPath = ancestors(from.id);
                    const toPath = ancestors(to.id);
                    let common = 0;
                    while (common < Math.min(fromPath.length, toPath.length) && fromPath[common] === toPath[common]) {
                        common++;
                    }
                    if (common < fromPath.length && common < toPath.length) {
                        const lower = from.y < to.y ? toPath[common] : fromPath[common];
                        reserve(verticalGaps, lower, label.offsetHeight + 32);
                    }
                    if (from.x + from.width <= to.x || to.x + to.width <= from.x) {
                        const right = from.x < to.x ? to : from;
                        reserve(horizontalGaps, right.id, label.offsetWidth + 32);
                    }
                }
            });
            if (horizontalGaps.size || verticalGaps.size) {
                result = layoutListMindmap(layoutRoot, {horizontalGaps, verticalGaps});
            }
            this.positions = result.nodes;
            this.relationRoutes.clear();
            this.fallbackRoutes.clear();
            this.edges = result.edges;
            this.bounds = result;
            let top = 0;
            let left = 0;
            // 每条连接独立避让节点和按钮，已有关系线不影响路径选择。
            this.model.metadata.relations.forEach((relation) => {
                const from = this.positions.get(relation.from);
                const to = this.positions.get(relation.to);
                if (from && to) {
                    const points = this.calculateRelationRoute(relation, from, to);
                    this.relationRoutes.set(relation.id, points);
                    points.forEach(point => {
                        top = Math.min(top, point.y - 24);
                        left = Math.min(left, point.x - 100);
                        this.bounds.width = Math.max(this.bounds.width, point.x + 100);
                        this.bounds.height = Math.max(this.bounds.height, point.y + 24);
                    });
                }
            });
            if (top < 0 || left < 0) {
                this.positions.forEach(position => {
                    position.y -= top;
                    position.x -= left;
                });
                this.relationRoutes.forEach(points => points.forEach(point => {
                    point.x -= left;
                    point.y -= top;
                }));
                this.bounds.height -= top;
                this.bounds.width -= left;
            }
            this.nodeElements.forEach((element, id) => {
                const position = this.positions.get(id);
                element.hidden = !position;
                if (position) {
                    element.style.left = `${position.x}px`;
                    element.style.top = `${position.y - 1}px`;
                }
            });
            // 编辑、折叠或调整路径时固定操作节点，避免整棵树随布局边界跳动。
            const current = anchorId ? this.positions.get(anchorId) : undefined;
            if (previous && current) {
                this.offsetX += (previous.x - current.x) * this.scale;
                this.offsetY += (previous.y - current.y) * this.scale;
            }
            if (this.foldAnchor && (this.folded.get(this.foldAnchor.id) ??
                this.model.nodes.get(this.foldAnchor.id)?.collapsed) === this.foldAnchor.collapsed) {
                this.foldAnchor = undefined;
            }
            if (this.printTransform || this.options.printLayout) {
                this.fitPrint();
            } else if (this.initialFit) {
                this.initialFit = false;
                this.fit(1);
            } else {
                this.draw();
            }
        });
    }

    private updateRelations() {
        this.relationElements.forEach((element, id) => {
            if (!this.model.metadata.relations.some(relation => relation.id === id)) {
                element.remove();
                this.relationElements.delete(id);
            }
        });
        this.model.metadata.relations.forEach((relation) => {
            let element = this.relationElements.get(relation.id);
            if (!element) {
                element = createElement("button", "list-mindmap__relation");
                element.type = "button";
                element.dataset.relationId = relation.id;
                element.addEventListener("click", (event) => {
                    event.stopPropagation();
                    this.finishThen(() => {
                        this.selectedRelation = relation.id;
                        this.selectedEdge = undefined;
                        this.relationFrom = undefined;
                        this.selectedId = undefined;
                        this.updateSelection();
                        if (!this.options.readOnly) {
                            this.inspector.hidden = false;
                            this.renderInspector();
                        }
                    });
                });
                this.relationElements.set(relation.id, element);
                this.world.append(element);
            }
            element.textContent = relation.label || "";
            element.setAttribute("aria-label", relation.label || this.label("connect"));
            element.style.color = relation.color || "";
        });
    }

    private routingObstacles() {
        return [...this.positions.values()].map(node => ({...node,
            controlY: node.y + (node.id === this.model.root.id ? node.height / 2 : node.height),
        }));
    }

    private relationPath(id: string | undefined, from: ListMindmapPosition, to: ListMindmapPosition, label?: HTMLElement) {
        let points = id ? this.relationRoutes.get(id) : undefined;
        if (!points) {
            points = this.calculateRelationRoute(this.model.metadata.relations.find(relation => relation.id === id), from, to);
            if (id) {
                this.relationRoutes.set(id, points);
            }
        }
        if (points.length < 2) {
            return;
        }
        const end = points[points.length - 1];
        const previous = points[points.length - 2];
        // 按整条路径限制箭头大小，短尾段不会把长关系线的箭头压小。
        const arrowSizeLimit = points.slice(1).reduce((length, point, i) =>
            length + Math.hypot(point.x - points[i].x, point.y - points[i].y), 0) / 3;
        // 重合路径从同一端绘制，避免反向虚线填满正向虚线的间隙。
        const drawingPoints = (points[0].x - end.x || points[0].y - end.y) > 0 ? [...points].reverse() : points;
        const path = new Path2D();
        path.moveTo(drawingPoints[0].x, drawingPoints[0].y);
        for (let i = 1; i < drawingPoints.length - 1; i++) {
            const a = drawingPoints[i - 1];
            const b = drawingPoints[i];
            const c = drawingPoints[i + 1];
            const before = Math.hypot(b.x - a.x, b.y - a.y);
            const after = Math.hypot(c.x - b.x, c.y - b.y);
            const radius = Math.min(8, before / 2, after / 2);
            path.lineTo(b.x + (a.x - b.x) * radius / before, b.y + (a.y - b.y) * radius / before);
            path.quadraticCurveTo(b.x, b.y, b.x + (c.x - b.x) * radius / after, b.y + (c.y - b.y) * radius / after);
        }
        const drawingEnd = drawingPoints[drawingPoints.length - 1];
        path.lineTo(drawingEnd.x, drawingEnd.y);
        if (!label) {
            return {path, end, previous, arrowSizeLimit, labelPoint: undefined as MindmapRoutePoint | undefined};
        }
        const width = label.offsetWidth;
        const height = label.offsetHeight;
        const segments = points.slice(1).map((p, i) => ({a: points[i], b: p,
            length: Math.hypot(p.x - points[i].x, p.y - points[i].y)})).sort((a, b) => b.length - a.length);
        const nodes = [...this.positions.values()];
        const available = (p: MindmapRoutePoint) => !nodes.some(node =>
            p.x + width / 2 > node.x - 4 && p.x - width / 2 < node.x + node.width + 4 &&
            p.y + height / 2 > node.y - 4 && p.y - height / 2 < node.y + node.height + 4);
        let labelPoint: MindmapRoutePoint;
        for (const segment of segments) {
            const candidates = [0.5, 0.25, 0.75].map(ratio => ({
                x: segment.a.x + (segment.b.x - segment.a.x) * ratio,
                y: segment.a.y + (segment.b.y - segment.a.y) * ratio,
            }));
            labelPoint = candidates.find(available);
            if (labelPoint) {
                break;
            }
        }
        // 调整关系线时隐藏文字，保留测量尺寸，避免遮挡手柄或改变节点布局。
        label.style.visibility = !labelPoint || (id === this.selectedRelation && !this.options.readOnly &&
            !this.printTransform && !this.options.printLayout) ? "hidden" : "";
        return {path, end, previous, arrowSizeLimit, labelPoint};
    }

    private calculateRelationRoute(relation: ListMindmapRelation | undefined, from: ListMindmapPosition, to: ListMindmapPosition) {
        if (relation) {
            this.fallbackRoutes.delete(relation.id);
            if (relation.route) {
                const points = routeManualMindmapRelation(from, to, this.routingObstacles(), relation.route);
                if (points.length >= 2) {
                    return points;
                }
                this.fallbackRoutes.add(relation.id);
            }
        }
        return routeMindmapRelation(from, to, this.routingObstacles());
    }

    private renderRouteControls() {
        const id = this.selectedRelation;
        const drag = this.pointer?.relation;
        const editable = !this.options.readOnly && !this.printTransform && !this.options.printLayout && !this.finishRelationEdit;
        const points = editable && !drag?.endpoint ? drag?.points || this.relationRoutes.get(id) || [] : [];
        const visible = new Set<string>();
        for (let i = 0; i < points.length - 1; i++) {
            const a = points[i];
            const b = points[i + 1];
            if (Math.hypot(b.x - a.x, b.y - a.y) < 12 || (drag && drag.segment !== i)) {
                continue;
            }
            const horizontal = a.y === b.y;
            let x = this.offsetX + (a.x + b.x) / 2 * this.scale;
            let y = this.offsetY + (a.y + b.y) / 2 * this.scale;
            if (drag) {
                x = this.offsetX + (drag.handle.x + (horizontal ? 0 : drag.offset)) * this.scale;
                y = this.offsetY + (drag.handle.y + (horizontal ? drag.offset : 0)) * this.scale;
            }
            const key = `${id}:${i}`;
            visible.add(key);
            const handle = this.getRouteHandle(id, i);
            handle.style.left = `${x}px`;
            handle.style.top = `${y}px`;
            handle.style.cursor = horizontal ? "ns-resize" : "ew-resize";
        }
        const route = editable ? this.relationRoutes.get(id) : undefined;
        if (route?.length >= 2) {
            (["from", "to"] as const).forEach(endpoint => {
                visible.add(`${id}:${endpoint}`);
                const handle = this.getRouteHandle(id, endpoint);
                const point = drag?.endpoint === endpoint && this.pointer.moved ? drag.handle :
                    route[endpoint === "from" ? 0 : route.length - 1];
                handle.style.left = `${this.offsetX + point.x * this.scale}px`;
                handle.style.top = `${this.offsetY + point.y * this.scale}px`;
            });
        }
        this.routeHandles.forEach((handle, key) => {
            if (!visible.has(key)) {
                handle.remove();
                this.routeHandles.delete(key);
            }
        });
        const invalid = this.pointer?.relation && !this.pointer.relation.valid;
        this.viewport.classList.toggle("list-mindmap__viewport--route-invalid", !!invalid);
        this.routeStatus.hidden = this.options.readOnly || !!this.options.printLayout || !!this.printTransform ||
            (!invalid && !this.fallbackRoutes.has(id));
        this.routeStatus.textContent = this.label(invalid ? "invalid" : "listMindmapRouteFallback");
    }

    private getRouteHandle(id: string, part: number | "from" | "to") {
        const key = `${id}:${part}`;
        let handle = this.routeHandles.get(key);
        if (handle) {
            return handle;
        }
        handle = createElement("button", "list-mindmap__route-handle");
        handle.type = "button";
        const endpoint = typeof part === "string" ? part : undefined;
        if (endpoint) {
            handle.classList.add("list-mindmap__route-endpoint");
            handle.dataset.endpoint = endpoint;
        }
        handle.setAttribute("aria-label", this.label(endpoint ?
            endpoint === "from" ? "listMindmapRouteStart" : "listMindmapRouteEnd" : "listMindmapRouteHandle"));
        handle.addEventListener("pointerdown", event => {
            event.stopPropagation();
            if (event.button === 0 && !this.options.readOnly && !this.pointer) {
                event.preventDefault();
                this.preparePointer(event);
                this.finishThen(() => {
                    if (this.pendingPointerId === event.pointerId) {
                        this.beginRouteDrag(event, id, typeof part === "number" ? part : 0, endpoint);
                    }
                });
            }
        });
        handle.addEventListener("dblclick", event => {
            event.stopPropagation();
            this.resetRelationRoute(id);
        });
        this.routeHandles.set(key, handle);
        this.viewport.append(handle);
        return handle;
    }

    private beginRouteDrag(event: PointerEvent, id: string, segment: number, endpoint?: "from" | "to") {
        const relation = this.model.metadata.relations.find(item => item.id === id);
        const points = this.relationRoutes.get(id);
        if (this.options.readOnly || !relation || !points?.[segment + 1]) {
            return;
        }
        this.selectedId = undefined;
        this.selectedEdge = undefined;
        this.selectedRelation = id;
        this.relationFrom = undefined;
        this.finishRelationEdit?.(true);
        this.options.host.focus({preventScroll: true});
        const handle = this.routeHandles.get(`${id}:${endpoint || segment}`);
        this.pointer = {pointerId: event.pointerId, startX: event.clientX, startY: event.clientY,
            x: this.offsetX, y: this.offsetY, moved: false,
            relation: {id, segment, endpoint, targetId: endpoint ? relation[endpoint] : undefined,
                points: points.map(point => ({...point})), original: JSON.stringify(relation), offset: 0, valid: true,
                handle: handle ? {x: (parseFloat(handle.style.left) - this.offsetX) / this.scale,
                    y: (parseFloat(handle.style.top) - this.offsetY) / this.scale} :
                    {x: (points[segment].x + points[segment + 1].x) / 2, y: (points[segment].y + points[segment + 1].y) / 2}}};
        try {
            this.pointerCapture = (event.target as Element).closest<HTMLElement>(".list-mindmap__route-handle") || this.viewport;
            this.pointerCapture.setPointerCapture(event.pointerId);
        } catch {
            this.cancelPointer();
            return;
        }
        this.inspector.hidden = false;
        this.updateSelection();
        this.renderInspector();
    }

    private previewRouteDrag() {
        cancelAnimationFrame(this.routeDragFrame);
        this.routeDragFrame = 0;
        const drag = this.pointer?.relation;
        const relation = this.model.metadata.relations.find(item => item.id === drag?.id);
        if (!drag || !relation) {
            return;
        }
        const from = this.positions.get(relation.from);
        const to = this.positions.get(relation.to);
        drag.valid = false;
        if (drag.endpoint) {
            const target = this.positions.get(drag.targetId);
            const point = target || {id: "", ...drag.handle, width: 0, height: 0};
            const nextFrom = drag.endpoint === "from" ? point : from;
            const nextTo = drag.endpoint === "to" ? point : to;
            const points = target?.id === relation[drag.endpoint] ? drag.points :
                routeMindmapRelation(nextFrom, nextTo, this.routingObstacles());
            drag.valid = !!target && this.canReconnectRelation(relation, drag.endpoint, target.id) && points.length >= 2;
            if (points.length >= 2) {
                this.relationRoutes.set(drag.id, points);
            }
            this.nodeElements.forEach((element, id) => element.classList.toggle("list-mindmap__node--relation",
                drag.valid && id === drag.targetId));
            this.draw();
            return;
        }
        const route = from && to && adjustMindmapRoute(drag.points, drag.segment, drag.offset, from, to,
            this.fallbackRoutes.has(drag.id) ? undefined : relation.route);
        if (route) {
            const points = routeManualMindmapRelation(from, to, this.routingObstacles(), route);
            if (points.length >= 2) {
                drag.route = route;
                drag.valid = true;
                this.relationRoutes.set(drag.id, points);
            }
        }
        this.draw();
    }

    private canReconnectRelation(relation: ListMindmapRelation, endpoint: "from" | "to", targetId: string) {
        const target = this.model.nodes.get(targetId);
        const from = endpoint === "from" ? targetId : relation.from;
        const to = endpoint === "to" ? targetId : relation.to;
        return target && !target.virtual && from !== to && !this.model.metadata.relations.some(item =>
            item.id !== relation.id && item.from === from && item.to === to);
    }

    private resetRelationRoute(id: string) {
        if (this.options.readOnly) {
            return;
        }
        this.cancelPointer();
        this.finishThen(() => {
            const relation = this.model.metadata.relations.find(item => item.id === id);
            if (!this.options.readOnly && relation?.route) {
                this.options.onRelationChange?.(id, {route: undefined}, JSON.stringify(relation));
            }
        });
    }

    private draw() {
        if (this.destroyed) {
            return;
        }
        this.world.style.transform = `translate(${this.offsetX}px, ${this.offsetY}px) scale(${this.scale})`;
        this.zoomLabel.textContent = `${Math.round(this.scale * 100)}%`;
        this.zoomSlider.value = String(Math.round(this.scale * 100));
        const width = this.viewport.clientWidth;
        const height = this.viewport.clientHeight;
        const ratio = window.devicePixelRatio || 1;
        if (this.canvas.width !== Math.round(width * ratio) || this.canvas.height !== Math.round(height * ratio)) {
            this.canvas.width = Math.round(width * ratio);
            this.canvas.height = Math.round(height * ratio);
        }
        const context = this.canvas.getContext("2d");
        this.linePaths = [];
        if (!context) {
            return;
        }
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, width, height);
        context.translate(this.offsetX, this.offsetY);
        context.scale(this.scale, this.scale);
        const theme = getComputedStyle(this.options.host);
        const defaultLine = theme.getPropertyValue("--b3-border-color").trim() || "#a8adb5";
        const primary = theme.getPropertyValue("--b3-theme-primary").trim() || "#3574f0";
        const colors = new Map<string, string>();
        const resolveColor = (value: string, fallback: string) => {
            const key = value || fallback;
            if (!colors.has(key)) {
                this.colorProbe.style.color = fallback;
                if (value) {
                    this.colorProbe.style.color = value;
                }
                colors.set(key, getComputedStyle(this.colorProbe).color);
            }
            return colors.get(key);
        };
        this.edges.forEach((edge) => {
            const from = this.positions.get(edge.from);
            const to = this.positions.get(edge.to);
            if (!from || !to) {
                return;
            }
            const style = {...this.model.metadata.nodes[this.model.root.id], ...this.model.metadata.nodes[edge.to]};
            const startX = from.x + from.width;
            const startY = from.y + (edge.from === this.model.root.id ? from.height / 2 : from.height);
            const endX = to.x;
            const endY = to.y + to.height;
            const center = (startX + endX) / 2;
            const path = new Path2D();
            path.moveTo(startX, startY);
            path.bezierCurveTo(center, startY, center, endY, endX, endY);
            path.lineTo(to.x + to.width, endY);
            this.linePaths.push({id: edge.to, relation: false, path});
            context.beginPath();
            context.strokeStyle = resolveColor(style.lineColor, defaultLine);
            context.lineWidth = (style.lineWidth || 1.5) + (this.selectedEdge === edge.to ? 1 : 0) +
                (this.hoveredLine === `edge:${edge.to}` ? 1.5 / this.scale : 0);
            context.setLineDash(style.lineDash ? [6, 4] : []);
            context.stroke(path);
        });
        this.model.metadata.relations.forEach((relation) => {
            const from = this.positions.get(relation.from);
            const to = this.positions.get(relation.to);
            const element = this.relationElements.get(relation.id);
            element.hidden = !from || !to || !relation.label?.trim();
            if (!from || !to) {
                return;
            }
            const route = this.relationPath(relation.id, from, to, element);
            if (!route) {
                element.hidden = true;
                return;
            }
            const {path, end, previous, arrowSizeLimit, labelPoint} = route;
            this.linePaths.push({id: relation.id, relation: true, path, end});
            context.beginPath();
            context.strokeStyle = resolveColor(relation.color, primary);
            const emphasis = (relation.id === this.selectedRelation ? 1 : 0) +
                (this.hoveredLine === `relation:${relation.id}` ? 1.5 / this.scale : 0);
            context.lineWidth = (relation.width || 1.5) + emphasis;
            element.classList.toggle("list-mindmap__relation--hover", this.hoveredLine === `relation:${relation.id}`);
            context.setLineDash(relation.dash === false ? [] : [5, 4]);
            context.stroke(path);
            context.setLineDash([]);
            context.beginPath();
            const direction = Math.atan2(end.y - previous.y, end.x - previous.x);
            // 短线上的双向箭头预留间隙，避免合并成菱形。
            const arrowSize = Math.min(Math.max(7 / this.scale, (relation.width || 1.5) * 2), arrowSizeLimit);
            // 箭头随线条状态加宽，保持长度不变以保留双向箭头之间的间隙。
            const halfWidth = arrowSize / 2 + emphasis / 2;
            const baseX = end.x - arrowSize * Math.cos(Math.PI / 6) * Math.cos(direction);
            const baseY = end.y - arrowSize * Math.cos(Math.PI / 6) * Math.sin(direction);
            context.fillStyle = context.strokeStyle;
            context.moveTo(baseX - halfWidth * Math.sin(direction), baseY + halfWidth * Math.cos(direction));
            context.lineTo(end.x, end.y);
            context.lineTo(baseX + halfWidth * Math.sin(direction), baseY - halfWidth * Math.cos(direction));
            context.closePath();
            context.fill();
            if (labelPoint) {
                element.style.left = `${labelPoint.x}px`;
                element.style.top = `${labelPoint.y}px`;
            }
        });
        this.drawRelationPreview(context, primary);
        this.renderRouteControls();
    }

    private drawRelationPreview(context: CanvasRenderingContext2D, color: string) {
        const from = this.positions.get(this.relationFrom);
        if (!from || !this.relationPreview) {
            return;
        }
        const target = this.positions.get(this.relationPreview.targetId);
        const route = this.relationPath(undefined, from, target || {
            id: "", x: this.relationPreview.x, y: this.relationPreview.y, width: 0, height: 0,
        });
        if (!route) {
            return;
        }
        const {path, end, previous, arrowSizeLimit} = route;
        context.beginPath();
        context.strokeStyle = color;
        context.lineWidth = 1.5;
        context.setLineDash([5, 4]);
        context.stroke(path);
        context.setLineDash([]);
        context.beginPath();
        const size = Math.min(Math.max(7 / this.scale, 3), arrowSizeLimit);
        const direction = Math.atan2(end.y - previous.y, end.x - previous.x);
        context.fillStyle = color;
        context.moveTo(end.x - size * Math.cos(direction - Math.PI / 6), end.y - size * Math.sin(direction - Math.PI / 6));
        context.lineTo(end.x, end.y);
        context.lineTo(end.x - size * Math.cos(direction + Math.PI / 6), end.y - size * Math.sin(direction + Math.PI / 6));
        context.closePath();
        context.fill();
    }

    private renderTask(element: HTMLElement, id: string) {
        const marker = this.model.nodes.get(id)?.taskMarker;
        let task = element.querySelector<HTMLButtonElement>(".list-mindmap__task");
        if (marker === undefined) {
            task?.remove();
            element.removeAttribute("data-task");
            element.classList.remove("protyle-task--done");
            return;
        }
        element.dataset.task = marker;
        element.classList.toggle("protyle-task--done", marker !== " ");
        if (!task) {
            task = this.makeButton("task", "iconUncheck", () => {
                if (!this.options.readOnly && this.model.nodes.get(id)?.taskMarker !== undefined) {
                    this.options.onTaskToggle?.(id);
                }
            });
            task.className = "protyle-action protyle-action--task list-mindmap__task";
            task.addEventListener("contextmenu", event => {
                event.preventDefault();
                event.stopPropagation();
                this.finishThen(() => this.openTaskMenu(id, task));
            });
            element.prepend(task);
        }
        task.dataset.task = marker;
        task.disabled = !!this.options.readOnly;
        const key = {" ": "taskStatusTodo", "/": "taskStatusInProgress", X: "taskStatusDone", "-": "taskStatusCanceled"}[marker.toUpperCase()];
        task.setAttribute("aria-label", key ? this.label(key) : `${this.label("customTaskStatus")} ${marker}`);
        task.querySelector("use").setAttribute("xlink:href", marker === " " ? "#iconUncheck" : "#iconCheck");
    }

    private openTaskMenu(id: string, anchor: HTMLElement) {
        if (!this.options.readOnly && this.model.nodes.get(id)?.taskMarker !== undefined) {
            this.options.onTaskMenu?.(id, anchor);
        }
    }

    private selectNode(id: string) {
        const changed = this.selectedId !== id || !!this.selectedRelation;
        this.selectedId = id;
        this.selectedRelation = undefined;
        this.selectedEdge = undefined;
        this.updateSelection();
        if (!this.options.readOnly && !this.relationFrom) {
            this.inspector.hidden = false;
        }
        if (changed || !this.inspector.hidden) {
            this.renderInspector();
        }
    }

    private updateSelection() {
        if (!this.relationFrom) {
            this.relationPreview = undefined;
        }
        this.nodeElements.forEach((element, id) => {
            element.classList.toggle("list-mindmap__node--selected", this.selectedId === id);
            element.classList.toggle("list-mindmap__node--relation", this.relationFrom === id ||
                this.relationPreview?.targetId === id);
            element.setAttribute("aria-selected", String(this.selectedId === id));
        });
        this.relationElements.forEach((element, id) => element.classList.toggle("list-mindmap__relation--selected", this.selectedRelation === id));
        const node = this.model.nodes.get(this.selectedId);
        const disabled: Record<string, boolean> = {
            relation: !node || node.virtual,
            style: !node && !this.selectedRelation && !this.selectedEdge,
        };
        Object.keys(disabled).forEach((key) => {
            const button = this.buttons.get(key);
            if (button) {
                button.disabled = disabled[key];
            }
        });
        this.buttons.get("relation")?.classList.toggle("block__icon--active", !!this.relationFrom);
        this.draw();
    }

    private toggleFold(id: string) {
        const node = this.model.nodes.get(id);
        if (!node?.children.length) {
            return;
        }
        this.foldAnchor = {id, collapsed: !(this.folded.get(id) ?? node.collapsed)};
        if (this.options.readOnly || node.virtual) {
            this.folded.set(id, !(this.folded.get(id) ?? node.collapsed));
            this.update(this.model);
        } else {
            this.options.onFold?.(id);
        }
    }

    private deleteSelection() {
        if (this.options.readOnly) {
            return;
        }
        if (this.selectedRelation) {
            this.options.onRelationDelete?.(this.selectedRelation);
        } else {
            const node = this.model.nodes.get(this.selectedId);
            if (node && !node.virtual && node !== this.model.root) {
                this.options.onDelete?.(node.id);
            }
        }
    }

    private pointerDown = (event: PointerEvent) => {
        clearTimeout(this.linkTimer);
        this.suppressLinkClick = false;
        this.suppressPanContextMenu = false;
        const target = event.target as HTMLElement;
        if (![0, 2].includes(event.button) || target.closest("button, input, select, textarea, audio, video, iframe, .list-mindmap__node--editing")) {
            return;
        }
        this.suppressPanContextMenu = event.button === 2;
        const element = target.closest<HTMLElement>(".list-mindmap__node");
        const id = element?.dataset.mindmapId;
        this.preparePointer(event);
        this.finishThen(() => {
            if (this.pendingPointerId === event.pointerId) {
                this.beginPointer(event, id);
            }
        });
    };

    private preparePointer(event: PointerEvent) {
        this.pendingPointerId = event.pointerId;
        // 按下时即暂停悬浮预览，等待编辑提交期间也不能补开旧浮窗。
        this.endInteraction ||= this.options.onInteractionStart?.(event);
    }

    private beginPointer(event: PointerEvent, id?: string) {
        if (this.panning || event.button === 2) {
            id = undefined;
            event.preventDefault();
        }
        if (event.button !== 2 && !this.panning && !id && !this.options.readOnly && !this.relationFrom) {
            const line = this.findLine(event);
            const points = line?.relation && this.relationRoutes.get(line.id);
            if (points) {
                const bounds = this.viewport.getBoundingClientRect();
                const x = (event.clientX - bounds.left - this.offsetX) / this.scale;
                const y = (event.clientY - bounds.top - this.offsetY) / this.scale;
                const segment = points.slice(1).map((b, index) => {
                    const a = points[index];
                    return {index, length: Math.hypot(b.x - a.x, b.y - a.y), distance: Math.hypot(
                        x - Math.max(Math.min(a.x, b.x), Math.min(x, Math.max(a.x, b.x))),
                        y - Math.max(Math.min(a.y, b.y), Math.min(y, Math.max(a.y, b.y))))};
                }).filter(item => item.length >= 12 && item.distance <= 12 / this.scale)
                    .sort((a, b) => a.distance - b.distance)[0];
                if (segment) {
                    this.beginRouteDrag(event, line.id, segment.index);
                    return;
                }
            }
        }
        if (this.relationFrom && id) {
            this.suppressLinkClick = true;
            event.preventDefault();
            if (id !== this.relationFrom && !this.model.nodes.get(id)?.virtual) {
                this.options.onRelationAdd?.(this.relationFrom, id);
                this.relationFrom = undefined;
                this.selectNode(id);
            }
            return;
        }
        if (id) {
            this.selectNode(id);
        }
        this.options.host.focus({preventScroll: true});
        this.pointer = {
            pointerId: event.pointerId,
            rightButton: event.button === 2,
            id: !this.options.readOnly && id && !this.model.nodes.get(id)?.virtual ? id : undefined,
            startX: event.clientX,
            startY: event.clientY,
            x: this.offsetX,
            y: this.offsetY,
            moved: false,
        };
        try {
            // 在原点击元素捕获指针，保留链接目标，同时让连续点击可以识别为双击。
            this.pointerCapture = id ? event.target as HTMLElement : this.viewport;
            this.pointerCapture.setPointerCapture(event.pointerId);
        } catch {
            this.cancelPointer();
        }
    }

    private pointerMove = (event: PointerEvent) => {
        if (this.relationFrom && !this.pointer?.rightButton) {
            const bounds = this.viewport.getBoundingClientRect();
            const id = (event.target as Element).closest<HTMLElement>(".list-mindmap__node")?.dataset.mindmapId;
            this.relationPreview = {
                x: (event.clientX - bounds.left - this.offsetX) / this.scale,
                y: (event.clientY - bounds.top - this.offsetY) / this.scale,
                targetId: id && id !== this.relationFrom && !this.model.nodes.get(id)?.virtual ? id : undefined,
            };
            this.updateSelection();
            return;
        }
        const pointer = this.pointer;
        if (!pointer) {
            if (this.panning) {
                this.setHoveredLine();
                return;
            }
            const target = event.target as Element;
            const relation = target.closest<HTMLElement>(".list-mindmap__relation[data-relation-id]");
            const line = target.closest(".list-mindmap__node, input, button") ? undefined : this.findLine(event);
            this.setHoveredLine(relation ? `relation:${relation.dataset.relationId}` :
                line ? `${line.relation ? "relation" : "edge"}:${line.id}` : undefined);
            return;
        }
        this.setHoveredLine();
        if (!pointer || event.pointerId !== pointer.pointerId) {
            return;
        }
        const dx = event.clientX - pointer.startX;
        const dy = event.clientY - pointer.startY;
        if (!pointer.moved && Math.hypot(dx, dy) < 5) {
            return;
        }
        event.preventDefault();
        pointer.moved = true;
        if (pointer.relation) {
            const drag = pointer.relation;
            if (drag.endpoint) {
                const bounds = this.viewport.getBoundingClientRect();
                drag.handle = {x: (event.clientX - bounds.left - this.offsetX) / this.scale,
                    y: (event.clientY - bounds.top - this.offsetY) / this.scale};
                drag.targetId = [...this.positions.values()].find(node => drag.handle.x >= node.x &&
                    drag.handle.x <= node.x + node.width && drag.handle.y >= node.y &&
                    drag.handle.y <= node.y + node.height)?.id;
            } else {
                drag.offset = (drag.points[drag.segment].y === drag.points[drag.segment + 1].y ? dy : dx) / this.scale;
            }
            if (!this.routeDragFrame) {
                this.routeDragFrame = requestAnimationFrame(() => this.previewRouteDrag());
            }
            return;
        }
        this.viewport.classList.add("list-mindmap__viewport--dragging");
        if (!pointer.id) {
            this.offsetX = pointer.x + dx;
            this.offsetY = pointer.y + dy;
            this.draw();
            return;
        }
        if (!this.ghost) {
            const source = this.nodeElements.get(pointer.id);
            this.ghost = source.cloneNode(true) as HTMLDivElement;
            this.ghost.className = "list-mindmap__node list-mindmap__node--selected list-mindmap__ghost";
            this.ghost.removeAttribute("data-mindmap-id");
            this.ghost.querySelectorAll(".list-mindmap__fold, .list-mindmap__add-child, .list-mindmap__add-bridge")
                .forEach(button => button.remove());
            this.world.append(this.ghost);
            source.classList.add("list-mindmap__node--dragging");
        }
        const source = this.positions.get(pointer.id);
        this.ghost.style.left = `${source.x + dx / this.scale}px`;
        this.ghost.style.top = `${source.y + dy / this.scale}px`;
        this.clearDrop();
        const hit = document.elementFromPoint(event.clientX, event.clientY);
        let target = hit?.closest<HTMLElement>(".list-mindmap__node");
        let blankPlacement: PointerState["placement"];
        // 直接命中节点时保留原有操作，空白处再比较同级和子节点落点的二维距离。
        if (!target && hit && this.viewport.contains(hit)) {
            const bounds = this.viewport.getBoundingClientRect();
            const x = (event.clientX - bounds.left - this.offsetX) / this.scale;
            const y = (event.clientY - bounds.top - this.offsetY) / this.scale;
            const drop = findMindmapDrop(this.positions.values(), x, y, id => this.canDrop(pointer.id, id));
            if (drop) {
                target = this.nodeElements.get(drop.id);
                blankPlacement = drop.placement;
            }
        }
        let targetId = target?.dataset.mindmapId;
        if (!targetId || !this.world.contains(target) || !this.canDrop(pointer.id, targetId)) {
            return;
        }
        const rect = target.getBoundingClientRect();
        const part = (event.clientY - rect.top) / rect.height;
        const node = this.model.nodes.get(targetId);
        let placement: PointerState["placement"] = blankPlacement || (node.virtual ? "child" :
            part < .25 ? "before" : part > .75 ? "after" : "child");
        // 同一个兄弟间隙统一显示在后一个节点之前，避免最近节点切换时插入线跳动。
        if (placement === "after" && node.parentId) {
            const siblings = this.model.nodes.get(node.parentId).children;
            const next = siblings[siblings.indexOf(node) + 1];
            if (next && this.positions.has(next.id) && this.canDrop(pointer.id, next.id)) {
                targetId = next.id;
                target = this.nodeElements.get(next.id);
                placement = "before";
            }
        }
        pointer.targetId = targetId;
        pointer.placement = placement;
        target.dataset.mindmapDrop = placement;
    };

    private canDrop(id: string, targetId: string) {
        let current = this.model.nodes.get(targetId);
        while (current) {
            if (current.id === id) {
                return false;
            }
            current = this.model.nodes.get(current.parentId);
        }
        return true;
    }

    private pointerUp = (event: PointerEvent) => {
        this.pendingPointerId = undefined;
        const pointer = this.pointer;
        if (!pointer || event.pointerId !== pointer.pointerId) {
            return;
        }
        const {id, targetId, placement, moved} = pointer;
        if (pointer.relation) {
            if (moved) {
                this.previewRouteDrag();
            }
            const drag = pointer.relation;
            this.cancelPointer();
            const relation = this.model.metadata.relations.find(item => item.id === drag.id);
            if (moved && drag.endpoint && drag.valid && relation && !this.options.readOnly &&
                relation[drag.endpoint] !== drag.targetId && this.canReconnectRelation(relation, drag.endpoint, drag.targetId)) {
                this.options.onRelationChange?.(drag.id, {[drag.endpoint]: drag.targetId, route: undefined}, drag.original);
            } else if (moved && !drag.endpoint && Math.abs(drag.offset) > .01 && drag.valid && drag.route && !this.options.readOnly) {
                this.options.onRelationChange?.(drag.id, {route: drag.route}, drag.original);
            }
            return;
        }
        this.suppressLinkClick = moved;
        this.cancelPointer();
        if (moved && id && targetId && placement) {
            this.options.onMove?.(id, targetId, placement);
        } else if (!moved && !id && !pointer.rightButton && !this.options.readOnly && !this.panning) {
            this.selectLine(event);
        }
    };

    private setHoveredLine(key?: string) {
        if (key === this.hoveredLine) {
            return;
        }
        if (this.hoveredLine?.startsWith("edge:")) {
            this.nodeElements.get(this.hoveredLine.slice(5))?.classList.remove("list-mindmap__node--line-hover");
        }
        this.hoveredLine = key;
        if (key?.startsWith("edge:")) {
            this.nodeElements.get(key.slice(5))?.classList.add("list-mindmap__node--line-hover");
        }
        this.viewport.classList.toggle("list-mindmap__viewport--line-hover", !!key);
        this.draw();
    }

    private findLine(event: MouseEvent) {
        const context = this.canvas.getContext("2d");
        if (!context) {
            return;
        }
        const bounds = this.viewport.getBoundingClientRect();
        const x = (event.clientX - bounds.left - this.offsetX) / this.scale;
        const y = (event.clientY - bounds.top - this.offsetY) / this.scale;
        context.save();
        context.resetTransform();
        context.setLineDash([]);
        context.lineWidth = 12 / this.scale;
        const lines = this.linePaths.slice().reverse();
        // 优先命中最近的箭头，重合的双向连接可从各自的箭头单独选中。
        let arrow: typeof lines[number];
        let distance = 12 / this.scale;
        lines.forEach(item => {
            if (!item.end) {
                return;
            }
            const current = Math.hypot(item.end.x - x, item.end.y - y);
            if (current < distance) {
                distance = current;
                arrow = item;
            }
        });
        const hits = lines.filter(item => context.isPointInStroke(item.path, x, y));
        // 沿线移动或双击时保持已选关系，避免重新选中覆盖在上方的反向连接。
        const line = arrow || hits.find(item => item.relation && item.id === this.selectedRelation) || hits[0];
        context.restore();
        return line;
    }

    private selectLine(event: MouseEvent) {
        const line = this.findLine(event);
        if (!line) {
            return;
        }
        this.selectedId = undefined;
        this.relationFrom = undefined;
        this.selectedRelation = line.relation ? line.id : undefined;
        this.selectedEdge = line.relation ? undefined : line.id;
        this.inspector.hidden = false;
        this.updateSelection();
        this.renderInspector();
    }

    private clearDrop() {
        if (this.pointer) {
            this.pointer.targetId = undefined;
            this.pointer.placement = undefined;
        }
        this.world.querySelectorAll<HTMLElement>("[data-mindmap-drop]").forEach(element => element.removeAttribute("data-mindmap-drop"));
    }

    private cancelPointer = () => {
        cancelAnimationFrame(this.routeDragFrame);
        this.routeDragFrame = 0;
        this.pendingPointerId = undefined;
        this.clearDrop();
        const pointer = this.pointer;
        this.pointer = undefined;
        if (pointer && this.pointerCapture?.hasPointerCapture(pointer.pointerId)) {
            this.pointerCapture.releasePointerCapture(pointer.pointerId);
        }
        this.pointerCapture = undefined;
        this.endInteraction?.();
        this.endInteraction = undefined;
        this.ghost?.remove();
        this.ghost = undefined;
        this.viewport.classList.remove("list-mindmap__viewport--dragging");
        this.nodeElements.forEach(element => element.classList.remove("list-mindmap__node--dragging"));
        if (pointer?.relation) {
            if (pointer.relation.endpoint) {
                this.nodeElements.forEach(element => element.classList.remove("list-mindmap__node--relation"));
            }
            this.relationRoutes.set(pointer.relation.id, pointer.relation.points);
            this.draw();
            this.refreshLayout();
        }
    };

    private contentClick = (event: MouseEvent) => {
        const target = event.target as Element;
        if (target.closest(".list-mindmap__node--editing")) {
            return;
        }
        const link = target.closest<HTMLElement>('a[href], [data-type~="a"][data-href], [data-type~="block-ref"][data-id]');
        if (!link?.closest(".list-mindmap__content")) {
            return;
        }
        clearTimeout(this.linkTimer);
        if (this.panning || this.suppressLinkClick || this.relationFrom || event.detail > 1) {
            event.preventDefault();
            return;
        }
        const href = getAVRichTextSafeURL(link.getAttribute("data-type")?.split(" ").includes("block-ref") ?
            `siyuan://blocks/${link.dataset.id}` : link.dataset.href || link.getAttribute("href"));
        if (!href) {
            event.preventDefault();
            return;
        }
        if (this.options.onOpenLink) {
            event.preventDefault();
            // 等待双击判定，拖拽和进入节点编辑均不触发跳转。
            this.linkTimer = window.setTimeout(() => {
                if (!this.destroyed && link.isConnected) {
                    this.finishThen(() => this.options.onOpenLink(href, event));
                }
            }, Constants.TIMEOUT_DBLCLICK);
        }
    };

    private doubleClick = (event: MouseEvent) => {
        clearTimeout(this.linkTimer);
        if (this.options.readOnly || this.relationFrom || this.panning) {
            return;
        }
        const target = event.target as HTMLElement;
        if (target.closest(".list-mindmap__relation")) {
            this.editRelationLabel(event);
            return;
        }
        if (target.closest("button, input, select, audio, video, iframe, .list-mindmap__node--editing")) {
            return;
        }
        const id = target.closest<HTMLElement>(".list-mindmap__node")?.dataset.mindmapId;
        if (!id) {
            this.selectLine(event);
            if (this.selectedRelation) {
                this.editRelationLabel(event);
            }
            return;
        }
        if (!id) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.cancelPointer();
        this.finishThen(() => {
            if (this.model.nodes.get(id)?.virtual) {
                this.editRootTitle(id);
                return;
            }
            this.setEditing(id);
            this.options.onEdit?.(id, this.getContentHost(id));
        });
    };

    private editRootTitle(id: string, toEnd = false) {
        this.finishRelationEdit?.(true);
        const content = this.getContentHost(id);
        const input = createElement("textarea", "list-mindmap__root-title");
        const measure = createElement("span", "list-mindmap__root-title-measure");
        input.rows = 1;
        input.value = this.model.metadata.rootTitle || "";
        measure.textContent = input.value;
        input.setAttribute("aria-label", this.label("text"));
        content.classList.add("list-mindmap__root-title-host");
        this.setEditing(id);
        content.replaceChildren(measure, input);
        input.addEventListener("input", () => {
            measure.textContent = input.value || "\u200b";
            this.refreshLayout();
        });
        let finished = false;
        const finish = (save: boolean) => {
            if (finished) {
                return;
            }
            finished = true;
            this.finishRelationEdit = undefined;
            const title = input.value.trim();
            content.classList.remove("list-mindmap__root-title-host");
            this.setEditing(undefined);
            if (save && title !== (this.model.metadata.rootTitle || "")) {
                this.options.onRootTitleChange?.(title);
            }
            this.update(this.model);
        };
        this.finishRelationEdit = finish;
        this.renderRouteControls();
        input.addEventListener("blur", () => finish(true));
        input.addEventListener("keydown", event => {
            event.stopPropagation();
            if (!event.isComposing && (event.key === "Enter" || event.key === "Escape")) {
                event.preventDefault();
                finish(event.key === "Enter");
                this.options.host.focus({preventScroll: true});
            }
        });
        input.focus();
        if (toEnd) {
            input.setSelectionRange(input.value.length, input.value.length);
        } else {
            input.select();
        }
    }

    private editRelationLabel(event: MouseEvent) {
        const relation = this.model.metadata.relations.find(item => item.id === this.selectedRelation);
        const element = this.relationElements.get(this.selectedRelation);
        if (!relation || !element) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.finishRelationEdit?.(true);
        this.inspector.hidden = true;
        const input = createElement("input", "b3-text-field list-mindmap__relation list-mindmap__relation-editor");
        input.type = "text";
        input.value = relation.label || "";
        input.setAttribute("aria-label", this.label("text"));
        input.style.left = element.style.left;
        input.style.top = element.style.top;
        element.style.visibility = "hidden";
        let finished = false;
        const finish = (save: boolean) => {
            if (finished) {
                return;
            }
            finished = true;
            this.finishRelationEdit = undefined;
            const value = input.value;
            input.remove();
            if (save && value !== (relation.label || "")) {
                this.options.onRelationChange?.(relation.id, {label: value});
            }
            this.draw();
        };
        this.finishRelationEdit = finish;
        this.renderRouteControls();
        input.addEventListener("blur", () => finish(true));
        input.addEventListener("keydown", event => {
            if (event.isComposing || (event.key !== "Enter" && event.key !== "Escape")) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            finish(event.key === "Enter");
            this.options.host.focus({preventScroll: true});
        });
        this.world.append(input);
        input.focus();
        input.select();
    }

    private wheel = (event: WheelEvent) => {
        if ((event.target as HTMLElement).closest(".list-mindmap__node--editing")) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (this.pointer?.relation) {
            return;
        }
        const mode = event.deltaMode;
        const unitX = mode === WheelEvent.DOM_DELTA_LINE ? 16 :
            mode === WheelEvent.DOM_DELTA_PAGE ? this.viewport.clientWidth : 1;
        const unitY = mode === WheelEvent.DOM_DELTA_LINE ? 16 :
            mode === WheelEvent.DOM_DELTA_PAGE ? this.viewport.clientHeight : 1;
        // 浏览器将触控板捏合转换为带 Ctrl 的滚轮事件，和鼠标组合滚轮共用光标锚点缩放。
        if (event.ctrlKey) {
            const bounds = this.viewport.getBoundingClientRect();
            const delta = Math.max(-24, Math.min(24, event.deltaY * unitY));
            this.zoomAt(this.scale * Math.exp(-delta * .01),
                event.clientX - bounds.left, event.clientY - bounds.top);
            return;
        }
        if (event.shiftKey) {
            this.offsetX -= event.deltaX ? event.deltaX * unitX : event.deltaY * unitX;
        } else {
            this.offsetX -= event.deltaX * unitX;
            this.offsetY -= event.deltaY * unitY;
        }
        this.draw();
    };

    private zoomAt(scale: number, x = this.viewport.clientWidth / 2, y = this.viewport.clientHeight / 2) {
        const next = Math.min(2.5, Math.max(.15, scale));
        this.offsetX = x - (x - this.offsetX) * next / this.scale;
        this.offsetY = y - (y - this.offsetY) * next / this.scale;
        this.scale = next;
        this.draw();
    }

    private contentBounds() {
        // 按实际可见节点、关系线和文字计算边界，不包含布局预留的空白。
        let left = Infinity;
        let top = Infinity;
        let right = -Infinity;
        let bottom = -Infinity;
        const include = (x: number, y: number, width = 0, height = 0) => {
            left = Math.min(left, x);
            top = Math.min(top, y);
            right = Math.max(right, x + width);
            bottom = Math.max(bottom, y + height);
        };
        this.positions.forEach(node => include(node.x, node.y - 1, node.width, node.height + 1));
        this.relationRoutes.forEach(points => points.forEach(point => include(point.x, point.y)));
        this.relationElements.forEach(element => {
            if (!element.hidden && element.style.visibility !== "hidden") {
                const x = parseFloat(element.style.left);
                const y = parseFloat(element.style.top);
                if (Number.isFinite(x) && Number.isFinite(y)) {
                    include(x - element.offsetWidth / 2, y - element.offsetHeight / 2,
                        element.offsetWidth, element.offsetHeight);
                }
            }
        });
        return {left, top, right, bottom};
    }

    private fitPrint() {
        if (!this.positions.size || !this.viewport.clientWidth) {
            return;
        }
        const {left, top, right, bottom} = this.contentBounds();
        const width = this.viewport.clientWidth;
        this.scale = Math.min(1, Math.max(1, width - 24) / Math.max(1, right - left));
        this.options.host.style.setProperty("--list-mindmap-print-height", `${Math.ceil((bottom - top) * this.scale + 26)}px`);
        this.offsetX = (width - (right - left) * this.scale) / 2 - left * this.scale;
        this.offsetY = 12 - top * this.scale;
        this.draw();
    }

    public fit(maxScale = 2.5) {
        const width = this.viewport.clientWidth;
        const height = this.viewport.clientHeight;
        if (!this.positions.size || !width || !height) {
            return;
        }
        // 先更新关系文字的位置，再按画布上下留白缩放并居中。
        this.draw();
        const {left, top, right, bottom} = this.contentBounds();
        const insetTop = 16;
        // 菜单打开前后保持相同的底部留白，避免选中节点时画布跳动。
        const insetBottom = 42;
        const availableWidth = Math.max(1, width - 48);
        const availableHeight = Math.max(1, height - insetTop - insetBottom);
        this.scale = Math.min(maxScale, Math.max(.15, Math.min(availableWidth / Math.max(1, right - left),
            availableHeight / Math.max(1, bottom - top))));
        this.offsetX = width / 2 - (left + right) * this.scale / 2;
        this.offsetY = insetTop + availableHeight / 2 - (top + bottom) * this.scale / 2;
        this.draw();
    }

    private keyDown = (event: KeyboardEvent) => {
        const target = event.target as HTMLElement;
        if (event.isComposing || target.closest("input, textarea, select, audio, video, iframe, .list-mindmap__node--editing")) {
            return;
        }
        if (this.pointer?.relation && event.key !== "Escape") {
            return;
        }
        if (!this.options.readOnly && this.options.isTaskCycle?.(event)) {
            const id = target.closest<HTMLElement>(".list-mindmap__node")?.dataset.mindmapId || this.selectedId;
            if (this.model.nodes.get(id)?.taskMarker !== undefined) {
                event.preventDefault();
                event.stopPropagation();
                if (!event.repeat) {
                    this.finishThen(() => {
                        if (!this.options.readOnly) {
                            this.options.onTaskToggle?.(id, true);
                        }
                    });
                }
            }
            return;
        }
        if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(event.key) &&
            !this.editingId && !this.relationFrom && this.selectedId &&
            !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey &&
            !target.isContentEditable && !target.closest("button, a")) {
            const node = this.model.nodes.get(this.selectedId);
            if (!node) {
                return;
            }
            if (event.key === " ") {
                if (this.options.readOnly || event.repeat) {
                    return;
                }
                this.finishThen(() => {
                    if (this.selectedId !== node.id) {
                        return;
                    }
                    if (node.virtual) {
                        this.editRootTitle(node.id, true);
                    } else {
                        this.setEditing(node.id);
                        this.options.onEdit?.(node.id, this.getContentHost(node.id));
                    }
                });
            } else {
                const parent = this.model.nodes.get(node.parentId);
                let next: string;
                if (event.key === "ArrowLeft") {
                    next = parent?.id;
                } else if (event.key === "ArrowRight") {
                    if (!(this.folded.get(node.id) ?? node.collapsed)) {
                        next = node.children[0]?.id;
                    }
                } else if (parent) {
                    const index = parent.children.findIndex(child => child.id === node.id);
                    next = parent.children[index + (event.key === "ArrowUp" ? -1 : 1)]?.id;
                }
                if (next) {
                    this.selectNode(next);
                }
            }
        } else if ((event.key === "Tab" || event.key === "Enter") && !this.options.readOnly &&
            !this.editingId && !this.relationFrom && this.selectedId && !event.repeat &&
            !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey &&
            !target.isContentEditable && !target.closest("button, a")) {
            const id = this.selectedId;
            const node = this.model.nodes.get(id);
            if (!node || (event.key === "Enter" && node.virtual)) {
                return;
            }
            const kind = event.key === "Tab" ? "child" : "sibling";
            this.finishThen(() => {
                if (this.selectedId === id) {
                    this.options.onAdd?.(id, kind);
                }
            });
        } else if ((event.key === "Delete" || event.key === "Backspace") &&
            !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
            const selectedId = this.selectedId;
            const selectedRelation = this.selectedRelation;
            this.finishThen(() => {
                if (selectedId === this.selectedId && selectedRelation === this.selectedRelation) {
                    this.deleteSelection();
                }
            });
        } else if (event.key === "Escape") {
            const draggingRoute = !!this.pointer?.relation;
            this.cancelPointer();
            if (draggingRoute) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            this.relationFrom = undefined;
            this.inspector.hidden = true;
            if (this.fullscreenMarker) {
                this.exitFullscreen();
            }
            this.updateSelection();
        } else {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
    };

    private renderInspector() {
        if (this.inspector.hidden || this.options.readOnly) {
            return;
        }
        this.inspector.replaceChildren();
        const lineSelected = !!this.selectedRelation || !!this.selectedEdge;
        this.inspector.classList.toggle("list-mindmap__inspector--node", !lineSelected);
        this.inspector.classList.toggle("list-mindmap__inspector--line", lineSelected);
        this.inspector.style.left = "";
        this.inspector.style.top = "";
        const squareButton = (key: string, icon: string, action: () => void) => {
            const button = this.makeButton(key, icon, action);
            button.className = "color__square";
            button.querySelector("svg").classList.add("svg--mid");
            return button;
        };
        const color = (value: string, action: (value: string) => void, key = "color") => {
            const palette = createElement("div", "list-mindmap__palette");
            palette.setAttribute("role", "group");
            palette.setAttribute("aria-label", this.label(key));
            const colors = [{label: this.label("default"), value: ""}, ...(this.options.colors?.() || [])];
            colors.forEach(item => {
                const button = this.makeButton("color", "", () => action(item.value));
                const selected = (value || "") === item.value;
                button.className = "color__square" + (selected ? " color__square--current" : "");
                button.setAttribute("aria-label", item.label);
                button.setAttribute("aria-pressed", String(selected));
                button.style.backgroundColor = item.value || "var(--b3-theme-background)";
                palette.append(button);
            });
            if (this.options.onManageLineColors) {
                palette.append(squareButton("manageColors", "iconSettings", this.options.onManageLineColors));
            }
            this.inspector.append(palette);
        };
        if (this.selectedRelation) {
            const relation = this.model.metadata.relations.find(item => item.id === this.selectedRelation);
            if (!relation) {
                return;
            }
            const change = (patch: Partial<ListMindmapRelation>) => this.options.onRelationChange?.(relation.id, patch);
            color(relation.color, value => change({color: value}));
            const remove = squareButton("delete", "iconTrashcan", () => this.options.onRelationDelete?.(relation.id));
            this.inspector.append(remove);
            return;
        }
        if (this.selectedEdge) {
            const id = this.selectedEdge;
            const style = {...this.model.metadata.nodes[this.model.root.id], ...this.model.metadata.nodes[id]};
            const change = (patch: Partial<ListMindmapNodeStyle>) => this.options.onNodeStyle?.(id, patch);
            color(style.lineColor, value => change({lineColor: value}));
            return;
        }
        if (!this.selectedId) {
            return;
        }
        const id = this.selectedId;
        const style = this.model.metadata.nodes[id] || {};
        const change = (patch: Partial<ListMindmapNodeStyle>) => this.options.onNodeStyle?.(id, patch);
        const nodePalette = createElement("div", "fn__flex");
        nodePalette.setAttribute("role", "group");
        nodePalette.setAttribute("aria-label", this.label("color"));
        const nodeColors: ReturnType<NonNullable<ListMindmapViewOptions["nodeColors"]>> = [
            {label: this.label("default"), color: "", backgroundColor: ""}, ...(this.options.nodeColors?.() || []),
        ];
        nodeColors.forEach(item => {
            const button = this.makeButton("color", "iconFont", () => change({
                textColor: item.color, backgroundColor: item.backgroundColor,
            }));
            const selected = (style.textColor || "") === item.color && (style.backgroundColor || "") === item.backgroundColor;
            button.className = "color__square" + (selected ? " color__square--current" : "");
            button.textContent = "A";
            button.setAttribute("aria-label", item.label);
            button.setAttribute("aria-pressed", String(selected));
            button.style.color = item.preview?.color ?? item.color;
            button.style.backgroundColor = item.preview?.backgroundColor ?? item.backgroundColor;
            nodePalette.append(button);
        });
        if (this.options.onManageNodeColors) {
            const manage = squareButton("manageColors", "iconSettings", this.options.onManageNodeColors);
            nodePalette.append(manage);
        }
        this.inspector.append(nodePalette);
        const node = this.model.nodes.get(id);
        if (node?.taskMarker !== undefined && this.options.onTaskMenu) {
            const task = squareButton("checkToggle", "iconCheck", () => this.openTaskMenu(id, task));
            nodePalette.append(task);
        }
        if (node && !node.virtual && node !== this.model.root) {
            nodePalette.append(squareButton("delete", "iconTrashcan", () => this.deleteSelection()));
        }
    }

    private toggleFullscreen() {
        if (this.fullscreenMarker) {
            this.exitFullscreen();
        } else {
            this.enterFullscreen();
        }
    }

    private enterFullscreen() {
        if (this.destroyed || this.fullscreenMarker) {
            return;
        }
        // 移到独立容器，避免编辑器祖先的变换和裁剪改变全屏覆盖范围。
        this.fullscreenMarker = document.createComment("list-mindmap");
        this.options.host.before(this.fullscreenMarker);
        document.body.append(this.options.host);
        this.options.onFullscreen?.(true, this.buttons.get("fullscreen"));
        this.options.host.classList.add("fullscreen");
        this.toolbar.classList.add("block__icons");
        this.fullscreenChange();
        this.options.host.focus({preventScroll: true});
    }

    private exitFullscreen() {
        if (!this.fullscreenMarker) {
            return;
        }
        this.options.onFullscreen?.(false, this.buttons.get("fullscreen"));
        this.options.host.classList.remove("fullscreen");
        this.fullscreenMarker.replaceWith(this.options.host);
        this.fullscreenMarker = undefined;
        this.fullscreenChange();
        if (!this.destroyed) {
            this.options.host.focus({preventScroll: true});
        }
    }

    private fullscreenChange = () => {
        const active = !!this.fullscreenMarker;
        this.tooltip.hidden = true;
        const button = this.buttons.get("fullscreen");
        button.setAttribute("aria-label", this.label(active ? "exitFullscreen" : "fullscreen"));
        button.querySelector("use").setAttribute("xlink:href", active ? "#iconFullscreenExit" : "#iconFullscreen");
        this.initialFit = true;
        this.refreshLayout();
    };

    public destroy() {
        this.finishRelationEdit?.(false);
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        clearTimeout(this.linkTimer);
        this.cancelPointer();
        if (this.frame) {
            cancelAnimationFrame(this.frame);
        }
        this.resizeObserver.disconnect();
        this.disposers.forEach(dispose => dispose());
        this.exitFullscreen();
        this.nodeElements.forEach((_element, id) => destroyTabsRender(this.getContentHost(id)));
        this.nodeElements.clear();
        this.relationElements.clear();
        this.options.host.replaceChildren();
    }
}
