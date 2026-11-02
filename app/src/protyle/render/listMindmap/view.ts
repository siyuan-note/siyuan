import {
    layoutListMindmap,
    ListMindmapLayoutNode,
    ListMindmapModel,
    ListMindmapNodeStyle,
    ListMindmapPosition,
    ListMindmapRelation,
    readListMindmap,
} from "./model";
import {routeMindmapRelation, routeManualMindmapRelation, adjustMindmapRoute,
    MindmapRoutePoint, MindmapManualRoute, MindmapRelationAnchor,
    projectMindmapRelationAnchor, getMindmapRelationAnchorPoint} from "./routing";
import {mathRender} from "../mathRender";
import {getAVRichTextSafeURL} from "../av/richTextValue";
import {Constants} from "../../../constants";
import {findMindmapDrop} from "./drop";
import {destroyTabsRender, tabsRender} from "../tabsRender";
import {getListMindmapFoldStates, getListMindmapSiblingFoldStates} from "./fold";
import type {ListMindmapFoldTarget} from "./fold";
import {clampMindmapPanOffset, clampMindmapPanPosition, MindmapPanRect} from "./pan";
import {getListMindmapSummarySelection, getListMindmapSummarySnapshot,
    layoutListMindmapSummaries, resolveListMindmapSummaryStyle} from "./summary";
import type {ListMindmapSummary, ListMindmapSummaryPosition, ListMindmapSummaryRange} from "./summary";
import {buildListMindmapConnectors, buildListMindmapSummaryConnector} from "./connectors";
import {getMindmapLineColor, getMindmapTextColor, isMindmapColor, resolveListMindmapColors} from "./appearance";
import type {ListMindmapViewport} from "./viewport";

export interface ListMindmapViewOptions {
    host: HTMLElement;
    model: ListMindmapModel;
    viewport?: ListMindmapViewport;
    onViewportChange?: (state: ListMindmapViewport) => void;
    readOnly?: boolean;
    onLockChange?: (locked: boolean) => Promise<boolean>;
    printLayout?: boolean;
    labels?: Record<string, string>;
    cdn?: string;
    onOpenLink?: (href: string, event: MouseEvent) => void;
    onPreviewImage?: (src: string, video?: string) => void;
    colors?: () => {label: string, value: string}[];
    nodeColors?: () => {
        label: string, color: string, backgroundColor: string,
        preview?: {color: string, backgroundColor: string},
    }[];
    onManageNodeColors?: (anchor: HTMLButtonElement) => void;
    onManageLineColors?: () => void;
    onFullscreen?: (enter: boolean, button: HTMLButtonElement) => void;
    onInteractionStart?: (event: PointerEvent) => () => void;
    onEdit?: (id: string, contentHost: HTMLElement, replaceFirstParagraph?: string) => void;
    onCopy?: (ids: string[], cut: boolean, event?: ClipboardEvent) => void;
    onPaste?: (id: string, kind: "child" | "sibling", data?: IClipboardData) => void;
    onClipboardMenu?: (anchor: HTMLElement, ids: string[]) => void;
    onDeleteNodes?: (ids: string[]) => void;
    isAddSiblingShortcut?: (event: KeyboardEvent) => boolean;
    isAddChildShortcut?: (event: KeyboardEvent) => boolean;
    onRootTitleChange?: (title: string) => void;
    finishEdit?: () => boolean | void | Promise<boolean | void>;
    onMove?: (id: string, targetId: string, placement: "before" | "child" | "after") => void;
    onAdd?: (id: string, kind: "child" | "sibling") => void;
    onDelete?: (id: string) => boolean | void | Promise<boolean | void>;
    onFold?: (id: string) => void;
    onFoldSiblings?: (id: string) => Promise<boolean>;
    onFoldLevel?: (level: ListMindmapFoldTarget) => Promise<boolean>;
    onExpandLevelMenu?: (anchor: HTMLElement, select: (level: ListMindmapFoldTarget) => void) => void;
    onSettingsMenu?: (anchor: HTMLElement, expand?: (level: ListMindmapFoldTarget) => void,
                      pan?: {active: boolean, toggle: () => void}) => void;
    onTaskToggle?: (id: string, cycle?: boolean) => void;
    onTaskMenu?: (id: string, anchor: HTMLElement) => void;
    onTabTaskToggle?: (id: string, itemId: string) => void;
    onTabTaskMenu?: (id: string, itemId: string, anchor: HTMLElement) => void;
    isTaskCycle?: (event: KeyboardEvent) => boolean;
    isTaskCompletionToggle?: (event: KeyboardEvent) => boolean;
    onNodeStyle?: (id: string, patch: Partial<ListMindmapNodeStyle>) => void;
    onNodesStyle?: (ids: string[], patch: Partial<ListMindmapNodeStyle>) => void;
    onNodeWidths?: (widths: {id: string, width: number}[], expected: string) => Promise<boolean>;
    onRelationAdd?: (from: string, to: string) => void;
    onRelationChange?: (id: string, patch: Partial<ListMindmapRelation>, expected?: string) => void;
    onRelationDelete?: (id: string) => void;
    onSummaryBatchAdd?: (ranges: ListMindmapSummaryRange[], expected: string) => Promise<string[] | undefined>;
    onSummaryChange?: (id: string, patch: Pick<Partial<ListMindmapSummary>, "label" | "color">, expected?: string) => void;
    onSummaryDelete?: (id: string) => void;
    onExit: () => void;
}

interface PointerState {
    pointerId: number;
    panButton?: boolean;
    pan?: boolean;
    id?: string;
    nodeId?: string;
    touchNode?: string;
    touchDragTimer?: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
    moved: boolean;
    hiddenControls?: HTMLElement[];
    selection?: string[];
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
        anchor?: MindmapRelationAnchor;
        routeFallback?: boolean;
    };
}

const createElement = <T extends keyof HTMLElementTagNameMap>(tag: T, className: string) => {
    const element = document.createElement(tag);
    element.className = className;
    return element;
};

export class ListMindmapView {
    private themeColors = new Map<string, ListMindmapNodeStyle>();
    private historyViewport?: {scale: number, x: number, y: number};
    private suppressPanContextMenu = false;
    private readonly options: ListMindmapViewOptions;
    private model: ListMindmapModel;
    private readonly viewport: HTMLDivElement;
    private readonly world: HTMLDivElement;
    private readonly canvas: HTMLCanvasElement;
    private readonly toolbar: HTMLDivElement;
    private readonly inspector: HTMLDivElement;
    private readonly inspectorPopover = createElement("div", "mindmap-view__inspector-popover");
    private inspectorPanel?: {
        kind: "color" | "width", ids: string[], anchor: HTMLButtonElement,
        widths: {id: string, width: number}[], baseWidth: number, slider: number, preview: boolean,
    };
    private widthPending = false;
    private inspectorFrame = 0;
    private revealInspectorHost = false;
    private readonly zoomLabel: HTMLSpanElement;
    private readonly zoomSlider = createElement("input", "b3-slider");
    private readonly nodeElements = new Map<string, HTMLDivElement>();
    private readonly nestedViews = new Map<string, ListMindmapView[]>();
    private readonly previewID = `mindmap-view-${Lute.NewNodeID()}-`;
    private readonly relationElements = new Map<string, HTMLButtonElement>();
    private readonly summaryElements = new Map<string, HTMLDivElement>();
    private summaryPositions = new Map<string, ListMindmapSummaryPosition>();
    private selectedSummary?: string;
    private summaryPending = false;
    private readonly selectionBox = createElement("div", "mindmap-view__selection-box");
    private readonly documentViewport = createElement("div", "mindmap-view__document-viewport");
    private readonly documentViewportSurface = createElement("div", "mindmap-view__document-viewport-surface");
    private finishSummaryEdit?: (save: boolean) => void;
    private editingSummary?: string;
    private readonly buttons = new Map<string, HTMLButtonElement>();
    private readonly folded = new Map<string, boolean>();
    private levelSelect?: HTMLSelectElement;
    private readonly tooltip = createElement("div", "tooltip mindmap-view__tooltip");
    private tooltipButton?: HTMLButtonElement;
    private readonly colorProbe = createElement("span", "mindmap-view__color-probe");
    private positions = new Map<string, ListMindmapPosition>();
    private foldOpacities?: Map<string, number>;
    private stopFoldAnimation?: () => void;
    private edges: {from: string, to: string}[] = [];
    private bounds = {width: 1, height: 1};
    private selectedId?: string;
    private readonly selectedIds = new Set<string>();
    private multiSelect = false;
    private pasteSibling = false;
    private selectedRelation?: string;
    private selectedEdge?: string;
    private hoveredLine?: string;
    private finishRelationEdit?: (save: boolean) => void;
    private linePaths: {id: string, relation: boolean, summary?: boolean, path: Path2D, arrows?: MindmapRoutePoint[]}[] = [];
    private relationRoutes = new Map<string, MindmapRoutePoint[]>();
    private anchorFallbackRoutes = new Set<string>();
    private readonly routeHandles = new Map<string, HTMLButtonElement>();
    private readonly routeStatus = createElement("div", "mindmap-view__route-status");
    private readonly fallbackRoutes = new Set<string>();
    private routeDragFrame = 0;
    private relationFrom?: string;
    private relationPreview?: {x: number, y: number, targetId?: string};
    private editingId?: string;
    private readonly selectionInput = createElement("div", "b3-text-field mindmap-view__selection-input");
    private selectionInputId?: string;
    private selectionInputRevision = 0;
    private selectionCompositionRevision = 0;
    private selectionComposing = false;
    private selectionCompositionEnding = false;
    private touchInput = false;
    private pointer?: PointerState;
    private pointerCapture?: HTMLElement;
    private pinching = false;
    private pinch?: {distance: number, scale: number, x: number, y: number, zooming?: boolean};
    private pendingPointerId?: number;
    private endInteraction?: () => void;
    private linkTimer = 0;
    private suppressLinkClick = false;
    private ghost?: HTMLDivElement;
    private scale = 1;
    private panning = false;
    private interactionActive = false;
    private locked = false;
    private persistedLocked = false;
    private offsetX = 0;
    private offsetY = 0;
    private foldAnchor?: {id: string, collapsed: boolean};
    private frame = 0;
    private drawFrame = 0;
    private initialFit = true;
    private destroyed = false;
    private readonly resizeObserver: ResizeObserver;
    private fullscreenMarker?: Comment;
    private documentView?: {scale: number, center: {x: number, y: number}, width: number, height: number};
    private documentScroll?: {element: HTMLElement, left: number, top: number}[];
    private viewportCenter?: {x: number, y: number};
    private viewportSize?: {width: number, height: number};
    private readonly disposers: (() => void)[] = [];
    private printTransform?: {scale: number, offsetX: number, offsetY: number};

    constructor(options: ListMindmapViewOptions) {
        this.options = options;
        this.model = options.model;
        this.locked = this.persistedLocked = !!options.model.metadata.viewLocked;
        this.selectedId = options.model.root.id;
        options.host.classList.add("mindmap-view");
        options.host.classList.remove("mindmap-view--active");
        options.host.contentEditable = "false";
        options.host.setAttribute("role", "group");
        options.host.setAttribute("aria-label", this.label("mindmap"));
        options.host.tabIndex = 0;
        this.toolbar = createElement("div", "mindmap-view__toolbar block__icons");
        this.toolbar.setAttribute("role", "toolbar");
        this.toolbar.setAttribute("data-prevent-swipe", "true");
        this.viewport = createElement("div", "mindmap-view__viewport");
        this.viewport.setAttribute("data-prevent-swipe", "true");
        this.canvas = createElement("canvas", "mindmap-view__canvas");
        this.canvas.setAttribute("aria-hidden", "true");
        this.world = createElement("div", "mindmap-view__world");
        this.inspector = createElement("div", "mindmap-view__inspector");
        this.inspector.setAttribute("data-prevent-swipe", "true");
        this.inspector.hidden = true;
        this.inspectorPopover.hidden = true;
        this.inspectorPopover.setAttribute("role", "group");
        this.inspectorPopover.setAttribute("data-prevent-swipe", "true");
        this.zoomLabel = createElement("span", "mindmap-view__zoom");
        this.documentViewport.hidden = true;
        this.documentViewport.setAttribute("aria-hidden", "true");
        this.viewport.append(this.canvas, this.world, this.documentViewport, this.documentViewportSurface);
        this.selectionInput.contentEditable = "plaintext-only";
        this.selectionInput.tabIndex = -1;
        this.selectionInput.hidden = true;
        this.selectionInput.setAttribute("role", "textbox");
        this.selectionInput.setAttribute("aria-label", this.label("text"));
        this.world.append(this.selectionInput);
        this.tooltip.hidden = true;
        this.tooltip.setAttribute("role", "tooltip");
        this.colorProbe.setAttribute("aria-hidden", "true");
        this.routeStatus.hidden = true;
        this.routeStatus.setAttribute("role", "status");
        options.host.append(this.toolbar, this.viewport, this.inspector, this.inspectorPopover,
            this.tooltip, this.colorProbe, this.routeStatus);
        this.listen(this.inspector, "scroll", () => this.closeInspectorPanel());
        this.listen(this.inspectorPopover, "mousedown", (event: MouseEvent) => {
            // 面板按钮保留输入焦点，恢复和默认操作直接替换未提交的宽度预览。
            if ((event.target as Element).closest("button")) {
                event.preventDefault();
            }
        });
        this.listen(this.inspectorPopover, "keydown", (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                const anchor = this.inspectorPanel?.anchor;
                this.closeInspectorPanel();
                anchor?.focus({preventScroll: true});
                event.preventDefault();
                event.stopPropagation();
            }
        });
        this.selectionBox.hidden = true;
        this.viewport.append(this.selectionBox);
        this.createToolbar();
        this.listen(document, "pointerdown", this.dismissControls, {capture: true});
        this.listen(options.host, "pointerdown", (event: PointerEvent) => {
            this.touchInput = event.pointerType === "touch";
        }, {capture: true});
        this.listen(options.host, "focus", () => queueMicrotask(() => {
            // 等待调用方交接选区，避免嵌套 focus 被浏览器恢复到不可编辑的画布。
            if (!this.destroyed && document.activeElement === options.host) {
                this.focusSelectionInput();
            }
        }));
        this.listen(this.selectionInput, "compositionstart", () => {
            this.selectionComposing = true;
            this.selectionCompositionRevision = this.selectionInputRevision;
        });
        this.listen(this.selectionInput, "compositionend", () => {
            this.selectionComposing = false;
            this.selectionCompositionEnding = true;
            const revision = this.selectionCompositionRevision;
            // 等待浏览器写入最后一次 input，整个组词过程保持同一输入目标。
            queueMicrotask(() => {
                this.selectionCompositionEnding = false;
                if (revision === this.selectionInputRevision) {
                    this.commitSelectionInput();
                } else if (!this.selectionComposing) {
                    this.selectionInput.textContent = "";
                }
            });
        });
        this.listen(this.selectionInput, "input", (event: InputEvent) => {
            if (!event.isComposing && !this.selectionComposing && !this.selectionCompositionEnding) {
                this.commitSelectionInput();
            }
        });
        this.listen(options.host, "pointerdown", this.activatePointer, {capture: true});
        this.listen(options.host, "click", this.activatePointer, {capture: true});
        this.listen(options.host, "click", (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            // 点击完成后再滚动文档，避免节点拖动、双指缩放和控件操作改变阅读位置。
            if (!this.panning && !this.pinching && !this.suppressLinkClick &&
                target.closest(".mindmap-view") === options.host && this.viewport.contains(target) &&
                !target.closest("input, select, textarea, a, audio, video, iframe, .mindmap-view__node--editing") &&
                (!target.closest("button") || target.closest(".mindmap-view__relation"))) {
                this.queueInspectorLayout(true);
            }
        }, {capture: true});
        this.listen(document, "scroll", (event: Event) => {
            if (event.target === document || event.target instanceof Element && event.target.contains(options.host)) {
                this.queueInspectorLayout();
            }
        }, {capture: true, passive: true});
        this.listen(window, "resize", () => this.queueInspectorLayout());
        if (window.visualViewport) {
            this.listen(window.visualViewport, "resize", () => this.queueInspectorLayout());
            this.listen(window.visualViewport, "scroll", () => this.queueInspectorLayout());
        }
        this.listen(options.host, "focusout", (event: FocusEvent) => {
            if (event.relatedTarget instanceof Node && !options.host.contains(event.relatedTarget)) {
                this.setInteractionActive(false);
            }
        });
        this.listen(options.host, "pointerover", this.showButtonTooltip);
        this.listen(options.host, "focusin", this.showButtonTooltip);
        ["pointerout", "focusout"].forEach(type => this.listen(options.host, type, this.hideButtonTooltip));
        this.listen(options.host, "wheel", () => this.tooltip.hidden = true);
        ["pointerdown", "keydown"].forEach(type =>
            this.listen(options.host, type, () => this.stopFoldAnimation?.(), {capture: true}));
        const refreshTheme = () => {
            if (this.model.metadata.appearance?.nodeStyle) {
                this.updateColors();
            }
            this.refreshLayout();
        };
        const themeObserver = new MutationObserver(refreshTheme);
        themeObserver.observe(document.documentElement, {attributes: true, attributeFilter: ["data-theme-mode", "style"]});
        themeObserver.observe(document.head, {childList: true, subtree: true, characterData: true, attributes: true});
        this.disposers.push(() => themeObserver.disconnect());
        this.listen(document.head, "load", refreshTheme, {capture: true});
        this.listen(this.viewport, "pointerdown", this.pointerDown);
        this.listen(this.viewport, "pointermove", this.pointerMove);
        this.listen(this.viewport, "pointerleave", () => this.setHoveredLine());
        this.listen(this.viewport, "pointerup", this.pointerUp);
        this.listen(this.viewport, "auxclick", (event: MouseEvent) => {
            if (event.button === 1 && this.isPanTarget(event as PointerEvent)) {
                event.preventDefault();
            }
        });
        this.listen(this.viewport, "touchstart", this.pinchStart, {passive: false});
        this.listen(this.viewport, "touchmove", this.pinchMove, {passive: false});
        this.listen(this.viewport, "touchend", this.pinchEnd, {passive: false});
        this.listen(this.viewport, "touchcancel", this.pinchEnd, {passive: false});
        this.listen(this.viewport, "touchcancel", this.cancelPointer);
        this.listen(window, "blur", () => {
            this.pinching = false;
            this.pinch = undefined;
            this.setInteractionActive(false);
        });
        this.listen(this.viewport, "contextmenu", (event: MouseEvent) => {
            if (this.suppressPanContextMenu || this.pointer?.touchNode) {
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
        this.listen(options.host, "copy", this.copySelection);
        this.listen(options.host, "cut", this.copySelection);
        this.listen(options.host, "paste", this.pasteSelection);
        this.listen(options.host, "keyup", () => this.pasteSibling = false);
        // 脑图内部先处理交互，再阻止外层文档将节点操作识别为列表块编辑。
        ["pointerdown", "pointerup", "pointermove", "pointercancel", "mousedown", "mouseup", "mousemove", "click",
            "dblclick", "contextmenu", "dragstart", "dragover", "drop", "beforeinput", "input", "compositionstart",
            "compositionupdate", "compositionend", "copy", "cut", "paste", "focusin", "focusout", "keydown", "keyup",
            "wheel"].forEach(type => this.listen(options.host, type, event => {
                // 未由脑图处理的按键交给应用快捷键入口，组合输入仍留在节点编辑器内。
                if (type === "keydown" && !event.defaultPrevented && !(event as KeyboardEvent).isComposing) {
                    return;
                }
                if (type === "click" && !event.defaultPrevented && !this.options.onOpenLink &&
                    (event.target as Element).closest(".mindmap-view__content a[href]")) {
                    return;
                }
                event.stopPropagation();
            }));
        this.listen(window, "beforeprint", () => {
            this.stopFoldAnimation?.();
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
                    this.options.host.style.removeProperty("--mindmap-view-print-height");
                    this.draw();
                }
            }
        });
        this.resizeObserver = new ResizeObserver(entries => {
            this.updateToolbarLayout();
            // 展开会让隐藏节点恢复尺寸；布局已测量这些节点，不应被同一尺寸的通知中断动画。
            const resized = entries.some(({target}) => {
                if (target === this.viewport) {
                    return true;
                }
                const element = target as HTMLElement;
                const position = this.positions.get(element.dataset.mindmapId) ||
                    this.summaryPositions.get(element.dataset.summaryId);
                return !element.hidden && position && (!this.stopFoldAnimation ||
                    element.offsetWidth !== position.width || element.offsetHeight !== position.height);
            });
            if (resized) {
                this.refreshLayout();
            }
            this.queueInspectorLayout();
        });
        this.resizeObserver.observe(this.viewport);
        // 分屏和面板调整会改变外层裁剪范围，即使画布自身尺寸没有变化也要更新浮层。
        for (let parent = options.host.parentElement; parent; parent = parent.parentElement) {
            this.resizeObserver.observe(parent);
        }
        this.update(this.model);
    }

