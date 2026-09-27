import {cacheTableVirtualizationRows, restoreTableVirtualizationDOM, restoreTableVirtualizationRows, TABLE_VIRTUAL_COLUMNS, TABLE_VIRTUAL_ID} from "../util/tableVirtualizationDOM";

export const LARGE_TABLE_ROW_THRESHOLD = 256;
// 奇数行替换为一个占位行后，后续内容的隔行底色顺序保持不变。
export const TABLE_VIRTUAL_CHUNK_SIZE = 33;
let tableVirtualSerial = 0;

interface ITableChunk {
    top: number;
    height: number;
    placeholder: HTMLTableRowElement;
    rows?: HTMLTableRowElement[];
}

interface ITableViewport {
    table: HTMLTableElement;
    body: HTMLTableSectionElement;
    chunks: ITableChunk[];
    rules: string;
    height: number;
}

export const isTableChunkVisible = (top: number, height: number, viewportTop: number, viewportBottom: number) =>
    top + height >= viewportTop && top <= viewportBottom;

// 普通表格仍使用完整块 DOM 编辑；浏览时将屏外行序列化为独立、可恢复的占位分段。
export class LargeTableVirtualizer {
    private states = new Map<HTMLTableElement, ITableViewport>();
    private excluded = new WeakSet<HTMLTableElement>();
    private styleElement = document.createElement("style");
    private observer: MutationObserver;
    private resizeObserver: ResizeObserver;
    private abortController = new AbortController();
    private frame = 0;
    private scan = true;
    private interacting = false;
    private composing = false;
    private font = "";
    private layout = "";

    constructor(private root: HTMLElement, private editor: HTMLElement, private viewport: HTMLElement,
                private blocked: () => boolean = () => false) {
        root.appendChild(this.styleElement);
        const signal = this.abortController.signal;
        this.observer = new MutationObserver(records => this.onMutations(records));
        this.observer.observe(editor, {childList: true, subtree: true, characterData: true, attributes: true,
            attributeFilter: ["style", "class", "rowspan", "colspan", "custom-pinthead"]});
        this.resizeObserver = new ResizeObserver(() => {
            const style = getComputedStyle(this.editor);
            const layout = [this.viewport.clientWidth, this.editor.clientWidth, style.paddingLeft, style.paddingRight].join("/");
            const changedHeight = Array.from(this.states.values()).some(state =>
                Math.abs(state.table.getBoundingClientRect().height - state.height) > 2);
            if (layout !== this.layout || style.font !== this.font) {
                this.layout = layout;
                this.font = style.font;
                this.restore();
                this.scan = true;
                this.schedule();
            } else if (changedHeight) {
                this.states.forEach(state => this.measureChunks(state));
                this.schedule();
            }
        });
        this.resizeObserver.observe(viewport);
        this.resizeObserver.observe(editor);
        document.fonts?.addEventListener("loadingdone", () => {
            this.restore();
            this.scan = true;
            this.schedule();
        }, {signal});
        root.addEventListener("scroll", () => this.schedule(), {capture: true, passive: true, signal});
        // 输入和块级操作在事件分发前恢复全部行，原生选区及后续事件处理仍面对完整表格。
        ["pointerdown", "keydown", "beforeinput", "copy", "cut", "paste", "dragstart", "contextmenu"].forEach(type => {
            window.addEventListener(type, event => {
                this.interacting = type === "pointerdown" || type === "keydown";
                if (type === "pointerdown") {
                    const pointer = event as PointerEvent;
                    const cell = (event.target as Element).closest?.("td, th");
                    if (pointer.button === 0 && !pointer.shiftKey && !pointer.ctrlKey && !pointer.metaKey &&
                        !pointer.altKey && cell && this.states.has(cell.closest("table"))) {
                        return;
                    }
                }
                this.restore();
            }, {capture: true, signal});
        });
        window.addEventListener("pointerup", () => { this.interacting = false; }, {capture: true, signal});
        window.addEventListener("pointercancel", () => { this.interacting = false; }, {capture: true, signal});
        root.addEventListener("pointermove", event => {
            if (event.buttons && (event.movementX || event.movementY)) {
                this.restore();
            }
        }, {capture: true, signal});
        window.addEventListener("keyup", event => {
            this.interacting = false;
            if (["PageDown", "PageUp", "Home", "End"].includes(event.key)) {
                this.scan = true;
                this.schedule();
            }
        }, {capture: true, signal});
        root.addEventListener("compositionstart", () => {
            this.composing = true;
            this.restore();
        }, {capture: true, signal});
        root.addEventListener("compositionend", () => { this.composing = false; }, {capture: true, signal});
        root.addEventListener("wheel", () => {
            this.scan = true;
            this.schedule();
        }, {passive: true, signal});
        root.addEventListener("touchmove", () => {
            this.interacting = false;
            this.scan = true;
            this.schedule();
        }, {passive: true, signal});
        document.addEventListener("selectionchange", () => {
            const selection = getSelection();
            if (selection && !selection.isCollapsed && selection.rangeCount &&
                selection.getRangeAt(0).intersectsNode(this.editor)) {
                this.restore();
            }
        }, {signal});
        window.addEventListener("beforeprint", () => this.restore(), {signal});
        this.schedule();
    }

