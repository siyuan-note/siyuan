import {getGraphNodeColor, IGraphRenderer, IGraphRenderState} from "./renderer";
import {getGraphEdgeOpacity, MIN_GRAPH_EDGE_WIDTH} from "./core";

export class GraphCanvasRenderer implements IGraphRenderer {
    private readonly canvas: HTMLCanvasElement;
    private readonly context: CanvasRenderingContext2D;

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
        const context = this.context;
        context.setTransform(state.devicePixelRatio, 0, 0, state.devicePixelRatio, 0, 0);
        context.clearRect(0, 0, state.width, state.height);
        context.lineWidth = Math.max(MIN_GRAPH_EDGE_WIDTH, state.options.linkWidth * state.camera.scale);
        context.lineCap = "round";
        this.drawEdgeGroup(state, false, false);
        this.drawEdgeGroup(state, true, false);
        this.drawEdgeGroup(state, false, true);
        if (state.options.arrow && state.camera.scale >= 0.08) {
            this.drawArrows(state);
        }
        context.globalAlpha = 1;
        this.drawNodes(state);
    }

    public destroy() {
        this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    private drawEdgeGroup(state: IGraphRenderState, reference: boolean, highlighted: boolean) {
        const context = this.context;
        context.beginPath();
        let drawn = false;
        state.data.links.forEach((link) => {
            const isHighlighted = link.source === state.selected || link.target === state.selected ||
                link.source === state.hovered || link.target === state.hovered;
            if (isHighlighted !== highlighted || (!highlighted && link.ref !== reference)) {
                return;
            }
            const sourceOffset = link.source * 2;
            const targetOffset = link.target * 2;
            context.moveTo(
                state.positions[sourceOffset] * state.camera.scale + state.camera.x,
                state.positions[sourceOffset + 1] * state.camera.scale + state.camera.y,
            );
            context.lineTo(
                state.positions[targetOffset] * state.camera.scale + state.camera.x,
                state.positions[targetOffset + 1] * state.camera.scale + state.camera.y,
            );
            drawn = true;
        });
        if (!drawn) {
            return;
        }
        context.strokeStyle = highlighted ? state.palette.highlightLine :
            reference ? state.palette.referenceLine : state.palette.line;
        context.globalAlpha = getGraphEdgeOpacity(state.options.lineOpacity, highlighted);
        context.stroke();
    }

    private drawArrows(state: IGraphRenderState) {
        const context = this.context;
        const arrowLength = Math.max(7, state.options.linkWidth * state.camera.scale * 2.2);
        state.data.links.forEach((link) => {
            if (!link.ref) {
                return;
            }
            const sourceOffset = link.source * 2;
            const targetOffset = link.target * 2;
            const sourceX = state.positions[sourceOffset] * state.camera.scale + state.camera.x;
            const sourceY = state.positions[sourceOffset + 1] * state.camera.scale + state.camera.y;
            const targetX = state.positions[targetOffset] * state.camera.scale + state.camera.x;
            const targetY = state.positions[targetOffset + 1] * state.camera.scale + state.camera.y;
            const deltaX = targetX - sourceX;
            const deltaY = targetY - sourceY;
            const distance = Math.max(0.001, Math.hypot(deltaX, deltaY));
            const directionX = deltaX / distance;
            const directionY = deltaY / distance;
            const targetRadius = Math.max(1, state.data.sizes[link.target] * state.camera.scale);
            const tipX = targetX - directionX * targetRadius * 1.15;
            const tipY = targetY - directionY * targetRadius * 1.15;
            context.beginPath();
            context.moveTo(tipX, tipY);
            context.lineTo(
                tipX - directionX * arrowLength + directionY * arrowLength * 0.6,
                tipY - directionY * arrowLength - directionX * arrowLength * 0.6,
            );
            context.lineTo(
                tipX - directionX * arrowLength - directionY * arrowLength * 0.6,
                tipY - directionY * arrowLength + directionX * arrowLength * 0.6,
            );
            context.closePath();
            const highlighted = link.source === state.selected || link.target === state.selected ||
                link.source === state.hovered || link.target === state.hovered;
            context.fillStyle = highlighted ? state.palette.highlightLine : state.palette.referenceLine;
            context.globalAlpha = getGraphEdgeOpacity(state.options.lineOpacity, highlighted);
            context.fill();
        });
    }

    private drawNodes(state: IGraphRenderState) {
        const context = this.context;
        state.data.nodes.forEach((node, index) => {
            const offset = index * 2;
            const x = state.positions[offset] * state.camera.scale + state.camera.x;
            const y = state.positions[offset + 1] * state.camera.scale + state.camera.y;
            const selected = index === state.selected;
            const hovered = !selected && index === state.hovered;
            const radius = Math.max(1, state.data.sizes[index] * state.camera.scale);
            context.beginPath();
            context.arc(x, y, radius, 0, Math.PI * 2);
            context.fillStyle = selected || hovered ? state.palette.highlightPoint :
                getGraphNodeColor(node.type, state.palette);
            context.fill();
        });
    }
}
