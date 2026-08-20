import {GraphCanvasRenderer} from "./canvasRenderer";
import {
    centerGraphCamera,
    createInitialPositions,
    fitGraphCamera,
    getDraggedGraphPosition,
    getGraphNodeSize,
    normalizeGraphData,
    screenToGraph,
} from "./core";
import {GraphLabelRenderer} from "./labelRenderer";
import {IGraphRenderer, IGraphRenderState} from "./renderer";
import {
    IGraphCamera,
    IGraphData,
    IGraphEngineOptions,
    IGraphOptions,
    IGraphPalette,
    IGraphSourceLink,
    IGraphSourceNode,
    TGraphLayoutRequest,
    TGraphLayoutResponse,
} from "./types";
import {GraphWebGLRenderer} from "./webglRenderer";

const MIN_SCALE = 0.02;
const MAX_SCALE = 8;
const CLICK_DISTANCE = 4;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;
const TRACKPAD_PINCH_ZOOM_MULTIPLIER = 4;

interface IPointerPosition {
    clientX: number;
    clientY: number;
    x: number;
    y: number;
}

interface IPointerAction extends IPointerPosition {
    cameraX: number;
    cameraY: number;
    moved: boolean;
    node: number;
    nodeOffsetX: number;
    nodeOffsetY: number;
    pointerId: number;
}

interface IPinchAction {
    anchorX: number;
    anchorY: number;
    distance: number;
    scale: number;
}

export class GraphEngine {
    private readonly container: HTMLElement;
    private readonly engineOptions: IGraphEngineOptions;
    private readonly labelCanvas: HTMLCanvasElement;
    private readonly labelRenderer: GraphLabelRenderer;
    private readonly resizeObserver: ResizeObserver;
    private readonly tooltip: HTMLDivElement;
    private baseCanvas: HTMLCanvasElement;
    private autoFitPending = false;
    private camera: IGraphCamera = {scale: 1, x: 0, y: 0};
    private cameraTouched = false;
    private data: IGraphData;
    private destroyed = false;
    private focusAnimation = 0;
    private generation = 0;
    private geometryVersion = 0;
    private height = 0;
    private hovered = -1;
    private layoutWorker: Worker;
    private options: IGraphOptions;
    private palette: IGraphPalette;
    private pendingFocusId = "";
    private readonly pendingNodeReleases = new Map<number, number>();
    private readonly pinnedNodes = new Map<number, [number, number]>();
    private pinchAction: IPinchAction;
    private pointerAction: IPointerAction;
    private readonly pointers = new Map<number, IPointerPosition>();
    private positionVersion = 0;
    private positions = new Float32Array();
    private renderFrame = 0;
    private renderer: IGraphRenderer;
    private releaseToken = 0;
    private selected = -1;
    private selectionVersion = 0;
    private styleVersion = 0;
    private width = 0;

