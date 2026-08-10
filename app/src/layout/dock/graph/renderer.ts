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
    positions: Float32Array;
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

const colorCanvas = document.createElement("canvas");
colorCanvas.width = 1;
colorCanvas.height = 1;
const colorContext = colorCanvas.getContext("2d", {willReadFrequently: true});

export const parseGraphColor = (color: string): [number, number, number, number] => {
    if (!colorContext) {
        return [0, 0, 0, 1];
    }
    colorContext.clearRect(0, 0, 1, 1);
    colorContext.fillStyle = "#000000";
    colorContext.fillStyle = color;
    colorContext.fillRect(0, 0, 1, 1);
    const value = colorContext.getImageData(0, 0, 1, 1).data;
    return [value[0] / 255, value[1] / 255, value[2] / 255, value[3] / 255];
};
