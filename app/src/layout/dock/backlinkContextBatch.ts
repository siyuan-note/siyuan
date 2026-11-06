interface IBacklinkContextUpdate {
    key: number;
    isCurrent: () => boolean;
    capture: () => (() => void);
    render: () => Promise<unknown>;
}

interface IQueuedBacklinkContextUpdate extends IBacklinkContextUpdate {
    resolve: () => void;
    reject: (error: unknown) => void;
}

export class BacklinkContextBatch {
    private pending: IQueuedBacklinkContextUpdate[] = [];
    private frame = 0;
    private generation = 0;
    private versions = new Map<number, number>();

    public enqueue(update: IBacklinkContextUpdate) {
        return new Promise<void>((resolve, reject) => {
            this.pending.push({...update, resolve, reject});
            if (!this.frame) {
                this.frame = window.requestAnimationFrame(() => this.flush());
            }
        });
    }

    private flush() {
        this.frame = 0;
        const pending = this.pending;
        this.pending = [];
        const generation = this.generation;
        const groups = new Map<number, {
            restore: () => void,
            version: number,
            updates: IQueuedBacklinkContextUpdate[],
        }>();
        // 所有分区先采集阅读位置，再统一修改 DOM，避免上下文响应交错触发布局。
        pending.forEach(update => {
            if (!update.isCurrent()) {
                update.resolve();
                return;
            }
            if (!groups.has(update.key)) {
                const version = (this.versions.get(update.key) || 0) + 1;
                this.versions.set(update.key, version);
                groups.set(update.key, {restore: update.capture(), version, updates: []});
            }
            groups.get(update.key).updates.push(update);
        });
        groups.forEach(({restore, version, updates}, key) => {
            const promises = updates.map(update => {
                let result: Promise<unknown>;
                try {
                    result = update.isCurrent() ? update.render() : Promise.resolve();
                } catch (error) {
                    result = Promise.reject(error);
                }
                return result.then(update.resolve, update.reject);
            });
            void Promise.all(promises).then(() => {
                if (generation !== this.generation || version !== this.versions.get(key)) {
                    return;
                }
                window.requestAnimationFrame(() => {
                    if (generation === this.generation && version === this.versions.get(key) &&
                        updates.some(update => update.isCurrent())) {
                        restore();
                    }
                });
            });
        });
    }

    public clear() {
        window.cancelAnimationFrame(this.frame);
        this.frame = 0;
        this.generation++;
        this.versions.clear();
        this.pending.forEach(update => update.resolve());
        this.pending = [];
    }
}
