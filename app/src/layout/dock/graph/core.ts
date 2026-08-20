import {
    IGraphCamera,
    IGraphData,
    IGraphLink,
    IGraphNode,
    IGraphSourceLink,
    IGraphSourceNode,
} from "./types";

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const HIGHLIGHT_EDGE_OPACITY_FACTOR = 2.5;
export const MIN_GRAPH_EDGE_WIDTH = 1;

export const getGraphEdgeOpacity = (lineOpacity: number, highlighted: boolean) =>
    Math.max(0, Math.min(1, lineOpacity * (highlighted ? HIGHLIGHT_EDGE_OPACITY_FACTOR : 1)));

export const getGraphArrowLength = (linkWidth: number, scale: number) =>
    Math.max(7, linkWidth * scale * 2.2);

export const getGraphArrowGeometry = (
    sourceX: number,
    sourceY: number,
    targetX: number,
    targetY: number,
    targetRadius: number,
    arrowLength: number,
    lineWidth = 0,
) => {
    const deltaX = targetX - sourceX;
    const deltaY = targetY - sourceY;
    const distance = Math.max(0.001, Math.hypot(deltaX, deltaY));
    const directionX = deltaX / distance;
    const directionY = deltaY / distance;
    const tipX = targetX - directionX * targetRadius;
    const tipY = targetY - directionY * targetRadius;
    return {
        baseX: tipX - directionX * arrowLength,
        baseY: tipY - directionY * arrowLength,
        directionX,
        directionY,
        lineEndX: tipX - directionX * (arrowLength + lineWidth / 2),
        lineEndY: tipY - directionY * (arrowLength + lineWidth / 2),
        tipX,
        tipY,
    };
};

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
    const parents = new Uint32Array(nodes.length);
    const ranks = new Uint8Array(nodes.length);
    nodes.forEach((_node, index) => {
        parents[index] = index;
    });
    const findRoot = (index: number) => {
        let root = index;
        while (parents[root] !== root) {
            root = parents[root];
        }
        while (parents[index] !== index) {
            const parent = parents[index];
            parents[index] = root;
            index = parent;
        }
        return root;
    };
    links.forEach((link) => {
        let sourceRoot = findRoot(link.source);
        let targetRoot = findRoot(link.target);
        if (sourceRoot === targetRoot) {
            return;
        }
        if (ranks[sourceRoot] < ranks[targetRoot]) {
            [sourceRoot, targetRoot] = [targetRoot, sourceRoot];
        }
        parents[targetRoot] = sourceRoot;
        if (ranks[sourceRoot] === ranks[targetRoot]) {
            ranks[sourceRoot]++;
        }
    });
    const nodesByRoot = new Map<number, number[]>();
    nodes.forEach((_node, index) => {
        const root = findRoot(index);
        const nodeIndices = nodesByRoot.get(root) || [];
        nodeIndices.push(index);
        nodesByRoot.set(root, nodeIndices);
    });
    const components = Array.from(nodesByRoot.values()).map((nodeIndices) => ({
        key: nodes[nodeIndices[0]].id,
        nodeIndices,
    })).sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);

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
        components,
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

const pseudoRandom = (value: number) => {
    let hash = value + 0x6d2b79f5;
    hash = Math.imul(hash ^ hash >>> 15, hash | 1);
    hash ^= hash + Math.imul(hash ^ hash >>> 7, hash | 61);
    return ((hash ^ hash >>> 14) >>> 0) / 4294967296;
};

interface IGraphBounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

interface IGraphComponentPlacement extends IGraphBounds {
    fixed: boolean;
    key: string;
    nodeIndices: number[];
    packingMaxX: number;
    packingMaxY: number;
    packingMinX: number;
    packingMinY: number;
}

interface IGraphPackingIndex {
    bounds: IGraphBounds[];
    cells: Map<string, number[]>;
    cellSize: number;
}

const getGraphBounds = (nodeIndices: number[], positions: Float32Array, sizes: Float32Array): IGraphBounds => {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    nodeIndices.forEach((nodeIndex) => {
        const offset = nodeIndex * 2;
        const radius = sizes[nodeIndex];
        minX = Math.min(minX, positions[offset] - radius);
        minY = Math.min(minY, positions[offset + 1] - radius);
        maxX = Math.max(maxX, positions[offset] + radius);
        maxY = Math.max(maxY, positions[offset + 1] + radius);
    });
    return {minX, minY, maxX, maxY};
};

