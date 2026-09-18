import {
    layoutListMindmap,
    ListMindmapLayoutNode,
    ListMindmapModel,
    ListMindmapNodeStyle,
    ListMindmapPosition,
    ListMindmapRelation,
} from "./model";
import {routeMindmapRelation, MindmapRoutePoint} from "./routing";
import {mathRender} from "../mathRender";
import {getAVRichTextSafeURL} from "../av/richTextValue";
import {Constants} from "../../../constants";
import {findMindmapDrop} from "./drop";

export interface ListMindmapViewOptions {
    host: HTMLElement;
    model: ListMindmapModel;
    readOnly?: boolean;
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
    onEdit?: (id: string, contentHost: HTMLElement) => void;
    onRootTitleChange?: (title: string) => void;
    finishEdit?: () => boolean | void | Promise<boolean | void>;
    onMove?: (id: string, targetId: string, placement: "before" | "child" | "after") => void;
    onAdd?: (id: string, kind: "child" | "sibling") => void;
    onDelete?: (id: string) => void;
    onFold?: (id: string) => void;
    onUndo?: () => void;
    onRedo?: () => void;
    onNodeStyle?: (id: string, patch: Partial<ListMindmapNodeStyle>) => void;
    onRelationAdd?: (from: string, to: string) => void;
    onRelationChange?: (id: string, patch: Partial<ListMindmapRelation>) => void;
    onRelationDelete?: (id: string) => void;
    onExit: () => void;
}

interface PointerState {
    pointerId: number;
    id?: string;
    startX: number;
    startY: number;
    x: number;
    y: number;
    moved: boolean;
    targetId?: string;
    placement?: "before" | "child" | "after";
}

const createElement = <T extends keyof HTMLElementTagNameMap>(tag: T, className: string) => {
    const element = document.createElement(tag);
    element.className = className;
    return element;
};