    constructor(container: HTMLElement, options: IGraphEngineOptions) {
        this.container = container;
        this.engineOptions = options;
        this.baseCanvas = this.createCanvas("graph__canvas");
        this.labelCanvas = this.createCanvas("graph__labels");
        this.tooltip = document.createElement("div");
        this.tooltip.className = "graph__tooltip fn__none";
        this.container.append(this.baseCanvas, this.labelCanvas, this.tooltip);
        this.renderer = this.createRenderer();
        this.labelRenderer = new GraphLabelRenderer(this.labelCanvas);
        this.container.addEventListener("pointerdown", this.handlePointerDown);
        this.container.addEventListener("pointermove", this.handlePointerMove);
        this.container.addEventListener("pointerup", this.handlePointerUp);
        this.container.addEventListener("pointercancel", this.handlePointerUp);
        this.container.addEventListener("pointerleave", this.handlePointerLeave);
        this.container.addEventListener("wheel", this.handleWheel, {passive: false});
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.container);
        this.resize();
    }

    public setData(
        nodes: IGraphSourceNode[],
        links: IGraphSourceLink[],
        options: IGraphOptions,
        palette: IGraphPalette,
        focusId = "",
        resetLayout = false,
    ) {
        if (this.destroyed) {
            return;
        }
        const previous = new Map<string, [number, number]>();
        if (!resetLayout) {
            this.data?.nodes.forEach((node, index) => {
                previous.set(node.id, [this.positions[index * 2], this.positions[index * 2 + 1]]);
            });
        }
        this.options = {...options};
        this.palette = palette;
        this.data = normalizeGraphData(nodes, links, options.nodeSize);
        this.positions = createInitialPositions(this.data, options.linkDistance, previous);
        this.geometryVersion++;
        this.positionVersion++;
        this.styleVersion++;
        this.selected = -1;
        this.hovered = -1;
        this.selectionVersion++;
        this.pendingFocusId = focusId;
        this.autoFitPending = true;
        this.cameraTouched = false;
        this.focusAnimation++;
        this.resetInteraction();
        this.pendingNodeReleases.clear();
        this.pinnedNodes.clear();
        this.hideTooltip();
        this.fit(false);
        this.startLayout();
        this.scheduleRender();
    }

    public updateOptions(options: IGraphOptions, palette: IGraphPalette) {
        if (this.destroyed) {
            return;
        }
        if (!this.data) {
            this.options = {...options};
            this.palette = palette;
            return;
        }
        const previous = this.options;
        const nodeSizeChanged = previous.nodeSize !== options.nodeSize;
        const physicsChanged = nodeSizeChanged || previous.centerStrength !== options.centerStrength ||
            previous.collideRadius !== options.collideRadius || previous.collideStrength !== options.collideStrength ||
            previous.linkDistance !== options.linkDistance;
        this.options = {...options};
        this.palette = palette;
        if (nodeSizeChanged) {
            this.data.nodes.forEach((node, index) => {
                this.data.sizes[index] = getGraphNodeSize(options.nodeSize, node.defs || 0);
            });
        }
        this.styleVersion++;
        if (physicsChanged) {
            if (nodeSizeChanged) {
                this.startLayout();
            } else {
                this.postLayoutMessage({
                    type: "options",
                    generation: this.generation,
                    options: this.getLayoutOptions(),
                });
            }
        }
        this.scheduleRender();
    }

    public clear() {
        if (this.destroyed) {
            return;
        }
        this.stopLayout();
        this.resetInteraction();
        if (this.renderFrame) {
            cancelAnimationFrame(this.renderFrame);
            this.renderFrame = 0;
        }
        this.focusAnimation++;
        this.autoFitPending = false;
        this.pendingFocusId = "";
        this.pendingNodeReleases.clear();
        this.pinnedNodes.clear();
        this.data = undefined;
        this.positions = new Float32Array();
        this.selected = -1;
        this.hovered = -1;
        this.hideTooltip();
        this.baseCanvas.width = 1;
        this.baseCanvas.height = 1;
        this.labelCanvas.width = 1;
        this.labelCanvas.height = 1;
    }

    public hasNode(id: string) {
        return this.data?.indexById.has(id) || false;
    }

    public focusNode(id: string, animate = true) {
        if (this.destroyed) {
            return;
        }
        const index = this.data?.indexById.get(id);
        if (index === undefined) {
            return;
        }
        this.selected = index;
        this.selectionVersion++;
        const targetX = this.width / 2 - this.positions[index * 2] * this.camera.scale;
        const targetY = this.height / 2 - this.positions[index * 2 + 1] * this.camera.scale;
        if (!animate) {
            this.focusAnimation++;
            this.camera.x = targetX;
            this.camera.y = targetY;
            this.scheduleRender();
            return;
        }
        const startX = this.camera.x;
        const startY = this.camera.y;
        const start = performance.now();
        const animation = ++this.focusAnimation;
        const update = () => {
            if (this.destroyed || animation !== this.focusAnimation) {
                return;
            }
            const progress = Math.min(1, (performance.now() - start) / 500);
            const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
            this.camera.x = startX + (targetX - startX) * eased;
            this.camera.y = startY + (targetY - startY) * eased;
            this.scheduleRender();
            if (progress < 1) {
                requestAnimationFrame(update);
            }
        };
        requestAnimationFrame(update);
    }

    public resize() {
        if (this.destroyed) {
            return;
        }
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        const wasHidden = this.width < 1 || this.height < 1;
        const sizeChanged = width !== this.width || height !== this.height;
        this.width = width;
        this.height = height;
        if (width < 1 || height < 1) {
            this.postLayoutMessage({type: "pause", generation: this.generation});
            return;
        }
        if (wasHidden) {
            this.postLayoutMessage({type: "resume", generation: this.generation});
        }
        if (this.data && !this.cameraTouched && (wasHidden || this.autoFitPending)) {
            this.fit(false);
        } else if (this.data && sizeChanged) {
            this.focusAnimation++;
            this.camera = centerGraphCamera(this.positions, this.data.sizes, width, height, this.camera.scale);
        }
        this.scheduleRender();
    }

    public destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        this.stopLayout();
        this.resetInteraction();
        this.resizeObserver.disconnect();
        this.container.removeEventListener("pointerdown", this.handlePointerDown);
        this.container.removeEventListener("pointermove", this.handlePointerMove);
        this.container.removeEventListener("pointerup", this.handlePointerUp);
        this.container.removeEventListener("pointercancel", this.handlePointerUp);
        this.container.removeEventListener("pointerleave", this.handlePointerLeave);
        this.container.removeEventListener("wheel", this.handleWheel);
        this.baseCanvas.removeEventListener("webglcontextlost", this.handleContextLost);
        if (this.renderFrame) {
            cancelAnimationFrame(this.renderFrame);
        }
        this.focusAnimation++;
        this.renderer.destroy();
        this.labelRenderer.destroy();
        this.baseCanvas.remove();
        this.labelCanvas.remove();
        this.tooltip.remove();
    }

    private createCanvas(className: string) {
        const canvas = document.createElement("canvas");
        canvas.className = className;
        canvas.setAttribute("aria-hidden", "true");
        return canvas;
    }

    private createRenderer() {
        try {
            this.baseCanvas.addEventListener("webglcontextlost", this.handleContextLost);
            return new GraphWebGLRenderer(this.baseCanvas);
        } catch (error) {
            console.warn("Unable to initialize WebGL graph renderer", error);
            this.baseCanvas.removeEventListener("webglcontextlost", this.handleContextLost);
            this.replaceBaseCanvas();
            return new GraphCanvasRenderer(this.baseCanvas);
        }
    }

    private replaceBaseCanvas() {
        const replacement = this.createCanvas("graph__canvas");
        this.baseCanvas.replaceWith(replacement);
        this.baseCanvas = replacement;
    }

    private readonly handleContextLost = (event: Event) => {
        event.preventDefault();
        if (this.destroyed) {
            return;
        }
        this.baseCanvas.removeEventListener("webglcontextlost", this.handleContextLost);
        this.renderer.destroy();
        this.replaceBaseCanvas();
        this.renderer = new GraphCanvasRenderer(this.baseCanvas);
        this.scheduleRender();
    };

    private startLayout() {
        this.stopLayout();
        this.pendingNodeReleases.forEach((_token, index) => this.pinnedNodes.delete(index));
        this.pendingNodeReleases.clear();
        if (!this.data || this.data.nodes.length < 2) {
            if (this.pendingFocusId) {
                this.focusNode(this.pendingFocusId);
                this.pendingFocusId = "";
            }
            this.autoFitPending = false;
            return;
        }
        this.generation++;
        try {
            // @ts-ignore TypeScript 的 CommonJS 类型检查不识别由 Webpack 转换的 import.meta.url。
            const worker = new Worker(new URL("./layoutWorker.ts", import.meta.url));
            this.layoutWorker = worker;
            worker.onmessage = (event: MessageEvent<TGraphLayoutResponse>) => {
                const message = event.data;
                if (message.generation !== this.generation) {
                    return;
                }
                if (message.type === "released") {
                    if (this.pendingNodeReleases.get(message.index) === message.token) {
                        this.pendingNodeReleases.delete(message.index);
                        this.pinnedNodes.delete(message.index);
                    }
                    return;
                }
                if (message.positions.length !== this.positions.length) {
                    return;
                }
                this.pinnedNodes.forEach((position, index) => {
                    const offset = index * 2;
                    message.positions[offset] = position[0];
                    message.positions[offset + 1] = position[1];
                });
                if (this.pointerAction?.node >= 0 && this.pointerAction.moved) {
                    const offset = this.pointerAction.node * 2;
                    message.positions[offset] = this.positions[offset];
                    message.positions[offset + 1] = this.positions[offset + 1];
                }
                this.positions = message.positions;
                this.positionVersion++;
                this.scheduleRender();
                if (message.settled) {
                    if (this.pendingFocusId) {
                        this.focusNode(this.pendingFocusId);
                        this.pendingFocusId = "";
                    } else if (this.autoFitPending && !this.cameraTouched) {
                        this.fit(true);
                    }
                    this.autoFitPending = false;
                }
            };
            worker.onerror = (event) => {
                console.warn("Graph layout worker failed", event.message);
                worker.terminate();
                if (this.layoutWorker === worker) {
                    this.layoutWorker = undefined;
                }
                if (this.pendingFocusId) {
                    this.focusNode(this.pendingFocusId);
                    this.pendingFocusId = "";
                }
                this.autoFitPending = false;
            };
            const positions = this.positions.slice();
            const sizes = this.data.sizes.slice();
            const sources = this.data.sources.slice();
            const targets = this.data.targets.slice();
            const degrees = this.data.degrees.slice();
            const message: TGraphLayoutRequest = {
                type: "init",
                generation: this.generation,
                positions,
                sizes,
                sources,
                targets,
                degrees,
                options: this.getLayoutOptions(),
            };
            worker.postMessage(message, [positions.buffer, sizes.buffer, sources.buffer, targets.buffer, degrees.buffer]);
            this.pinnedNodes.forEach((position, index) => {
                this.postLayoutMessage({
                    type: "pin",
                    generation: this.generation,
                    index,
                    x: position[0],
                    y: position[1],
                });
            });
            if (this.width < 1 || this.height < 1) {
                this.postLayoutMessage({type: "pause", generation: this.generation});
            }
        } catch (error) {
            console.warn("Unable to start graph layout worker", error);
            this.stopLayout();
            if (this.pendingFocusId) {
                this.focusNode(this.pendingFocusId);
                this.pendingFocusId = "";
            }
            this.autoFitPending = false;
        }
    }

    private stopLayout() {
        if (!this.layoutWorker) {
            return;
        }
        this.layoutWorker.terminate();
        this.layoutWorker = undefined;
    }

    private getLayoutOptions() {
        return {
            centerStrength: this.options.centerStrength,
            linkDistance: this.options.linkDistance,
            repulsion: this.options.collideRadius,
            springStrength: this.options.collideStrength,
        };
    }

    private postLayoutMessage(message: TGraphLayoutRequest) {
        this.layoutWorker?.postMessage(message);
    }

    private fit(animate: boolean) {
        if (!this.data || this.width < 1 || this.height < 1) {
            return;
        }
        const target = fitGraphCamera(this.positions, this.data.sizes, this.width, this.height);
        if (!animate) {
            this.focusAnimation++;
            this.camera = target;
            this.scheduleRender();
            return;
        }
        const start = {...this.camera};
        const started = performance.now();
        const animation = ++this.focusAnimation;
        const update = () => {
            if (this.destroyed || animation !== this.focusAnimation) {
                return;
            }
            const progress = Math.min(1, (performance.now() - started) / 350);
            const eased = 1 - Math.pow(1 - progress, 3);
            this.camera = {
                scale: start.scale + (target.scale - start.scale) * eased,
                x: start.x + (target.x - start.x) * eased,
                y: start.y + (target.y - start.y) * eased,
            };
            this.scheduleRender();
            if (progress < 1) {
                requestAnimationFrame(update);
            }
        };
        requestAnimationFrame(update);
    }

    private scheduleRender() {
        if (this.destroyed || this.renderFrame || !this.data || this.width < 1 || this.height < 1) {
            return;
        }
        this.renderFrame = requestAnimationFrame(() => {
            this.renderFrame = 0;
            const state: IGraphRenderState = {
                camera: this.camera,
                data: this.data,
                devicePixelRatio: window.devicePixelRatio || 1,
                geometryVersion: this.geometryVersion,
                height: this.height,
                hovered: this.hovered,
                options: this.options,
                palette: this.palette,
                positionVersion: this.positionVersion,
                positions: this.positions,
                selected: this.selected,
                selectionVersion: this.selectionVersion,
                styleVersion: this.styleVersion,
                width: this.width,
            };
            this.renderer.render(state);
            this.labelRenderer.render(state);
        });
    }

    private getPointer(event: PointerEvent): IPointerPosition {
        const rect = this.container.getBoundingClientRect();
        return {
            clientX: event.clientX,
            clientY: event.clientY,
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
        };
    }

    private hitTest(x: number, y: number) {
        if (!this.data) {
            return -1;
        }
        let result = -1;
        let resultDistanceSquared = Number.POSITIVE_INFINITY;
        for (let index = this.data.nodes.length - 1; index >= 0; index--) {
            const nodeX = this.positions[index * 2] * this.camera.scale + this.camera.x;
            const nodeY = this.positions[index * 2 + 1] * this.camera.scale + this.camera.y;
            const radius = Math.max(6, this.data.sizes[index] * this.camera.scale * 1.3);
            const deltaX = x - nodeX;
            const deltaY = y - nodeY;
            const distanceSquared = deltaX * deltaX + deltaY * deltaY;
            if (distanceSquared <= radius * radius && distanceSquared < resultDistanceSquared) {
                result = index;
                resultDistanceSquared = distanceSquared;
            }
        }
        return result;
    }

    private readonly handlePointerDown = (event: PointerEvent) => {
        if (!this.data || (event.pointerType === "mouse" && event.button !== 0)) {
            return;
        }
        const pointer = this.getPointer(event);
        this.focusAnimation++;
        this.autoFitPending = false;
        this.pointers.set(event.pointerId, pointer);
        this.container.setPointerCapture?.(event.pointerId);
        if (this.pointers.size === 2) {
            if (this.pointerAction?.node >= 0) {
                this.finishNodeInteraction(this.pointerAction);
            }
            this.pointerAction = undefined;
            this.startPinch();
            event.preventDefault();
            return;
        }
        const node = this.hitTest(pointer.x, pointer.y);
        const pointerGraph = screenToGraph(pointer.x, pointer.y, this.camera);
        const nodeX = node >= 0 ? this.positions[node * 2] : 0;
        const nodeY = node >= 0 ? this.positions[node * 2 + 1] : 0;
        this.pointerAction = {
            ...pointer,
            cameraX: this.camera.x,
            cameraY: this.camera.y,
            moved: false,
            node,
            nodeOffsetX: nodeX - pointerGraph.x,
            nodeOffsetY: nodeY - pointerGraph.y,
            pointerId: event.pointerId,
        };
        this.updateCursor();
        if (node >= 0) {
            this.selected = node;
            this.selectionVersion++;
        } else {
            this.selected = -1;
            this.selectionVersion++;
            this.hideTooltip();
        }
        this.scheduleRender();
        event.preventDefault();
    };

    private readonly handlePointerMove = (event: PointerEvent) => {
        const pointer = this.getPointer(event);
        if (this.pointers.has(event.pointerId)) {
            this.pointers.set(event.pointerId, pointer);
        }
        if (this.pinchAction && this.pointers.size >= 2) {
            this.updatePinch();
            event.preventDefault();
            return;
        }
        const action = this.pointerAction;
        if (action && action.pointerId === event.pointerId) {
            const deltaX = pointer.x - action.x;
            const deltaY = pointer.y - action.y;
            if (Math.hypot(deltaX, deltaY) >= CLICK_DISTANCE) {
                action.moved = true;
            }
            if (action.node >= 0) {
                if (action.moved) {
                    const graph = getDraggedGraphPosition(
                        pointer.x,
                        pointer.y,
                        this.camera,
                        action.nodeOffsetX,
                        action.nodeOffsetY,
                    );
                    const x = graph.x;
                    const y = graph.y;
                    this.positions[action.node * 2] = x;
                    this.positions[action.node * 2 + 1] = y;
                    this.pendingNodeReleases.delete(action.node);
                    this.pinnedNodes.set(action.node, [x, y]);
                    this.positionVersion++;
                    this.postLayoutMessage({
                        type: "pin",
                        generation: this.generation,
                        index: action.node,
                        x,
                        y,
                    });
                }
            } else {
                this.camera.x = action.cameraX + deltaX;
                this.camera.y = action.cameraY + deltaY;
                this.cameraTouched = true;
                this.focusAnimation++;
            }
            this.updatePointerHover(pointer, event.pointerType);
            this.scheduleRender();
            event.preventDefault();
            return;
        }
        this.updatePointerHover(pointer, event.pointerType);
    };

    private readonly handlePointerUp = (event: PointerEvent) => {
        const pointer = this.getPointer(event);
        this.pointers.delete(event.pointerId);
        if (this.pinchAction) {
            if (this.pointers.size < 2) {
                this.pinchAction = undefined;
                this.pointerAction = undefined;
                this.updateCursor();
            }
            event.preventDefault();
            return;
        }
        const action = this.pointerAction;
        if (!action || action.pointerId !== event.pointerId) {
            return;
        }
        this.pointerAction = undefined;
        if (action.node >= 0) {
            this.finishNodeInteraction(action);
            if (!action.moved && event.type === "pointerup") {
                this.engineOptions.onNodeClick({
                    event,
                    node: this.data.nodes[action.node],
                    x: event.clientX,
                    y: event.clientY,
                });
            }
        }
        this.updatePointerHover(pointer, event.pointerType);
        event.preventDefault();
    };

    private readonly handlePointerLeave = () => {
        if (this.pointers.size === 0) {
            this.setHovered(-1);
            this.hideTooltip();
        }
    };

    private readonly handleWheel = (event: WheelEvent) => {
        if (!this.data) {
            return;
        }
        const rect = this.container.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const anchor = screenToGraph(x, y, this.camera);
        const delta = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY;
        const sensitivity = WHEEL_ZOOM_SENSITIVITY * (event.ctrlKey ? TRACKPAD_PINCH_ZOOM_MULTIPLIER : 1);
        const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.camera.scale * Math.exp(-delta * sensitivity)));
        this.camera.scale = scale;
        this.camera.x = x - anchor.x * scale;
        this.camera.y = y - anchor.y * scale;
        this.cameraTouched = true;
        this.focusAnimation++;
        this.updateHover({clientX: event.clientX, clientY: event.clientY, x, y});
        this.scheduleRender();
        event.preventDefault();
    };

    private startPinch() {
        const [first, second] = Array.from(this.pointers.values());
        const centerX = (first.x + second.x) / 2;
        const centerY = (first.y + second.y) / 2;
        const anchor = screenToGraph(centerX, centerY, this.camera);
        this.pinchAction = {
            anchorX: anchor.x,
            anchorY: anchor.y,
            distance: Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)),
            scale: this.camera.scale,
        };
        this.cameraTouched = true;
        this.focusAnimation++;
        this.updateCursor();
    }

    private updatePinch() {
        const [first, second] = Array.from(this.pointers.values());
        const centerX = (first.x + second.x) / 2;
        const centerY = (first.y + second.y) / 2;
        const distance = Math.max(1, Math.hypot(first.x - second.x, first.y - second.y));
        const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE,
            this.pinchAction.scale * distance / this.pinchAction.distance));
        this.camera.scale = scale;
        this.camera.x = centerX - this.pinchAction.anchorX * scale;
        this.camera.y = centerY - this.pinchAction.anchorY * scale;
        this.scheduleRender();
    }

    private updateHover(pointer: IPointerPosition) {
        const hovered = this.hitTest(pointer.x, pointer.y);
        this.setHovered(hovered);
        if (hovered < 0 || !this.data.nodes[hovered].title) {
            this.hideTooltip();
            return;
        }
        this.tooltip.textContent = this.data.nodes[hovered].title;
        this.tooltip.style.left = `${pointer.x + 12}px`;
        this.tooltip.style.top = `${pointer.y + 12}px`;
        this.tooltip.classList.remove("fn__none");
    }

    private updatePointerHover(pointer: IPointerPosition, pointerType: string) {
        if (pointerType === "touch") {
            this.setHovered(-1);
            this.hideTooltip();
            return;
        }
        this.updateHover(pointer);
    }

    private finishNodeInteraction(action: IPointerAction) {
        if (!action.moved) {
            return;
        }
        const offset = action.node * 2;
        this.pinnedNodes.set(action.node, [this.positions[offset], this.positions[offset + 1]]);
        if (!this.layoutWorker) {
            this.pinnedNodes.delete(action.node);
            return;
        }
        const token = ++this.releaseToken;
        this.pendingNodeReleases.set(action.node, token);
        this.postLayoutMessage({
            type: "release",
            generation: this.generation,
            index: action.node,
            token,
        });
    }

    private setHovered(index: number) {
        if (this.hovered === index) {
            this.updateCursor();
            return;
        }
        this.hovered = index;
        this.selectionVersion++;
        this.updateCursor();
        this.scheduleRender();
    }

    private updateCursor() {
        this.container.style.cursor = this.pointerAction || this.pinchAction ? "grabbing" :
            this.hovered >= 0 ? "pointer" : "default";
    }

    private hideTooltip() {
        this.tooltip?.classList.add("fn__none");
    }

    private resetInteraction() {
        this.pointers.forEach((_pointer, pointerId) => {
            if (this.container.hasPointerCapture?.(pointerId)) {
                this.container.releasePointerCapture(pointerId);
            }
        });
        this.pointers.clear();
        this.pointerAction = undefined;
        this.pinchAction = undefined;
        this.container.style.cursor = "default";
    }
}
