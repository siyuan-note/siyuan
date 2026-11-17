// 草稿不携带写入操作身份，也不作为已保存卡片或复习会话使用。
export class FlashcardV2DraftPreview {
    private generation = 0;
    private closed = false;
    private pending = false;

    invalidate() {
        this.generation++;
    }

    close() {
        this.closed = true;
        this.invalidate();
    }

    async run<T>(request: () => Promise<T>, ready: (value: T) => void,
        connected: () => boolean): Promise<void> {
        if (this.pending || this.closed) {
            return;
        }
        this.pending = true;
        const generation = this.generation;
        try {
            const result = await request();
            if (!this.closed && generation === this.generation && connected()) {
                ready(result);
            }
        } finally {
            this.pending = false;
        }
    }
}
