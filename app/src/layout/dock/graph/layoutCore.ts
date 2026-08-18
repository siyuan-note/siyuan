import {IGraphLayoutOptions} from "./types";

const TREE_THETA_SQUARED = 0.25;
const MAX_TREE_DEPTH = 32;
const STABLE_TICKS = 12;
const LEGACY_LINK_DISTANCE_FACTOR = 1.5;

export class GraphForceLayout {
    public readonly positions: Float32Array;
    private readonly degrees: Uint32Array;
    private readonly forces: Float32Array;
    private readonly pinned: Uint8Array;
    private readonly pinnedPositions: Float32Array;
    private readonly sizes: Float32Array;
    private readonly sources: Uint32Array;
    private readonly targets: Uint32Array;
    private readonly velocities: Float32Array;
    private options: IGraphLayoutOptions;
    private iteration = 0;
    private stable = 0;
    private treeBodies: Int32Array;
    private treeCentersX: Float64Array;
    private treeCentersY: Float64Array;
    private treeChildren: Int32Array;
    private treeHalves: Float64Array;
    private treeMasses: Float64Array;
    private treePointsX: Float64Array;
    private treePointsY: Float64Array;
    private treeCount = 0;
    private treeStack: Int32Array;

    constructor(options: {
        degrees: Uint32Array;
        layout: IGraphLayoutOptions;
        positions: Float32Array;
        sizes: Float32Array;
        sources: Uint32Array;
        targets: Uint32Array;
    }) {
        this.positions = options.positions;
        this.degrees = options.degrees;
        this.options = options.layout;
        this.sizes = options.sizes;
        this.sources = options.sources;
        this.targets = options.targets;
        this.forces = new Float32Array(this.positions.length);
        this.velocities = new Float32Array(this.positions.length);
        this.pinned = new Uint8Array(this.sizes.length);
        this.pinnedPositions = new Float32Array(this.positions.length);
        const treeCapacity = Math.max(16, this.sizes.length * 4 + 1);
        this.treeBodies = new Int32Array(treeCapacity);
        this.treeCentersX = new Float64Array(treeCapacity);
        this.treeCentersY = new Float64Array(treeCapacity);
        this.treeChildren = new Int32Array(treeCapacity * 4);
        this.treeHalves = new Float64Array(treeCapacity);
        this.treeMasses = new Float64Array(treeCapacity);
        this.treePointsX = new Float64Array(treeCapacity);
        this.treePointsY = new Float64Array(treeCapacity);
        this.treeStack = new Int32Array(treeCapacity);
    }

    public setOptions(options: IGraphLayoutOptions) {
        this.options = options;
        for (let index = 0; index < this.velocities.length; index++) {
            this.velocities[index] *= 0.25;
        }
        this.restart();
    }

    public pin(index: number, x: number, y: number) {
        if (index < 0 || index >= this.sizes.length) {
            return;
        }
        this.pinned[index] = 1;
        this.pinnedPositions[index * 2] = x;
        this.pinnedPositions[index * 2 + 1] = y;
        this.positions[index * 2] = x;
        this.positions[index * 2 + 1] = y;
        this.velocities[index * 2] = 0;
        this.velocities[index * 2 + 1] = 0;
        this.restart();
    }

    public release(index: number) {
        if (index < 0 || index >= this.sizes.length) {
            return;
        }
        this.pinned[index] = 0;
        this.restart();
    }

    public restart() {
        this.iteration = 0;
        this.stable = 0;
    }

    public step(count = 1) {
        if (this.sizes.length < 2) {
            return true;
        }
        let settled = false;
        for (let index = 0; index < count; index++) {
            settled = this.stepOnce();
            if (settled) {
                break;
            }
        }
        return settled;
    }