    private label(key: string) {
        return this.options.labels?.[key] || window.siyuan?.languages?.[key] || key;
    }

    private listen(target: EventTarget, event: string, handler: EventListener, options?: AddEventListenerOptions) {
        target.addEventListener(event, handler, options);
        this.disposers.push(() => target.removeEventListener(event, handler, options));
    }

    private makeButton(key: string, icon: string, action: (event: MouseEvent) => void, className = "", finish = true) {
        const button = createElement("button", "block__icon block__icon--show " + className);
        button.type = "button";
        button.setAttribute("aria-label", this.label(key));
        // 图标引用现有图标集，避免复制或生成路径数据。
        if (icon) {
            button.innerHTML = `<svg aria-hidden="true"><use xlink:href="#${icon}"></use></svg>`;
        }
        button.addEventListener("click", (event) => {
            event.stopPropagation();
            if (finish) {
                this.finishThen(() => action(event));
            } else {
                action(event);
            }
        });
        return button;
    }

    private showButtonTooltip = (event: Event) => {
        const button = (event.target as Element).closest<HTMLButtonElement>("button[aria-label]");
        if (!button || button.closest(".mindmap-view") !== this.options.host ||
            !(this.toolbar.contains(button) || this.inspector.contains(button) || this.inspectorPopover.contains(button) ||
                button.classList.contains("mindmap-view__add-child") || button.classList.contains("mindmap-view__fold"))) {
            this.tooltip.hidden = true;
            return;
        }
        if (this.tooltipButton === button && !this.tooltip.hidden) {
            return;
        }
        this.tooltipButton = button;
        this.tooltip.textContent = button.dataset.tooltip || button.getAttribute("aria-label");
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
        if (!this.selectedId && !this.selectedRelation && !this.selectedEdge && !this.relationFrom &&
            !this.selectedSummary) {
            return;
        }
        this.selectedId = undefined;
        this.selectedRelation = undefined;
        this.selectedEdge = undefined;
        this.relationFrom = undefined;
        this.selectedSummary = undefined;
        this.updateSelection();
    }

    private dismissControls = (event: PointerEvent) => {
        const target = event.target as Node;
        this.tooltip.hidden = true;
        if (!this.inspectorPopover.contains(target) && !this.inspectorPanel?.anchor.contains(target)) {
            this.closeInspectorPanel();
        }
        if (!this.options.host.contains(target)) {
            this.setInteractionActive(false);
        }
        if ((this.editingId || this.isTemporaryPan(event)) && this.isPanTarget(event)) {
            return;
        }
        if ((event.ctrlKey || event.metaKey) && event.button === 0 && this.viewport.contains(target)) {
            return;
        }
        if (target instanceof Element && target.closest(".mindmap-view__relation-editor, .mindmap-view__route-handle, .mindmap-view__summary-editor")) {
            return;
        }
        if (this.inspector.contains(target) || this.inspectorPopover.contains(target) || this.buttons.get("style")?.contains(target) ||
            this.buttons.get("relation")?.contains(target) || this.buttons.get("expandLevel")?.contains(target) ||
            this.buttons.get("summary")?.contains(target) || this.buttons.get("multiSelect")?.contains(target) ||
            this.levelSelect?.contains(target)) {
            return;
        }
        this.inspector.hidden = true;
        const node = target instanceof Element && target.closest(".mindmap-view__node, .mindmap-view__relation, .mindmap-view__summary");
        if (!node || !this.options.host.contains(node)) {
            this.clearSelection();
        }
    };

    private finishThen(action: () => void) {
        this.finishSummaryEdit?.(true);
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
        this.refreshControls();
        this.update(this.model);
    }

    public isLocked() {
        return this.locked;
    }

    public finishLabels() {
        this.finishSummaryEdit?.(true);
        this.finishRelationEdit?.(true);
    }

    private activatePointer = (event: PointerEvent) => {
        const target = event.target as Element;
        if (this.pinching || target.closest(".mindmap-view") !== this.options.host ||
            this.buttons.get("lock")?.contains(target) || this.isTemporaryPan(event)) {
            return;
        }
        // 触屏在点按完成后激活，按下时仍允许浏览器处理文档滑动。
        if (event.type === "click" || event.pointerType !== "touch" || target.closest("button, input, select")) {
            this.setInteractionActive(true);
        }
    };

    private setInteractionActive(value: boolean) {
        value = (value || !!this.fullscreenMarker) && !this.locked;
        this.interactionActive = value;
        this.options.host.classList.toggle("mindmap-view--active", value);
        if (!value) {
            this.closeInspectorPanel();
            const selecting = !!this.relationFrom || this.multiSelect;
            const inspectorVisible = !this.inspector.hidden;
            this.multiSelect = false;
            this.pinching = false;
            this.pinch = undefined;
            this.cancelPointer();
            this.setPanning(false);
            this.relationFrom = undefined;
            this.relationPreview = undefined;
            this.inspector.hidden = true;
            if (selecting) {
                this.updateSelection();
            } else if (inspectorVisible) {
                this.draw();
            }
        }
    }

    private get readOnly() {
        return this.locked || this.options.readOnly;
    }

    private setLocked(value: boolean) {
        this.locked = value;
        if (value) {
            this.documentViewport.hidden = true;
        }
        this.setInteractionActive(false);
        this.pinching = false;
        this.pinch = undefined;
        this.setPanning(false);
        this.clearSelection();
        this.refreshControls();
    }

