export interface MindmapRoutePoint {x: number; y: number;}
export interface MindmapRouteBox extends MindmapRoutePoint {width: number; height: number; controlY?: number;}

const bendCost = 24;

export const routeMindmapRelation = (from: MindmapRouteBox, to: MindmapRouteBox,
                                    nodes: MindmapRouteBox[], clearance = 12): MindmapRoutePoint[] => {
    // 双向连接使用同一条几何路径，避免端口同分时因搜索方向不同而出现错位。
    const order = from.x - to.x || from.y - to.y || from.width - to.width || from.height - to.height;
    if (to.width > 0 && to.height > 0 && order > 0) {
        return routeMindmapRelation(to, from, nodes, clearance).reverse();
    }
    let best: MindmapRoutePoint[] = [];
    let bestCost = Infinity;
    for (const gap of [...new Set([clearance, Math.min(clearance, 6)])]) {
        const route = findRelationRoute(from, to, nodes, gap);
        if (route.length < 2) {
            continue;
        }
        const cost = route.slice(1).reduce((total, point, index) => total +
            Math.abs(point.x - route[index].x) + Math.abs(point.y - route[index].y),
        Math.max(0, route.length - 2) * bendCost);
        if (cost < bestCost) {
            best = route;
            bestCost = cost;
        }
        // 直连已经没有绕行和转弯，无需再次搜索更靠近节点的端口。
        if (best.length === 2) {
            break;
        }
    }
    // 搜索保留避障空间，绘制端点靠近节点，避免短连接只剩两个挤在一起的箭头。
    const attach = (point: MindmapRoutePoint, node: MindmapRouteBox) => {
        if (!node.width || !node.height) {
            return;
        }
        if (point.x < node.x) {
            point.x = node.x - 3;
        } else if (point.x > node.x + node.width) {
            point.x = node.x + node.width + 3;
        } else if (point.y < node.y) {
            point.y = node.y - 3;
        } else {
            point.y = node.y + node.height + 3;
        }
    };
    if (best.length >= 2) {
        attach(best[0], from);
        attach(best[best.length - 1], to);
    }
    return best;
};

// 在障碍边界构成的正交可视网格上搜索，方向纳入状态以惩罚多余转弯。
const findRelationRoute = (from: MindmapRouteBox, to: MindmapRouteBox,
                           nodes: MindmapRouteBox[], clearance: number): MindmapRoutePoint[] => {
    const boxes = nodes.flatMap(node => [
        {left: node.x - clearance, right: node.x + node.width + clearance,
            top: node.y - clearance, bottom: node.y + node.height + clearance},
        {left: node.x + node.width - 19, right: node.x + node.width + 61,
            top: (node.controlY ?? node.y + node.height) - 15, bottom: (node.controlY ?? node.y + node.height) + 15},
    ]);
    const ports = (node: MindmapRouteBox, other: MindmapRouteBox) => {
        const centerX = node.x + node.width / 2;
        const otherCenterX = other.x + other.width / 2;
        const xs = [...new Set([centerX, ...(otherCenterX >= node.x + 12 &&
            otherCenterX <= node.x + node.width - 12 ? [otherCenterX] : [])])];
        const centerY = node.y + node.height / 2;
        const otherCenterY = other.y + other.height / 2;
        const ys = [...new Set([centerY, ...(otherCenterY >= node.y + 4 &&
            otherCenterY <= node.y + node.height - 4 ? [otherCenterY] : [])])];
        return [
            ...xs.flatMap(x => [{x, y: node.y - clearance, direction: 2},
                {x, y: node.y + node.height + clearance, direction: 3}]),
            ...ys.flatMap(y => [{x: node.x - clearance, y, direction: 0},
                {x: node.x + node.width + clearance, y, direction: 1}]),
        ];
    };
    const starts = ports(from, to);
    const goals = to.width === 0 && to.height === 0 ?
        [0, 1, 2, 3].map(direction => ({x: to.x, y: to.y, direction})) : ports(to, from);
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
    const targets = new Set(goals.map(goal => indexOf(goal) * 4 + (goal.direction ^ 1)));
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
        const key = indexOf(start) * 4 + start.direction;
        distance.set(key, 0);
        push({key, cost: 0, score: heuristic(start)});
    });
    while (heap.length) {
        const current = pop();
        if (distance.get(current.key) !== current.cost) {
            continue;
        }
        const index = Math.floor(current.key / 4);
        const a = point(index);
        // 相邻节点的避让端口可能重合，不能将尚未走过任何线段的起点作为完整路径。
        if (targets.has(current.key) && previous.has(current.key)) {
            const route: MindmapRoutePoint[] = [];
            let key: number | undefined = current.key;
            while (key !== undefined) {
                route.push(point(Math.floor(key / 4)));
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
            const direction = side;
            // 起终点保留垂直于节点边缘的引出段，箭头始终朝向目标节点。
            if (direction === (current.key % 4 ^ 1) ||
                (!previous.has(current.key) && direction !== current.key % 4) || blocked(a, b)) {
                return;
            }
            const key = next * 4 + direction;
            const cost = current.cost + Math.abs(a.x - b.x) + Math.abs(a.y - b.y) + (direction === current.key % 4 ? 0 : bendCost);
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
