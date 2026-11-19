import {decodeMindmapRoute, getMindmapRelationAnchorPoint} from "./routing";
import type {MindmapRelationAnchor, MindmapRouteBox, MindmapRoutePoint} from "./routing";
import type {ListMindmapRelation} from "./model";

export const MINDMAP_RELATION_PATHS = ["auto", "straight", "bezier", "rounded"] as const;
export const MINDMAP_RELATION_STROKES = ["solid", "dashed", "long-dashed", "dotted"] as const;
export type MindmapRelationPathStyle = typeof MINDMAP_RELATION_PATHS[number];
export type MindmapRelationStrokeStyle = typeof MINDMAP_RELATION_STROKES[number];
export interface MindmapRelationCurve {
    version: 1;
    from: MindmapRoutePoint;
    to: MindmapRoutePoint;
}

export const getMindmapRelationPathStyle = (relation?: Pick<ListMindmapRelation, "pathStyle">) => relation?.pathStyle || "auto";
export const getMindmapRelationStrokeStyle = (relation: Pick<ListMindmapRelation, "strokeStyle" | "dash">) =>
    relation.strokeStyle || (relation.dash === false ? "solid" : "dashed");
export const getMindmapRelationDash = (relation: Pick<ListMindmapRelation, "strokeStyle" | "dash">, width: number) => {
    switch (getMindmapRelationStrokeStyle(relation)) {
        case "solid": return [];
        case "long-dashed": return [12, 6];
        case "dotted": return [0, Math.max(4, width * 2.5)];
        default: return [5, 4];
    }
};

const automaticAnchor = (node: MindmapRouteBox, other: MindmapRouteBox): MindmapRelationAnchor => {
    const dx = other.x + other.width / 2 - node.x - node.width / 2;
    const dy = other.y + other.height / 2 - node.y - node.height / 2;
    const horizontal = Math.abs(dx) / Math.max(1, node.width) >= Math.abs(dy) / Math.max(1, node.height);
    const ratio = horizontal ? .5 + dy * node.width / (2 * (Math.abs(dx) || 1) * (node.height || 1)) :
        .5 + dx * node.height / (2 * (Math.abs(dy) || 1) * (node.width || 1));
    return {side: horizontal ? dx >= 0 ? "right" : "left" : dy >= 0 ? "bottom" : "top",
        ratio: Math.max(0, Math.min(1, ratio))};
};

const simplify = (points: MindmapRoutePoint[]) => {
    const result: MindmapRoutePoint[] = [];
    for (const point of points) {
        const b = result[result.length - 1];
        if (b?.x === point.x && b.y === point.y) {
            continue;
        }
        const a = result[result.length - 2];
        if (a && ((a.x === b.x && b.x === point.x) || (a.y === b.y && b.y === point.y))) {
            result.pop();
        }
        result.push(point);
    }
    return result;
};

export const routeFreeMindmapRelation = (from: MindmapRouteBox, to: MindmapRouteBox,
                                        relation: Partial<ListMindmapRelation>) => {
    const fromAnchor = relation.fromAnchor || automaticAnchor(from, to);
    const toAnchor = relation.toAnchor || automaticAnchor(to, from);
    const endpoint = (node: MindmapRouteBox, anchor: MindmapRelationAnchor, gap: number) =>
        node.width || node.height ? getMindmapRelationAnchorPoint(node, anchor, gap) : {x: node.x, y: node.y};
    const start = endpoint(from, fromAnchor, 3);
    const end = endpoint(to, toAnchor, 3);
    if (relation.pathStyle === "straight") {
        return [start, end];
    }
    const distance = Math.max(24, Math.min(160, Math.hypot(end.x - start.x, end.y - start.y) / 3));
    const first = endpoint(from, fromAnchor, distance + 3);
    const last = endpoint(to, toAnchor, distance + 3);
    if (relation.pathStyle === "bezier") {
        return [start, relation.curve ? {x: start.x + relation.curve.from.x, y: start.y + relation.curve.from.y} : first,
            relation.curve ? {x: end.x + relation.curve.to.x, y: end.y + relation.curve.to.y} : last, end];
    }
    const stops = relation.freeRoute ? [start, ...decodeMindmapRoute(relation.freeRoute, from, to), end] : [start, first, last, end];
    const points = [start];
    for (let i = 1; i < stops.length; i++) {
        const a = stops[i - 1];
        const b = stops[i];
        if (a.x !== b.x && a.y !== b.y) {
            const horizontal = i === 1 ? ["left", "right"].includes(fromAnchor.side) :
                i === stops.length - 1 ? !["left", "right"].includes(toAnchor.side) :
                    Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
            const middle = horizontal ? (a.x + b.x) / 2 : (a.y + b.y) / 2;
            points.push(horizontal ? {x: middle, y: a.y} : {x: a.x, y: middle},
                horizontal ? {x: middle, y: b.y} : {x: b.x, y: middle});
        }
        points.push(b);
    }
    return simplify(points);
};

export const sampleMindmapRelation = (points: MindmapRoutePoint[], style: MindmapRelationPathStyle) => {
    if (style !== "bezier" || points.length !== 4) {
        return points;
    }
    return Array.from({length: 33}, (_, i) => {
        const t = i / 32;
        const u = 1 - t;
        const at = (axis: "x" | "y") => u ** 3 * points[0][axis] + 3 * u * u * t * points[1][axis] +
            3 * u * t * t * points[2][axis] + t ** 3 * points[3][axis];
        return {x: at("x"), y: at("y")};
    });
};

// 绘制和命中检测共用真实曲线；采样仅用于标签位置与路径长度估算。
export const buildMindmapRelationPath = <T extends Pick<CanvasPath, "moveTo" | "lineTo" | "bezierCurveTo" | "quadraticCurveTo">>(
    points: MindmapRoutePoint[], style: MindmapRelationPathStyle, makePath: () => T,
) => {
    const path = makePath();
    const end = points[points.length - 1];
    const drawing = (points[0].x - end.x || points[0].y - end.y) > 0 ? [...points].reverse() : points;
    path.moveTo(drawing[0].x, drawing[0].y);
    if (style === "bezier") {
        path.bezierCurveTo(drawing[1].x, drawing[1].y, drawing[2].x, drawing[2].y, drawing[3].x, drawing[3].y);
    } else {
        for (let i = 1; i < drawing.length - 1; i++) {
            const a = drawing[i - 1];
            const b = drawing[i];
            const c = drawing[i + 1];
            const before = Math.hypot(b.x - a.x, b.y - a.y);
            const after = Math.hypot(c.x - b.x, c.y - b.y);
            const radius = Math.min(8, before / 2, after / 2);
            if (!radius) {
                continue;
            }
            path.lineTo(b.x + (a.x - b.x) * radius / before, b.y + (a.y - b.y) * radius / before);
            path.quadraticCurveTo(b.x, b.y, b.x + (c.x - b.x) * radius / after, b.y + (c.y - b.y) * radius / after);
        }
        path.lineTo(drawing[drawing.length - 1].x, drawing[drawing.length - 1].y);
    }
    return path;
};