export class ListMindmapView {
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
    private readonly relationElements = new Map<string, HTMLButtonElement>();
    private readonly buttons = new Map<string, HTMLButtonElement>();
    private readonly folded = new Map<string, boolean>();
    private readonly tooltip = createElement("div", "list-mindmap__tooltip");
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
    private relationFrom?: string;
    private relationPreview?: {x: number, y: number, targetId?: string};
    private editingId?: string;
    private pointer?: PointerState;
    private pointerCapture?: HTMLElement;
    private pendingPointerId?: number;
    private linkTimer = 0;
    private suppressLinkClick = false;
    private ghost?: HTMLDivElement;
    private scale = 1;
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
        options.host.append(this.toolbar, this.viewport, this.inspector, this.tooltip, this.colorProbe);
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
        this.listen(this.viewport, "pointercancel", this.cancelPointer);
        this.listen(this.viewport, "lostpointercapture", this.cancelPointer);
        this.listen(window, "pointerup", (event: PointerEvent) => {
            if (this.pendingPointerId === event.pointerId) {
                this.pendingPointerId = undefined;
            }
        });
        this.listen(window, "pointercancel", (event: PointerEvent) => {
            if (this.pendingPointerId === event.pointerId) {
                this.pendingPointerId = undefined;
            }
        });
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
            this.printTransform = {scale: this.scale, offsetX: this.offsetX, offsetY: this.offsetY};
            this.fit();
        });
        this.listen(window, "afterprint", () => {
            if (this.printTransform) {
                Object.assign(this, this.printTransform);
                this.printTransform = undefined;
                this.draw();
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
        if (target instanceof Element && target.closest(".list-mindmap__relation-editor")) {
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
        });
        this.updateSelection();
    }

    private createToolbar() {
        const add = (id: string, key: string, icon: string, action: () => void) => {
            const button = this.makeButton(key, icon, action);
            this.buttons.set(id, button);
            this.toolbar.append(button);
        };
        add("exit", "listMindmapToList", "iconList", () => this.options.onExit());
        this.toolbar.append(createElement("span", "list-mindmap__spacer fn__flex-1"));
        if (!this.options.readOnly) {
            add("relation", "connect", "iconRoute", () => {
                this.inspector.hidden = true;
                this.relationFrom = this.relationFrom ? undefined : this.selectedId;
                this.relationPreview = undefined;
                this.updateSelection();
            });
        }
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

    public update(model: ListMindmapModel) {
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
            element.classList.toggle("list-mindmap__node--root", id === model.root.id);
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
                content.replaceChildren();
                if (node.virtual) {
                    content.textContent = this.model.metadata.rootTitle || this.label("listMindmapRoot");
                } else {
                    node.contentBlocks.forEach((block) => {
                        const clone = block.cloneNode(true) as HTMLElement;
                        clone.querySelectorAll(".protyle-attr, .protyle-action, .protyle-icons, .list-mindmap").forEach(item => item.remove());
                        [clone, ...Array.from(clone.querySelectorAll<HTMLElement>("*"))].forEach((item) => {
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
                        });
                        content.append(clone);
                    });
                }
                const hasBlankLines = node.contentBlocks.length > 1 || content.textContent.includes("\n") ||
                    content.querySelectorAll("br").length > 1;
                const empty = !hasBlankLines && !content.textContent.replace(/[\u200b\ufeff]/g, "").trim() &&
                    !content.querySelector("img, svg, video, audio, iframe, canvas, hr, [data-content]");
                content.classList.toggle("list-mindmap__content--empty", empty);
                content.dataset.placeholder = this.label("listMindmapPlaceholder");
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
            this.selectNode(id);
            this.nodeElements.get(id)?.classList.add("list-mindmap__node--editing");
        }
        this.refreshLayout();
    }

    public refreshLayout() {
        if (this.destroyed || this.frame) {
            return;
        }
        this.frame = requestAnimationFrame(() => {
            this.frame = 0;
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
                    width: Math.max(64, element.offsetWidth),
                    height: Math.max(1, element.offsetHeight),
                    collapsed: this.folded.get(id) ?? node.collapsed,
                    children: node.children.map(child => makeLayoutNode(child.id)),
                };
            };
            const anchorId = this.editingId || this.foldAnchor?.id;
            const previous = anchorId ? this.positions.get(anchorId) : undefined;
            const result = layoutListMindmap(makeLayoutNode(this.model.root.id));
            this.positions = result.nodes;
            this.relationRoutes.clear();
            this.edges = result.edges;
            this.bounds = result;
            let top = 0;
            let left = 0;
            // 每条连接独立避让节点和按钮，已有关系线不影响路径选择。
            this.model.metadata.relations.forEach((relation) => {
                const from = this.positions.get(relation.from);
                const to = this.positions.get(relation.to);
                if (from && to) {
                    const points = routeMindmapRelation(from, to, this.routingObstacles());
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
            // 编辑或折叠改变布局时固定操作节点，避免光标和折叠按钮随整棵树跳动。
            const current = anchorId ? this.positions.get(anchorId) : undefined;
            if (previous && current) {
                this.offsetX += (previous.x - current.x) * this.scale;
                this.offsetY += (previous.y - current.y) * this.scale;
            }
            if (this.foldAnchor && (this.folded.get(this.foldAnchor.id) ??
                this.model.nodes.get(this.foldAnchor.id)?.collapsed) === this.foldAnchor.collapsed) {
                this.foldAnchor = undefined;
            }
            if (this.initialFit) {
                this.initialFit = false;
                this.fit();
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
            points = routeMindmapRelation(from, to, this.routingObstacles());
            if (id) {
                this.relationRoutes.set(id, points);
            }
        }
        if (points.length < 2) {
            return;
        }
        const end = points[points.length - 1];
        const previous = points[points.length - 2];
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
            return {path, end, previous, labelPoint: undefined as MindmapRoutePoint | undefined};
        }
        const width = label.offsetWidth;
        const height = label.offsetHeight;
        const segments = points.slice(1).map((p, i) => ({a: points[i], b: p,
            length: Math.hypot(p.x - points[i].x, p.y - points[i].y)})).sort((a, b) => b.length - a.length);
        let labelPoint: MindmapRoutePoint;
        for (const segment of segments) {
            const center = {x: (segment.a.x + segment.b.x) / 2, y: (segment.a.y + segment.b.y) / 2};
            const candidates = [center, {x: center.x + width / 2 + 6, y: center.y},
                {x: center.x - width / 2 - 6, y: center.y},
                {x: center.x, y: center.y - height / 2 - 6}, {x: center.x, y: center.y + height / 2 + 6}];
            labelPoint = candidates.find(p => ![...this.positions.values()].some(node =>
                p.x + width / 2 > node.x - 4 && p.x - width / 2 < node.x + node.width + 40 &&
                p.y + height / 2 > node.y - 4 && p.y - height / 2 < node.y + node.height + 4));
            if (labelPoint) {
                break;
            }
        }
        label.style.visibility = labelPoint ? "" : "hidden";
        return {path, end, previous, labelPoint};
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
            const {path, end, previous, labelPoint} = route;
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
            const arrowSize = Math.min(Math.max(7 / this.scale, (relation.width || 1.5) * 2),
                Math.hypot(end.x - previous.x, end.y - previous.y) / 3);
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
        const {path, end, previous} = route;
        context.beginPath();
        context.strokeStyle = color;
        context.lineWidth = 1.5;
        context.setLineDash([5, 4]);
        context.stroke(path);
        context.setLineDash([]);
        context.beginPath();
        const size = Math.min(Math.max(7 / this.scale, 3), Math.hypot(end.x - previous.x, end.y - previous.y) / 3);
        const direction = Math.atan2(end.y - previous.y, end.x - previous.x);
        context.fillStyle = color;
        context.moveTo(end.x - size * Math.cos(direction - Math.PI / 6), end.y - size * Math.sin(direction - Math.PI / 6));
        context.lineTo(end.x, end.y);
        context.lineTo(end.x - size * Math.cos(direction + Math.PI / 6), end.y - size * Math.sin(direction + Math.PI / 6));
        context.closePath();
        context.fill();
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
        const target = event.target as HTMLElement;
        if (event.button !== 0 || target.closest("button, input, select, textarea, .list-mindmap__node--editing")) {
            return;
        }
        const element = target.closest<HTMLElement>(".list-mindmap__node");
        const id = element?.dataset.mindmapId;
        this.pendingPointerId = event.pointerId;
        this.finishThen(() => {
            if (this.pendingPointerId === event.pointerId) {
                this.beginPointer(event, id);
            }
        });
    };

    private beginPointer(event: PointerEvent, id?: string) {
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
            this.pointer = undefined;
        }
    }

    private pointerMove = (event: PointerEvent) => {
        if (this.relationFrom) {
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
        this.suppressLinkClick = moved;
        this.cancelPointer();
        if (moved && id && targetId && placement) {
            this.options.onMove?.(id, targetId, placement);
        } else if (!moved && !id && !this.options.readOnly) {
            this.selectLine(event);
        }
    };

    private setHoveredLine(key?: string) {
        if (key === this.hoveredLine) {
            return;
        }
        this.hoveredLine = key;
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
        this.pendingPointerId = undefined;
        this.clearDrop();
        const pointer = this.pointer;
        this.pointer = undefined;
        if (pointer && this.pointerCapture?.hasPointerCapture(pointer.pointerId)) {
            this.pointerCapture.releasePointerCapture(pointer.pointerId);
        }
        this.pointerCapture = undefined;
        this.ghost?.remove();
        this.ghost = undefined;
        this.viewport.classList.remove("list-mindmap__viewport--dragging");
        this.nodeElements.forEach(element => element.classList.remove("list-mindmap__node--dragging"));
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
        if (this.suppressLinkClick || this.relationFrom || event.detail > 1) {
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
        if (this.options.readOnly || this.relationFrom) {
            return;
        }
        const target = event.target as HTMLElement;
        if (target.closest(".list-mindmap__relation")) {
            this.editRelationLabel(event);
            return;
        }
        if (target.closest("button, input, select, .list-mindmap__node--editing")) {
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

    private editRootTitle(id: string) {
        this.finishRelationEdit?.(true);
        const content = this.getContentHost(id);
        const input = createElement("textarea", "list-mindmap__root-title");
        const measure = createElement("span", "list-mindmap__root-title-measure");
        input.rows = 1;
        input.value = this.model.metadata.rootTitle || this.label("listMindmapRoot");
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
        input.addEventListener("blur", () => finish(true));
        input.addEventListener("keydown", event => {
            event.stopPropagation();
            if (!event.isComposing && (event.key === "Enter" || event.key === "Escape")) {
                event.preventDefault();
                finish(event.key === "Enter");
            }
        });
        input.focus();
        input.select();
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
            element.style.visibility = "";
            if (save && value !== (relation.label || "")) {
                this.options.onRelationChange?.(relation.id, {label: value});
            }
        };
        this.finishRelationEdit = finish;
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

    public fit() {
        const width = this.viewport.clientWidth;
        const height = this.viewport.clientHeight;
        this.scale = Math.min(1, Math.max(.15, Math.min((width - 64) / this.bounds.width, (height - 64) / this.bounds.height)));
        this.offsetX = (width - this.bounds.width * this.scale) / 2;
        this.offsetY = (height - this.bounds.height * this.scale) / 2;
        this.draw();
    }

    private keyDown = (event: KeyboardEvent) => {
        const target = event.target as HTMLElement;
        if (event.isComposing || target.closest("input, textarea, select, .list-mindmap__node--editing")) {
            return;
        }
        if ((event.key === "Tab" || event.key === "Enter") && !this.options.readOnly &&
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
            this.cancelPointer();
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
        this.nodeElements.clear();
        this.relationElements.clear();
        this.options.host.replaceChildren();
    }
}
