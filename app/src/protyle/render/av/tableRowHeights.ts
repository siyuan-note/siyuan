export class AVTableRowHeights {
    private readonly heights: number[];
    private readonly measured = new Set<number>();
    private offsets?: number[];

    constructor(count: number, estimatedHeight: number) {
        this.heights = Array(Math.max(0, count)).fill(Math.max(1, estimatedHeight));
    }

    set(index: number, height: number) {
        if (!Number.isInteger(index) || index < 0 || index >= this.heights.length || !Number.isFinite(height) || height <= 0) {
            return;
        }
        this.measured.add(index);
        if (this.heights[index] === height) {
            return;
        }
        this.heights[index] = height;
        this.offsets = undefined;
    }

    setEstimate(height: number) {
        this.heights.forEach((value, index) => {
            if (!this.measured.has(index) && value !== height) {
                this.heights[index] = height;
                this.offsets = undefined;
            }
        });
    }

    offset(index: number) {
        if (!this.offsets) {
            this.offsets = [0];
            this.heights.forEach(height => this.offsets.push(this.offsets[this.offsets.length - 1] + height));
        }
        return this.offsets[Math.max(0, Math.min(index, this.heights.length))];
    }

    indexAt(offset: number) {
        let left = 0;
        let right = this.heights.length;
        while (left < right) {
            const middle = Math.floor((left + right) / 2);
            if (this.offset(middle + 1) <= offset) {
                left = middle + 1;
            } else {
                right = middle;
            }
        }
        return Math.max(0, Math.min(left, this.heights.length - 1));
    }
}