const translateGraphNodes = (
    nodeIndices: number[],
    positions: Float32Array,
    deltaX: number,
    deltaY: number,
) => {
    nodeIndices.forEach((nodeIndex) => {
        const offset = nodeIndex * 2;
        positions[offset] += deltaX;
        positions[offset + 1] += deltaY;
    });
};

const getPackingCellKey = (x: number, y: number) => `${x}:${y}`;

const addPackingBounds = (index: IGraphPackingIndex, bounds: IGraphBounds) => {
    const boundsIndex = index.bounds.length;
    index.bounds.push(bounds);
    const minCellX = Math.floor(bounds.minX / index.cellSize);
    const minCellY = Math.floor(bounds.minY / index.cellSize);
    const maxCellX = Math.floor(bounds.maxX / index.cellSize);
    const maxCellY = Math.floor(bounds.maxY / index.cellSize);
    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
        for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
            const key = getPackingCellKey(cellX, cellY);
            const cell = index.cells.get(key) || [];
            cell.push(boundsIndex);
            index.cells.set(key, cell);
        }
    }
};

const hasPackingOverlap = (index: IGraphPackingIndex, bounds: IGraphBounds) => {
    const minCellX = Math.floor(bounds.minX / index.cellSize);
    const minCellY = Math.floor(bounds.minY / index.cellSize);
    const maxCellX = Math.floor(bounds.maxX / index.cellSize);
    const maxCellY = Math.floor(bounds.maxY / index.cellSize);
    const checked = new Set<number>();
    for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
        for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
            const cell = index.cells.get(getPackingCellKey(cellX, cellY));
            if (!cell) {
                continue;
            }
            for (const boundsIndex of cell) {
                if (checked.has(boundsIndex)) {
                    continue;
                }
                checked.add(boundsIndex);
                const placed = index.bounds[boundsIndex];
                if (bounds.minX < placed.maxX && bounds.maxX > placed.minX &&
                    bounds.minY < placed.maxY && bounds.maxY > placed.minY) {
                    return true;
                }
            }
        }
    }
    return false;
};