    private schedule() {
        if (!this.frame) {
            this.frame = requestAnimationFrame(() => {
                this.frame = 0;
                this.refresh();
            });
        }
    }

    private onMutations(records: MutationRecord[]) {
        // 内嵌编辑器的浮动控件随滚动更新样式，不属于表格正文变化。
        records = records.filter(record => {
            const element = record.target instanceof Element ? record.target : record.target.parentElement;
            const host = element?.closest(".table__cell-editor.table__cell--inline");
            return !host || element === host || host.contains(element.closest(".protyle-wysiwyg"));
        });
        if (records.length === 0) {
            return;
        }
        records.forEach(record => {
            const element = record.target instanceof Element ? record.target : record.target.parentElement;
            const table = element?.closest("table");
            if (table) {
                this.excluded.delete(table);
            }
        });
        this.states.forEach((state, table) => {
            if (!table.isConnected || records.some(record => table.contains(record.target) ||
                record.type === "childList" && record.target instanceof Element && record.target.contains(table))) {
                const relevant = records.filter(record => table.contains(record.target));
                const cellContentOnly = table.isConnected && relevant.length > 0 && relevant.every(record => {
                    const element = record.target instanceof Element ? record.target : record.target.parentElement;
                    const cell = element?.closest("td, th");
                    return cell?.closest("table") === table && (record.type !== "attributes" ||
                        record.attributeName === "class" || record.attributeName === "style") &&
                        !cell.matches(".fn__none, [hidden], [style*='display: none'], [style*='display:none']") &&
                        !cell.querySelector(".table__cell-rich, table, img, video, audio, iframe, canvas, math") &&
                        !Array.from(record.addedNodes).some(node => node instanceof Element && node.matches("tr, td, th"));
                });
                if (cellContentOnly) {
                    this.measureChunks(state);
                    this.schedule();
                } else {
                    this.restore(table);
                }
            }
        });
        // 内联编辑器异步挂载完成后重新扫描，避免首次滚动早于编辑器就绪而停留在完整表格。
        const inlineEditorReady = records.some(record => {
            const element = record.target instanceof Element ? record.target : record.target.parentElement;
            return element?.matches(".table__cell-editor.table__cell--inline") ||
                Array.from(record.addedNodes).some(node => node instanceof Element &&
                    node.matches(".table__cell-editor.table__cell--inline"));
        });
        // 文档加载及事务替换会引入新的表格，单元格输入无需反复初始化。
        if (inlineEditorReady || records.some(record => Array.from(record.addedNodes).some(node => node instanceof Element &&
            (node.matches('[data-type="NodeTable"]') || !!node.querySelector('[data-type="NodeTable"]'))))) {
            this.scan = true;
            this.schedule();
        }
    }

