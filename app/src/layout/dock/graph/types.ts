export interface IGraphSourceNode {
    id: string;
    box: string;
    path: string;
    type: string;
    size: number;
    title?: string;
    label?: string;
    refs?: number;
    defs?: number;
}

export interface IGraphSourceLink {
    from: string;
    to: string;
    ref: boolean;
}

export interface IGraphNode extends IGraphSourceNode {
    index: number;
    degree: number;
}

export interface IGraphLink {
    source: number;
    target: number;
    ref: boolean;
}

export interface IGraphComponent {
    key: string;
    nodeIndices: number[];
}

export interface IGraphData {
    nodes: IGraphNode[];
    links: IGraphLink[];
    components: IGraphComponent[];
    indexById: Map<string, number>;
    sources: Uint32Array;
    targets: Uint32Array;
    references: Uint8Array;
    degrees: Uint32Array;
    sizes: Float32Array;
}

export interface IGraphOptions {
    arrow: boolean;
    centerStrength: number;
    collideRadius: number;
    collideStrength: number;
    lineOpacity: number;
    linkDistance: number;
    linkWidth: number;
    nodeSize: number;
}

export interface IGraphPalette {
    background: string;
    blockquote: string;
    callout: string;
    code: string;
    document: string;
    heading: string;
    highlightLine: string;
    highlightPoint: string;
    line: string;
    list: string;
    listItem: string;
    math: string;
    paragraph: string;
    referenceLine: string;
    superBlock: string;
    table: string;
    tag: string;
}

export interface IGraphCamera {
    scale: number;
    x: number;
    y: number;
}

export interface IGraphNodeClick {
    event: PointerEvent;
    node: IGraphNode;
    x: number;
    y: number;
}

export interface IGraphEngineOptions {
    onNodeClick: (details: IGraphNodeClick) => void;
}

export interface IGraphLayoutOptions {
    centerStrength: number;
    linkDistance: number;
    repulsion: number;
    springStrength: number;
}

export type TGraphLayoutRequest = {
    type: "init";
    generation: number;
    positions: Float32Array;
    sizes: Float32Array;
    sources: Uint32Array;
    targets: Uint32Array;
    degrees: Uint32Array;
    options: IGraphLayoutOptions;
} | {
    type: "options";
    generation: number;
    options: IGraphLayoutOptions;
} | {
    type: "pin";
    generation: number;
    index: number;
    x: number;
    y: number;
} | {
    type: "release";
    generation: number;
    index: number;
    token: number;
} | {
    type: "pause" | "resume" | "stop";
    generation: number;
};

export type TGraphLayoutResponse = {
    type: "positions";
    generation: number;
    positions: Float32Array;
    settled: boolean;
} | {
    type: "released";
    generation: number;
    index: number;
    token: number;
};
