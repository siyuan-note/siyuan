// 网格只依赖单元格结构，滚动和文字编辑不需要重新构建。
export class TableGridCache<T> {
    private entries = new Map<HTMLTableElement, {observer: MutationObserver, value?: T}>();

    constructor(private build: (table: HTMLTableElement) => T) {
    }

    public get(table: HTMLTableElement): T {
        this.entries.forEach((entry, candidate) => {
            if (!candidate.isConnected) {
                entry.observer.disconnect();
                this.entries.delete(candidate);
            }
        });
        let entry = this.entries.get(table);
        if (!entry) {
            entry = {observer: new MutationObserver(records => {
                if (this.affectsGrid(records)) {
                    entry.value = undefined;
                }
            })};
            entry.observer.observe(table, {childList: true, subtree: true, attributes: true,
                attributeFilter: ["rowspan", "colspan", "class"]});
            this.entries.set(table, entry);
        }
        // 同一事件中修改结构后立即读取时，观察回调尚未执行。
        if (this.affectsGrid(entry.observer.takeRecords())) {
            entry.value = undefined;
        }
        if (!entry.value) {
            entry.value = this.build(table);
        }
        return entry.value;
    }

    private affectsGrid(records: MutationRecord[]) {
        return records.some(record => record.type === "attributes" ?
            (record.target as Element).matches("td, th") :
            [...record.addedNodes, ...record.removedNodes].some(node => node instanceof Element &&
                (node.matches("tr, td, th, thead, tbody, tfoot") || !!node.querySelector("tr, td, th"))));
    }

    public destroy() {
        this.entries.forEach(entry => entry.observer.disconnect());
        this.entries.clear();
    }
}

// 表格分区的边界覆盖全部行，测量次数不随行数增长，并保留固定表头的独立位置。
export const getTableGridRect = (table: HTMLTableElement) => {
    const rects = Array.from(table.children).filter(section => ["THEAD", "TBODY", "TFOOT"].includes(section.tagName))
        .map(section => section.getBoundingClientRect()).filter(rect => rect.height > 0);
    if (rects.length === 0) {
        return table.getBoundingClientRect();
    }
    const left = Math.min(...rects.map(rect => rect.left));
    const top = Math.min(...rects.map(rect => rect.top));
    const right = Math.max(...rects.map(rect => rect.right));
    const bottom = Math.max(...rects.map(rect => rect.bottom));
    return {left, top, right, bottom, width: right - left, height: bottom - top};
};
