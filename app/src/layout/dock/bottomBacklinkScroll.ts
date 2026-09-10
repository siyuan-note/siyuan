export class BottomBacklinkScroll {
    private finishes = new Set<() => void>();
    private overflowAnchor = "";
    private minHeight: string;

    constructor(private panel: HTMLElement, private viewport: HTMLElement) {
        this.minHeight = panel.style.minHeight;
    }

    public begin() {
        if (this.finishes.size === 0) {
            this.overflowAnchor = this.viewport.style.overflowAnchor;
            this.viewport.style.overflowAnchor = "none";
        }
        // 保留当前视口所需的高度，避免折叠后滚动位置被截断；不保留屏幕外的列表高度。
        const viewportBottom = this.viewport.getBoundingClientRect().top + this.viewport.clientTop +
            this.viewport.clientHeight;
        const marginBottom = parseFloat(getComputedStyle(this.panel).marginBottom) || 0;
        this.panel.style.minHeight = `${Math.max(32,
            viewportBottom - this.panel.getBoundingClientRect().top - marginBottom)}px`;
        const finish = () => {
            if (!this.finishes.delete(finish)) {
                return;
            }
            if (this.finishes.size === 0) {
                // 先完成最终布局，再恢复浏览器滚动锚定。
                this.panel.getBoundingClientRect();
                this.viewport.style.overflowAnchor = this.overflowAnchor;
            }
        };
        this.finishes.add(finish);
        return finish;
    }

    public reset() {
        this.finishes.forEach(finish => finish());
        this.panel.style.minHeight = this.minHeight;
    }
}
