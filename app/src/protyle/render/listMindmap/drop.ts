import type {ListMindmapPosition} from "./model";

// 空白区域同时比较上下方的同级落点和右侧中部的子节点落点。
export const findMindmapDrop = (positions: Iterable<ListMindmapPosition>, x: number, y: number,
                                       canDrop: (id: string) => boolean) => {
    let result: {id: string, placement: "before" | "after" | "child"} | undefined;
    let nearest = Infinity;
    for (const position of positions) {
        if (!position.parentId || !canDrop(position.id)) {
            continue;
        }
        const dx = Math.max(position.x - x, 0, x - position.x - position.width);
        const before = Math.abs(y - position.y);
        const after = Math.abs(y - position.y - position.height);
        const distance = Math.hypot(dx, Math.min(before, after));
        if (distance < nearest) {
            nearest = distance;
            result = {id: position.id, placement: before < after ? "before" : "after"};
        }
        const centerY = position.y + position.height / 2;
        const right = position.x + position.width;
        if (x > right && Math.abs(y - centerY) <= position.height / 6) {
            // 将子节点落点投影到下一列，避免已有下一列节点抢占与父节点对齐的空白。
            const childLeft = right + 40;
            const childDx = Math.max(childLeft - x, 0, x - childLeft - position.width);
            const childDistance = Math.hypot(childDx, y - centerY);
            if (childDistance < nearest) {
                nearest = childDistance;
                result = {id: position.id, placement: "child"};
            }
        }
    }
    return result;
};
