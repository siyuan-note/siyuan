import {IGraphRenderState} from "./renderer";

const LABEL_FONT_SIZE = 32;
const LABEL_CELL_WIDTH = 72;
const LABEL_CELL_HEIGHT = 20;

export class GraphLabelRenderer {
    private readonly canvas: HTMLCanvasElement;
    private readonly context: CanvasRenderingContext2D;
    private geometryVersion = -1;
    private labelOrder: number[] = [];

    constructor(canvas: HTMLCanvasElement) {
        const context = canvas.getContext("2d");
        if (!context) {
            throw new Error("Canvas 2D is unavailable");
        }
        this.canvas = canvas;
        this.context = context;
    }

    public render(state: IGraphRenderState) {
        const width = Math.max(1, Math.round(state.width * state.devicePixelRatio));
        const height = Math.max(1, Math.round(state.height * state.devicePixelRatio));
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }
        if (this.geometryVersion !== state.geometryVersion) {
            this.labelOrder = state.data.nodes
                .filter((node) => Boolean(node.label))
                .sort((left, right) => right.degree - left.degree || left.index - right.index)
                .map((node) => node.index);
            this.geometryVersion = state.geometryVersion;
        }
        const context = this.context;
        context.setTransform(state.devicePixelRatio, 0, 0, state.devicePixelRatio, 0, 0);
        context.clearRect(0, 0, state.width, state.height);
        const scaledFontSize = LABEL_FONT_SIZE * state.camera.scale;
        const occupied = new Set<number>();
        const priority: number[] = [];
        if (state.selected >= 0) {
            priority.push(state.selected);
        }
        if (state.hovered >= 0 && state.hovered !== state.selected) {
            priority.push(state.hovered);
        }
        const maxLabels = Math.max(32, Math.floor(state.width * state.height / 2400));
        let rendered = 0;
        const seen = new Set<number>();
        const fontFamily = getComputedStyle(document.body).getPropertyValue("--b3-font-family-graph").trim() || "sans-serif";
        for (const index of priority.concat(this.labelOrder)) {
            if (seen.has(index)) {
                continue;
            }
            seen.add(index);
            if (rendered >= maxLabels || (scaledFontSize < 5 && !priority.includes(index))) {
                break;
            }
            const node = state.data.nodes[index];
            const label = node?.label;
            if (!label) {
                continue;
            }
            const priorityLabel = index === state.selected || index === state.hovered;
            const fontSize = priorityLabel ? Math.max(12, Math.min(40, scaledFontSize)) : Math.min(40, scaledFontSize);
            if (fontSize < 5) {
                continue;
            }
            context.font = `${fontSize}px ${fontFamily}`;
            const nodeX = state.positions[index * 2] * state.camera.scale + state.camera.x;
            const nodeY = state.positions[index * 2 + 1] * state.camera.scale + state.camera.y;
            const x = nodeX + Math.max(2, state.data.sizes[index] * state.camera.scale) + 4;
            const y = nodeY;
            if (x > state.width || y < 0 || y > state.height) {
                continue;
            }
            const textWidth = context.measureText(label).width;
            if (x + textWidth < 0) {
                continue;
            }
            if (!priorityLabel && this.isOccupied(occupied, x, y - fontSize / 2, textWidth, fontSize)) {
                continue;
            }
            this.occupy(occupied, x, y - fontSize / 2, textWidth, fontSize);
            context.fillStyle = state.palette.background;
            context.textBaseline = "middle";
            context.fillText(label, x, y);
            rendered++;
        }
    }

    public destroy() {
        this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    private isOccupied(occupied: Set<number>, x: number, y: number, width: number, height: number) {
        const startX = Math.floor(x / LABEL_CELL_WIDTH);
        const endX = Math.floor((x + width) / LABEL_CELL_WIDTH);
        const startY = Math.floor(y / LABEL_CELL_HEIGHT);
        const endY = Math.floor((y + height) / LABEL_CELL_HEIGHT);
        for (let cellY = startY; cellY <= endY; cellY++) {
            for (let cellX = startX; cellX <= endX; cellX++) {
                if (occupied.has((cellY << 16) ^ cellX)) {
                    return true;
                }
            }
        }
        return false;
    }

    private occupy(occupied: Set<number>, x: number, y: number, width: number, height: number) {
        const startX = Math.floor(x / LABEL_CELL_WIDTH);
        const endX = Math.floor((x + width) / LABEL_CELL_WIDTH);
        const startY = Math.floor(y / LABEL_CELL_HEIGHT);
        const endY = Math.floor((y + height) / LABEL_CELL_HEIGHT);
        for (let cellY = startY; cellY <= endY; cellY++) {
            for (let cellX = startX; cellX <= endX; cellX++) {
                occupied.add((cellY << 16) ^ cellX);
            }
        }
    }
}