    public restore(table?: HTMLTableElement) {
        const tables = table ? [table] : Array.from(this.states.keys());
        tables.forEach(current => {
            restoreTableVirtualizationDOM(current);
            this.states.delete(current);
        });
        this.updateStyle();
        this.observer.takeRecords();
    }

    private updateStyle() {
        const rules = Array.from(this.states.values()).map(state => state.rules).join("\n");
        if (rules !== this.styleElement.textContent) {
            this.styleElement.textContent = rules;
        }
    }

    private measureChunks(state: ITableViewport) {
        const top = state.body.getBoundingClientRect().top;
        state.chunks.forEach(chunk => {
            const first = (chunk.rows?.[0] || chunk.placeholder).getBoundingClientRect();
            const last = (chunk.rows?.[chunk.rows.length - 1] || chunk.placeholder).getBoundingClientRect();
            chunk.top = first.top - top;
            chunk.height = last.bottom - first.top;
        });
        state.height = state.table.getBoundingClientRect().height;
    }

    private prepare(table: HTMLTableElement): ITableViewport | undefined {
        const body = table.tBodies[0];
        if (table.tBodies.length !== 1 || table.tFoot || !body || body.rows.length <= LARGE_TABLE_ROW_THRESHOLD ||
            table.closest(".protyle-wysiwyg__embed, .protyle-custom, .mindmap-view, .table__cell-rich") ||
            Array.from(table.querySelectorAll("table, img, video, audio, iframe, canvas, svg, math, input, textarea, select, button, " +
                "object, embed, details, [hidden], [style*='display: none'], [style*='display:none'], " +
                ".table__cell-rich, .table__cell-editor, " +
                '[data-type~="inline-math"], [data-type~="search-mark"], [data-type~="block-ref"], ' +
                "wbr, .fn__none")).some(element =>
                !element.closest(".table__cell-editor.table__cell--inline")) ||
            table.querySelectorAll(":scope > colgroup").length > 1) {
            this.excluded.add(table);
            return;
        }
        const rows = Array.from(body.rows);
        const first = rows[0];
        const columns = first.cells.length;
        const originalColumns = table.querySelector(":scope > colgroup");
        if (!columns || Array.from(table.rows).some(row => row.cells.length !== columns ||
            Array.from(row.cells).some(cell => cell.rowSpan !== 1 || cell.colSpan !== 1)) ||
            originalColumns && (originalColumns.children.length !== columns ||
                Array.from(originalColumns.children).some(column => (column as HTMLTableColElement).span !== 1))) {
            this.excluded.add(table);
            return;
        }
        const tableRect = table.getBoundingClientRect();
        const bodyRect = body.getBoundingClientRect();
        if (tableRect.width <= 0 || bodyRect.height <= 0) {
            return;
        }
        // 一次性读取完整表格的列宽与分段高度，滚动时只计算视口与缓存区间。
        const widths = Array.from(first.cells).map(cell => cell.getBoundingClientRect().width);
        const chunks: ITableChunk[] = [];
        for (let i = 0; i < rows.length; i += TABLE_VIRTUAL_CHUNK_SIZE) {
            const chunkRows = rows.slice(i, i + TABLE_VIRTUAL_CHUNK_SIZE);
            const top = chunkRows[0].getBoundingClientRect().top - bodyRect.top;
            const end = chunkRows[chunkRows.length - 1].getBoundingClientRect().bottom - bodyRect.top;
            const placeholder = document.createElement("tr");
            placeholder.setAttribute("contenteditable", "false");
            placeholder.setAttribute("aria-hidden", "true");
            const cell = placeholder.insertCell();
            cell.colSpan = columns;
            // 占位单元格只保留布局高度，不能引入正文单元格的边距、边框或空内容最小高度。
            cell.style.cssText = `height:${end - top}px;padding:0;border:0;line-height:0;font-size:0;`;
            cell.textContent = "\u200b";
            chunks.push({top, height: end - top, placeholder, rows: chunkRows});
        }
        const group = originalColumns ? originalColumns.cloneNode(true) as HTMLTableColElement : document.createElement("colgroup");
        group.setAttribute(TABLE_VIRTUAL_COLUMNS, originalColumns?.outerHTML || "");
        widths.forEach((width, index) => {
            const column = group.children[index] as HTMLTableColElement || document.createElement("col");
            column.style.width = `${width}px`;
            if (!column.parentElement) {
                group.appendChild(column);
            }
        });
        if (originalColumns) {
            originalColumns.replaceWith(group);
        } else {
            table.insertBefore(group, table.firstChild);
        }
        const id = (++tableVirtualSerial).toString();
        table.setAttribute(TABLE_VIRTUAL_ID, id);
        const selector = `.protyle-wysiwyg table[${TABLE_VIRTUAL_ID}="${id}"]`;
        const rules = `${selector}{table-layout:fixed;width:${tableRect.width}px;}`;
        return {table, body, chunks, rules, height: tableRect.height};
    }

