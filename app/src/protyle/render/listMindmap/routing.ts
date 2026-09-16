export interface MindmapRoutePoint {x: number; y: number;}
export interface MindmapRouteBox extends MindmapRoutePoint {width: number; height: number; controlY?: number;}

// 在障碍边界构成的正交可视网格上搜索，方向纳入状态以惩罚多余转弯。
export const routeMindmapRelation = (from: MindmapRouteBox, to: MindmapRouteBox,
                                    nodes: MindmapRouteBox[], clearance = 12): MindmapRoutePoint[] => {
    const boxes = nodes.flatMap(node => [
        {left: node.x - clearance, right: node.x + node.width + clearance,
            top: node.y - clearance, bottom: node.y + node.height + clearance},
        {left: node.x + node.width - 19, right: node.x + node.width + 46,
            top: (node.controlY ?? node.y + node.height) - 19, bottom: (node.controlY ?? node.y + node.height) + 19},
    ]);
    const ports = (node: MindmapRouteBox) => [
        {x: node.x + node.width / 2, y: node.y - clearance, direction: 1},
        {x: node.x + node.width / 2, y: node.y + node.height + clearance, direction: 1},
        {x: node.x - clearance, y: node.y + node.height / 2, direction: 0},
        {x: node.x + node.width + clearance, y: node.y + Math.max(0, Math.min(node.height / 2, node.height - 22)), direction: 0},
    ];
    const starts = ports(from);
    const goals = ports(to);
    const xs = [...new Set([...boxes.flatMap(box => [box.left, box.right]), ...starts.map(p => p.x), ...goals.map(p => p.x)])].sort((a, b) => a - b);
    const ys = [...new Set([...boxes.flatMap(box => [box.top, box.bottom]), ...starts.map(p => p.y), ...goals.map(p => p.y)])].sort((a, b) => a - b);
    const point = (index: number) => ({x: xs[index % xs.length], y: ys[Math.floor(index / xs.length)]});
    const indexOf = (p: MindmapRoutePoint) => ys.indexOf(p.y) * xs.length + xs.indexOf(p.x);
    const columns = new Map<number, typeof boxes>();
    const rows = new Map<number, typeof boxes>();
    const blocked = (a: MindmapRoutePoint, b: MindmapRoutePoint) => {
        if (a.x === b.x) {
            if (!columns.has(a.x)) {
                columns.set(a.x, boxes.filter(box => a.x > box.left && a.x < box.right));
            }
            return columns.get(a.x).some(box => Math.max(a.y, b.y) > box.top && Math.min(a.y, b.y) < box.bottom);
        }
        if (!rows.has(a.y)) {
            rows.set(a.y, boxes.filter(box => a.y > box.top && a.y < box.bottom));
        }
        return rows.get(a.y).some(box => Math.max(a.x, b.x) > box.left && Math.min(a.x, b.x) < box.right);
    };
    const heuristic = (p: MindmapRoutePoint) => Math.min(...goals.map(goal => Math.abs(p.x - goal.x) + Math.abs(p.y - goal.y)));
    const targets = new Set(goals.map(goal => indexOf(goal) * 2 + goal.direction));
    const distance = new Map<number, number>();
    const previous = new Map<number, number>();
    const heap: {key: number, cost: number, score: number}[] = [];
    const push = (item: typeof heap[number]) => {
        let i = heap.length;
        heap.push(item);
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (heap[parent].score <= item.score) {
                break;
            }
            heap[i] = heap[parent];
            i = parent;
        }
        heap[i] = item;
    };
    const pop = () => {
        const first = heap[0];
        const last = heap.pop();
        if (heap.length) {
            let i = 0;
            while (i * 2 + 1 < heap.length) {
                let child = i * 2 + 1;
                if (child + 1 < heap.length && heap[child + 1].score < heap[child].score) {
                    child++;
                }
                if (last.score <= heap[child].score) {
                    break;
                }
                heap[i] = heap[child];
                i = child;
            }
            heap[i] = last;
        }
        return first;
    };
    starts.forEach(start => {
        if (blocked(start, start)) {
            return;
        }
        const key = indexOf(start) * 2 + start.direction;
        distance.set(key, 0);
        push({key, cost: 0, score: heuristic(start)});
    });
    while (heap.length) {
        const current = pop();
        if (distance.get(current.key) !== current.cost) {
            continue;
        }
        const index = Math.floor(current.key / 2);
        const a = point(index);
        if (targets.has(current.key)) {
            const route: MindmapRoutePoint[] = [];
            let key: number | undefined = current.key;
            while (key !== undefined) {
                route.push(point(Math.floor(key / 2)));
                key = previous.get(key);
            }
            route.reverse();
            return route.filter((p, i) => i === 0 || i === route.length - 1 ||
                !((route[i - 1].x === p.x && route[i + 1].x === p.x) || (route[i - 1].y === p.y && route[i + 1].y === p.y)));
        }
        const x = index % xs.length;
        const y = Math.floor(index / xs.length);
        const neighbors = [x > 0 ? index - 1 : -1, x + 1 < xs.length ? index + 1 : -1,
            y > 0 ? index - xs.length : -1, y + 1 < ys.length ? index + xs.length : -1];
        neighbors.forEach((next, side) => {
            if (next < 0) {
                return;
            }
            const b = point(next);
            const direction = side < 2 ? 0 : 1;
            // 起终点保留垂直于节点边缘的引出段，箭头始终朝向目标节点。
            if ((!previous.has(current.key) && direction !== current.key % 2) || blocked(a, b)) {
                return;
            }
            const key = next * 2 + direction;
            const cost = current.cost + Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + (direction === current.key % 2 ? 0 : 24);
            if (cost >= (distance.get(key) ?? Infinity)) {
                return;
            }
            distance.set(key, cost);
            previous.set(key, current.key);
            push({key, cost, score: cost + heuristic(b)});
        });
    }
    return [];
};
