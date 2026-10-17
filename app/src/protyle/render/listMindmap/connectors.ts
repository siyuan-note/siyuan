import type {ListMindmapPosition} from "./model";

export const LIST_MINDMAP_CONNECTOR_STYLES = ["spline", "orthogonal", "bezier", "rounded"] as const;
export type ListMindmapConnectorStyle = typeof LIST_MINDMAP_CONNECTOR_STYLES[number];

type ConnectorPath = Pick<CanvasPath, "moveTo" | "lineTo" | "bezierCurveTo" | "quadraticCurveTo">;

// 连线路径只使用已完成的节点布局，共享主干不进入分支的命中路径。
export const buildListMindmapConnectors = <T extends ConnectorPath>(
    rootID: string, positions: Map<string, ListMindmapPosition>, edges: {from: string, to: string}[],
    style: ListMindmapConnectorStyle, makePath: () => T,
) => {
    const trunks: T[] = [];
    const branches: {id: string, path: T}[] = [];
    const groups = new Map<string, ListMindmapPosition[]>();
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
        const startY = from.y + (edge.from === rootID ? from.height / 2 : from.height);
        const endY = to.y + to.height;
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
        const startY = from.y + (parentID === rootID ? from.height / 2 : from.height);
        const endX = children.reduce((left, node) => Math.min(left, node.x), Infinity);
        const trunkX = (startX + endX) / 2;
        const radius = style === "rounded" ? Math.min(8, Math.max(0, endX - startX) / 4) : 0;
        let top = startY;
        let bottom = startY;
        children.forEach(to => {
            const endY = to.y + to.height;
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
            branches.push({id: to.id, path});
        });
        const trunk = makePath();
        trunk.moveTo(startX, startY);
        trunk.lineTo(trunkX, startY);
        if (bottom > top) {
            trunk.moveTo(trunkX, top);
            trunk.lineTo(trunkX, bottom);
        }
        trunks.push(trunk);
    });
    return {trunks, branches};
};
