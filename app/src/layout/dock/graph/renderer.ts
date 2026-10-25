import {parseCanvasColor} from "../../../util/color";
import {IGraphCamera, IGraphData, IGraphOptions, IGraphPalette} from "./types";

export interface IGraphRenderState {
    camera: IGraphCamera;
    data: IGraphData;
    devicePixelRatio: number;
    geometryVersion: number;
    height: number;
    hovered: number;
    options: IGraphOptions;
    palette: IGraphPalette;
    positionVersion: number;
    positions: Float32Array<ArrayBuffer>;
    selected: number;
    selectionVersion: number;
    styleVersion: number;
    width: number;
}

export interface IGraphRenderer {
    destroy: () => void;
    render: (state: IGraphRenderState) => void;
}

export const getGraphNodeColor = (type: string, palette: IGraphPalette) => {
    switch (type) {
        case "NodeDocument":
            return palette.document;
        case "NodeHeading":
            return palette.heading;
        case "NodeMathBlock":
            return palette.math;
        case "NodeCodeBlock":
            return palette.code;
        case "NodeTable":
            return palette.table;
        case "NodeList":
            return palette.list;
        case "NodeListItem":
            return palette.listItem;
        case "NodeBlockquote":
            return palette.blockquote;
        case "NodeCallout":
            return palette.callout;
        case "NodeSuperBlock":
            return palette.superBlock;
        case "tag":
        case "textmark tag":
            return palette.tag;
        default:
            return palette.paragraph;
    }
};

// WebGL 需要 0-1 浮点通道；无法解析的颜色按不透明黑色处理，与调色板缺省值一致。
export const parseGraphColor = (color: string): [number, number, number, number] => {
    const value = parseCanvasColor(color);
    return value ? [value[0] / 255, value[1] / 255, value[2] / 255, value[3] / 255] : [0, 0, 0, 1];
};