    private stepOnce() {
        this.forces.fill(0);
        this.buildTree();
        this.applyRepulsion();
        this.applySprings();
        const nodeCount = this.sizes.length;
        const timestep = nodeCount > 2048 ? 0.12 : nodeCount > 256 ? 0.18 : 0.25;
        const damping = 0.4;
        const maxVelocity = Math.max(24, this.options.linkDistance * 0.25);
        let velocityTotal = 0;
        for (let index = 0; index < nodeCount; index++) {
            const offset = index * 2;
            if (this.pinned[index]) {
                this.positions[offset] = this.pinnedPositions[offset];
                this.positions[offset + 1] = this.pinnedPositions[offset + 1];
                this.velocities[offset] = 0;
                this.velocities[offset + 1] = 0;
                continue;
            }
            const degreeWeight = this.degrees[index] + 1;
            const centerStrength = this.options.centerStrength * degreeWeight;
            this.forces[offset] -= this.positions[offset] * centerStrength;
            this.forces[offset + 1] -= this.positions[offset + 1] * centerStrength;
            let velocityX = this.velocities[offset] +
                (this.forces[offset] - damping * this.velocities[offset]) * timestep;
            let velocityY = this.velocities[offset + 1] +
                (this.forces[offset + 1] - damping * this.velocities[offset + 1]) * timestep;
            const velocity = Math.hypot(velocityX, velocityY);
            if (velocity > maxVelocity) {
                const ratio = maxVelocity / velocity;
                velocityX *= ratio;
                velocityY *= ratio;
            }
            this.velocities[offset] = velocityX;
            this.velocities[offset + 1] = velocityY;
            this.positions[offset] += velocityX * timestep;
            this.positions[offset + 1] += velocityY * timestep;
            velocityTotal += Math.hypot(velocityX, velocityY);
        }
        this.iteration++;
        if (velocityTotal / nodeCount < 0.035) {
            this.stable++;
        } else {
            this.stable = 0;
        }
        const maxIterations = nodeCount > 4096 ? 96 : nodeCount > 1024 ? 160 : 320;
        return this.iteration >= maxIterations || this.stable >= STABLE_TICKS;
    }

    private applySprings() {
        const linkDistance = this.options.linkDistance * LEGACY_LINK_DISTANCE_FACTOR;
        for (let index = 0; index < this.sources.length; index++) {
            const source = this.sources[index];
            const target = this.targets[index];
            const sourceOffset = source * 2;
            const targetOffset = target * 2;
            const deltaX = this.positions[targetOffset] - this.positions[sourceOffset];
            const deltaY = this.positions[targetOffset + 1] - this.positions[sourceOffset + 1];
            const distance = Math.max(0.001, Math.hypot(deltaX, deltaY));
            const force = (distance - linkDistance) * this.options.springStrength;
            const forceX = deltaX / distance * force;
            const forceY = deltaY / distance * force;
            this.forces[sourceOffset] += forceX;
            this.forces[sourceOffset + 1] += forceY;
            this.forces[targetOffset] -= forceX;
            this.forces[targetOffset + 1] -= forceY;
        }
    }

    private applyRepulsion() {
        for (let body = 0; body < this.sizes.length; body++) {
            const bodyOffset = body * 2;
            const degreeWeight = this.degrees[body] + 1;
            const bodyX = this.positions[bodyOffset];
            const bodyY = this.positions[bodyOffset + 1];
            let stackLength = 1;
            this.treeStack[0] = 0;
            while (stackLength > 0) {
                const cell = this.treeStack[--stackLength];
                const mass = this.treeMasses[cell];
                if (mass === 0) {
                    continue;
                }
                const cellBody = this.treeBodies[cell];
                if (cellBody === body) {
                    continue;
                }
                const deltaX = bodyX - this.treePointsX[cell];
                const deltaY = bodyY - this.treePointsY[cell];
                const distanceSquared = deltaX * deltaX + deltaY * deltaY + 0.01;
                const width = this.treeHalves[cell] * 2;
                if (cellBody >= 0 || width * width / distanceSquared < TREE_THETA_SQUARED) {
                    const distance = Math.sqrt(distanceSquared);
                    let force = this.options.repulsion * degreeWeight * mass / distanceSquared;
                    if (cellBody >= 0) {
                        const minimumDistance = (this.sizes[body] + this.sizes[cellBody]) * 1.2;
                        if (distance < minimumDistance) {
                            force += (minimumDistance - distance) * 0.5 * degreeWeight / distance;
                        }
                    }
                    this.forces[bodyOffset] += deltaX * force;
                    this.forces[bodyOffset + 1] += deltaY * force;
                    continue;
                }
                const childOffset = cell * 4;
                for (let quadrant = 0; quadrant < 4; quadrant++) {
                    const child = this.treeChildren[childOffset + quadrant];
                    if (child >= 0) {
                        this.treeStack[stackLength++] = child;
                    }
                }
            }
        }
    }