    private refresh() {
        this.onMutations(this.observer.takeRecords());
        const selection = getSelection();
        if (this.interacting) {
            return;
        }
        if (!this.editor.isConnected || this.composing || this.blocked() ||
            selection && !selection.isCollapsed && selection.rangeCount &&
            selection.getRangeAt(0).intersectsNode(this.editor)) {
            this.restore();
            return;
        }
        this.states.forEach((_state, table) => {
            if (!table.isConnected || !table.hasAttribute(TABLE_VIRTUAL_ID)) {
                this.restore(table);
            }
        });
        if (this.scan) {
            this.scan = false;
            this.editor.querySelectorAll<HTMLTableElement>('[data-type="NodeTable"] > div > table').forEach(table => {
                if (!this.states.has(table) && !this.excluded.has(table)) {
                    const state = this.prepare(table);
                    if (state) {
                        this.states.set(table, state);
                    }
                }
            });
            this.updateStyle();
        }
        const viewport = this.viewport.getBoundingClientRect();
        const plans = Array.from(this.states.values()).map(state => {
            const wrapper = state.table.parentElement.getBoundingClientRect();
            const top = Math.max(viewport.top, wrapper.top);
            const bottom = Math.min(viewport.bottom, wrapper.bottom);
            const bodyTop = state.body.getBoundingClientRect().top;
            const buffer = Math.max(0, Math.min(viewport.height, wrapper.height));
            return {state, top: top - buffer - bodyTop, bottom: bottom + buffer - bodyTop};
        });
        // 先完成全部几何读取，再移除或恢复行；光标所在分段保持连接以保护原生选区。
        plans.forEach(({state, top, bottom}) => {
            state.chunks.forEach(chunk => {
                // 内联单元格编辑器包含交互状态，即使光标移走也不能序列化或卸载。
                const pinned = chunk.rows?.some(row => row.contains(selection?.anchorNode) ||
                    !!row.querySelector(".table__cell-editor"));
                if (pinned || isTableChunkVisible(chunk.top, chunk.height, top, bottom)) {
                    if (!chunk.rows) {
                        chunk.rows = restoreTableVirtualizationRows(chunk.placeholder);
                    }
                } else if (chunk.rows) {
                    chunk.placeholder.cells[0].style.height = `${chunk.height}px`;
                    cacheTableVirtualizationRows(chunk.placeholder, chunk.rows);
                    chunk.rows[0].before(chunk.placeholder);
                    chunk.rows.forEach(row => row.remove());
                    chunk.rows = undefined;
                }
            });
        });
        this.observer.takeRecords();
    }

    public destroy() {
        cancelAnimationFrame(this.frame);
        this.abortController.abort();
        this.resizeObserver.disconnect();
        this.restore();
        this.observer.disconnect();
        this.styleElement.remove();
    }
}