    private refreshControls() {
        const value = !!this.readOnly;
        this.finishSummaryEdit?.(false);
        this.multiSelect = false;
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
            const addChild = element.querySelector<HTMLButtonElement>(".mindmap-view__add-child");
            addChild.hidden = value;
            addChild.disabled = value;
            element.querySelector<HTMLElement>(".mindmap-view__add-bridge").hidden = value;
            const task = element.querySelector<HTMLButtonElement>(".mindmap-view__task");
            if (task) {
                task.disabled = value;
            }
        });
    }

    private createToolbar() {
        const controls = createElement("div", "mindmap-view__toolbar-group");
        const add = (id: string, key: string, icon: string, action: () => void, nodeAction = false, finish = true) => {
            const button = this.makeButton(key, icon, action, "", finish);
            this.buttons.set(id, button);
            if (nodeAction) {
                button.className = "color__square";
                button.querySelector("svg").classList.add("svg--mid");
            } else {
                controls.append(button);
            }
        };
        const addFullscreen = () => {
            add("documentLayout", "listMindmapDocumentLayout", "iconSelectAll", () => {
                if (!this.fullscreenMarker || !this.documentView || this.locked) {
                    return;
                }
                this.stopFoldAnimation?.();
                this.documentViewport.hidden = !this.documentViewport.hidden;
                const button = this.buttons.get("documentLayout");
                button.setAttribute("aria-pressed", String(!this.documentViewport.hidden));
                button.classList.toggle("block__icon--active", !this.documentViewport.hidden);
                this.updateDocumentViewport();
            });
            const preview = this.buttons.get("documentLayout");
            preview.hidden = !this.fullscreenMarker || !this.documentView || this.locked;
            preview.setAttribute("aria-pressed", String(!this.documentViewport.hidden));
            preview.classList.toggle("block__icon--active", !this.documentViewport.hidden);
            add("fullscreen", "fullscreen", "iconFullscreen", () => this.toggleFullscreen());
        };
        this.toolbar.append(createElement("span", "mindmap-view__spacer fn__flex-1"), controls);
        this.levelSelect = undefined;
        this.options.host.classList.toggle("mindmap-view--locked", this.locked);
        add("lock", this.locked ? "listMindmapUnlock" : "listMindmapLock", this.locked ? "iconLock" : "iconUnlock", () => {
            this.finishRelationEdit?.(true);
            const locked = !this.locked;
            const button = this.buttons.get("lock");
            button.disabled = true;
            void Promise.resolve(this.options.onLockChange?.(locked)).then(result => {
                if (result !== false && !this.destroyed) {
                    this.setLocked(locked);
                    this.update(this.model);
                }
            }).catch(error => console.error(error)).finally(() => button.disabled = false);
        });
        this.buttons.get("lock").setAttribute("aria-pressed", String(this.locked));
        this.buttons.get("lock").classList.toggle("block__icon--active", this.locked);
        this.buttons.get("lock").setAttribute("data-subtype", this.locked ? "lock" : "unlock");
        if (this.locked) {
            addFullscreen();
            return;
        }
        if (!this.readOnly) {
            add("multiSelect", "multiSelect", "iconSelect", () => {
                this.setInteractionActive(true);
                this.cancelPointer();
                this.setPanning(false);
                if (!this.multiSelect && this.inspector.hidden) {
                    this.clearSelection();
                }
                this.relationFrom = undefined;
                this.multiSelect = !this.multiSelect;
                this.updateSelection();
            });
            this.buttons.get("multiSelect").setAttribute("aria-pressed", String(this.multiSelect));
            add("summary", "listMindmapSummary", "iconGroups", () => void this.createSummary(), true);
            add("relation", "connect", "iconRoute", () => {
                this.setInteractionActive(true);
                this.setPanning(false);
                this.inspector.hidden = true;
                this.multiSelect = false;
                this.relationFrom = this.relationFrom ? undefined : this.selectedId;
                this.relationPreview = undefined;
                this.updateSelection();
            }, true);
        }
        add("expandLevel", "expandLevel", "iconExpandLevel", () => {
            const selectedId = this.selectedId;
            this.options.onExpandLevelMenu?.(this.buttons.get("expandLevel"),
                level => this.finishThen(() => {
                    void this.expandToLevel(level, selectedId).catch(error => console.error(error));
                }));
        });
        this.buttons.get("expandLevel").setAttribute("aria-haspopup", "menu");
        if (!this.options.onExpandLevelMenu) {
            // 独立导出页面使用原生选择菜单，不依赖应用菜单或移动端框架。
            const control = createElement("div", "mindmap-view__level-control");
            this.levelSelect = createElement("select", "mindmap-view__level-select");
            this.levelSelect.setAttribute("aria-label", this.label("expandLevel"));
            this.levelSelect.addEventListener("change", () => {
                const value = this.levelSelect.value;
                const level = value === "expandAll" || value === "foldAll" ? value : Number(value);
                this.levelSelect.value = "";
                this.finishThen(() => void this.expandToLevel(level).catch(error => console.error(error)));
            });
            const button = this.buttons.get("expandLevel");
            button.tabIndex = -1;
            button.setAttribute("aria-hidden", "true");
            button.before(control);
            control.append(button, this.levelSelect);
        }
        add("pan", "cursorHand", "iconPan", () => this.togglePanning());
        this.setPanning(this.panning);
        const zoomControl = createElement("div", "mindmap-view__zoom-control");
        const zoomActions = createElement("div", "mindmap-view__zoom-actions");
        this.zoomLabel.tabIndex = 0;
        this.zoomLabel.setAttribute("aria-label", this.label("zoom"));
        this.zoomSlider.type = "range";
        this.zoomSlider.min = "15";
        this.zoomSlider.max = "250";
        this.zoomSlider.step = "1";
        this.zoomSlider.setAttribute("aria-label", this.label("zoom"));
        this.zoomSlider.oninput = () => this.zoomAt(Number(this.zoomSlider.value) / 100);
        const reset = this.makeButton("reset", "iconRefresh", () => this.zoomAt(1));
        const fit = this.makeButton("listMindmapFit", "iconFocus", () => this.fit());
        this.buttons.set("fit", fit);
        zoomActions.append(this.zoomSlider, reset, fit);
        zoomControl.append(this.zoomLabel, zoomActions);
        controls.append(zoomControl);
        addFullscreen();
        if (this.options.onSettingsMenu) {
            add("settings", "more", "iconMore", () => {
                const selectedId = this.selectedId;
                const panning = this.panning;
                this.options.onSettingsMenu(this.buttons.get("settings"),
                    this.buttons.get("expandLevel").hidden ? level => this.finishThen(() => {
                        void this.expandToLevel(level, selectedId).catch(error => console.error(error));
                    }) : undefined, {active: panning, toggle: () => this.togglePanning(!panning)});
            });
            this.buttons.get("settings").setAttribute("aria-haspopup", "menu");
        }
        this.updateToolbarLayout();
    }

    private updateToolbarLayout() {
        const expand = this.buttons.get("expandLevel");
        if (expand && this.options.onSettingsMenu && !this.readOnly) {
            expand.hidden = this.viewport.clientWidth > 0 && this.viewport.clientWidth < 360;
            if (this.levelSelect) {
                this.levelSelect.parentElement.hidden = expand.hidden;
            }
        }
        this.queueInspectorLayout();
    }

    private togglePanning(value = !this.panning) {
        this.finishThen(() => {
            if (this.locked || this.destroyed) {
                return;
            }
            this.setInteractionActive(true);
            this.finishRelationEdit?.(true);
            this.cancelPointer();
            this.setPanning(value);
            this.relationFrom = undefined;
            this.relationPreview = undefined;
            this.inspector.hidden = true;
            this.updateSelection();
        });
    }

    private setPanning(value: boolean) {
        if (value) {
            this.multiSelect = false;
        }
        this.panning = value;
        this.options.host.classList.toggle("mindmap-view--pan", value);
        this.viewport.classList.toggle("mindmap-view__viewport--pan", value);
        const button = this.buttons.get("pan");
        if (button) {
            button.hidden = !!this.options.onSettingsMenu && !value;
        }
        button?.classList.toggle("block__icon--active", value);
        button?.setAttribute("aria-pressed", String(value));
    }

    public update(model: ListMindmapModel) {
        this.stopFoldAnimation?.();
        if (this.pointer?.relation || this.pointer?.selection || this.pointer?.touchNode) {
            this.cancelPointer();
        }
        if (this.destroyed) {
            return;
        }
        this.model = model;
        this.selectedIds.forEach(id => {
            if (!model.nodes.has(id)) {
                this.selectedIds.delete(id);
            }
        });
        if (!!model.metadata.viewLocked !== this.persistedLocked) {
            this.persistedLocked = !!model.metadata.viewLocked;
            this.setLocked(this.persistedLocked);
        }
        if (this.levelSelect) {
            const placeholder = new Option(this.label("expandLevel"), "");
            placeholder.disabled = true;
            this.levelSelect.replaceChildren(placeholder);
            this.levelSelect.add(new Option(this.label("expandAll"), "expandAll"));
            this.levelSelect.add(new Option(this.label("foldAll"), "foldAll"));
            for (let level = 1; level <= 6; level++) {
                this.levelSelect.add(new Option(this.label("listMindmapExpandToLevel").replace("${level}", String(level)),
                    String(level)));
            }
            this.levelSelect.value = "";
        }
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
                this.destroyContentViews(id);
                this.resizeObserver.unobserve(element);
                element.remove();
                this.nodeElements.delete(id);
            }
        });
        model.nodes.forEach((node, id) => {
            let element = this.nodeElements.get(id);
            if (!element) {
                element = createElement("div", "mindmap-view__node");
                element.dataset.mindmapId = id;
                element.setAttribute("role", "treeitem");
                element.append(createElement("div", "mindmap-view__content"));
                const addBridge = createElement("span", "mindmap-view__add-bridge");
                addBridge.hidden = !!this.readOnly;
                addBridge.setAttribute("aria-hidden", "true");
                element.append(addBridge);
                const fold = this.makeButton("collapse", "iconLeft", event => {
                    if (event.altKey) {
                        void this.toggleSiblingFold(id).catch(error => console.error(error));
                    } else {
                        this.toggleFold(id);
                    }
                }, "mindmap-view__fold");
                fold.append(createElement("span", "mindmap-view__fold-count"));
                element.append(fold);
                const addChild = this.makeButton("listMindmapChild", "iconAdd", () => {
                    if (!this.readOnly && this.model.nodes.has(id)) {
                        this.options.onAdd?.(id, "child");
                    }
                }, "mindmap-view__add-child");
                addChild.hidden = !!this.readOnly;
                addChild.disabled = !!this.readOnly;
                element.append(addChild);
                this.nodeElements.set(id, element);
                this.world.append(element);
                this.resizeObserver.observe(element);
            }
            element.classList.toggle("mindmap-view__node--virtual", node.virtual);
            element.classList.toggle("mindmap-view__node--untitled", node.virtual && !model.metadata.rootTitle);
            if (node.virtual) {
                element.setAttribute("aria-label", model.metadata.rootTitle || this.label("listMindmapRoot"));
            }
            element.classList.toggle("mindmap-view__node--root", id === model.root.id);
            this.renderTask(element, id);
            element.classList.toggle("mindmap-view__node--branch", node.children.length > 0);
            const style = model.metadata.nodes[id];
            element.style.width = style?.width ? `${Math.max(32, style.width)}px` : "";
            element.style.maxWidth = style?.width ? "none" : "";
            const collapsed = this.folded.get(id) ?? node.collapsed;
            element.setAttribute("aria-expanded", String(!collapsed));
            const fold = element.querySelector<HTMLButtonElement>(".mindmap-view__fold");
            fold.hidden = !node.children.length;
            fold.classList.toggle("mindmap-view__fold--closed", collapsed);
            fold.setAttribute("aria-label", this.label(collapsed ? "expand" : "collapse"));
            fold.querySelector("span").textContent = String(descendants.get(id));
            if (id !== this.editingId) {
                const content = this.getContentHost(id);
                const activeTabs = new Map<string, string>();
                content.querySelectorAll<HTMLElement>('.tab-item[data-tabs-hidden="false"]').forEach(item => {
                    activeTabs.set(item.parentElement.id, item.id);
                });
                this.destroyContentViews(id);
                content.replaceChildren();
                const sourceTabIDs = new Map<string, string>();
                if (node.virtual) {
                    content.textContent = this.model.metadata.rootTitle || "";
                } else {
                    node.contentBlocks.forEach((block) => {
                        let clone = block.cloneNode(true) as HTMLElement;
                        const sourceCanvases = block.querySelectorAll("canvas");
                        clone.querySelectorAll("canvas").forEach((canvas, index) => {
                            const source = sourceCanvases[index];
                            if (source.width && source.height) {
                                canvas.getContext("2d")?.drawImage(source, 0, 0);
                            }
                        });
                        const previewTabIDs = new Map<string, string>();
                        // 嵌套脑图使用独立模型生成静态预览，双击仍由外层节点打开正文编辑。
                        const nested: {host: HTMLElement, model: ListMindmapModel}[] = [];
                        const selector = '[data-type="NodeMindmap"], [data-type="NodeList"][custom-sy-list-mindmap="1"]';
                        const nestedLists = Array.from(clone.querySelectorAll<HTMLElement>(selector));
                        if (clone.matches(selector)) {
                            nestedLists.unshift(clone);
                        }
                        nestedLists.filter(list => !list.parentElement?.closest(selector)).forEach(list => {
                            const host = createElement("div", "mindmap-view--nested");
                            nested.push({host, model: readListMindmap(list)});
                            if (list === clone) {
                                clone = host;
                            } else {
                                list.replaceWith(host);
                            }
                        });
                        // 富文本单元格的列表标记保留为只读内容，其他编辑控件不进入预览。
                        clone.querySelectorAll(".protyle-attr, .protyle-action:not(.li[data-table-cell-node] > .protyle-action), " +
                            ".protyle-action__table, .protyle-icons, .protyle-image-resize, .mindmap-view")
                            .forEach(item => item.remove());
                        [clone, ...Array.from(clone.querySelectorAll<HTMLElement>("*"))].forEach((item) => {
                            item.classList.remove("img--select", "img--drag", "protyle-image-container--compact");
                            // 页签预览使用独立 DOM 标识切换正文，不携带可提交事务的块身份。
                            if (["NodeTabs", "NodeTabItem"].includes(item.getAttribute("data-type"))) {
                                item.id = this.previewID + item.getAttribute("data-node-id");
                                previewTabIDs.set(item.getAttribute("data-node-id"), item.id);
                                sourceTabIDs.set(item.id, item.getAttribute("data-node-id"));
                            }
                            if (item.hasAttribute("data-node-id")) {
                                item.classList.add("mindmap-view__preview-block");
                                item.dataset.mindmapSourceId = item.dataset.nodeId;
                            }
                            if (item.hasAttribute("spellcheck")) {
                                // 行级公式末尾的单个换行用于放置光标，预览不把它显示成额外空行。
                                const last = item.lastChild;
                                if (last?.nodeType === Node.TEXT_NODE && last.textContent === "\n" &&
                                    last.previousSibling instanceof Element &&
                                    last.previousSibling.matches('[data-type~="inline-math"]')) {
                                    last.remove();
                                }
                                item.classList.add("mindmap-view__text");
                                item.classList.toggle("mindmap-view__text--trailing-newline",
                                    item.textContent.endsWith("\n") && !item.closest(".hljs"));
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
                        nested.forEach(({host, model}) => {
                            const view = new ListMindmapView({host, model, readOnly: true,
                                printLayout: this.options.printLayout, labels: this.options.labels,
                                cdn: this.options.cdn, onExit: () => {}});
                            host.setAttribute("role", "img");
                            host.setAttribute("aria-label", Array.from(model.nodes.values()).map(node =>
                                node.virtual ? model.metadata.rootTitle || "" :
                                    node.contentBlocks.map(block => block.textContent).join("\n")).join("\n") || this.label("mindmap"));
                            Array.from(host.children).forEach((child: HTMLElement) => child.inert = true);
                            host.tabIndex = -1;
                            const views = this.nestedViews.get(id) || [];
                            views.push(view);
                            this.nestedViews.set(id, views);
                        });
                    });
                }
                const hasBlankLines = node.contentBlocks.length > 1 || content.textContent.includes("\n") ||
                    content.querySelectorAll("br").length > 1;
                const empty = !node.virtual && !hasBlankLines && !content.textContent.replace(/[\u200b\ufeff]/g, "").trim() &&
                    !content.querySelector("img, svg, video, audio, iframe, canvas, hr, [data-content]");
                content.classList.toggle("mindmap-view__content--empty", empty);
                content.dataset.placeholder = this.label("listMindmapPlaceholder");
                if (content.querySelector('.tabs[data-type="NodeTabs"]')) {
                    tabsRender(content, {
                        label: this.label("tabItem"),
                        readonly: () => true,
                        taskReadonly: () => !!this.readOnly || !this.options.onTabTaskToggle,
                        taskLabel: this.label("taskList"),
                        task: item => {
                            const itemId = sourceTabIDs.get(item.id);
                            if (!this.readOnly && itemId) {
                                this.options.onTabTaskToggle?.(id, itemId);
                            }
                        },
                        taskMenu: item => {
                            const itemId = sourceTabIDs.get(item.id);
                            const anchor = content.querySelector<HTMLElement>(`.tabs-task[data-tab-id="${item.id}"]`);
                            if (!this.readOnly && itemId && anchor) {
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
        if (this.selectedSummary && !model.metadata.summaries?.some(summary => summary.id === this.selectedSummary)) {
            this.selectedSummary = undefined;
            this.inspector.hidden = true;
        }
        this.updateColors();
        this.updateRelations();
        this.updateSummaries();
        this.updateSelection();
        this.renderInspector();
        this.refreshLayout();
    }

    // 主题变更只刷新节点外观，保留正在编辑的正文和画布状态。
    private updateColors() {
        if (this.destroyed) {
            return;
        }
        this.viewport.style.backgroundColor = this.model.metadata.appearance?.backgroundColor || "";
        const canvasForeground = this.model.metadata.appearance?.backgroundColor ?
            getMindmapTextColor(this.model.metadata.appearance.backgroundColor) : undefined;
        this.themeColors = resolveListMindmapColors(this.model, getComputedStyle(this.options.host).backgroundColor);
        this.nodeElements.forEach((element, id) => {
            const style = this.model.metadata.nodes[id];
            const themed = this.themeColors.get(id);
            const background = style?.backgroundColor || themed?.backgroundColor || "";
            const adaptForeground = !!themed || !!canvasForeground;
            element.classList.toggle("mindmap-view__node--colored", adaptForeground);
            element.style.backgroundColor = background;
            element.style.color = style?.textColor || (adaptForeground && style?.backgroundColor && isMindmapColor(background) ?
                getMindmapTextColor(background) : themed?.textColor || canvasForeground) || "";
            element.style.fontSize = themed?.fontSize ? `${style?.fontSize ?? themed.fontSize}px` : "";
            element.style.fontWeight = themed?.fontSize ? (style?.bold === undefined ? (themed.bold ? "600" : "400") :
                style.bold ? "700" : "400") : "";
            element.style.fontStyle = themed?.fontSize && style?.italic !== undefined ? (style.italic ? "italic" : "normal") : "";
            if (adaptForeground) {
                element.style.setProperty("--mindmap-node-text-color", element.style.color);
            } else {
                element.style.removeProperty("--mindmap-node-text-color");
            }
        });
    }

    public getContentHost(id: string): HTMLElement | undefined {
        return this.nodeElements.get(id)?.querySelector<HTMLElement>(".mindmap-view__content");
    }

    public captureHistoryViewport() {
        return JSON.stringify({scale: this.scale, x: this.offsetX, y: this.offsetY});
    }

    public restoreHistoryViewport(value: unknown) {
        if (typeof value !== "string") {
            return;
        }
        try {
            const state = JSON.parse(value);
            if (!state || !Number.isFinite(state.scale) || state.scale < .15 || state.scale > 2.5 ||
                ![state.x, state.y].every(value => Number.isFinite(value) && Math.abs(value) <= 1000000)) {
                return;
            }
            this.historyViewport = state;
            this.refreshLayout();
        } catch (_error) {
            // 无效的取景上下文不影响节点和正文回放。
        }
    }

    private destroyContentViews(id: string) {
        this.nestedViews.get(id)?.forEach(view => view.destroy());
        this.nestedViews.delete(id);
        destroyTabsRender(this.getContentHost(id));
    }

    public getBlockById(id: string) {
        return this.nodeElements.get(id) ||
            this.options.host.querySelector<HTMLElement>(`[data-mindmap-source-id="${id}"]`);
    }

    private getToolbarBounds(includePopup = true) {
        const bounds: DOMRect[] = [];
        const toolbarStyle = getComputedStyle(this.toolbar);
        if (this.toolbar.hidden || toolbarStyle.display === "none" || toolbarStyle.visibility === "hidden" ||
            Number(toolbarStyle.opacity) === 0) {
            return bounds;
        }
        // 节点定位避让可见控件及缩放面板；整图适配只考虑常驻按钮组，不包含左侧空白。
        this.toolbar.querySelectorAll<HTMLElement>(includePopup ?
            ".mindmap-view__toolbar-group, .mindmap-view__zoom-actions" : ".mindmap-view__toolbar-group")
            .forEach(control => {
                const rect = control.getBoundingClientRect();
                const style = getComputedStyle(control);
                if (rect.width && rect.height && style.display !== "none" && style.visibility !== "hidden" &&
                    Number(style.opacity) !== 0) {
                    bounds.push(rect);
                }
            });
        return bounds;
    }

    public revealNode(id: string) {
        const node = this.nodeElements.get(id) || this.summaryElements.get(id);
        if (!node || node.hidden) {
            return;
        }
        const reveal = () => {
            if (this.destroyed || node.hidden) {
                return;
            }
            const viewport = this.viewport.getBoundingClientRect();
            const rect = node.getBoundingClientRect();
            if (!viewport.width || !viewport.height || !rect.width || !rect.height) {
                return;
            }
            const scaleX = viewport.width / (this.viewport.offsetWidth || viewport.width);
            const scaleY = viewport.height / (this.viewport.offsetHeight || viewport.height);
            const marginX = 16 * scaleX;
            const marginY = 16 * scaleY;
            const x = rect.left < viewport.left + marginX ? viewport.left + marginX - rect.left :
                rect.right > viewport.right - marginX ? viewport.right - marginX - rect.right : 0;
            let top = viewport.top + marginY;
            this.getToolbarBounds().forEach(bounds => {
                if (bounds.bottom > viewport.top && bounds.top < viewport.bottom &&
                    rect.left + x < bounds.right && rect.right + x > bounds.left) {
                    top = Math.max(top, bounds.bottom + marginY);
                }
            });
            let bottom = viewport.bottom - marginY;
            // 底部浮层按实际尺寸避让，横向定位后仍不相交的节点无需额外上移。
            if (!this.inspector.hidden) {
                const bounds = this.inspector.getBoundingClientRect();
                if (bounds.width && bounds.height && bounds.bottom > viewport.top && bounds.top < viewport.bottom &&
                    rect.left + x < bounds.right && rect.right + x > bounds.left) {
                    bottom = Math.min(bottom, bounds.top - marginY);
                }
            }
            // 可用高度不足以完整显示节点时，优先保留节点顶部的正文。
            const y = rect.top < top ? top - rect.top :
                rect.bottom > bottom ? Math.max(top - rect.top, bottom - rect.bottom) : 0;
            if (x || y) {
                const bounded = this.boundedPan(this.offsetX + x / scaleX, this.offsetY + y / scaleY);
                this.offsetX = bounded.x;
                this.offsetY = bounded.y;
                this.draw();
            }
        };
        if (this.frame) {
            requestAnimationFrame(reveal);
        } else {
            reveal();
        }
    }

    public getSelectedId() {
        return this.selectedId;
    }

    public getSelectedIds() {
        return this.selectedId ? [...new Set([this.selectedId, ...this.selectedIds])]
            .filter(id => this.model.nodes.has(id)) : [];
    }

    public focusNode(id: string, reveal = true) {
        if (this.destroyed || !this.model.nodes.has(id)) {
            return;
        }
        this.setInteractionActive(true);
        this.selectNode(id);
        this.options.host.focus({preventScroll: true});
        this.focusSelectionInput();
        this.queueInspectorLayout(reveal);
        if (reveal) {
            this.revealNode(id);
        }
    }

    public setEditing(id?: string) {
        if (this.editingId) {
            this.nodeElements.get(this.editingId)?.classList.remove("mindmap-view__node--editing");
        }
        this.editingId = id;
        this.syncSelectionInput();
        if (id) {
            this.setInteractionActive(true);
            this.destroyContentViews(id);
            this.selectNode(id);
            this.nodeElements.get(id)?.classList.add("mindmap-view__node--editing");
        }
        this.refreshLayout();
    }

    private syncSelectionInput() {
        const focused = document.activeElement === this.selectionInput;
        const id = !this.destroyed && !this.readOnly && !this.editingId && !this.relationFrom &&
            !this.selectedRelation && !this.selectedSummary && !this.selectedEdge &&
            this.getSelectedIds().length === 1 && this.model.nodes.has(this.selectedId) ? this.selectedId : undefined;
        if (id !== this.selectionInputId) {
            this.selectionInputId = id;
            this.selectionInputRevision++;
            this.selectionInput.textContent = "";
            this.selectionComposing = false;
            this.selectionCompositionEnding = false;
        }
        this.selectionInput.hidden = !id;
        const position = this.positions.get(id);
        if (position) {
            this.selectionInput.style.left = `${position.x}px`;
            this.selectionInput.style.top = `${position.y}px`;
            this.selectionInput.style.width = `${position.width}px`;
        }
        if (!id && focused) {
            this.options.host.focus({preventScroll: true});
        }
    }

    private focusSelectionInput() {
        this.syncSelectionInput();
        // 触屏点选仍保持画布焦点，避免仅选择节点就弹出软键盘。
        if (this.selectionInputId && !this.touchInput &&
            !document.body.matches(".body--ios, .body--android, .body--harmony")) {
            this.selectionInput.focus({preventScroll: true});
        }
    }

    private commitSelectionInput() {
        const id = this.selectionInputId;
        const revision = this.selectionInputRevision;
        if (!id || this.selectionComposing || this.selectionCompositionEnding || !this.selectionInput.textContent) {
            return;
        }
        this.finishThen(() => {
            if (revision !== this.selectionInputRevision || this.readOnly || this.editingId || this.selectionComposing) {
                return;
            }
            const text = this.selectionInput.textContent;
            if (!text) {
                return;
            }
            if (this.model.nodes.get(id)?.virtual) {
                this.editRootTitle(id, false, text);
            } else {
                this.setEditing(id);
                this.options.onEdit?.(id, this.getContentHost(id), text);
            }
        });
    }

    public refreshLayout() {
        if (this.destroyed || this.frame || this.pointer?.relation) {
            return;
        }
        this.frame = requestAnimationFrame(() => {
            this.frame = 0;
            this.stopFoldAnimation?.();
            if (this.pointer?.relation) {
                return;
            }
            if (!this.viewport.clientWidth || !this.viewport.clientHeight) {
                return;
            }
            this.resizeViewport();
            const previousPositions = this.positions;
            const previousSummaries = this.summaryPositions;
            const previousEdges = this.edges;
            const previousOffset = {x: this.offsetX, y: this.offsetY};
            const animateFold = !!this.foldAnchor && !this.initialFit;
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
            const summarySizes = new Map<string, {width: number, height: number}>();
            this.summaryElements.forEach((element, id) => {
                element.hidden = false;
                summarySizes.set(id, {width: Math.max(1, element.offsetWidth), height: Math.max(1, element.offsetHeight)});
            });
            const summaries = (this.model.metadata.summaries || []).map(summary => ({
                nodeIds: summary.nodeIds, height: summarySizes.get(summary.id)?.height || 0,
            }));
            let result = layoutListMindmap(layoutRoot, {summaries});
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
            // 关系线两端保留拖拽线段和文字的空间，只撑开所跨分支，其他节点保留紧凑间距。
            this.model.metadata.relations.forEach(relation => {
                if (!result.nodes.has(relation.from) || !result.nodes.has(relation.to)) {
                    return;
                }
                const label = relation.label?.trim() ? this.relationElements.get(relation.id) : undefined;
                if (label) {
                    label.hidden = false;
                }
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
                    reserve(verticalGaps, lower, label ? label.offsetHeight + 32 : 24);
                }
                if (label && (from.x + from.width <= to.x || to.x + to.width <= from.x)) {
                    const right = from.x < to.x ? to : from;
                    reserve(horizontalGaps, right.id, label.offsetWidth + 32);
                }
            });
            if (horizontalGaps.size || verticalGaps.size) {
                result = layoutListMindmap(layoutRoot, {horizontalGaps, verticalGaps, summaries});
            }
            this.positions = result.nodes;
            this.summaryPositions = layoutListMindmapSummaries(this.model, this.positions, summarySizes);
            this.relationRoutes.clear();
            this.fallbackRoutes.clear();
            this.anchorFallbackRoutes.clear();
            this.edges = result.edges;
            this.bounds = result;
            let top = 0;
            let left = 0;
            this.summaryPositions.forEach(position => {
                top = Math.min(top, position.top - 32, position.labelY - 32);
                this.bounds.width = Math.max(this.bounds.width, position.labelX + position.width + 32);
                this.bounds.height = Math.max(this.bounds.height, position.bottom + 32, position.labelY + position.height + 32);
            });
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
                this.summaryPositions.forEach(position => {
                    position.x -= left;
                    position.labelX -= left;
                    position.top -= top;
                    position.bottom -= top;
                    position.labelY -= top;
                });
                this.bounds.height -= top;
                this.bounds.width -= left;
            }
            this.positionNodes();
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
            const center = this.viewportCenter;
            this.viewportCenter = undefined;
            if (center && !this.initialFit) {
                this.offsetX = this.viewport.clientWidth / 2 - center.x * this.scale;
                this.offsetY = this.getViewportAnchorY(this.viewport.clientHeight) - center.y * this.scale;
            }
            if (this.historyViewport && !this.printTransform && !this.options.printLayout) {
                const state = this.historyViewport;
                this.historyViewport = undefined;
                this.initialFit = false;
                this.scale = state.scale;
                this.offsetX = state.x;
                this.offsetY = state.y;
                this.draw();
            } else if (this.printTransform || this.options.printLayout) {
                this.fitPrint();
            } else if (this.initialFit) {
                this.initialFit = false;
                if (!this.restoreViewport()) {
                    this.fit();
                }
            } else if (center) {
                this.draw();
            } else {
                // 内容布局未变化时保留当前取景，避免全屏裁切后被尺寸通知重新拉回。
                const changed = previousPositions.size !== this.positions.size ||
                    [...this.positions].some(([id, position]) => {
                        const previous = previousPositions.get(id);
                        return !previous || previous.x !== position.x || previous.y !== position.y ||
                            previous.width !== position.width || previous.height !== position.height;
                    }) || previousSummaries.size !== this.summaryPositions.size ||
                    [...this.summaryPositions].some(([id, position]) => {
                        const previous = previousSummaries.get(id);
                        return !previous || previous.x !== position.x || previous.top !== position.top ||
                            previous.bottom !== position.bottom || previous.labelX !== position.labelX ||
                            previous.labelY !== position.labelY || previous.width !== position.width || previous.height !== position.height;
                    });
                if (changed) {
                    const bounded = this.boundedPan(this.offsetX, this.offsetY);
                    this.offsetX = bounded.x;
                    this.offsetY = bounded.y;
                }
                this.draw();
            }
            if (animateFold && (previousPositions.size !== this.positions.size ||
                [...previousPositions.keys()].some(id => !this.positions.has(id)))) {
                this.animateFold(previousPositions, previousEdges, previousOffset, summarySizes);
            }
        });
    }

    private positionNodes() {
        this.nodeElements.forEach((element, id) => {
            const position = this.positions.get(id);
            element.hidden = !position;
            element.inert = !!this.foldOpacities?.has(id);
            element.style.opacity = this.foldOpacities?.has(id) ? String(this.foldOpacities.get(id)) : "";
            if (position) {
                element.style.left = `${position.x}px`;
                element.style.top = `${position.y - (id === this.model.root.id ? 1 : 3)}px`;
            }
        });
    }

    private animateFold(previous: Map<string, ListMindmapPosition>, previousEdges: {from: string, to: string}[],
                        previousOffset: {x: number, y: number}, summarySizes: Map<string, {width: number, height: number}>) {
        if (this.destroyed || this.printTransform || this.options.printLayout || !previous.size ||
            !previous.has(this.model.root.id) ||
            window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            return;
        }
        const target = this.positions;
        const targetEdges = this.edges;
        const targetSummaries = this.summaryPositions;
        const targetOffset = {x: this.offsetX, y: this.offsetY};
        const expanding = [...target.keys()].some(id => !previous.has(id));
        const duration = expanding ? 280 : 180;
        const changed = new Set([...previous.keys(), ...target.keys()]);
        const endpoints = new Map<string, {from: ListMindmapPosition, to: ListMindmapPosition}>();
        const attachment = (id: string, positions: Map<string, ListMindmapPosition>, size: ListMindmapPosition) => {
            let parent = this.model.nodes.get(id)?.parentId;
            while (parent && !positions.has(parent)) {
                parent = this.model.nodes.get(parent)?.parentId;
            }
            const anchor = positions.get(parent) || positions.get(this.model.root.id);
            return {...size, x: anchor.x + anchor.width, y: anchor.y + (anchor.height - size.height) / 2};
        };
        // 新分支保留内部排版，仅随可见祖先滑入，避免展开中途把多行正文挤到一起。
        const entrance = (id: string) => {
            let parent = this.model.nodes.get(id)?.parentId;
            while (parent && (!previous.has(parent) || !target.has(parent))) {
                parent = this.model.nodes.get(parent)?.parentId;
            }
            const from = previous.get(parent) || previous.get(this.model.root.id);
            const to = target.get(parent) || target.get(this.model.root.id);
            const position = target.get(id);
            return {...position, x: position.x + from.x - to.x - 36, y: position.y + from.y - to.y};
        };
        changed.forEach(id => endpoints.set(id, {
            from: previous.get(id) || entrance(id),
            to: target.get(id) || attachment(id, target, previous.get(id)),
        }));
        const targetChildren = new Set(targetEdges.map(edge => edge.to));
        this.edges = [...targetEdges, ...previousEdges.filter(edge => !targetChildren.has(edge.to))];
        let frame = 0;
        let active = true;
        const finish = () => {
            if (!active) {
                return;
            }
            active = false;
            cancelAnimationFrame(frame);
            this.stopFoldAnimation = undefined;
            this.foldOpacities = undefined;
            this.positions = target;
            this.edges = targetEdges;
            this.summaryPositions = targetSummaries;
            this.offsetX = targetOffset.x;
            this.offsetY = targetOffset.y;
            this.relationRoutes.clear();
            this.positionNodes();
            if (!this.destroyed) {
                this.draw();
            }
        };
        this.stopFoldAnimation = finish;
        const started = performance.now();
        const step = (now: number) => {
            if (!active) {
                return;
            }
            const progress = Math.min(1, Math.max(0, (now - started) / duration));
            if (progress === 1 || this.destroyed || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
                finish();
                return;
            }
            const eased = expanding ? (progress < .5 ? 2 * progress ** 2 : 1 - (-2 * progress + 2) ** 2 / 2) :
                1 - (1 - progress) ** 3;
            this.positions = new Map();
            this.foldOpacities = new Map();
            endpoints.forEach(({from, to}, id) => {
                this.positions.set(id, {...to, x: from.x + (to.x - from.x) * eased,
                    y: from.y + (to.y - from.y) * eased});
                if (!previous.has(id) || !target.has(id)) {
                    this.foldOpacities.set(id, target.has(id) ? eased : 1 - eased);
                }
            });
            this.offsetX = previousOffset.x + (targetOffset.x - previousOffset.x) * eased;
            this.offsetY = previousOffset.y + (targetOffset.y - previousOffset.y) * eased;
            this.summaryPositions = layoutListMindmapSummaries(this.model, this.positions, summarySizes);
            this.relationRoutes.clear();
            this.positionNodes();
            this.draw();
            frame = requestAnimationFrame(step);
        };
        step(started);
    }

    private updateSummaries() {
        this.summaryElements.forEach((element, id) => {
            if (!this.model.metadata.summaries?.some(summary => summary.id === id)) {
                this.resizeObserver.unobserve(element);
                element.remove();
                this.summaryElements.delete(id);
            }
        });
        (this.model.metadata.summaries || []).forEach(summary => {
            let element = this.summaryElements.get(summary.id);
            if (!element) {
                element = createElement("div", "mindmap-view__node mindmap-view__node--summary mindmap-view__summary");
                element.setAttribute("role", "button");
                element.tabIndex = 0;
                element.dataset.summaryId = summary.id;
                element.addEventListener("click", event => {
                    event.stopPropagation();
                    if (!this.panning && !this.suppressLinkClick) {
                        this.finishThen(() => this.selectSummary(summary.id));
                    }
                });
                element.addEventListener("focus", () => this.finishThen(() => this.selectSummary(summary.id)));
                element.addEventListener("keydown", event => {
                    if (!event.isComposing && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey &&
                        (event.key === "Enter" || event.key === " ")) {
                        event.preventDefault();
                        event.stopPropagation();
                        if (!event.repeat) {
                            this.finishThen(() => this.selectSummary(summary.id));
                        }
                    }
                });
                this.summaryElements.set(summary.id, element);
                this.world.append(element);
                this.resizeObserver.observe(element);
            }
            element.textContent = summary.label || this.label("listMindmapSummary");
            element.setAttribute("aria-label", element.textContent);
            element.style.color = summary.color || "";
        });
    }

    private selectSummary(id: string) {
        this.selectedSummary = id;
        this.selectedId = undefined;
        this.selectedRelation = undefined;
        this.selectedEdge = undefined;
        this.relationFrom = undefined;
        this.inspector.hidden = !!this.readOnly;
        this.updateSelection();
        this.renderInspector();
    }

    private async createSummary() {
        if (this.readOnly || this.summaryPending || !this.options.onSummaryBatchAdd) {
            return;
        }
        const selected = this.getSelectedIds();
        if (!selected.length) {
            return;
        }
        const {ranges, conflict} = getListMindmapSummarySelection(this.model, new Set(selected));
        if (conflict || !ranges.length) {
            return;
        }
        const expected = getListMindmapSummarySnapshot(this.model);
        this.summaryPending = true;
        this.updateSelection();
        try {
            const ids = await this.options.onSummaryBatchAdd(ranges, expected);
            if (!this.destroyed && !this.readOnly && ids?.length &&
                JSON.stringify(this.getSelectedIds()) === JSON.stringify(selected)) {
                this.selectSummary(ids[0]);
                this.revealNode(ids[0]);
                requestAnimationFrame(() => {
                    if (!this.destroyed && this.selectedSummary === ids[0]) {
                        this.editSummaryLabel(ids[0]);
                    }
                });
            }
        } catch (error) {
            console.error(error);
        } finally {
            this.summaryPending = false;
            if (!this.destroyed) {
                this.updateSelection();
            }
        }
    }

    private editSummaryLabel(id: string) {
        const summary = this.model.metadata.summaries?.find(item => item.id === id);
        const position = this.summaryPositions.get(id);
        if (this.readOnly || !summary || !position) {
            return;
        }
        this.finishSummaryEdit?.(true);
        this.finishRelationEdit?.(true);
        this.inspector.hidden = true;
        const expected = JSON.stringify(summary);
        const input = createElement("input", "b3-text-field mindmap-view__summary-editor");
        input.type = "text";
        input.value = summary.label;
        input.setAttribute("aria-label", this.label("listMindmapSummary"));
        input.style.left = `${position.labelX}px`;
        input.style.top = `${position.labelY}px`;
        const nativeSizing = CSS.supports("field-sizing", "content");
        const resizeInput = () => {
            if (nativeSizing) {
                return;
            }
            // 不支持内容自适应的 WebView 按实际字体测量，宽度上下限由样式控制。
            const style = getComputedStyle(input);
            const measure = document.createElement("span");
            measure.style.position = "absolute";
            measure.style.visibility = "hidden";
            measure.style.whiteSpace = "pre";
            (["fontFamily", "fontSize", "fontWeight", "fontStyle", "fontStretch", "fontVariant",
                "letterSpacing", "wordSpacing", "textTransform"] as const).forEach(key => {
                measure.style[key] = style[key];
            });
            measure.textContent = input.value || " ";
            this.world.append(measure);
            input.style.width = `${measure.offsetWidth + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) +
                parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth) + 1}px`;
            measure.remove();
        };
        input.addEventListener("input", resizeInput);
        input.addEventListener("compositionend", resizeInput);
        this.editingSummary = id;
        let finished = false;
        const finish = (save: boolean) => {
            if (finished) {
                return;
            }
            finished = true;
            this.finishSummaryEdit = undefined;
            this.editingSummary = undefined;
            input.remove();
            if (save && input.value !== summary.label) {
                this.options.onSummaryChange?.(id, {label: input.value}, expected);
            }
            this.draw();
        };
        this.finishSummaryEdit = finish;
        input.addEventListener("blur", () => finish(true));
        input.addEventListener("keydown", event => {
            if (!event.isComposing && (event.key === "Enter" || event.key === "Escape")) {
                event.preventDefault();
                event.stopPropagation();
                finish(event.key === "Enter");
                this.options.host.focus({preventScroll: true});
            }
        });
        this.world.append(input);
        resizeInput();
        input.style.top = `${position.labelY + (position.height - input.offsetHeight) / 2}px`;
        this.draw();
        input.focus();
        input.select();
    }

    private drawSummaries(context: CanvasRenderingContext2D,
                          resolveStyle: (color: string, selected: boolean, hovered: boolean) => {color: string, width: number}) {
        (this.model.metadata.summaries || []).forEach(summary => {
            const position = this.summaryPositions.get(summary.id);
            const element = this.summaryElements.get(summary.id);
            if (!element) {
                return;
            }
            const opacity = Math.min(...summary.nodeIds.map(id => this.foldOpacities?.get(id) ?? 1));
            element.style.opacity = this.foldOpacities ? String(opacity) : "";
            element.inert = summary.nodeIds.some(id => this.foldOpacities?.has(id));
            element.hidden = !position;
            if (!position) {
                return;
            }
            const {labelX, labelY} = position;
            const path = buildListMindmapSummaryConnector(position,
                this.model.metadata.connectorStyle || "bezier", () => new Path2D());
            const selected = this.selectedSummary === summary.id && !this.printTransform && !this.options.printLayout;
            const hovered = this.hoveredLine === `summary:${summary.id}` && !this.printTransform && !this.options.printLayout;
            const inherited = resolveListMindmapSummaryStyle(this.model, summary, this.themeColors);
            element.style.color = inherited.textColor || "";
            element.style.backgroundColor = inherited.backgroundColor || "";
            const style = resolveStyle(inherited.lineColor, selected, hovered);
            context.strokeStyle = style.color;
            context.lineWidth = style.width;
            context.globalAlpha = opacity;
            context.setLineDash([]);
            context.stroke(path);
            this.linePaths.push({id: summary.id, relation: false, summary: true, path});
            element.style.left = `${labelX}px`;
            element.style.top = `${labelY}px`;
            element.style.visibility = this.editingSummary === summary.id ? "hidden" : "";
            element.classList.toggle("mindmap-view__summary--selected", selected);
            element.classList.toggle("mindmap-view__node--selected", selected);
            element.setAttribute("aria-pressed", String(selected));
        });
        context.globalAlpha = 1;
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
                element = createElement("button", "mindmap-view__relation");
                element.type = "button";
                element.dataset.relationId = relation.id;
                element.addEventListener("click", (event) => {
                    event.stopPropagation();
                    this.finishThen(() => {
                        this.selectedRelation = relation.id;
                        this.selectedSummary = undefined;
                        this.selectedEdge = undefined;
                        this.relationFrom = undefined;
                        this.selectedId = undefined;
                        this.updateSelection();
                        if (!this.readOnly) {
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
        })).concat([...this.summaryPositions.values()].map(summary => ({
            id: `summary:${summary.id}`, x: summary.x - 10, y: Math.min(summary.top, summary.labelY),
            width: summary.labelX + summary.width - summary.x + 10,
            height: Math.max(summary.bottom, summary.labelY + summary.height) - Math.min(summary.top, summary.labelY),
            controlY: summary.top,
        })));
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
        const start = points[0];
        const next = points[1];
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
            return {path, start, next, end, previous, arrowSizeLimit, labelPoint: undefined as MindmapRoutePoint | undefined};
        }
        const width = label.offsetWidth;
        const height = label.offsetHeight;
        const segments = points.slice(1).map((p, i) => ({a: points[i], b: p,
            length: Math.hypot(p.x - points[i].x, p.y - points[i].y)})).sort((a, b) => b.length - a.length);
        const nodes = this.routingObstacles();
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
        label.style.visibility = !labelPoint || (id === this.selectedRelation && !this.readOnly &&
            !this.printTransform && !this.options.printLayout) ? "hidden" : "";
        return {path, start, next, end, previous, arrowSizeLimit, labelPoint};
    }

    private resolveRelationRoute(relation: ListMindmapRelation | undefined, from: ListMindmapPosition,
                                 to: ListMindmapPosition, allowAnchorFallback = true) {
        const obstacles = this.routingObstacles();
        if (relation?.route) {
            const points = routeManualMindmapRelation(from, to, obstacles, relation.route, relation);
            if (points.length >= 2) {
                return {points, routeFallback: false, anchorFallback: false};
            }
        }
        const points = routeMindmapRelation(from, to, obstacles, undefined, relation);
        const routeFallback = !!relation?.route;
        if (points.length >= 2 || !allowAnchorFallback || (!relation?.fromAnchor && !relation?.toAnchor)) {
            return {points, routeFallback, anchorFallback: false};
        }
        // 布局变化时保留原约束，临时自动选取接入点；再次可用后恢复保存的位置。
        return {points: routeMindmapRelation(from, to, obstacles), routeFallback, anchorFallback: true};
    }

    private calculateRelationRoute(relation: ListMindmapRelation | undefined, from: ListMindmapPosition, to: ListMindmapPosition) {
        const result = this.resolveRelationRoute(relation, from, to);
        if (relation) {
            this.fallbackRoutes.delete(relation.id);
            this.anchorFallbackRoutes.delete(relation.id);
            if (result.routeFallback) {
                this.fallbackRoutes.add(relation.id);
            }
            if (result.anchorFallback) {
                this.anchorFallbackRoutes.add(relation.id);
            }
        }
        return result.points;
    }

    private renderRouteControls() {
        const id = this.selectedRelation;
        const drag = this.pointer?.relation;
        const editable = !this.readOnly && !this.printTransform && !this.options.printLayout && !this.finishRelationEdit;
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
        const invalid = drag && !drag.valid;
        const anchorFallback = !drag && this.anchorFallbackRoutes.size > 0;
        const routeFallback = drag ? drag.valid && drag.routeFallback :
            this.readOnly ? this.fallbackRoutes.size > 0 : this.fallbackRoutes.has(id);
        this.viewport.classList.toggle("mindmap-view__viewport--route-invalid", !!invalid);
        this.routeStatus.hidden = !!this.options.printLayout || !!this.printTransform ||
            (!invalid && !anchorFallback && !routeFallback);
        this.routeStatus.textContent = this.label(invalid ? drag.anchor ? "listMindmapAnchorInvalid" : "invalid" :
            anchorFallback ? "listMindmapAnchorFallback" : "listMindmapRouteFallback");
    }

    private getRouteHandle(id: string, part: number | "from" | "to") {
        const key = `${id}:${part}`;
        let handle = this.routeHandles.get(key);
        if (handle) {
            return handle;
        }
        handle = createElement("button", "mindmap-view__route-handle");
        handle.type = "button";
        const endpoint = typeof part === "string" ? part : undefined;
        if (endpoint) {
            handle.classList.add("mindmap-view__route-endpoint");
            handle.dataset.endpoint = endpoint;
        }
        handle.setAttribute("aria-label", this.label(endpoint ?
            endpoint === "from" ? "listMindmapRouteStart" : "listMindmapRouteEnd" : "listMindmapRouteHandle"));
        handle.addEventListener("pointerdown", event => {
            event.stopPropagation();
            if (event.button === 0 && !this.readOnly && !this.pointer) {
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
        if (this.readOnly || !relation || !points?.[segment + 1]) {
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
            this.pointerCapture = (event.target as Element).closest<HTMLElement>(".mindmap-view__route-handle") || this.viewport;
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
        if (!from || !to) {
            this.draw();
            return;
        }
        if (drag.endpoint) {
            const target = this.positions.get(drag.targetId);
            const point = target || {id: "", ...drag.handle, width: 0, height: 0};
            const nextFrom = drag.endpoint === "from" ? point : from;
            const nextTo = drag.endpoint === "to" ? point : to;
            const anchorKey = drag.endpoint === "from" ? "fromAnchor" : "toAnchor";
            const sameNode = target?.id === relation[drag.endpoint];
            const preview = {...relation, [drag.endpoint]: target?.id || relation[drag.endpoint],
                [anchorKey]: sameNode ? drag.anchor : undefined, route: sameNode ? relation.route : undefined};
            const {points, routeFallback} = this.resolveRelationRoute(preview, nextFrom, nextTo, false);
            drag.valid = !!target && (!sameNode || !!drag.anchor) &&
                this.canReconnectRelation(relation, drag.endpoint, target.id) && points.length >= 2;
            drag.routeFallback = routeFallback;
            if (points.length >= 2) {
                this.relationRoutes.set(drag.id, points);
            }
            this.nodeElements.forEach((element, id) => element.classList.toggle("mindmap-view__node--relation",
                id === drag.targetId && (sameNode || drag.valid)));
            this.draw();
            return;
        }
        const route = from && to && adjustMindmapRoute(drag.points, drag.segment, drag.offset, from, to,
            this.fallbackRoutes.has(drag.id) ? undefined : relation.route);
        if (route) {
            const points = routeManualMindmapRelation(from, to, this.routingObstacles(), route, relation);
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
        if (this.readOnly) {
            return;
        }
        this.cancelPointer();
        this.finishThen(() => {
            const relation = this.model.metadata.relations.find(item => item.id === id);
            if (!this.readOnly && relation?.route) {
                this.options.onRelationChange?.(id, {route: undefined}, JSON.stringify(relation));
            }
        });
    }

    private resetRelationAnchors(id: string) {
        if (this.readOnly) {
            return;
        }
        this.cancelPointer();
        this.finishThen(() => {
            const relation = this.model.metadata.relations.find(item => item.id === id);
            if (!this.readOnly && (relation?.fromAnchor || relation?.toAnchor)) {
                this.options.onRelationChange?.(id, {fromAnchor: undefined, toAnchor: undefined}, JSON.stringify(relation));
            }
        });
    }

    private requestDraw() {
        if (this.destroyed || this.drawFrame) {
            return;
        }
        // 高频指针事件只记录最新位置，每帧统一绘制节点和连线。
        this.drawFrame = requestAnimationFrame(() => {
            this.drawFrame = 0;
            this.draw();
        });
    }

    private draw() {
        cancelAnimationFrame(this.drawFrame);
        this.drawFrame = 0;
        if (this.destroyed) {
            return;
        }
        const width = this.viewport.clientWidth;
        const height = this.viewport.clientHeight;
        this.resizeViewport(width, height);
        this.world.style.transform = `translate(${this.offsetX}px, ${this.offsetY}px) scale(${this.scale})`;
        this.syncSelectionInput();
        this.rememberViewport();
        this.updateDocumentViewport();
        this.zoomLabel.textContent = `${Math.round(this.scale * 100)}%`;
        this.zoomSlider.value = String(Math.round(this.scale * 100));
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
        const readLineStyles = (type: "line" | "relation" | "summary") => ["", "hover-", "selected-"].map(state => {
            const prefix = `--b3-mindmap-${type}-${state}`;
            const width = Number(theme.getPropertyValue(`${prefix}width`).trim().replace(/px$/, ""));
            return {
                color: theme.getPropertyValue(`${prefix}color`).trim(),
                width: Number.isFinite(width) && width > 0 ? width : undefined,
            };
        });
        const lineStyles = readLineStyles("line");
        const relationStyles = readLineStyles("relation");
        const summaryStyles = readLineStyles("summary");
        const colors = new Map<string, string>();
        const resolveColor = (value: string, fallback: string) => {
            const key = `${fallback}\n${value || ""}`;
            if (!colors.has(key)) {
                this.colorProbe.style.color = fallback;
                if (value) {
                    this.colorProbe.style.color = value;
                }
                colors.set(key, getComputedStyle(this.colorProbe).color);
            }
            return colors.get(key);
        };
        const resolveLineStyle = (styles: typeof lineStyles, color: string, width: number, fallback: string,
                                  selected: boolean, hovered: boolean, themeWidth = 1.5) => {
            const baseColor = resolveColor(styles[0].color, fallback);
            const baseWidth = width || (styles[0].width || 1.5) / 1.5 * themeWidth;
            const stateStyle = selected ? styles[2] : hovered ? styles[1] : undefined;
            return {
                // 显式颜色始终优先，状态颜色缺省时沿用普通主题色。
                color: resolveColor(color, resolveColor(stateStyle?.color, baseColor)),
                width: stateStyle?.width ?? baseWidth + (selected ? 1 : 0) + (hovered ? 1.5 / this.scale : 0),
                baseWidth,
            };
        };
        const canvasColor = this.themeColors?.size ? resolveColor(this.model.metadata.appearance?.backgroundColor ||
            theme.getPropertyValue("--b3-theme-background").trim(), "#ffffff") : "";
        const paletteLines = new Map<string, string>();
        const themeLineColor = (id: string) => {
            const color = this.themeColors?.get(id)?.lineColor;
            if (color && !paletteLines.has(color)) {
                paletteLines.set(color, this.model.metadata.appearance?.nodeStyle === "branch" ?
                    color : getMindmapLineColor(color, canvasColor));
            }
            return paletteLines.get(color);
        };
        const connectors = buildListMindmapConnectors(this.model.root.id, this.positions, this.edges,
            this.model.metadata.connectorStyle || "bezier", () => new Path2D(),
            this.model.metadata.appearance?.nodeStyle === "branch");
        const trunkOpacities = new Map<string, number>();
        if (this.foldOpacities) {
            this.edges.forEach(edge => {
                if (this.positions.has(edge.to)) {
                    trunkOpacities.set(edge.from, Math.max(trunkOpacities.get(edge.from) ?? 0,
                        this.foldOpacities.get(edge.to) ?? 1));
                }
            });
        }
        const rootStyle = this.model.metadata.nodes[this.model.root.id] || {};
        connectors.trunks.forEach((path, index) => {
            const id = connectors.trunkParents[index];
            const style = this.themeColors?.size ? {...rootStyle, ...this.model.metadata.nodes[id]} : rootStyle;
            const trunkStyle = resolveLineStyle(lineStyles, style.lineColor || themeLineColor(id),
                style.lineWidth, defaultLine, false, false, this.themeColors?.get(id)?.lineWidth);
            context.strokeStyle = trunkStyle.color;
            context.lineWidth = trunkStyle.width;
            context.globalAlpha = Math.min(this.foldOpacities?.get(id) ?? 1, trunkOpacities.get(id) ?? 1);
            context.setLineDash(style.lineDash ? [6, 4] : []);
            context.stroke(path);
        });
        connectors.branches.forEach(({id, path, trunk}) => {
            const style = {...rootStyle, ...this.model.metadata.nodes[id]};
            this.linePaths.push({id, relation: false, path});
            context.beginPath();
            const selected = this.selectedEdge === id;
            const hovered = this.hoveredLine === `edge:${id}`;
            const lineStyle = resolveLineStyle(lineStyles, style.lineColor || themeLineColor(id),
                style.lineWidth, defaultLine, selected, hovered, this.themeColors?.get(id)?.lineWidth);
            context.globalAlpha = this.foldOpacities?.get(id) ?? 1;
            context.setLineDash(style.lineDash ? [6, 4] : []);
            if (trunk) {
                const trunkStyle = resolveLineStyle(lineStyles, style.lineColor || themeLineColor(id),
                    style.lineWidth, defaultLine, false, false, this.themeColors?.get(id)?.lineWidth);
                context.strokeStyle = trunkStyle.color;
                context.lineWidth = trunkStyle.width;
                context.stroke(trunk);
            }
            context.strokeStyle = lineStyle.color;
            context.lineWidth = lineStyle.width;
            context.stroke(path);
        });
        this.model.metadata.relations.forEach((relation) => {
            const from = this.positions.get(relation.from);
            const to = this.positions.get(relation.to);
            const element = this.relationElements.get(relation.id);
            const opacity = Math.min(this.foldOpacities?.get(relation.from) ?? 1, this.foldOpacities?.get(relation.to) ?? 1);
            element.style.opacity = this.foldOpacities ? String(opacity) : "";
            element.inert = !!(this.foldOpacities?.has(relation.from) || this.foldOpacities?.has(relation.to));
            element.hidden = !from || !to || !relation.label?.trim();
            if (!from || !to) {
                return;
            }
            const route = this.relationPath(relation.id, from, to, element);
            if (!route) {
                element.hidden = true;
                return;
            }
            const {path, start, next, end, previous, arrowSizeLimit, labelPoint} = route;
            const direction = relation.arrowDirection || "forward";
            const arrows = [];
            if (direction === "forward" || direction === "both") {
                arrows.push({tip: end, previous});
            }
            if (direction === "reverse" || direction === "both") {
                arrows.push({tip: start, previous: next});
            }
            this.linePaths.push({id: relation.id, relation: true, path, arrows: arrows.map(arrow => arrow.tip)});
            context.beginPath();
            const selected = relation.id === this.selectedRelation;
            const hovered = this.hoveredLine === `relation:${relation.id}`;
            const lineStyle = resolveLineStyle(relationStyles, relation.color, relation.width, primary, selected, hovered);
            const baseWidth = lineStyle.baseWidth;
            context.strokeStyle = lineStyle.color;
            context.lineWidth = lineStyle.width;
            context.globalAlpha = opacity;
            const emphasis = Math.max(0, context.lineWidth - baseWidth);
            element.classList.toggle("mindmap-view__relation--hover", hovered);
            context.setLineDash(relation.dash === false ? [] : [5, 4]);
            context.stroke(path);
            context.setLineDash([]);
            // 短线上的双向箭头预留间隙，避免合并成菱形。
            const arrowSize = Math.min(Math.max(7 / this.scale, baseWidth * 2), arrowSizeLimit);
            // 箭头随线条状态加宽，保持长度不变以保留双向箭头之间的间隙。
            const halfWidth = arrowSize / 2 + emphasis / 2;
            context.fillStyle = context.strokeStyle;
            arrows.forEach(({tip, previous}) => {
                const angle = Math.atan2(tip.y - previous.y, tip.x - previous.x);
                const baseX = tip.x - arrowSize * Math.cos(Math.PI / 6) * Math.cos(angle);
                const baseY = tip.y - arrowSize * Math.cos(Math.PI / 6) * Math.sin(angle);
                context.beginPath();
                context.moveTo(baseX - halfWidth * Math.sin(angle), baseY + halfWidth * Math.cos(angle));
                context.lineTo(tip.x, tip.y);
                context.lineTo(baseX + halfWidth * Math.sin(angle), baseY - halfWidth * Math.cos(angle));
                context.closePath();
                context.fill();
            });
            if (labelPoint) {
                element.style.left = `${labelPoint.x}px`;
                element.style.top = `${labelPoint.y}px`;
            }
        });
        context.globalAlpha = 1;
        this.drawRelationPreview(context, resolveColor(relationStyles[0].color, primary), relationStyles[0].width || 1.5);
        this.drawSummaries(context, (color, selected, hovered) =>
            resolveLineStyle(summaryStyles, color, undefined, defaultLine, selected, hovered));
        this.renderRouteControls();
    }

    private drawRelationPreview(context: CanvasRenderingContext2D, color: string, width: number) {
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
        context.lineWidth = width;
        context.setLineDash([5, 4]);
        context.stroke(path);
        context.setLineDash([]);
        context.beginPath();
        const size = Math.min(Math.max(7 / this.scale, width * 2), arrowSizeLimit);
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
        let task = element.querySelector<HTMLButtonElement>(".mindmap-view__task");
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
                if (!this.readOnly && this.model.nodes.get(id)?.taskMarker !== undefined) {
                    this.options.onTaskToggle?.(id);
                }
            });
            task.className = "protyle-action protyle-action--task mindmap-view__task";
            task.addEventListener("contextmenu", event => {
                event.preventDefault();
                event.stopPropagation();
                this.finishThen(() => this.openTaskMenu(id, task));
            });
            element.prepend(task);
        }
        task.dataset.task = marker;
        task.disabled = !!this.readOnly;
        const key = {" ": "taskStatusTodo", "/": "taskStatusInProgress", X: "taskStatusDone", "-": "taskStatusCanceled"}[marker.toUpperCase()];
        task.setAttribute("aria-label", key ? this.label(key) : `${this.label("customTaskStatus")} ${marker}`);
        task.querySelector("use").setAttribute("xlink:href", marker === " " ? "#iconUncheck" : "#iconCheck");
    }

    private openTaskMenu(id: string, anchor: HTMLElement) {
        if (!this.readOnly && this.model.nodes.get(id)?.taskMarker !== undefined) {
            this.options.onTaskMenu?.(id, anchor);
        }
    }

    private selectNode(id: string, additive = false) {
        const changed = this.selectedId !== id || !!this.selectedRelation;
        const ids = additive ? new Set(this.getSelectedIds()) : new Set<string>();
        if (additive && ids.has(id)) {
            ids.delete(id);
            this.selectedId = [...ids].pop();
        } else {
            ids.add(id);
            this.selectedId = id;
        }
        this.selectedIds.clear();
        ids.forEach(selected => this.selectedIds.add(selected));
        this.selectedSummary = undefined;
        this.selectedRelation = undefined;
        this.selectedEdge = undefined;
        if (!this.readOnly && !this.relationFrom) {
            this.inspector.hidden = !this.selectedId;
        }
        this.updateSelection();
        if (changed || !this.inspector.hidden) {
            this.renderInspector();
        }
    }

    private updateSelection() {
        if (this.inspector.hidden || this.readOnly || this.selectedRelation || this.selectedEdge || this.selectedSummary ||
            this.inspectorPanel && JSON.stringify(this.inspectorPanel.ids) !== JSON.stringify(this.getSelectedIds())) {
            this.closeInspectorPanel();
        }
        if (!this.selectedId) {
            this.selectedIds.clear();
        }
        if (!this.relationFrom) {
            this.relationPreview = undefined;
        }
        this.nodeElements.forEach((element, id) => {
            const selected = this.selectedId === id || this.selectedIds.has(id);
            element.classList.toggle("mindmap-view__node--selected", selected);
            element.classList.toggle("mindmap-view__node--relation", this.relationFrom === id ||
                this.relationPreview?.targetId === id);
            element.setAttribute("aria-selected", String(selected));
        });
        this.relationElements.forEach((element, id) => element.classList.toggle("mindmap-view__relation--selected", this.selectedRelation === id));
        const node = this.model.nodes.get(this.selectedId);
        const {ranges, conflict} = getListMindmapSummarySelection(this.model, new Set(this.getSelectedIds()));
        const disabled: Record<string, boolean> = {
            relation: !node || node.virtual || this.getSelectedIds().length > 1,
            summary: this.readOnly || this.summaryPending ||
                conflict || !ranges.length || !this.options.onSummaryBatchAdd,
            style: !node && !this.selectedRelation && !this.selectedEdge,
        };
        Object.keys(disabled).forEach((key) => {
            const button = this.buttons.get(key);
            if (button) {
                button.disabled = disabled[key];
            }
        });
        this.buttons.get("relation")?.classList.toggle("block__icon--active", !!this.relationFrom);
        const summary = this.buttons.get("summary");
        if (summary) {
            const description = conflict ? this.label("listMindmapSummaryConflict") :
                this.label("listMindmapSummaryBatch").replace("${count}", String(ranges.length));
            summary.dataset.tooltip = description;
            summary.setAttribute("aria-description", description);
        }
        this.buttons.get("multiSelect")?.classList.toggle("block__icon--active", this.multiSelect);
        this.buttons.get("multiSelect")?.setAttribute("aria-pressed", String(this.multiSelect));
        this.draw();
    }

    private toggleFold(id: string) {
        if (this.locked) {
            return;
        }
        const node = this.model.nodes.get(id);
        if (!node?.children.length) {
            return;
        }
        this.foldAnchor = {id, collapsed: !(this.folded.get(id) ?? node.collapsed)};
        if (this.readOnly || node.virtual) {
            this.folded.set(id, !(this.folded.get(id) ?? node.collapsed));
            this.update(this.model);
        } else {
            this.options.onFold?.(id);
        }
    }

    private async toggleSiblingFold(id: string) {
        if (this.locked) {
            return;
        }
        const states = getListMindmapSiblingFoldStates(this.model, id, this.folded);
        if (!states.size) {
            return;
        }
        const selectedId = this.selectedId;
        this.finishRelationEdit?.(true);
        this.cancelPointer();
        if (!this.readOnly && !await this.options.onFoldSiblings?.(id)) {
            return;
        }
        if (!this.destroyed) {
            this.updateFoldStates(states, selectedId);
        }
    }

    private async expandToLevel(level: ListMindmapFoldTarget, selectedId = this.selectedId) {
        if (this.locked) {
            return;
        }
        this.finishRelationEdit?.(true);
        this.cancelPointer();
        if (!this.readOnly && !await this.options.onFoldLevel?.(level)) {
            return;
        }
        if (this.destroyed) {
            return;
        }
        this.updateFoldStates(getListMindmapFoldStates(this.model.root, level), selectedId);
    }

    private updateFoldStates(states: Map<string, boolean>, selectedId: string) {
        states.forEach((collapsed, id) => {
            if (this.readOnly || this.model.nodes.get(id)?.virtual) {
                this.folded.set(id, collapsed);
            } else {
                this.folded.delete(id);
            }
        });
        let selected = this.model.nodes.get(selectedId) || this.model.root;
        let ancestor = selected;
        while (ancestor.parentId) {
            ancestor = this.model.nodes.get(ancestor.parentId);
            if (this.folded.get(ancestor.id) ?? ancestor.collapsed) {
                selected = ancestor;
            }
        }
        this.selectedId = selected.id;
        this.selectedSummary = undefined;
        this.selectedRelation = undefined;
        this.selectedEdge = undefined;
        this.relationFrom = undefined;
        this.relationPreview = undefined;
        this.inspector.hidden = true;
        this.foldAnchor = {id: selected.id, collapsed: this.folded.get(selected.id) ?? selected.collapsed};
        this.update(this.model);
    }

    private deleteSelection() {
        if (this.readOnly) {
            return;
        }
        if (this.selectedSummary) {
            this.options.onSummaryDelete?.(this.selectedSummary);
        } else if (this.selectedRelation) {
            this.options.onRelationDelete?.(this.selectedRelation);
        } else if (this.getSelectedIds().length > 1 && this.options.onDeleteNodes) {
            this.options.onDeleteNodes(this.getSelectedIds());
        } else {
            const node = this.model.nodes.get(this.selectedId);
            if (node && !node.virtual && node !== this.model.root) {
                const siblings = this.model.nodes.get(node.parentId)?.children || [];
                const index = siblings.findIndex(item => item.id === node.id);
                const nextId = siblings[index + 1]?.id || siblings[index - 1]?.id || node.parentId;
                if (this.options.onDelete) {
                    void Promise.resolve(this.options.onDelete(node.id)).then(deleted => {
                        if (deleted !== false && !this.model.nodes.has(node.id) && nextId &&
                            (!this.selectedId || this.selectedId === node.id)) {
                            this.focusNode(nextId);
                        }
                    }).catch(error => console.error(error));
                }
            }
        }
    }

    private pinchStart = (event: TouchEvent) => {
        if (event.touches.length > 1 && this.pointer?.touchNode) {
            this.cancelPointer();
        }
        if (this.locked || event.touches.length !== 2 || Array.from(event.touches).some(touch =>
            !this.viewport.contains(touch.target as Node) ||
            ((touch.target as Element).closest("button, input, select, textarea, audio, video, iframe") ||
                this.viewport.contains((touch.target as Element).closest(".mindmap-view__node--editing"))))) {
            this.pinch = undefined;
            return;
        }
        event.preventDefault();
        this.cancelPointer();
        clearTimeout(this.linkTimer);
        // 双指操作转移外部编辑焦点，避免鸿蒙在松手后重新唤起输入法。
        const active = this.options.host.ownerDocument.activeElement;
        if (active instanceof HTMLElement && !this.options.host.contains(active) &&
            (active.isContentEditable || active.matches("input, textarea"))) {
            this.options.host.focus({preventScroll: true});
        }
        this.suppressLinkClick = true;
        this.pinching = true;
        const [first, second] = Array.from(event.touches);
        const bounds = this.viewport.getBoundingClientRect();
        this.pinch = {distance: Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY), scale: this.scale,
            x: (first.clientX + second.clientX) / 2 - bounds.left, y: (first.clientY + second.clientY) / 2 - bounds.top};
    };

    private pinchMove = (event: TouchEvent) => {
        if (!this.pinching) {
            return;
        }
        event.preventDefault();
        if (!this.pinch || event.touches.length !== 2 || this.pinch.distance === 0) {
            return;
        }
        const [first, second] = Array.from(event.touches);
        const bounds = this.viewport.getBoundingClientRect();
        const x = (first.clientX + second.clientX) / 2 - bounds.left;
        const y = (first.clientY + second.clientY) / 2 - bounds.top;
        this.offsetX += x - this.pinch.x;
        this.offsetY += y - this.pinch.y;
        this.pinch.x = x;
        this.pinch.y = y;
        const distance = Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
        // 起始容差过滤平移时的间距抖动，进入缩放后保留连续的捏合反馈。
        this.pinch.zooming ||= Math.abs(distance - this.pinch.distance) > Math.max(8, this.pinch.distance * .04);
        this.zoomAt(this.pinch.zooming ? this.pinch.scale * distance / this.pinch.distance : this.pinch.scale, x, y);
    };

    private pinchEnd = (event: TouchEvent) => {
        if (!this.pinching) {
            return;
        }
        event.preventDefault();
        this.pinch = undefined;
        // 双指结束后等待所有手指离开，避免剩余手指触发节点拖动或点击。
        if (event.touches.length === 0) {
            this.pinching = false;
        } else if (event.touches.length === 2) {
            this.pinchStart(event);
        }
    };

    private isTemporaryPan(event: PointerEvent) {
        return event.button === 1 || event.button === 2 && (event.ctrlKey || event.metaKey);
    }

    public isPanTarget(event: PointerEvent) {
        const target = event.target as HTMLElement;
        return !this.locked && !this.pinching && (event.button === 1 || event.button === 2 || !this.relationFrom) &&
            (event.pointerType !== "touch" || this.interactionActive || !!this.fullscreenMarker) &&
            (event.pointerType !== "touch" || event.isPrimary) && [0, 1, 2].includes(event.button) &&
            this.viewport.contains(target) && target.closest(".mindmap-view") === this.options.host &&
            !target.closest("button, input, select, textarea, audio, video, iframe, .mindmap-view__node--editing") &&
            (this.panning || event.button === 1 || event.button === 2 ||
                event.pointerType === "touch" && !target.closest(".mindmap-view__node, .mindmap-view__summary") &&
                !this.findLine(event));
    }

    private pointerDown = (event: PointerEvent) => {
        if (this.locked || this.pinching || event.pointerType === "touch" &&
            (!event.isPrimary || !this.interactionActive && !this.fullscreenMarker)) {
            return;
        }
        clearTimeout(this.linkTimer);
        this.suppressLinkClick = false;
        this.suppressPanContextMenu = false;
        const target = event.target as HTMLElement;
        if (![0, 1, 2].includes(event.button) || target.closest("button, input, select, textarea, audio, video, iframe") ||
            this.viewport.contains(target.closest(".mindmap-view__node--editing"))) {
            return;
        }
        if (event.button === 0 && !this.panning && target.closest(".mindmap-view__summary")) {
            return;
        }
        this.suppressPanContextMenu = event.button === 2;
        const element = target.closest<HTMLElement>(".mindmap-view__node");
        const id = element?.dataset.mindmapId;
        if (event.pointerType !== "touch") {
            // 画布接管指针时阻止浏览器启动文字划选，节点编辑器保留原生选区。
            event.preventDefault();
        }
        this.preparePointer(event);
        if ((this.editingId || this.isTemporaryPan(event)) && this.isPanTarget(event)) {
            // 平移只改变画布位置，保留节点编辑器及其文字选区。
            event.preventDefault();
            this.beginPointer(event);
            return;
        }
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
        if (this.panning || event.button === 1 || event.button === 2) {
            id = undefined;
            event.preventDefault();
        }
        if (event.button === 0 && !this.panning && !id && !this.readOnly && !this.relationFrom) {
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
            if (event.pointerType !== "touch" || event.ctrlKey || event.metaKey || this.multiSelect) {
                this.selectNode(id, event.button === 0 && (event.ctrlKey || event.metaKey || this.multiSelect));
            }
            if (event.ctrlKey || event.metaKey || this.multiSelect) {
                this.suppressLinkClick = true;
                this.options.host.focus({preventScroll: true});
                this.focusSelectionInput();
                this.cancelPointer();
                return;
            }
        }
        if ((!this.editingId || id) && !this.isTemporaryPan(event)) {
            this.options.host.focus({preventScroll: true});
            this.focusSelectionInput();
        }
        // 在捕获指针改变悬停状态前记录控件所属节点，避免拖动时重算整张脑图。
        const hiddenControls = Array.from(this.world.querySelectorAll<HTMLElement>(
            ".mindmap-view__node--selected, .mindmap-view__node--line-hover, " +
            ".mindmap-view__node:hover, .mindmap-view__node:focus-within"))
            .filter(element => element.closest(".mindmap-view") === this.options.host);
        this.pointer = {
            pointerId: event.pointerId,
            panButton: event.button === 1 || event.button === 2,
            pan: this.panning || event.button === 1 || event.button === 2 || event.pointerType === "touch",
            id: event.pointerType !== "touch" && !this.readOnly && id && !this.model.nodes.get(id)?.virtual ? id : undefined,
            nodeId: id,
            touchNode: event.pointerType === "touch" && !this.readOnly && this.options.onMove &&
                id !== this.model.root.id && this.model.nodes.has(id) && !this.model.nodes.get(id).virtual ? id : undefined,
            startX: event.clientX,
            startY: event.clientY,
            x: this.offsetX,
            y: this.offsetY,
            moved: false,
            hiddenControls,
            selection: !id && event.button === 0 && !this.panning && !this.relationFrom &&
                event.pointerType !== "touch" ? (event.ctrlKey || event.metaKey ? this.getSelectedIds() : []) : undefined,
        };
        try {
            // 在原点击元素捕获指针，保留链接目标，同时让连续点击可以识别为双击。
            this.pointerCapture = id ? event.target as HTMLElement : this.viewport;
            this.pointerCapture.setPointerCapture(event.pointerId);
            if (this.pointer.touchNode) {
                this.startTouchNodeDrag(this.pointer);
            }
        } catch {
            this.cancelPointer();
        }
    }

    private startTouchNodeDrag(pointer: PointerState) {
        if (!pointer.touchNode) {
            return;
        }
        // 快速滑动始终平移；只有在原节点上长按完成后才允许改变导图结构。
        pointer.touchDragTimer = window.setTimeout(() => {
            pointer.touchDragTimer = undefined;
            if (this.pointer !== pointer || pointer.moved || this.readOnly || this.pinching || this.panning ||
                this.multiSelect || this.relationFrom ||
                this.destroyed || !this.model.nodes.has(pointer.touchNode)) {
                return;
            }
            pointer.id = pointer.touchNode;
            pointer.pan = false;
            this.selectNode(pointer.id);
            this.inspector.hidden = true;
            this.suppressLinkClick = true;
            this.nodeElements.get(pointer.id)?.classList.add("mindmap-view__node--drag-ready");
        }, Constants.TIMEOUT_LONGPRESS);
    }

    private pointerMove = (event: PointerEvent) => {
        if (this.pinching) {
            return;
        }
        if (this.relationFrom && !this.pointer?.panButton) {
            const bounds = this.viewport.getBoundingClientRect();
            const id = (event.target as Element).closest<HTMLElement>(".mindmap-view__node")?.dataset.mindmapId;
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
            const relation = target.closest<HTMLElement>(".mindmap-view__relation[data-relation-id]");
            const summary = target.closest<HTMLElement>(".mindmap-view__summary[data-summary-id]");
            const line = target.closest(".mindmap-view__node, input, button") ? undefined : this.findLine(event);
            this.setHoveredLine(summary ? `summary:${summary.dataset.summaryId}` : relation ? `relation:${relation.dataset.relationId}` :
                line ? `${line.summary ? "summary" : line.relation ? "relation" : "edge"}:${line.id}` : undefined);
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
        clearTimeout(pointer.touchDragTimer);
        pointer.touchDragTimer = undefined;
        event.preventDefault();
        if (!pointer.moved && (pointer.id || pointer.pan)) {
            pointer.hiddenControls?.forEach(element => element.classList.add("mindmap-view__node--hide-controls"));
        }
        pointer.moved = true;
        if (pointer.selection) {
            const viewport = this.viewport.getBoundingClientRect();
            const left = Math.min(pointer.startX, event.clientX);
            const right = Math.max(pointer.startX, event.clientX);
            const top = Math.min(pointer.startY, event.clientY);
            const bottom = Math.max(pointer.startY, event.clientY);
            this.selectionBox.hidden = false;
            this.selectionBox.style.cssText = `left:${left - viewport.left}px;top:${top - viewport.top}px;` +
                `width:${right - left}px;height:${bottom - top}px`;
            this.selectedIds.clear();
            pointer.selection.forEach(id => this.selectedIds.add(id));
            this.nodeElements.forEach((element, id) => {
                if (!this.positions.has(id) || this.model.nodes.get(id)?.virtual) {
                    return;
                }
                const rect = element.getBoundingClientRect();
                if (rect.left + rect.width / 2 >= left && rect.left + rect.width / 2 <= right &&
                    rect.top + rect.height / 2 >= top && rect.top + rect.height / 2 <= bottom) {
                    this.selectedIds.add(id);
                }
            });
            this.selectedId = [...this.selectedIds][0];
            this.selectedRelation = this.selectedEdge = this.selectedSummary = undefined;
            this.inspector.hidden = true;
            this.updateSelection();
            return;
        }
        if (pointer.relation) {
            const drag = pointer.relation;
            if (drag.endpoint) {
                const bounds = this.viewport.getBoundingClientRect();
                drag.handle = {x: (event.clientX - bounds.left - this.offsetX) / this.scale,
                    y: (event.clientY - bounds.top - this.offsetY) / this.scale};
                drag.targetId = [...this.positions.values()].find(node => drag.handle.x >= node.x &&
                    drag.handle.x <= node.x + node.width && drag.handle.y >= node.y &&
                    drag.handle.y <= node.y + node.height)?.id;
                const relation = this.model.metadata.relations.find(item => item.id === drag.id);
                const original = this.positions.get(relation?.[drag.endpoint]);
                const tolerance = (event.pointerType === "touch" ? 16 : 8) / this.scale;
                // 真实节点命中优先于原节点的近边吸附，避免缩小时抢占换接目标。
                if (original && (!drag.targetId || drag.targetId === original.id) &&
                    drag.handle.x >= original.x - tolerance && drag.handle.x <= original.x + original.width + tolerance &&
                    drag.handle.y >= original.y - tolerance && drag.handle.y <= original.y + original.height + tolerance) {
                    drag.targetId = original.id;
                    const anchor = relation[drag.endpoint === "from" ? "fromAnchor" : "toAnchor"];
                    drag.anchor = {...anchor, ...projectMindmapRelationAnchor(original, drag.handle, drag.anchor || anchor)};
                    drag.handle = getMindmapRelationAnchorPoint(original, drag.anchor, 3);
                } else {
                    drag.anchor = undefined;
                }
            } else {
                drag.offset = (drag.points[drag.segment].y === drag.points[drag.segment + 1].y ? dy : dx) / this.scale;
            }
            if (!this.routeDragFrame) {
                this.routeDragFrame = requestAnimationFrame(() => this.previewRouteDrag());
            }
            return;
        }
        if (!pointer.id && !pointer.pan) {
            return;
        }
        this.viewport.classList.add("mindmap-view__viewport--dragging");
        if (!pointer.id) {
            const bounded = this.boundedPan(pointer.x + dx, pointer.y + dy);
            this.offsetX = bounded.x;
            this.offsetY = bounded.y;
            this.requestDraw();
            pointer.x = this.offsetX;
            pointer.y = this.offsetY;
            pointer.startX = event.clientX;
            pointer.startY = event.clientY;
            return;
        }
        if (!this.ghost) {
            const source = this.nodeElements.get(pointer.id);
            this.ghost = source.cloneNode(true) as HTMLDivElement;
            this.ghost.className = "mindmap-view__node mindmap-view__node--selected mindmap-view__ghost";
            this.ghost.removeAttribute("data-mindmap-id");
            this.ghost.querySelectorAll(".mindmap-view__fold, .mindmap-view__add-child, .mindmap-view__add-bridge")
                .forEach(button => button.remove());
            this.world.append(this.ghost);
            source.classList.add("mindmap-view__node--dragging");
        }
        const source = this.positions.get(pointer.id);
        this.ghost.style.left = `${source.x + dx / this.scale}px`;
        this.ghost.style.top = `${source.y + dy / this.scale}px`;
        this.clearDrop();
        const hit = document.elementFromPoint(event.clientX, event.clientY);
        let target = hit?.closest<HTMLElement>(".mindmap-view__node");
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
        if (placement !== "child" && !node.parentId) {
            return;
        }
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
        if (pointer.selection && moved) {
            this.suppressLinkClick = true;
            this.cancelPointer();
            this.inspector.hidden = !this.selectedId || this.readOnly;
            this.updateSelection();
            this.renderInspector();
            return;
        }
        if (pointer.relation) {
            if (moved) {
                this.previewRouteDrag();
            }
            const drag = pointer.relation;
            this.cancelPointer();
            const relation = this.model.metadata.relations.find(item => item.id === drag.id);
            if (moved && drag.endpoint && drag.valid && relation && !this.readOnly &&
                this.canReconnectRelation(relation, drag.endpoint, drag.targetId)) {
                const anchorKey = drag.endpoint === "from" ? "fromAnchor" : "toAnchor";
                if (relation[drag.endpoint] === drag.targetId) {
                    if (drag.anchor && JSON.stringify(relation[anchorKey]) !== JSON.stringify(drag.anchor)) {
                        this.options.onRelationChange?.(drag.id, {[anchorKey]: drag.anchor}, drag.original);
                    }
                } else {
                    const patch: Partial<ListMindmapRelation> = {[drag.endpoint]: drag.targetId, route: undefined};
                    if (relation[anchorKey]) {
                        patch[anchorKey] = undefined;
                    }
                    this.options.onRelationChange?.(drag.id, patch, drag.original);
                }
            } else if (moved && !drag.endpoint && Math.abs(drag.offset) > .01 && drag.valid && drag.route && !this.readOnly) {
                this.options.onRelationChange?.(drag.id, {route: drag.route}, drag.original);
            }
            return;
        }
        this.suppressLinkClick = moved || !!pointer.touchNode && !!id;
        this.cancelPointer();
        if (!moved && !id && event.pointerType === "touch" && pointer.nodeId && !this.panning) {
            this.selectNode(pointer.nodeId);
        }
        if (moved && id && targetId && placement) {
            this.options.onMove?.(id, targetId, placement);
        } else if (!moved && !pointer.nodeId && !pointer.panButton && !this.readOnly && !this.panning) {
            if (this.editingId) {
                this.clearSelection();
            }
            this.finishThen(() => {
                this.options.host.focus({preventScroll: true});
                this.clearSelection();
                this.selectLine(event);
            });
        }
    };

    private setHoveredLine(key?: string) {
        if (key === this.hoveredLine) {
            return;
        }
        if (this.hoveredLine?.startsWith("edge:")) {
            this.nodeElements.get(this.hoveredLine.slice(5))?.classList.remove("mindmap-view__node--line-hover");
        }
        this.hoveredLine = key;
        if (key?.startsWith("edge:")) {
            this.nodeElements.get(key.slice(5))?.classList.add("mindmap-view__node--line-hover");
        }
        this.viewport.classList.toggle("mindmap-view__viewport--line-hover", !!key);
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
            item.arrows?.forEach(tip => {
                const current = Math.hypot(tip.x - x, tip.y - y);
                if (current < distance || (arrow && current === distance && item.id === this.selectedRelation)) {
                    distance = current;
                    arrow = item;
                }
            });
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
        if (line.summary) {
            this.selectSummary(line.id);
            return;
        }
        this.selectedSummary = undefined;
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
        clearTimeout(pointer?.touchDragTimer);
        pointer?.hiddenControls?.forEach(element => element.classList.remove("mindmap-view__node--hide-controls"));
        this.selectionBox.hidden = true;
        if (pointer && this.pointerCapture?.hasPointerCapture(pointer.pointerId)) {
            this.pointerCapture.releasePointerCapture(pointer.pointerId);
        }
        this.pointerCapture = undefined;
        this.endInteraction?.();
        this.endInteraction = undefined;
        this.ghost?.remove();
        this.ghost = undefined;
        this.viewport.classList.remove("mindmap-view__viewport--dragging");
        this.nodeElements.forEach(element => element.classList.remove("mindmap-view__node--dragging", "mindmap-view__node--drag-ready"));
        if (pointer?.relation) {
            if (pointer.relation.endpoint) {
                this.nodeElements.forEach(element => element.classList.remove("mindmap-view__node--relation"));
            }
            this.relationRoutes.set(pointer.relation.id, pointer.relation.points);
            this.draw();
            this.refreshLayout();
        }
    };

    private contentClick = (event: MouseEvent) => {
        const target = event.target as Element;
        if (this.viewport.contains(target.closest(".mindmap-view__node--editing"))) {
            return;
        }
        const link = target.closest<HTMLElement>('a[href], [data-type~="a"][data-href], [data-type~="block-ref"][data-id]');
        if (!link?.closest(".mindmap-view__content")) {
            return;
        }
        clearTimeout(this.linkTimer);
        if (this.panning || this.suppressLinkClick || this.relationFrom || this.multiSelect || event.detail > 1) {
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
        if (this.relationFrom || this.multiSelect || this.panning || this.pinching) {
            return;
        }
        const target = event.target as HTMLElement;
        if (target.tagName === "IMG" && !target.classList.contains("emoji") &&
            !target.closest('[data-subtype="plantuml"]') &&
            !this.viewport.contains(target.closest(".mindmap-view__node--editing")) && this.options.onPreviewImage) {
            event.preventDefault();
            event.stopPropagation();
            this.cancelPointer();
            const src = target.getAttribute("src");
            const video = target.getAttribute(Constants.CUSTOM_SY_LIVE_PHOTO) === "1" ?
                target.getAttribute(Constants.CUSTOM_SY_LIVE_PHOTO_VIDEO) || "" : "";
            this.finishThen(() => this.options.onPreviewImage(src, video));
            return;
        }
        if (this.readOnly) {
            return;
        }
        this.setInteractionActive(true);
        const summary = target.closest<HTMLElement>(".mindmap-view__summary");
        if (summary) {
            this.editSummaryLabel(summary.dataset.summaryId);
            return;
        }
        if (target.closest(".mindmap-view__relation")) {
            this.editRelationLabel(event);
            return;
        }
        if (target.closest("button, input, select, audio, video, iframe") ||
            this.viewport.contains(target.closest(".mindmap-view__node--editing"))) {
            return;
        }
        const id = target.closest<HTMLElement>(".mindmap-view__node")?.dataset.mindmapId;
        if (!id) {
            this.selectLine(event);
            if (this.selectedRelation) {
                this.editRelationLabel(event);
            } else if (this.selectedSummary) {
                this.editSummaryLabel(this.selectedSummary);
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
            const content = this.getContentHost(id);
            if (!content?.isConnected || !this.model.nodes.has(id)) {
                return;
            }
            if (this.model.nodes.get(id)?.virtual) {
                this.editRootTitle(id);
                return;
            }
            this.setEditing(id);
            this.options.onEdit?.(id, content);
        });
    };

    private editRootTitle(id: string, toEnd = false, replaceText?: string) {
        this.finishRelationEdit?.(true);
        const content = this.getContentHost(id);
        const input = createElement("textarea", "mindmap-view__root-title");
        const measure = createElement("span", "mindmap-view__root-title-measure");
        input.rows = 1;
        input.value = replaceText === undefined ? this.model.metadata.rootTitle || "" : replaceText;
        measure.textContent = input.value;
        input.setAttribute("aria-label", this.label("text"));
        content.classList.add("mindmap-view__root-title-host");
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
            content.classList.remove("mindmap-view__root-title-host");
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
        if (toEnd || replaceText !== undefined) {
            input.setSelectionRange(input.value.length, input.value.length);
        } else {
            input.select();
        }
    }

    private editRelationLabel(event?: MouseEvent) {
        const relation = this.model.metadata.relations.find(item => item.id === this.selectedRelation);
        const element = this.relationElements.get(this.selectedRelation);
        if (!relation || !element) {
            return;
        }
        event?.preventDefault();
        event?.stopPropagation();
        this.finishRelationEdit?.(true);
        this.inspector.hidden = true;
        const input = createElement("input", "b3-text-field mindmap-view__relation mindmap-view__relation-editor");
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
        this.stopFoldAnimation?.();
        if (this.locked || this.viewport.contains((event.target as HTMLElement).closest(".mindmap-view__node--editing"))) {
            return;
        }
        if (this.pointer?.relation) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        const mode = event.deltaMode;
        const unitX = mode === WheelEvent.DOM_DELTA_LINE ? 16 :
            mode === WheelEvent.DOM_DELTA_PAGE ? this.viewport.clientWidth : 1;
        const unitY = mode === WheelEvent.DOM_DELTA_LINE ? 16 :
            mode === WheelEvent.DOM_DELTA_PAGE ? this.viewport.clientHeight : 1;
        // 浏览器将触控板捏合转换为带 Ctrl 的滚轮事件，和鼠标组合滚轮共用光标锚点缩放。
        if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            event.stopPropagation();
            const bounds = this.viewport.getBoundingClientRect();
            const delta = Math.max(-24, Math.min(24, event.deltaY * unitY));
            this.zoomAt(this.scale * Math.exp(-delta * .01),
                event.clientX - bounds.left, event.clientY - bounds.top);
            return;
        }
        if (!this.interactionActive && !this.fullscreenMarker) {
            return;
        }
        const next = this.boundedPan(this.offsetX - (event.shiftKey ?
            (event.deltaX ? event.deltaX : event.deltaY) * unitX : event.deltaX * unitX),
            this.offsetY - (event.shiftKey ? 0 : event.deltaY * unitY));
        event.preventDefault();
        event.stopPropagation();
        this.offsetX = next.x;
        this.offsetY = next.y;
        this.draw();
    };

    private boundedPan(x: number, y: number) {
        const rectangles = this.contentRectangles();
        const {left, top, right, bottom} = this.contentBounds(rectangles);
        const axis = x === this.offsetX && y !== this.offsetY ? "y" :
            y === this.offsetY && x !== this.offsetX ? "x" : undefined;
        return clampMindmapPanPosition(
            clampMindmapPanOffset(x, left, right, this.scale, this.viewport.clientWidth),
            clampMindmapPanOffset(y, top, bottom, this.scale, this.viewport.clientHeight),
            rectangles, this.scale, this.viewport.clientWidth, this.viewport.clientHeight, axis);
    }

    private zoomAt(scale: number, x = this.viewport.clientWidth / 2, y = this.viewport.clientHeight / 2) {
        if (this.locked) {
            return;
        }
        const next = Math.min(2.5, Math.max(.15, scale));
        this.offsetX = x - (x - this.offsetX) * next / this.scale;
        this.offsetY = y - (y - this.offsetY) * next / this.scale;
        this.scale = next;
        const bounded = this.boundedPan(this.offsetX, this.offsetY);
        this.offsetX = bounded.x;
        this.offsetY = bounded.y;
        this.draw();
    }

    private contentRectangles(): MindmapPanRect[] {
        const rectangles: MindmapPanRect[] = [];
        this.positions.forEach(node => rectangles.push({x: node.x, y: node.y - 1, width: node.width, height: node.height + 1}));
        this.summaryPositions.forEach(summary => rectangles.push({
            x: summary.labelX, y: summary.labelY, width: summary.width, height: summary.height,
        }));
        this.relationElements.forEach(element => {
            if (!element.hidden && element.style.visibility !== "hidden") {
                const x = parseFloat(element.style.left);
                const y = parseFloat(element.style.top);
                if (Number.isFinite(x) && Number.isFinite(y)) {
                    rectangles.push({x: x - element.offsetWidth / 2, y: y - element.offsetHeight / 2,
                        width: element.offsetWidth, height: element.offsetHeight});
                }
            }
        });
        return rectangles;
    }

    private contentBounds(rectangles = this.contentRectangles()) {
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
        rectangles.forEach(rectangle => include(rectangle.x, rectangle.y, rectangle.width, rectangle.height));
        this.relationRoutes.forEach(points => points.forEach(point => include(point.x, point.y)));
        this.summaryPositions.forEach(summary => {
            include(summary.x - 10, summary.top, summary.labelX + summary.width - summary.x + 10, summary.bottom - summary.top);
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
        this.options.host.style.setProperty("--mindmap-view-print-height", `${Math.ceil((bottom - top) * this.scale + 26)}px`);
        this.offsetX = (width - (right - left) * this.scale) / 2 - left * this.scale;
        this.offsetY = 12 - top * this.scale;
        this.draw();
    }

    public fit(maxScale = 1) {
        this.stopFoldAnimation?.();
        const width = this.viewport.clientWidth;
        const height = this.viewport.clientHeight;
        if (!this.positions.size || !width || !height) {
            return;
        }
        // 先更新关系文字的位置，再按画布上下留白缩放并居中。
        this.draw();
        const {left, top, right, bottom} = this.contentBounds();
        const viewport = this.viewport.getBoundingClientRect();
        const scaleY = viewport.height / (this.viewport.offsetHeight || viewport.height) || 1;
        let insetTop = 16;
        // 只为全屏常驻按钮组预留空间，文档内工具栏和临时浮层不缩小整图适配范围。
        const toolbarBounds = this.options.host.classList.contains("fullscreen") ? this.getToolbarBounds(false) : [];
        toolbarBounds.forEach(bounds => {
            if (bounds.right > viewport.left && bounds.left < viewport.right &&
                bounds.bottom > viewport.top && bounds.top < viewport.bottom) {
                insetTop = Math.max(insetTop, (bounds.bottom - viewport.top) / scaleY + 16);
            }
        });
        const insetBottom = 16;
        const availableWidth = Math.max(1, width - 48);
        const availableHeight = Math.max(1, height - insetTop - insetBottom);
        this.scale = Math.min(maxScale, Math.max(.15, Math.min(availableWidth / Math.max(1, right - left),
            availableHeight / Math.max(1, bottom - top))));
        this.offsetX = width / 2 - (left + right) * this.scale / 2;
        // 达到最小缩放仍无法容纳整图时，优先保证顶部正文留在可用区域内。
        this.offsetY = (bottom - top) * this.scale > availableHeight ? insetTop - top * this.scale :
            insetTop + availableHeight / 2 - (top + bottom) * this.scale / 2;
        this.draw();
    }

    private copySelection = (event: ClipboardEvent) => {
        const cut = event.type === "cut";
        if (event.defaultPrevented || this.editingId || this.relationFrom || this.selectionComposing ||
            cut && this.readOnly || !this.options.onCopy || !this.getSelectedIds().length ||
            (event.target !== this.selectionInput && (event.target as HTMLElement).isContentEditable) ||
            (event.target as HTMLElement).closest("input, textarea, select")) {
            return;
        }
        event.preventDefault();
        this.options.onCopy(this.getSelectedIds(), cut, cut ? undefined : event);
    };

    private pasteSelection = (event: ClipboardEvent) => {
        if (event.defaultPrevented || this.readOnly || this.editingId || this.relationFrom || this.selectionComposing ||
            !this.options.onPaste || this.getSelectedIds().length !== 1 ||
            (event.target !== this.selectionInput && (event.target as HTMLElement).isContentEditable) ||
            (event.target as HTMLElement).closest("input, textarea, select")) {
            return;
        }
        const id = this.selectedId;
        const node = this.model.nodes.get(id);
        const data: IClipboardData = {
            files: Array.from(event.clipboardData?.files || []),
            textPlain: event.clipboardData?.getData("text/plain"),
            textHTML: event.clipboardData?.getData("text/html"),
            siyuanHTML: event.clipboardData?.getData("text/siyuan"),
        };
        const kind = this.pasteSibling ? "sibling" : "child";
        this.pasteSibling = false;
        if (!node || !node.parentId && kind === "sibling" ||
            !data.files.length && !data.textPlain && !data.textHTML && !data.siyuanHTML) {
            return;
        }
        event.preventDefault();
        this.finishThen(() => {
            if (!this.readOnly && this.selectedId === id && this.model.nodes.has(id)) {
                this.options.onPaste(id, kind, data);
            }
        });
    };

    private keyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape" && this.inspectorPanel) {
            const anchor = this.inspectorPanel.anchor;
            this.closeInspectorPanel();
            anchor.focus({preventScroll: true});
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (this.locked) {
            if (event.key === "Escape" && this.fullscreenMarker) {
                event.preventDefault();
                this.toggleFullscreen();
            }
            return;
        }
        const selectionInput = event.target === this.selectionInput;
        if (selectionInput && (this.selectionComposing || this.selectionCompositionEnding || event.isComposing ||
            event.key === "Process" || event.key === "Dead" || event.keyCode === 229 ||
            !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== " " && Array.from(event.key).length === 1)) {
            // 原生输入事件提供实际文本，keydown 的字母不能代替输入法结果。
            event.stopPropagation();
            return;
        }
        const target = selectionInput ? this.options.host : event.target as HTMLElement;
        const startingComposition = event.isComposing || event.key === "Process" || event.key === "Dead" ||
            event.keyCode === 229;
        if (target.closest("input, textarea, select, audio, video, iframe") ||
            this.viewport.contains(target.closest(".mindmap-view__node--editing"))) {
            return;
        }
        if (target.closest("button") && (event.key === "Enter" || event.key === " ")) {
            return;
        }
        if (this.pointer?.relation && event.key !== "Escape") {
            return;
        }
        if (!startingComposition && !this.editingId && !this.relationFrom &&
            (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey &&
            ["c", "x"].includes(event.key.toLowerCase()) && this.options.onCopy && this.getSelectedIds().length) {
            const cut = event.key.toLowerCase() === "x";
            if (!cut || !this.readOnly) {
                event.preventDefault();
                event.stopPropagation();
                this.options.onCopy(this.getSelectedIds(), cut);
            }
            return;
        }
        if (!startingComposition && (event.ctrlKey || event.metaKey) && !event.altKey &&
            event.key.toLowerCase() === "v" && !this.editingId && !this.relationFrom &&
            !this.readOnly && this.options.onPaste && this.getSelectedIds().length === 1) {
            this.pasteSibling = event.shiftKey;
            // Shift+V 在部分宿主中会被解释为纯文本粘贴，直接读取完整载荷以保留节点结构。
            if (event.shiftKey) {
                event.preventDefault();
                this.pasteSibling = false;
                if (this.model.nodes.get(this.selectedId)?.parentId) {
                    this.options.onPaste(this.selectedId, "sibling");
                }
            }
            event.stopPropagation();
            return;
        }
        const noModifiers = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
        const siblingShortcut = !startingComposition &&
            (event.key === "Enter" && noModifiers || this.options.isAddSiblingShortcut?.(event));
        const childShortcut = !startingComposition &&
            (event.key === "Tab" && noModifiers || this.options.isAddChildShortcut?.(event));
        const text = !startingComposition && !event.ctrlKey && !event.metaKey && !event.altKey &&
            event.key !== " " && Array.from(event.key).length === 1 ? event.key : undefined;
        const isTaskCompletionToggle = !startingComposition && this.options.isTaskCompletionToggle?.(event);
        if (!startingComposition && !this.readOnly &&
            (isTaskCompletionToggle || this.options.isTaskCycle?.(event))) {
            const id = target.closest<HTMLElement>(".mindmap-view__node")?.dataset.mindmapId || this.selectedId;
            if (this.model.nodes.get(id)?.taskMarker !== undefined) {
                event.preventDefault();
                event.stopPropagation();
                if (!event.repeat) {
                    this.finishThen(() => {
                        if (!this.readOnly) {
                            this.options.onTaskToggle?.(id, !isTaskCompletionToggle);
                        }
                    });
                }
            }
            return;
        }
        if (!startingComposition && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", " "].includes(event.key) &&
            !this.editingId && !this.relationFrom && this.selectedId &&
            noModifiers &&
            !target.isContentEditable && !target.closest("button, a")) {
            const node = this.model.nodes.get(this.selectedId);
            if (!node) {
                return;
            }
            if (event.key === " ") {
                if (this.readOnly || event.repeat) {
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
                } else {
                    // 按层遍历可见节点，让上下导航跨越父节点，并跳过折叠分支。
                    let level = [this.model.root];
                    while (level.length) {
                        const index = level.findIndex(item => item.id === node.id);
                        if (index >= 0) {
                            next = level[index + (event.key === "ArrowUp" ? -1 : 1)]?.id;
                            break;
                        }
                        level = level.flatMap(item => (this.folded.get(item.id) ?? item.collapsed) ? [] : item.children);
                    }
                }
                if (next) {
                    this.focusNode(next);
                }
            }
        } else if (!this.readOnly && !this.editingId && !this.relationFrom && this.selectedId &&
            (text !== undefined || startingComposition && !event.ctrlKey && !event.metaKey && !event.altKey) &&
            !target.isContentEditable && !target.closest("button, a")) {
            const id = this.selectedId;
            if (event.repeat) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            this.finishThen(() => {
                const node = this.model.nodes.get(id);
                if (this.selectedId !== id || !node) {
                    return;
                }
                if (node.virtual) {
                    this.editRootTitle(id, false, text);
                } else {
                    this.setEditing(id);
                    this.options.onEdit?.(id, this.getContentHost(id), text ?? "");
                }
            });
            if (startingComposition) {
                event.stopPropagation();
                return;
            }
        } else if (!this.readOnly && !this.editingId && !this.relationFrom && this.selectedId &&
            (siblingShortcut || childShortcut) &&
            !target.isContentEditable && !target.closest("button, a")) {
            if (event.repeat) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            const id = this.selectedId;
            const node = this.model.nodes.get(id);
            const kind = siblingShortcut ? "sibling" : "child";
            if (!node || (kind === "sibling" && node.virtual)) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            this.finishThen(() => {
                if (this.selectedId === id) {
                    this.options.onAdd?.(id, kind);
                }
            });
        } else if (!startingComposition && (event.key === "Delete" || event.key === "Backspace") &&
            !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
            const selectedId = this.selectedId;
            const selectedRelation = this.selectedRelation;
            const selectedSummary = this.selectedSummary;
            this.finishThen(() => {
                if (selectedId === this.selectedId && selectedRelation === this.selectedRelation && selectedSummary === this.selectedSummary) {
                    this.deleteSelection();
                }
            });
        } else if (!startingComposition && event.key === "Escape") {
            const draggingRoute = !!this.pointer?.relation;
            this.cancelPointer();
            if (draggingRoute) {
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            this.relationFrom = undefined;
            this.multiSelect = false;
            this.inspector.hidden = true;
            if (this.fullscreenMarker) {
                this.exitFullscreen();
            } else {
                this.setInteractionActive(false);
            }
            this.updateSelection();
        } else {
            return;
        }
        if (event.key !== "Escape") {
            this.setInteractionActive(true);
        }
        event.preventDefault();
        event.stopPropagation();
    };

    private closeInspectorPanel() {
        const panel = this.inspectorPanel;
        this.inspectorPanel = undefined;
        this.inspectorPopover.hidden = true;
        panel?.anchor.setAttribute("aria-expanded", "false");
        if (panel?.preview && !this.destroyed) {
            this.previewNodeWidths(this.nodeWidths(panel.ids));
        }
    }

    private nodeWidths(ids: string[]) {
        return ids.map(id => ({id, width: this.model.metadata.nodes[id]?.width || 0}));
    }

    private openInspectorPanel(kind: "color" | "width", anchor: HTMLButtonElement) {
        if (this.readOnly || this.inspector.hidden || anchor.disabled) {
            return;
        }
        if (this.inspectorPanel?.kind !== kind) {
            this.closeInspectorPanel();
            const ids = this.getSelectedIds();
            this.inspectorPanel = {kind, ids, anchor, widths: this.nodeWidths(ids), slider: 0, preview: false,
                baseWidth: Math.max(32, this.positions.get(this.selectedId)?.width || 32)};
        }
        anchor.setAttribute("aria-expanded", "true");
        this.renderInspectorPanel();
    }

    private queueInspectorLayout(reveal = false) {
        if (this.destroyed || this.inspector.hidden && !reveal) {
            return;
        }
        this.revealInspectorHost ||= reveal;
        if (this.inspectorFrame) {
            return;
        }
        this.inspectorFrame = requestAnimationFrame(() => {
            this.inspectorFrame = 0;
            const revealHost = this.revealInspectorHost;
            this.revealInspectorHost = false;
            if (this.destroyed) {
                return;
            }
            if (this.inspector.hidden || this.readOnly) {
                return;
            }
            if (revealHost && !this.pointer && !this.pinching && !this.fullscreenMarker) {
                this.revealInspectorContainer();
            }
            this.positionInspector();
        });
    }

    private revealInspectorContainer() {
        // 只有能完整放入编辑区的脑图才滚动文档；高画布保持当前位置并让操作栏跟随可见区域。
        for (let parent = this.options.host.parentElement; parent; parent = parent.parentElement) {
            const host = this.options.host.getBoundingClientRect();
            const clip = this.getViewportClip();
            if (!host.height || host.height > clip.bottom - clip.top) {
                return;
            }
            const delta = host.top < clip.top ? host.top - clip.top : Math.max(0, host.bottom - clip.bottom);
            if (Math.abs(delta) < 1) {
                return;
            }
            if (parent.scrollHeight > parent.clientHeight &&
                /^(auto|scroll|overlay)$/.test(getComputedStyle(parent).overflowY)) {
                const scale = parent.getBoundingClientRect().height / parent.offsetHeight || 1;
                parent.scrollBy({top: delta / scale, behavior: "instant"});
            }
        }
    }

    private getVisibleViewportBounds() {
        const bounds = this.viewport.getBoundingClientRect();
        const clip = this.getViewportClip();
        return {left: Math.max(bounds.left, clip.left), right: Math.min(bounds.right, clip.right),
            top: Math.max(bounds.top, clip.top), bottom: Math.min(bounds.bottom, clip.bottom)};
    }

    private positionInspector() {
        const host = this.options.host.getBoundingClientRect();
        const visible = this.getVisibleViewportBounds();
        const scaleX = host.width / this.options.host.offsetWidth || 1;
        const scaleY = host.height / this.options.host.offsetHeight || 1;
        const width = (visible.right - visible.left) / scaleX - 16;
        this.inspector.style.maxWidth = `${Math.max(0, width)}px`;
        this.inspector.style.left = `${((visible.left + visible.right) / 2 - host.left) / scaleX -
            this.options.host.clientLeft}px`;
        this.inspector.style.bottom = `${this.options.host.clientTop + this.options.host.clientHeight -
            (visible.bottom - host.top) / scaleY + 8}px`;
        // 可见条带放不下操作栏时保留选择，滚动回足够的空间后恢复显示。
        this.inspector.style.visibility = width <= 0 ||
            (visible.bottom - visible.top) / scaleY < this.inspector.offsetHeight + 16 ? "hidden" : "";
        this.positionInspectorPanel();
    }

    private positionInspectorPanel() {
        if (this.destroyed || this.inspectorPopover.hidden || !this.inspectorPanel) {
            return;
        }
        const host = this.options.host.getBoundingClientRect();
        const visible = this.getVisibleViewportBounds();
        const scaleX = host.width / this.options.host.offsetWidth || 1;
        const scaleY = host.height / this.options.host.offsetHeight || 1;
        const bar = this.inspector.getBoundingClientRect();
        const above = (bar.top - visible.top) / scaleY - 12;
        const below = (visible.bottom - bar.bottom) / scaleY - 12;
        const width = Math.max(0, (visible.right - visible.left) / scaleX - 16);
        this.inspectorPopover.style.maxWidth = `${width}px`;
        this.inspectorPopover.style.width = `${Math.min(width, bar.width / scaleX)}px`;
        const height = this.inspectorPopover.scrollHeight +
            this.inspectorPopover.offsetHeight - this.inspectorPopover.clientHeight;
        const placeAbove = above >= height || above >= below;
        const available = Math.max(0, placeAbove ? above : below);
        this.inspectorPopover.style.maxHeight = `${available}px`;
        this.inspectorPopover.style.visibility = this.inspector.style.visibility === "hidden" ||
            !width || !available ? "hidden" : "";
        const left = (bar.left - host.left) / scaleX - this.options.host.clientLeft;
        const minLeft = (visible.left - host.left) / scaleX - this.options.host.clientLeft + 8;
        this.inspectorPopover.style.left = `${Math.max(minLeft,
            Math.min(left, minLeft + width - this.inspectorPopover.offsetWidth))}px`;
        this.inspectorPopover.style.bottom = "";
        this.inspectorPopover.style.top = `${(placeAbove ? bar.top - host.top : bar.bottom - host.top) / scaleY -
            this.options.host.clientTop + (placeAbove ? -4 - this.inspectorPopover.offsetHeight : 4)}px`;
    }

    private previewNodeWidths(widths: {id: string, width: number}[]) {
        widths.forEach(({id, width}) => {
            const element = this.nodeElements.get(id);
            if (element) {
                element.style.width = width ? `${Math.max(32, width)}px` : "";
                element.style.maxWidth = width ? "none" : "";
            }
        });
        this.refreshLayout();
    }

    private async commitInspectorWidths(widths: {id: string, width: number}[]) {
        const panel = this.inspectorPanel;
        if (!panel || this.widthPending || this.readOnly || !this.options.onNodeWidths) {
            return;
        }
        const expected = JSON.stringify(this.nodeWidths(panel.ids));
        const focus = this.inspectorPopover.contains(document.activeElement) ?
            document.activeElement.getAttribute("data-width-control") : undefined;
        this.widthPending = true;
        try {
            await this.options.onNodeWidths(widths, expected);
        } catch (error) {
            console.error(error);
        } finally {
            this.widthPending = false;
            if (!this.destroyed) {
                panel.preview = false;
                this.previewNodeWidths(this.nodeWidths(panel.ids));
                if (this.inspectorPanel === panel) {
                    this.renderInspector();
                    if (focus) {
                        this.inspectorPopover.querySelector<HTMLInputElement>(`[data-width-control="${focus}"]`)?.focus({preventScroll: true});
                    }
                }
            }
        }
    }

    private makePaletteRow(palette: HTMLElement, controls: HTMLElement[], columns = 8) {
        palette.querySelectorAll(".color__square--current").forEach(control => {
            control.insertAdjacentHTML("beforeend",
                '<svg class="color__square-mark" aria-hidden="true"><use xlink:href="#iconSelect"></use></svg>');
        });
        // 滚轮手势期间暂停吸附，横向位移由浏览器处理，纵向位移累计后写入；触屏沿用原生滚动。
        let drag: {id: number, x: number, scroll: number, scale: number};
        let moved = false;
        let wheel: {position: number, direction: number, target?: number};
        let wheelFrame = 0;
        let wheelTimer: number;
        let settleTimer: number;
        let nativeScrolling = false;
        let nativeDirection = 0;
        const stopWheel = (restore = true) => {
            window.clearTimeout(wheelTimer);
            window.clearTimeout(settleTimer);
            cancelAnimationFrame(wheelFrame);
            wheelFrame = 0;
            if (wheel?.target !== undefined) {
                palette.scrollTo({left: palette.scrollLeft, behavior: "instant"});
            }
            wheel = undefined;
            nativeScrolling = false;
            if (restore && !drag) {
                palette.removeAttribute("data-scrolling");
            }
        };
        const snap = (direction = 0, position = palette.scrollLeft) => {
            if (drag || !palette.isConnected) {
                stopWheel();
                return;
            }
            cancelAnimationFrame(wheelFrame);
            wheelFrame = 0;
            const step = parseFloat(getComputedStyle(palette).gridTemplateColumns);
            if (!(step > 0)) {
                stopWheel();
                return;
            }
            // 纵向滚轮沿输入方向停靠，避免小于半列的滚动反复回到原列。
            const column = direction > 0 ? Math.ceil((position - .001) / step) :
                direction < 0 ? Math.floor((position + .001) / step) : Math.round(position / step);
            const target = Math.max(0, Math.min(palette.scrollWidth - palette.clientWidth, column * step));
            wheel = {position, direction, target};
            palette.setAttribute("data-scrolling", "");
            palette.scrollTo({left: target, behavior:
                window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth"});
            // 部分 WebView 没有 scrollend；超时后完成对齐并恢复原生吸附。
            settleTimer = window.setTimeout(() => {
                if (palette.isConnected) {
                    palette.scrollLeft = target;
                }
                stopWheel();
            }, 500);
        };
        const waitForNativeScroll = () => {
            window.clearTimeout(wheelTimer);
            wheelTimer = window.setTimeout(() => {
                nativeScrolling = false;
                snap(nativeDirection);
            }, 240);
        };
        palette.addEventListener("scroll", () => {
            if (nativeScrolling) {
                waitForNativeScroll();
            }
        }, {passive: true});
        palette.addEventListener("scrollend", () => {
            if (wheel?.target !== undefined && Math.abs(palette.scrollLeft - wheel.target) < 1) {
                stopWheel();
            }
        });
        palette.addEventListener("keydown", () => stopWheel());
        palette.addEventListener("pointerdown", (event: PointerEvent) => {
            stopWheel();
            moved = false;
            if (event.pointerType !== "mouse" || event.button !== 0 ||
                palette.scrollWidth <= palette.clientWidth) {
                return;
            }
            drag = {id: event.pointerId, x: event.clientX, scroll: palette.scrollLeft,
                scale: palette.getBoundingClientRect().width / palette.offsetWidth || 1};
        });
        const finishDrag = (event: PointerEvent) => {
            if (drag?.id === event.pointerId) {
                drag = undefined;
                if (moved) {
                    snap();
                }
            }
        };
        palette.addEventListener("pointerup", finishDrag);
        palette.addEventListener("pointercancel", finishDrag);
        palette.addEventListener("lostpointercapture", finishDrag);
        palette.addEventListener("pointerleave", () => {
            if (drag && !moved) {
                drag = undefined;
            }
        });
        palette.addEventListener("pointermove", (event: PointerEvent) => {
            if (!drag || event.pointerId !== drag.id) {
                return;
            }
            const delta = (event.clientX - drag.x) / drag.scale;
            if (!moved && Math.abs(delta) < 4) {
                return;
            }
            if (!moved) {
                moved = true;
                palette.setAttribute("data-scrolling", "");
                palette.setPointerCapture(event.pointerId);
                this.tooltip.hidden = true;
            }
            palette.scrollLeft = drag.scroll - delta;
            event.preventDefault();
        });
        palette.addEventListener("click", event => {
            if (moved && event.detail !== 0) {
                event.preventDefault();
                event.stopImmediatePropagation();
            }
            moved = false;
        }, {capture: true});
        palette.addEventListener("wheel", (event: WheelEvent) => {
            if (event.ctrlKey || event.metaKey || palette.scrollWidth <= palette.clientWidth) {
                stopWheel();
                return;
            }
            if (drag) {
                event.preventDefault();
                return;
            }
            // 同一横向手势即使末尾只剩纵向抖动，也由浏览器处理，避免轴向切换。
            if (event.deltaX || event.shiftKey || nativeScrolling) {
                if (!nativeScrolling) {
                    stopWheel(false);
                    nativeScrolling = true;
                    nativeDirection = 0;
                    palette.setAttribute("data-scrolling", "");
                }
                if (event.deltaX) {
                    nativeDirection = Math.sign(event.deltaX);
                } else if (event.shiftKey && event.deltaY) {
                    nativeDirection = Math.sign(event.deltaY);
                }
                waitForNativeScroll();
                return;
            }
            if (!event.deltaY) {
                return;
            }
            if (!wheel || wheel.target !== undefined) {
                stopWheel(false);
                wheel = {position: palette.scrollLeft, direction: 0};
                palette.setAttribute("data-scrolling", "");
            }
            const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 :
                event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? palette.clientWidth : 1;
            wheel.position = Math.max(0, Math.min(palette.scrollWidth - palette.clientWidth,
                wheel.position + event.deltaY * unit));
            wheel.direction = Math.sign(event.deltaY);
            if (!wheelFrame) {
                wheelFrame = requestAnimationFrame(() => {
                    wheelFrame = 0;
                    if (!palette.isConnected) {
                        stopWheel();
                    } else if (wheel) {
                        palette.scrollLeft = wheel.position;
                    }
                });
            }
            window.clearTimeout(wheelTimer);
            wheelTimer = window.setTimeout(() => snap(wheel?.direction, wheel?.position), 160);
            event.preventDefault();
        }, {passive: false});
        const row = createElement("div", "mindmap-view__palette-row");
        row.style.setProperty("--mindmap-palette-columns", String(columns - controls.length));
        row.style.setProperty("--mindmap-toolbar-columns", String(columns));
        row.append(palette, ...controls);
        return row;
    }

    private renderInspectorPanel() {
        const panel = this.inspectorPanel;
        if (!panel) {
            return;
        }
        const focus = this.inspectorPopover.contains(document.activeElement) ?
            document.activeElement.getAttribute("data-width-control") : undefined;
        this.inspectorPopover.replaceChildren();
        this.inspectorPopover.hidden = false;
        this.inspectorPopover.setAttribute("aria-label", this.label(panel.kind));
        const current = () => this.inspectorPanel === panel && !this.readOnly && !this.inspector.hidden &&
            JSON.stringify(panel.ids) === JSON.stringify(this.getSelectedIds());
        const button = (key: string, icon: string, action: () => void) => {
            const control = this.makeButton(key, icon, () => { if (current()) { action(); } });
            control.className = "color__square color__square--compact";
            control.querySelector("svg")?.classList.add("svg--mid");
            return control;
        };
        if (panel.kind === "color") {
            const change = (patch: Partial<ListMindmapNodeStyle>) => {
                if (current()) {
                    if (panel.ids.length > 1) {
                        this.options.onNodesStyle?.(panel.ids, patch);
                    } else {
                        this.options.onNodeStyle?.(panel.ids[0], patch);
                    }
                }
            };
            const palette = createElement("div", "mindmap-view__palette");
            palette.setAttribute("role", "group");
            palette.setAttribute("aria-label", this.label("listMindmapNodeColor"));
            [{label: this.label("default"), color: "", backgroundColor: "", preview: undefined},
                ...(this.options.nodeColors?.() || [])].forEach(item => {
                const selected = panel.ids.every(id => {
                    const style = this.model.metadata.nodes[id] || {};
                    return (style.textColor || "") === item.color && (style.backgroundColor || "") === item.backgroundColor;
                });
                const control = button("color", "", () => change({textColor: item.color, backgroundColor: item.backgroundColor}));
                control.textContent = "A";
                control.setAttribute("aria-label", item.label);
                control.setAttribute("aria-pressed", String(selected));
                control.classList.toggle("color__square--current", selected);
                control.style.color = item.preview?.color ?? item.color;
                control.style.backgroundColor = item.preview?.backgroundColor ?? item.backgroundColor;
                palette.append(control);
            });
            const controls: HTMLElement[] = [];
            if (this.options.onManageNodeColors) {
                const manage = button("listMindmapManageNodeColors", "iconFont", () => this.options.onManageNodeColors(manage));
                manage.setAttribute("aria-haspopup", "menu");
                controls.push(manage);
            }
            this.inspectorPopover.append(this.makePaletteRow(palette, controls));
            if (panel.ids.length > 1) {
                const lines = createElement("div", "mindmap-view__palette");
                lines.setAttribute("role", "group");
                lines.setAttribute("aria-label", this.label("listMindmapLineColor"));
                [{label: this.label("default"), value: ""}, ...(this.options.colors?.() || [])].forEach(item => {
                    const control = button("color", "", () => change({lineColor: item.value}));
                    const selected = panel.ids.every(id => (this.model.metadata.nodes[id]?.lineColor || "") === item.value);
                    control.setAttribute("aria-label", item.label);
                    control.setAttribute("aria-pressed", String(selected));
                    control.classList.toggle("color__square--current", selected);
                    control.style.backgroundColor = item.value || "var(--b3-theme-background)";
                    lines.append(control);
                });
                const lineControls = [];
                if (this.options.onManageLineColors) {
                    lineControls.push(button("listMindmapManageLineColors", "iconLine", this.options.onManageLineColors));
                }
                this.inspectorPopover.append(this.makePaletteRow(lines, lineControls));
            }
        } else {
            const row = createElement("div", "mindmap-view__node-width");
            const slider = createElement("input", "b3-slider");
            slider.type = "range";
            slider.min = "-100";
            slider.max = "100";
            slider.step = "1";
            slider.value = String(panel.slider);
            slider.setAttribute("aria-label", this.label("width"));
            slider.dataset.widthControl = "slider";
            const width = createElement("input", "b3-text-field b3-text-field--small");
            width.type = "number";
            width.min = "32";
            width.step = "1";
            width.placeholder = this.label("default");
            width.setAttribute("aria-label", this.label("width"));
            width.dataset.widthControl = "number";
            const widths = this.nodeWidths(panel.ids);
            width.value = widths[0].width && widths.every(item => item.width === widths[0].width) ? String(widths[0].width) : "";
            const preview = () => {
                if (current() && !this.widthPending && width.validity.valid) {
                    panel.preview = true;
                    this.previewNodeWidths(panel.ids.map(id => ({id, width: width.valueAsNumber || 0})));
                }
            };
            slider.addEventListener("input", () => {
                panel.slider = slider.valueAsNumber;
                width.value = String(Math.max(32, Math.round(panel.baseWidth * Math.pow(2, panel.slider / 50))));
                preview();
            });
            width.addEventListener("input", () => {
                if (width.valueAsNumber >= 32) {
                    panel.slider = Math.max(-100, Math.min(100, 50 * Math.log2(width.valueAsNumber / panel.baseWidth)));
                    slider.value = String(panel.slider);
                }
                preview();
            });
            const save = () => {
                if (current() && width.validity.valid) {
                    this.finishThen(() => void this.commitInspectorWidths(panel.ids.map(id => ({id, width: width.valueAsNumber || 0}))));
                }
            };
            slider.addEventListener("change", save);
            width.addEventListener("change", save);
            const restore = button("listMindmapRestoreWidth", "iconRefresh", () => {
                panel.slider = 0;
                void this.commitInspectorWidths(panel.widths);
            });
            const automatic = button("default", "iconFocus", () => {
                panel.slider = 0;
                void this.commitInspectorWidths(panel.ids.map(id => ({id, width: 0})));
            });
            [slider, width, restore, automatic].forEach(control => control.disabled = this.widthPending);
            row.append(width, slider, restore, automatic);
            this.inspectorPopover.append(row);
            if (focus) {
                this.inspectorPopover.querySelector<HTMLInputElement>(`[data-width-control="${focus}"]`)?.focus({preventScroll: true});
            }
        }
        this.positionInspectorPanel();
        requestAnimationFrame(() => this.positionInspectorPanel());
    }

    private renderInspector() {
        if (this.inspector.hidden || this.readOnly) {
            return;
        }
        this.queueInspectorLayout();
        const focusArrowDirection = this.inspector.querySelector("select") === document.activeElement;
        this.inspector.replaceChildren();
        const lineSelected = !!this.selectedRelation || !!this.selectedEdge || !!this.selectedSummary;
        this.inspector.classList.toggle("mindmap-view__inspector--node", !lineSelected);
        this.inspector.classList.toggle("mindmap-view__inspector--line", lineSelected);
        this.inspector.classList.toggle("mindmap-view__inspector--relation", !!this.selectedRelation);
        this.inspector.style.left = "";
        this.inspector.style.top = "";
        const squareButton = (key: string, icon: string, action: () => void) => {
            const button = this.makeButton(key, icon, action);
            button.className = "color__square color__square--compact";
            button.querySelector("svg").classList.add("svg--mid");
            return button;
        };
        const color = (value: string, action: (value: string) => void, controls: HTMLElement[] = [], key = "color") => {
            const palette = createElement("div", "mindmap-view__palette");
            palette.setAttribute("role", "group");
            palette.setAttribute("aria-label", this.label(key));
            const colors = [{label: this.label("default"), value: ""}, ...(this.options.colors?.() || [])];
            colors.forEach(item => {
                const button = this.makeButton("color", "", () => action(item.value));
                const selected = (value || "") === item.value;
                button.className = "color__square color__square--compact" + (selected ? " color__square--current" : "");
                button.setAttribute("aria-label", item.label);
                button.setAttribute("aria-pressed", String(selected));
                button.style.backgroundColor = item.value || "var(--b3-theme-background)";
                palette.append(button);
            });
            if (this.options.onManageLineColors) {
                controls.push(squareButton("listMindmapManageLineColors", "iconLine", this.options.onManageLineColors));
            }
            this.inspector.append(this.makePaletteRow(palette, controls, this.selectedRelation ? 6 : 8));
        };
        if (this.selectedSummary) {
            const summary = this.model.metadata.summaries?.find(item => item.id === this.selectedSummary);
            if (summary) {
                color(summary.color, value => this.options.onSummaryChange?.(summary.id, {color: value}),
                    [squareButton("delete", "iconTrashcan", () => this.options.onSummaryDelete?.(summary.id))]);
            }
            return;
        }
        if (this.selectedRelation) {
            const relation = this.model.metadata.relations.find(item => item.id === this.selectedRelation);
            if (!relation) {
                return;
            }
            const change = (patch: Partial<ListMindmapRelation>) => this.options.onRelationChange?.(relation.id, patch);
            color(relation.color, value => change({color: value}));
            const direction = createElement("select", "b3-select");
            direction.setAttribute("aria-label", this.label("listMindmapArrowDirection"));
            for (const [value, key] of [["forward", "listMindmapArrowForward"], ["reverse", "listMindmapArrowReverse"],
                ["both", "listMindmapArrowBoth"], ["none", "listMindmapArrowNone"]]) {
                const option = document.createElement("option");
                option.value = value;
                option.textContent = this.label(key);
                direction.append(option);
            }
            direction.value = relation.arrowDirection || "forward";
            direction.addEventListener("change", () => change({arrowDirection: direction.value as ListMindmapRelation["arrowDirection"]}));
            this.inspector.append(direction);
            if (focusArrowDirection) {
                direction.focus({preventScroll: true});
            }
            this.inspector.append(squareButton("edit", "iconEdit", () => this.editRelationLabel()),
                squareButton("delete", "iconTrashcan", () => this.options.onRelationDelete?.(relation.id)));
            if (relation.fromAnchor || relation.toAnchor) {
                this.inspector.append(squareButton("listMindmapAnchorReset", "iconRefresh", () => this.resetRelationAnchors(relation.id)));
            }
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
        const ids = this.getSelectedIds();
        const multiple = ids.length > 1;
        const sameSelection = () => !this.readOnly && JSON.stringify(ids) === JSON.stringify(this.getSelectedIds());
        const appendMore = () => {
            if (this.options.onClipboardMenu) {
                const more = squareButton("more", "iconMore", () => this.options.onClipboardMenu(more, ids));
                more.classList.add("mindmap-view__node-more");
                more.setAttribute("aria-haspopup", "menu");
                this.inspector.append(more);
            }
        };
        const remove = squareButton("delete", "iconTrashcan", () => this.deleteSelection());
        remove.disabled = ids.includes(this.model.root.id) ||
            this.model.root.virtual && this.model.root.children.every(node => ids.includes(node.id));
        const clipboard: HTMLButtonElement[] = [];
        if (this.options.onCopy) {
            const copy = squareButton("copy", "iconCopy", () => {
                if (sameSelection()) {
                    this.options.onCopy(ids, false);
                }
            });
            clipboard.push(copy);
        }
        if (this.options.onPaste) {
            const paste = squareButton("paste", "iconPaste", () => {
                if (sameSelection() && ids.length === 1) {
                    this.options.onPaste(id, "child");
                }
            });
            paste.disabled = multiple;
            paste.dataset.tooltip = this.label("mindmapPasteChild");
            clipboard.push(paste);
        }
        const relation = this.buttons.get("relation");
        const summary = this.buttons.get("summary");
        relation.classList.add("color__square--compact");
        summary.classList.add("color__square--compact");
        this.inspector.append(relation, summary);
        for (const [kind, key, icon] of [["color", "color", "iconFont"], ["width", "width", "iconWidth"]] as const) {
            const button = squareButton(key, icon, () => this.openInspectorPanel(kind, button));
            button.setAttribute("aria-expanded", String(this.inspectorPanel?.kind === kind));
            button.disabled = kind === "width" && (!this.options.onNodeWidths || this.widthPending);
            button.addEventListener("pointerenter", event => {
                if (event.pointerType === "mouse" && !button.disabled) {
                    this.openInspectorPanel(kind, button);
                }
            });
            this.inspector.append(button);
            if (this.inspectorPanel?.kind === kind) {
                this.inspectorPanel.anchor = button;
                this.renderInspectorPanel();
            }
        }
        this.inspector.append(...clipboard, remove);
        appendMore();
    }

    private toggleFullscreen() {
        if (this.fullscreenMarker) {
            this.exitFullscreen();
        } else {
            this.enterFullscreen();
        }
    }

    private enterFullscreen() {
        this.stopFoldAnimation?.();
        if (this.destroyed || this.fullscreenMarker) {
            return;
        }
        this.resizeViewport();
        this.captureViewportCenter();
        if (this.viewportCenter) {
            // 文档视角只在本次全屏期间暂存，全屏内的平移和缩放独立生效。
            this.documentView = {scale: this.scale, center: this.viewportCenter,
                width: this.viewport.clientWidth, height: this.viewport.clientHeight};
            const visible = this.getVisibleViewportAnchor();
            this.viewportCenter = {
                x: this.viewportCenter.x + (visible.x - this.viewport.clientWidth / 2) / this.scale,
                y: this.viewportCenter.y + visible.y / this.scale,
            };
        }
        this.documentScroll = [];
        for (let parent = this.options.host.parentElement; parent; parent = parent.parentElement) {
            if (parent.scrollHeight > parent.clientHeight || parent.scrollWidth > parent.clientWidth) {
                this.documentScroll.push({element: parent, left: parent.scrollLeft, top: parent.scrollTop});
            }
        }
        // 移到独立容器，避免编辑器祖先的变换和裁剪改变全屏覆盖范围。
        this.fullscreenMarker = document.createComment("mindmap-view");
        this.options.host.before(this.fullscreenMarker);
        document.body.append(this.options.host);
        this.options.onFullscreen?.(true, this.buttons.get("fullscreen"));
        this.options.host.classList.add("fullscreen");
        this.toolbar.classList.add("block__icons");
        this.fullscreenChange();
        this.options.host.focus({preventScroll: true});
    }

    private exitFullscreen() {
        this.stopFoldAnimation?.();
        if (!this.fullscreenMarker) {
            return;
        }
        if (this.documentView) {
            if (!this.documentViewport.hidden && !this.destroyed && !this.locked) {
                // 主动布局时，将固定取景框内的视角应用到文档；关闭布局模式则保留原快照。
                this.resizeViewport();
                this.viewportCenter ||= {
                    x: (this.viewport.clientWidth / 2 - this.offsetX) / this.scale,
                    y: (this.getViewportAnchorY(this.viewport.clientHeight) - this.offsetY) / this.scale,
                };
            } else {
                this.scale = this.documentView.scale;
                this.viewportCenter = this.documentView.center;
            }
            this.documentView = undefined;
        }
        this.options.onFullscreen?.(false, this.buttons.get("fullscreen"));
        this.options.host.classList.remove("fullscreen");
        this.fullscreenMarker.replaceWith(this.options.host);
        this.fullscreenMarker = undefined;
        this.fullscreenChange();
        // 重新插入高画布可能触发浏览器滚动锚定，恢复文档阅读位置而非跟随下方内容。
        this.documentScroll?.forEach(({element, left, top}) => {
            element.scrollLeft = left;
            element.scrollTop = top;
        });
        this.documentScroll = undefined;
        if (!this.destroyed) {
            this.options.host.focus({preventScroll: true});
        }
    }

    private fullscreenChange = () => {
        const active = !!this.fullscreenMarker;
        this.setInteractionActive(active);
        this.tooltip.hidden = true;
        if (!active) {
            this.documentViewport.hidden = true;
        }
        const preview = this.buttons.get("documentLayout");
        preview.hidden = !active || !this.documentView || this.locked;
        preview.setAttribute("aria-pressed", String(!this.documentViewport.hidden));
        preview.classList.toggle("block__icon--active", !this.documentViewport.hidden);
        const button = this.buttons.get("fullscreen");
        button.setAttribute("aria-label", this.label(active ? "exitFullscreen" : "fullscreen"));
        button.querySelector("use").setAttribute("xlink:href", active ? "#iconFullscreenExit" : "#iconFullscreen");
        this.refreshLayout();
    };

    private updateDocumentViewport() {
        const saved = this.documentView;
        if (!saved || this.documentViewport.hidden) {
            return;
        }
        // 取景框与进入全屏前的文档视口等大，平移缩放只调整框下的导图。
        const width = saved.width;
        const height = saved.height;
        const x = (this.viewport.clientWidth - width) / 2;
        const y = Math.max(0, (this.viewport.clientHeight - height) / 2);
        this.documentViewport.style.width = `${width}px`;
        this.documentViewport.style.height = `${height}px`;
        this.documentViewport.style.transform = `translate(${x}px, ${y}px)`;
        // 装饰层独立于逻辑框的半像素变换，避免合成时重新采样；视角仍按精确取景范围应用。
        const ratio = window.devicePixelRatio || 1;
        const rect = this.documentViewport.getBoundingClientRect();
        const left = Math.round(rect.left * ratio) / ratio;
        const top = Math.round(rect.top * ratio) / ratio;
        const right = Math.round(rect.right * ratio) / ratio;
        const bottom = Math.round(rect.bottom * ratio) / ratio;
        const strokePixels = Math.max(1, Math.round(ratio));
        const stroke = strokePixels / ratio;
        const dotPixels = Math.max(1, Math.round(2 * ratio));
        const center = (value: number) => (Math.round(value * ratio - dotPixels / 2) + dotPixels / 2) / ratio;
        const surface = this.documentViewportSurface.style;
        surface.left = `${left - rect.left + x}px`;
        surface.top = `${top - rect.top + y}px`;
        surface.width = `${right - left}px`;
        surface.height = `${bottom - top}px`;
        surface.setProperty("--mindmap-grid-stroke", `${stroke}px`);
        surface.setProperty("--mindmap-grid-dot", `${dotPixels / ratio}px`);
        surface.setProperty("--mindmap-grid-half-step", `${Math.round(6 * ratio) / ratio}px`);
        surface.setProperty("--mindmap-grid-x", `${center(rect.left + rect.width / 2) - left}px`);
        surface.setProperty("--mindmap-grid-y", `${center(rect.top + rect.height / 2) - top}px`);
    }

    private restoreViewport() {
        const state = this.options.viewport;
        if (!state) {
            return false;
        }
        this.scale = state.scale;
        this.offsetX = this.viewport.clientWidth / 2 - state.center.x * this.scale;
        this.offsetY = this.getViewportAnchorY(this.viewport.clientHeight) - state.center.y * this.scale;
        this.draw();
        return true;
    }

    private rememberViewport() {
        if (!this.options.onViewportChange || this.initialFit || this.printTransform || this.options.printLayout ||
            !this.viewport.clientWidth || !this.viewport.clientHeight) {
            return;
        }
        // 全屏中的临时浏览不覆盖文档视角；显式应用布局后由文档视图的下一次绘制保存。
        this.options.onViewportChange(this.documentView || {
            scale: this.scale,
            center: {
                x: (this.viewport.clientWidth / 2 - this.offsetX) / this.scale,
                y: (this.getViewportAnchorY(this.viewport.clientHeight) - this.offsetY) / this.scale,
            },
        });
    }

    private captureViewportCenter() {
        if (!this.initialFit && !this.viewportCenter) {
            this.viewportCenter = {
                x: (this.viewport.clientWidth / 2 - this.offsetX) / this.scale,
                y: (this.viewport.clientHeight / 2 - this.offsetY) / this.scale,
            };
        }
    }

    private getViewportAnchorY(height: number) {
        // 高画布全屏时固定顶部；高度相等处两种取景方式连续衔接。
        return Math.max(height, this.fullscreenMarker ? this.documentView?.height || 0 : 0) / 2;
    }

    private resizeViewport(width = this.viewport.clientWidth, height = this.viewport.clientHeight) {
        if (!width || !height || this.printTransform || this.options.printLayout) {
            return;
        }
        const previous = this.viewportSize;
        if (previous?.width === width && previous.height === height) {
            return;
        }
        this.viewportSize = {width, height};
        if (!previous || this.initialFit || this.viewportCenter) {
            return;
        }
        const x = (width - previous.width) / 2;
        const y = this.getViewportAnchorY(height) - this.getViewportAnchorY(previous.height);
        this.offsetX += x;
        this.offsetY += y;
        if (this.pointer?.pan && !this.pointer.id) {
            this.pointer.x += x;
            this.pointer.y += y;
        }
    }

    private getViewportClip() {
        const visual = window.visualViewport;
        let left = visual?.offsetLeft || 0;
        let right = Math.min(window.innerWidth, left + (visual?.width || window.innerWidth));
        let top = visual?.offsetTop || 0;
        let bottom = Math.min(window.innerHeight, top + (visual?.height || window.innerHeight));
        // 文档滚动容器可能只露出画布的一部分，浮层和全屏取景共用实际可见边界。
        for (let parent = this.viewport.parentElement; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            const rect = parent.getBoundingClientRect();
            const ratioX = parent.offsetWidth ? rect.width / parent.offsetWidth : 1;
            const ratioY = parent.offsetHeight ? rect.height / parent.offsetHeight : 1;
            if (style.overflowX !== "visible") {
                const start = rect.left + parent.clientLeft * ratioX;
                left = Math.max(left, start);
                right = Math.min(right, start + parent.clientWidth * ratioX);
            }
            if (style.overflowY !== "visible") {
                const start = rect.top + parent.clientTop * ratioY;
                top = Math.max(top, start);
                bottom = Math.min(bottom, start + parent.clientHeight * ratioY);
            }
        }
        return {left, right, top, bottom};
    }

    private getVisibleViewportAnchor() {
        const bounds = this.viewport.getBoundingClientRect();
        const scaleX = bounds.width ? this.viewport.clientWidth / bounds.width : 1;
        const scaleY = bounds.height ? this.viewport.clientHeight / bounds.height : 1;
        const {left, right, top, bottom} = this.getVisibleViewportBounds();
        return right > left && bottom > top ? {
            x: ((left + right) / 2 - bounds.left) * scaleX,
            y: (top - bounds.top) * scaleY,
        } : {x: this.viewport.clientWidth / 2, y: 0};
    }

    public destroy() {
        this.finishSummaryEdit?.(false);
        this.finishRelationEdit?.(false);
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        cancelAnimationFrame(this.inspectorFrame);
        this.stopFoldAnimation?.();
        cancelAnimationFrame(this.drawFrame);
        this.drawFrame = 0;
        clearTimeout(this.linkTimer);
        this.cancelPointer();
        if (this.frame) {
            cancelAnimationFrame(this.frame);
        }
        this.resizeObserver.disconnect();
        this.disposers.forEach(dispose => dispose());
        this.exitFullscreen();
        this.options.host.classList.remove("mindmap-view--active");
        this.nodeElements.forEach((_element, id) => this.destroyContentViews(id));
        this.nodeElements.clear();
        this.relationElements.clear();
        this.summaryElements.clear();
        this.options.host.replaceChildren();
    }
}
