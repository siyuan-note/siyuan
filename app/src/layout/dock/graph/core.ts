import {
    IGraphCamera,
    IGraphData,
    IGraphLink,
    IGraphNode,
    IGraphSourceLink,
    IGraphSourceNode,
} from "./types";

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const EDGE_OPACITY_FACTOR = 1.25;
const HIGHLIGHT_EDGE_OPACITY_FACTOR = 2.5;
export const MIN_GRAPH_EDGE_WIDTH = 1.5;

export const getGraphEdgeOpacity = (lineOpacity: number, highlighted: boolean) =>
    Math.max(0, Math.min(1, lineOpacity * (highlighted ? HIGHLIGHT_EDGE_OPACITY_FACTOR : EDGE_OPACITY_FACTOR)));

export const getGraphNodeSize = (baseSize: number, definitions: number) => {
    if (definitions < 1) {
        return baseSize;
    }
    return (Math.log2(definitions) + 1) * baseSize;
};

export const normalizeGraphData = (
    sourceNodes: IGraphSourceNode[],
    sourceLinks: IGraphSourceLink[],
    nodeSize: number,
): IGraphData => {
    const nodes: IGraphNode[] = [];
    const indexById = new Map<string, number>();
    for (const sourceNode of sourceNodes) {
        if (!sourceNode.id || indexById.has(sourceNode.id)) {
            continue;
        }
        nodes.push({
            ...sourceNode,
            degree: 0,
            index: 0,
        });
        indexById.set(sourceNode.id, 0);
    }
    nodes.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    indexById.clear();
    nodes.forEach((node, index) => {
        node.index = index;
        indexById.set(node.id, index);
    });

    const links: IGraphLink[] = [];
    for (const sourceLink of sourceLinks) {
        const source = indexById.get(sourceLink.from);
        const target = indexById.get(sourceLink.to);
        if (source === undefined || target === undefined) {
            continue;
        }
        links.push({
            source,
            target,
            ref: sourceLink.ref,
        });
        nodes[source].degree++;
        nodes[target].degree++;
    }
    links.sort((left, right) => left.source - right.source || left.target - right.target ||
        Number(left.ref) - Number(right.ref));

    const sources = new Uint32Array(links.length);
    const targets = new Uint32Array(links.length);
    const references = new Uint8Array(links.length);
    const degrees = new Uint32Array(nodes.length);
    const sizes = new Float32Array(nodes.length);
    links.forEach((link, index) => {
        sources[index] = link.source;
        targets[index] = link.target;
        references[index] = link.ref ? 1 : 0;
    });
    nodes.forEach((node, index) => {
        degrees[index] = node.degree;
        sizes[index] = getGraphNodeSize(nodeSize, node.defs || 0);
    });

    return {
        nodes,
        links,
        indexById,
        sources,
        targets,
        references,
        degrees,
        sizes,
    };
};

const hashString = (value: string) => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
};

export const createInitialPositions = (data: IGraphData, linkDistance: number, previous?: Map<string, [number, number]>) => {
    const positions = new Float32Array(data.nodes.length * 2);
    const spacing = Math.max(24, linkDistance * 0.35);
    data.nodes.forEach((node, index) => {
        const saved = previous?.get(node.id);
        if (saved) {
            positions[index * 2] = saved[0];
            positions[index * 2 + 1] = saved[1];
            return;
        }
        const hash = hashString(node.id);
        const angle = index * GOLDEN_ANGLE + (hash % 1024) / 1024;
        const radius = Math.sqrt(index + 1) * spacing;
        positions[index * 2] = Math.cos(angle) * radius;
        positions[index * 2 + 1] = Math.sin(angle) * radius;
    });
    return positions;
};

export const graphToScreen = (x: number, y: number, camera: IGraphCamera) => ({
    x: x * camera.scale + camera.x,
    y: y * camera.scale + camera.y,
});

export const screenToGraph = (x: number, y: number, camera: IGraphCamera) => ({
    x: (x - camera.x) / camera.scale,
    y: (y - camera.y) / camera.scale,
});

export const getDraggedGraphPosition = (
    x: number,
    y: number,
    camera: IGraphCamera,
    offsetX: number,
    offsetY: number,
) => {
    const position = screenToGraph(x, y, camera);
    return {
        x: position.x + offsetX,
        y: position.y + offsetY,
    };
};

export const fitGraphCamera = (
    positions: Float32Array,
    sizes: Float32Array,
    width: number,
    height: number,
    padding = 32,
): IGraphCamera => {
    if (positions.length === 0 || width < 1 || height < 1) {
        return {scale: 1, x: width / 2, y: height / 2};
    }
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (let index = 0; index < sizes.length; index++) {
        const radius = sizes[index];
        const x = positions[index * 2];
        const y = positions[index * 2 + 1];
        minX = Math.min(minX, x - radius);
        maxX = Math.max(maxX, x + radius);
        minY = Math.min(minY, y - radius);
        maxY = Math.max(maxY, y + radius);
    }
    const contentWidth = Math.max(1, maxX - minX);
    const contentHeight = Math.max(1, maxY - minY);
    const availableWidth = Math.max(1, width - padding * 2);
    const availableHeight = Math.max(1, height - padding * 2);
    const scale = Math.max(0.02, Math.min(4, availableWidth / contentWidth, availableHeight / contentHeight));
    return {
        scale,
        x: width / 2 - (minX + maxX) / 2 * scale,
        y: height / 2 - (minY + maxY) / 2 * scale,
    };
};