    private buildTree() {
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        for (let index = 0; index < this.positions.length; index += 2) {
            minX = Math.min(minX, this.positions[index]);
            maxX = Math.max(maxX, this.positions[index]);
            minY = Math.min(minY, this.positions[index + 1]);
            maxY = Math.max(maxY, this.positions[index + 1]);
        }
        const half = Math.max(1, Math.max(maxX - minX, maxY - minY) / 2 + 1);
        this.treeCount = 0;
        this.createTreeCell((minX + maxX) / 2, (minY + maxY) / 2, half);
        for (let body = 0; body < this.sizes.length; body++) {
            this.insertTreeBody(body);
        }
        for (let cell = this.treeCount - 1; cell >= 0; cell--) {
            const body = this.treeBodies[cell];
            if (body >= 0) {
                this.treeMasses[cell] = 1;
                this.treePointsX[cell] = this.positions[body * 2];
                this.treePointsY[cell] = this.positions[body * 2 + 1];
                continue;
            }
            let mass = 0;
            let pointX = 0;
            let pointY = 0;
            const childOffset = cell * 4;
            for (let quadrant = 0; quadrant < 4; quadrant++) {
                const child = this.treeChildren[childOffset + quadrant];
                if (child < 0) {
                    continue;
                }
                const childMass = this.treeMasses[child];
                mass += childMass;
                pointX += this.treePointsX[child] * childMass;
                pointY += this.treePointsY[child] * childMass;
            }
            this.treeMasses[cell] = mass;
            if (mass > 0) {
                this.treePointsX[cell] = pointX / mass;
                this.treePointsY[cell] = pointY / mass;
            }
        }
    }

    private insertTreeBody(body: number) {
        let cell = 0;
        let depth = 0;
        while (depth++ < MAX_TREE_DEPTH) {
            const existingBody = this.treeBodies[cell];
            if (existingBody === -1) {
                this.treeBodies[cell] = body;
                return;
            }
            if (existingBody >= 0) {
                this.treeBodies[cell] = -2;
                const existingChild = this.getTreeChild(cell, existingBody);
                this.treeBodies[existingChild] = existingBody;
            }
            cell = this.getTreeChild(cell, body);
        }
        const offset = body * 2;
        this.positions[offset] += (body % 7 + 1) * 0.001;
        this.positions[offset + 1] -= (body % 11 + 1) * 0.001;
    }

    private getTreeChild(cell: number, body: number) {
        const x = this.positions[body * 2];
        const y = this.positions[body * 2 + 1];
        const right = x >= this.treeCentersX[cell] ? 1 : 0;
        const bottom = y >= this.treeCentersY[cell] ? 1 : 0;
        const quadrant = right + bottom * 2;
        const childOffset = cell * 4 + quadrant;
        let child = this.treeChildren[childOffset];
        if (child >= 0) {
            return child;
        }
        const half = this.treeHalves[cell] / 2;
        child = this.createTreeCell(
            this.treeCentersX[cell] + (right ? half : -half),
            this.treeCentersY[cell] + (bottom ? half : -half),
            half,
        );
        this.treeChildren[childOffset] = child;
        return child;
    }

    private createTreeCell(centerX: number, centerY: number, half: number) {
        this.ensureTreeCapacity(this.treeCount + 1);
        const cell = this.treeCount++;
        this.treeBodies[cell] = -1;
        this.treeCentersX[cell] = centerX;
        this.treeCentersY[cell] = centerY;
        this.treeHalves[cell] = half;
        this.treeMasses[cell] = 0;
        this.treePointsX[cell] = 0;
        this.treePointsY[cell] = 0;
        this.treeChildren.fill(-1, cell * 4, cell * 4 + 4);
        return cell;
    }

    private ensureTreeCapacity(required: number) {
        if (required <= this.treeBodies.length) {
            return;
        }
        const capacity = Math.max(required, this.treeBodies.length * 2);
        const bodies = new Int32Array(capacity);
        bodies.set(this.treeBodies);
        this.treeBodies = bodies;
        const centersX = new Float64Array(capacity);
        centersX.set(this.treeCentersX);
        this.treeCentersX = centersX;
        const centersY = new Float64Array(capacity);
        centersY.set(this.treeCentersY);
        this.treeCentersY = centersY;
        const children = new Int32Array(capacity * 4);
        children.set(this.treeChildren);
        this.treeChildren = children;
        const halves = new Float64Array(capacity);
        halves.set(this.treeHalves);
        this.treeHalves = halves;
        const masses = new Float64Array(capacity);
        masses.set(this.treeMasses);
        this.treeMasses = masses;
        const pointsX = new Float64Array(capacity);
        pointsX.set(this.treePointsX);
        this.treePointsX = pointsX;
        const pointsY = new Float64Array(capacity);
        pointsY.set(this.treePointsY);
        this.treePointsY = pointsY;
        this.treeStack = new Int32Array(capacity);
    }
}