export const createInitialPositions = (
    data: IGraphData,
    linkDistance: number,
    previous?: Map<string, [number, number]>,
) => {
    const positions = new Float32Array(data.nodes.length * 2);
    const spacing = Math.max(24, linkDistance * 0.35);
    const placements: IGraphComponentPlacement[] = data.components.map((component) => {
        const savedNodes: number[] = [];
        let centerX = 0;
        let centerY = 0;
        component.nodeIndices.forEach((nodeIndex) => {
            const saved = previous?.get(data.nodes[nodeIndex].id);
            if (!saved || !Number.isFinite(saved[0]) || !Number.isFinite(saved[1])) {
                return;
            }
            const offset = nodeIndex * 2;
            positions[offset] = saved[0];
            positions[offset + 1] = saved[1];
            centerX += saved[0];
            centerY += saved[1];
            savedNodes.push(nodeIndex);
        });
        const fixed = savedNodes.length > 0;
        const savedSet = new Set(savedNodes);
        if (fixed) {
            centerX /= savedNodes.length;
            centerY /= savedNodes.length;
            let savedRadius = spacing;
            savedNodes.forEach((nodeIndex) => {
                const offset = nodeIndex * 2;
                savedRadius = Math.max(savedRadius, Math.hypot(
                    positions[offset] - centerX,
                    positions[offset + 1] - centerY,
                ) + data.sizes[nodeIndex]);
            });
            let added = 0;
            component.nodeIndices.forEach((nodeIndex) => {
                if (savedSet.has(nodeIndex)) {
                    return;
                }
                const hash = hashString(data.nodes[nodeIndex].id);
                const angle = added * GOLDEN_ANGLE + (hash % 1024) / 1024;
                const radius = savedRadius + Math.sqrt(++added) * spacing;
                positions[nodeIndex * 2] = centerX + Math.cos(angle) * radius;
                positions[nodeIndex * 2 + 1] = centerY + Math.sin(angle) * radius;
            });
        } else {
            const orderedNodes = component.nodeIndices.slice().sort((left, right) =>
                data.degrees[right] - data.degrees[left] || left - right);
            orderedNodes.forEach((nodeIndex, localIndex) => {
                if (localIndex === 0) {
                    return;
                }
                const hash = hashString(data.nodes[nodeIndex].id);
                const angle = (localIndex - 1) * GOLDEN_ANGLE + (hash % 1024) / 1024;
                const radius = Math.sqrt(localIndex) * spacing;
                positions[nodeIndex * 2] = Math.cos(angle) * radius;
                positions[nodeIndex * 2 + 1] = Math.sin(angle) * radius;
            });
            const bounds = getGraphBounds(component.nodeIndices, positions, data.sizes);
            const centerX = (bounds.minX + bounds.maxX) / 2;
            const centerY = (bounds.minY + bounds.maxY) / 2;
            translateGraphNodes(component.nodeIndices, positions, -centerX, -centerY);
        }
        const bounds = getGraphBounds(component.nodeIndices, positions, data.sizes);
        const padding = component.nodeIndices.length > 1 ? Math.max(48, linkDistance * 0.75) :
            Math.max(12, data.sizes[component.nodeIndices[0]] * 1.5);
        return {
            ...bounds,
            fixed,
            key: component.key,
            nodeIndices: component.nodeIndices,
            packingMaxX: bounds.maxX + padding,
            packingMaxY: bounds.maxY + padding,
            packingMinX: bounds.minX - padding,
            packingMinY: bounds.minY - padding,
        };
    });

    const fixedPlacements = placements.filter((placement) => placement.fixed);
    const movablePlacements = placements.filter((placement) => !placement.fixed).sort((left, right) => {
        const leftArea = (left.packingMaxX - left.packingMinX) * (left.packingMaxY - left.packingMinY);
        const rightArea = (right.packingMaxX - right.packingMinX) * (right.packingMaxY - right.packingMinY);
        return rightArea - leftArea || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
    });
    const fixedBounds = fixedPlacements.length > 0 ? getGraphBounds(
        fixedPlacements.flatMap((placement) => placement.nodeIndices), positions, data.sizes,
    ) : undefined;
    const packingCenterX = fixedBounds ? (fixedBounds.minX + fixedBounds.maxX) / 2 : 0;
    const packingCenterY = fixedBounds ? (fixedBounds.minY + fixedBounds.maxY) / 2 : 0;
    const packingIndex: IGraphPackingIndex = {
        bounds: [],
        cells: new Map(),
        cellSize: Math.max(64, linkDistance * 0.5),
    };
    fixedPlacements.forEach((placement) => {
        addPackingBounds(packingIndex, {
            minX: placement.packingMinX,
            minY: placement.packingMinY,
            maxX: placement.packingMaxX,
            maxY: placement.packingMaxY,
        });
    });
    let packingSequence = 0;
    movablePlacements.forEach((placement) => {
        const width = placement.packingMaxX - placement.packingMinX;
        const height = placement.packingMaxY - placement.packingMinY;
        let packedBounds: IGraphBounds;
        while (true) {
            const sequence = packingSequence++;
            const angle = pseudoRandom(sequence * 2) * Math.PI * 2;
            const radius = sequence === 0 ? 0 : spacing * Math.sqrt(sequence + pseudoRandom(sequence * 2 + 1));
            const centerX = packingCenterX + Math.cos(angle) * radius;
            const centerY = packingCenterY + Math.sin(angle) * radius;
            packedBounds = {
                minX: centerX - width / 2,
                minY: centerY - height / 2,
                maxX: centerX + width / 2,
                maxY: centerY + height / 2,
            };
            if (!hasPackingOverlap(packingIndex, packedBounds)) {
                break;
            }
        }
        const deltaX = packedBounds.minX - placement.packingMinX;
        const deltaY = packedBounds.minY - placement.packingMinY;
        translateGraphNodes(placement.nodeIndices, positions, deltaX, deltaY);
        addPackingBounds(packingIndex, packedBounds);
    });
    if (fixedPlacements.length === 0 && data.nodes.length > 0) {
        const nodeIndices = data.nodes.map((_node, index) => index);
        const bounds = getGraphBounds(nodeIndices, positions, data.sizes);
        const deltaX = -(bounds.minX + bounds.maxX) / 2;
        const deltaY = -(bounds.minY + bounds.maxY) / 2;
        translateGraphNodes(nodeIndices, positions, deltaX, deltaY);
    }
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

export const centerGraphCamera = (
    positions: Float32Array,
    sizes: Float32Array,
    width: number,
    height: number,
    scale: number,
): IGraphCamera => {
    const fitted = fitGraphCamera(positions, sizes, width, height);
    const graphCenterX = (width / 2 - fitted.x) / fitted.scale;
    const graphCenterY = (height / 2 - fitted.y) / fitted.scale;
    return {
        scale,
        x: width / 2 - graphCenterX * scale,
        y: height / 2 - graphCenterY * scale,
    };
};
