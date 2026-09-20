export interface MindmapRoutePoint {x: number; y: number;}
export interface MindmapRouteBox extends MindmapRoutePoint {width: number; height: number; controlY?: number;}
export interface MindmapManualRoute {
    version: 1;
    points: (MindmapRoutePoint & {t: number})[];
}

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
        if (!node.width && !node.height) {
            return [0, 1, 2, 3].map(direction => ({x: node.x, y: node.y, direction}));
        }
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

const routeAnchor = (from: MindmapRouteBox, to: MindmapRouteBox, t: number): MindmapRoutePoint => ({
    x: (from.x + from.width / 2) * (1 - t) + (to.x + to.width / 2) * t,
    y: (from.y + from.height / 2) * (1 - t) + (to.y + to.height / 2) * t,
});

// 控制点相对两个端点保存；整体平移不改变配置，单端移动按路径比例带动控制点。
export const encodeMindmapRoute = (points: MindmapRoutePoint[], from: MindmapRouteBox,
                                  to: MindmapRouteBox): MindmapManualRoute => {
    const lengths = [0];
    points.slice(1).forEach((point, index) => lengths.push(lengths[index] +
        Math.hypot(point.x - points[index].x, point.y - points[index].y)));
    const total = lengths[lengths.length - 1] || 1;
    return {version: 1, points: points.slice(1, -1).map((point, index) => {
        const t = lengths[index + 1] / total;
        const anchor = routeAnchor(from, to, t);
        return {t, x: point.x - anchor.x, y: point.y - anchor.y};
    })};
};

const decodeMindmapRoute = (route: MindmapManualRoute, from: MindmapRouteBox, to: MindmapRouteBox) =>
    route.points.map(point => {
        const anchor = routeAnchor(from, to, point.t);
        return {x: Math.round((anchor.x + point.x) * 1e6) / 1e6,
            y: Math.round((anchor.y + point.y) * 1e6) / 1e6, width: 0, height: 0};
    });

export const routeManualMindmapRelation = (from: MindmapRouteBox, to: MindmapRouteBox,
                                          nodes: MindmapRouteBox[], route: MindmapManualRoute): MindmapRoutePoint[] => {
    const controls = decodeMindmapRoute(route, from, to);
    const stops = [from, ...controls, to];
    const result: MindmapRoutePoint[] = [];
    for (let i = 1; i < stops.length; i++) {
        const a = stops[i - 1];
        const b = stops[i];
        if (!a.width && !b.width && a.x === b.x && a.y === b.y) {
            continue;
        }
        const segment = routeMindmapRelation(a, b, nodes);
        if (segment.length < 2) {
            return [];
        }
        result.push(...(result.length ? segment.slice(1) : segment));
    }
    // 合并共线点和避障后重叠的折返段，避免接缝产生无效圆角。
    const simplified: MindmapRoutePoint[] = [];
    for (const point of result) {
        let b = simplified[simplified.length - 1];
        if (b && point.x === b.x && point.y === b.y) {
            continue;
        }
        let a = simplified[simplified.length - 2];
        while (a && ((a.x === b.x && b.x === point.x) || (a.y === b.y && b.y === point.y))) {
            simplified.pop();
            b = a;
            a = simplified[simplified.length - 2];
        }
        if (!b || b.x !== point.x || b.y !== point.y) {
            simplified.push(point);
        }
    }
    return simplified;
};

export const moveMindmapRouteSegment = (points: MindmapRoutePoint[], index: number, offset: number): MindmapRoutePoint[] => {
    if (index < 0 || index >= points.length - 1) {
        return [];
    }
    const result = points.map(point => ({...point}));
    const a = result[index];
    const b = result[index + 1];
    const axis = a.y === b.y ? "y" : "x";
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 12) {
        return [];
    }
    // 首尾线段只保存移动部分，连接端重新选择垂直于节点边缘的引出段。
    const start = index === 0 ? {x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3} : a;
    const end = index === points.length - 2 ? {x: b.x - (b.x - a.x) / 3, y: b.y - (b.y - a.y) / 3} : b;
    const movedStart = {...start, [axis]: start[axis] + offset};
    const movedEnd = {...end, [axis]: end[axis] + offset};
    return [...result.slice(0, index), ...(index === 0 ? [a] : []), movedStart, movedEnd,
        ...(index === points.length - 2 ? [b] : []), ...result.slice(index + 2)];
};

export const adjustMindmapRoute = (points: MindmapRoutePoint[], index: number, offset: number,
                                  from: MindmapRouteBox, to: MindmapRouteBox, route?: MindmapManualRoute): MindmapManualRoute | undefined => {
    const candidate = moveMindmapRouteSegment(points, index, offset);
    if (candidate.length < 3) {
        return;
    }
    const a = points[index];
    const b = points[index + 1];
    const axis = a.y === b.y ? "y" : "x";
    const along = axis === "x" ? "y" : "x";
    const controls = route ? decodeMindmapRoute(route, from, to) : [];
    const selected = controls.map((point, i) => Math.abs(point[axis] - a[axis]) < .001 ? i : -1).filter(i => i >= 0);
    if (!selected.length) {
        return candidate.length <= 66 ? encodeMindmapRoute(candidate, from, to) : undefined;
    }
    // 再次拖动沿用已保存的控制点，自动避障产生的拐点不转成固定约束。
    const removed = new Set<number>();
    const crosses = (point: MindmapRoutePoint) => point[axis] > Math.min(a[axis], a[axis] + offset) &&
        point[axis] < Math.max(a[axis], a[axis] + offset);
    // 越过相邻折线时收起被跨过的控制点，允许已保存的绕行逐段缩回。
    for (let i = selected[0] - 1; i >= 0 && crosses(controls[i]); i--) {
        removed.add(i);
    }
    for (let i = selected[selected.length - 1] + 1; i < controls.length && crosses(controls[i]); i++) {
        removed.add(i);
    }
    const size = along === "y" ? "height" : "width";
    const first = from[along] < to[along] ? from : to;
    const last = first === from ? to : from;
    return {...route, points: route.points.flatMap((point, i) => {
        if (removed.has(i)) {
            return [];
        }
        if (!selected.includes(i)) {
            return [point];
        }
        const moved = {...controls[i], [axis]: controls[i][axis] + offset};
        // 回到端点之间时，连接处的控制点退到节点外侧，由路由重新选择连接端口。
        const overlapsEndpoint = [from, to].some(node =>
            (moved.x > node.x - 6 && moved.x < node.x + node.width + 6 &&
                moved.y > node.y - 6 && moved.y < node.y + node.height + 6) ||
            (moved.x > node.x + node.width - 19 && moved.x < node.x + node.width + 61 &&
                moved.y > (node.controlY ?? node.y + node.height) - 15 &&
                moved.y < (node.controlY ?? node.y + node.height) + 15));
        const inset = along === "y" && moved.x > first.x + first.width - 19 &&
            moved.x < first.x + first.width + 61 ? 16 : 8;
        if (overlapsEndpoint && first[along] + first[size] + inset <= last[along] - 8) {
            moved[along] = Math.max(first[along] + first[size] + inset, Math.min(last[along] - 8, moved[along]));
        }
        return [{...point, x: point.x + moved.x - controls[i].x, y: point.y + moved.y - controls[i].y}];
    })};
};
