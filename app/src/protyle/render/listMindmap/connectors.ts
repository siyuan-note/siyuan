import type {ListMindmapPosition} from "./model";
import type {ListMindmapSummaryPosition} from "./summary";

export const LIST_MINDMAP_CONNECTOR_STYLES = ["spline", "orthogonal", "bezier", "rounded"] as const;
export type ListMindmapConnectorStyle = typeof LIST_MINDMAP_CONNECTOR_STYLES[number];

type ConnectorPath = Pick<CanvasPath, "moveTo" | "lineTo" | "bezierCurveTo" | "quadraticCurveTo">;

// 概要范围与标签之间的连线使用导图样式，预览、绘制和命中检测共用路径。
export const buildListMindmapSummaryConnector = <T extends ConnectorPath>(
    position: ListMindmapSummaryPosition, style: ListMindmapConnectorStyle, makePath: () => T,
) => {
    const {x, top, bottom, labelX} = position;
    const startX = x - 10;
    const endX = labelX - 6;
    const centerY = (top + bottom) / 2;
    const path = makePath();
    if (style === "spline" || style === "bezier") {
        const centerX = (startX + endX) / 2;
        [top, bottom].forEach(y => {
            path.moveTo(endX, centerY);
            path.bezierCurveTo(style === "spline" ? endX : centerX, centerY, centerX, y, startX, y);
        });
    } else {
        const radius = style === "rounded" ? Math.min(6, Math.max(0, bottom - top) / 2) : 0;
        path.moveTo(startX, top);
        path.lineTo(x - radius, top);
        if (radius) {
            path.quadraticCurveTo(x, top, x, top + radius);
        }
        path.lineTo(x, bottom - radius);
        if (radius) {
            path.quadraticCurveTo(x, bottom, x - radius, bottom);
        }
        path.lineTo(startX, bottom);
        path.moveTo(x, centerY);
        path.lineTo(endX, centerY);
    }
    return path;
};

// 连线路径只使用已完成的节点布局，共享主干不进入分支的命中路径。
export const buildListMindmapConnectors = <T extends ConnectorPath>(
    rootID: string, positions: Map<string, ListMindmapPosition>, edges: {from: string, to: string}[],
    style: ListMindmapConnectorStyle, makePath: () => T, branchTheme = false,
) => {
    const trunks: T[] = [];
    const trunkParents: string[] = [];
    const branches: {id: string, path: T, trunk?: T}[] = [];
    const groups = new Map<string, ListMindmapPosition[]>();
    const firstLevel = new Set(branchTheme ? edges.filter(edge => edge.from === rootID).map(edge => edge.to) : []);
    const anchorY = (node: ListMindmapPosition) => node.y +
        (node.id === rootID || firstLevel.has(node.id) ? node.height / 2 : node.height);
    edges.forEach(edge => {
        const from = positions.get(edge.from);
        const to = positions.get(edge.to);
        if (!from || !to) {
            return;
        }
        if (style === "orthogonal" || style === "rounded") {
            if (!groups.has(edge.from)) {
                groups.set(edge.from, []);
            }
            groups.get(edge.from).push(to);
            return;
        }
        const startX = from.x + from.width;
        const startY = anchorY(from);
        const endY = anchorY(to);
        const center = (startX + to.x) / 2;
        const path = makePath();
        path.moveTo(startX, startY);
        path.bezierCurveTo(style === "spline" ? startX : center, startY, center, endY, to.x, endY);
        path.lineTo(to.x + to.width, endY);
        branches.push({id: edge.to, path});
    });
    groups.forEach((children, parentID) => {
        const from = positions.get(parentID);
        const startX = from.x + from.width;
        const startY = anchorY(from);
        const endX = children.reduce((left, node) => Math.min(left, node.x), Infinity);
        const trunkX = (startX + endX) / 2;
        const radius = style === "rounded" ? Math.min(8, Math.max(0, endX - startX) / 4) : 0;
        let top = startY;
        let bottom = startY;
        children.forEach(to => {
            const endY = anchorY(to);
            const corner = Math.min(radius, Math.abs(endY - startY) / 2);
            const branchY = endY - Math.sign(endY - startY) * corner;
            top = Math.min(top, branchY);
            bottom = Math.max(bottom, branchY);
            const path = makePath();
            path.moveTo(trunkX, branchY);
            if (corner) {
                path.quadraticCurveTo(trunkX, endY, trunkX + corner, endY);
            }
            path.lineTo(to.x + to.width, endY);
            if (branchTheme && parentID === rootID) {
                const trunk = makePath();
                trunk.moveTo(startX, startY);
                trunk.lineTo(trunkX, startY);
                trunk.lineTo(trunkX, branchY);
                branches.push({id: to.id, path, trunk});
            } else {
                branches.push({id: to.id, path});
            }
        });
        if (branchTheme && parentID === rootID) {
            return;
        }
        const trunk = makePath();
        trunk.moveTo(startX, startY);
        trunk.lineTo(trunkX, startY);
        if (bottom > top) {
            trunk.moveTo(trunkX, top);
            trunk.lineTo(trunkX, bottom);
        }
        trunks.push(trunk);
        trunkParents.push(parentID);
    });
    return {trunks, trunkParents, branches};
};
