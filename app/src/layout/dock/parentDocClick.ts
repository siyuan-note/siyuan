// 单击判定与数据预取并行，取消后不再应用异步结果。
export class ParentDocClick {
    private pending: {row: HTMLElement, timer: ReturnType<typeof setTimeout>, waiting: boolean} | undefined;

    public cancel() {
        if (this.pending) {
            clearTimeout(this.pending.timer);
            this.pending = undefined;
        }
    }

    public click(row: HTMLElement, prepare: () => Promise<() => void>, open: () => void) {
        if (this.pending?.row === row && this.pending.waiting) {
            this.cancel();
            open();
            return;
        }
        this.cancel();
        const pending = {row, timer: undefined as ReturnType<typeof setTimeout>, waiting: true};
        this.pending = pending;
        let apply: () => void;
        const finish = () => {
            if (this.pending !== pending || pending.waiting || !apply) { return; }
            this.pending = undefined;
            if (row.isConnected) { apply(); }
        };
        pending.timer = setTimeout(() => {
            pending.waiting = false;
            finish();
        }, 300);
        prepare().then(result => {
            apply = result;
            finish();
        }).catch(error => {
            if (this.pending === pending) { this.cancel(); }
            console.warn("Failed to prepare document children", error);
        });
    }
}
