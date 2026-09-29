export const TABLE_VIRTUAL_ROWS = "data-sy-table-virtual-rows";
export const TABLE_VIRTUAL_ID = "data-sy-table-virtual-id";
export const TABLE_VIRTUAL_COLUMNS = "data-sy-table-virtual-columns";

const detachedRows = new WeakMap<HTMLTableRowElement, {html: string, rows: HTMLTableRowElement[]}>();
const selectionEndpoints = new WeakMap<HTMLTableElement, HTMLTableCellElement[]>();

export const setTableVirtualSelection = (table: HTMLTableElement, cells?: HTMLTableCellElement[]) => {
    if (cells) {
        selectionEndpoints.set(table, cells);
    } else {
        selectionEndpoints.delete(table);
    }
};

export const isTableVirtualSelectionRow = (table: HTMLTableElement, row: HTMLTableRowElement) =>
    selectionEndpoints.get(table)?.some(cell => row.contains(cell));

// 普通虚拟表格没有合并单元格，逻辑网格直接复用屏外缓存，不挂载屏外行。
export const getVirtualTableGrid = (table: HTMLTableElement): import("./table").ITableGrid => {
    const rows = Array.from(table.rows).flatMap(row => {
        const source = row.getAttribute(TABLE_VIRTUAL_ROWS);
        if (source === null) {
            return [row];
        }
        let cached = detachedRows.get(row);
        if (cached?.html !== source) {
            const body = document.createElement("tbody");
            body.innerHTML = source;
            cached = {html: source, rows: Array.from(body.rows)};
            detachedRows.set(row, cached);
        }
        return cached.rows;
    });
    const grid = rows.map(row => Array.from(row.cells));
    return {
        grid,
        rowCount: rows.length,
        columnCount: grid[0]?.length || 0,
        sectionOfRow: rows.map(row => row.parentElement?.tagName === "THEAD" ? "thead" : "tbody"),
        cellInfos: grid.flatMap((cells, row) => cells.map((cell, col) => ({cell, row, col, rowspan: 1, colspan: 1}))),
    };
};

export const getTableVirtualRowIndex = (row: HTMLTableRowElement) => {
    let index = 0;
    for (const current of Array.from(row.closest("table").rows)) {
        if (current === row) {
            return index;
        }
        const source = current.getAttribute(TABLE_VIRTUAL_ROWS);
        if (source === null) {
            index++;
        } else {
            const cached = detachedRows.get(current);
            if (cached?.html === source) {
                index += cached.rows.length;
            } else {
                const body = document.createElement("tbody");
                body.innerHTML = source;
                index += body.rows.length;
            }
        }
    }
    return row.rowIndex;
};

export const getTableVirtualCellIndex = (cell: HTMLTableCellElement) => {
    const table = cell.closest("table");
    if (table.hasAttribute(TABLE_VIRTUAL_ID)) {
        return getTableVirtualRowIndex(cell.parentElement as HTMLTableRowElement) * table.rows[0].cells.length + cell.cellIndex;
    }
    return Array.from(table.querySelectorAll("th, td")).indexOf(cell);
};

// 只序列化可见内容与容器，屏外分段直接使用源字符串；不挂载或修改快照对应的节点。
export const getTableVirtualizationHTML = (root: Element, cellReplacements = new Map<Element, string>()): string => {
    const replacements = new Map(cellReplacements);
    root.querySelectorAll(`[${TABLE_VIRTUAL_ROWS}], [${TABLE_VIRTUAL_COLUMNS}]`).forEach(element => {
        replacements.set(element, element.getAttribute(TABLE_VIRTUAL_ROWS) ?? element.getAttribute(TABLE_VIRTUAL_COLUMNS));
    });
    const ancestors = new Set<Element>();
    [...replacements.keys(), ...Array.from(root.querySelectorAll(`[${TABLE_VIRTUAL_ID}]`)), root].forEach(element => {
        while (element && !ancestors.has(element) && root.contains(element)) {
            ancestors.add(element);
            element = element.parentElement;
        }
    });
    const holder = document.createElement("div");
    const serialize = (node: Node): string => {
        if (!(node instanceof Element)) {
            holder.replaceChildren(node.cloneNode(true));
            return holder.innerHTML;
        }
        if (replacements.has(node)) {
            return replacements.get(node);
        }
        if (!ancestors.has(node)) {
            return node.outerHTML;
        }
        const shell = node.cloneNode(false) as Element;
        shell.removeAttribute(TABLE_VIRTUAL_ID);
        const closing = `</${node.localName}>`;
        return shell.outerHTML.slice(0, -closing.length) + Array.from(node.childNodes).map(serialize).join("") + closing;
    };
    return serialize(root);
};

// 当前编辑器复用已卸载的行节点，快照仍由占位属性独立保存完整内容。
export const cacheTableVirtualizationRows = (placeholder: HTMLTableRowElement, rows: HTMLTableRowElement[]) => {
    const html = rows.map(row => row.outerHTML).join("");
    placeholder.setAttribute(TABLE_VIRTUAL_ROWS, html);
    detachedRows.set(placeholder, {html, rows});
};

export const restoreTableVirtualizationRows = (placeholder: HTMLTableRowElement) => {
    const html = placeholder.getAttribute(TABLE_VIRTUAL_ROWS);
    const cached = detachedRows.get(placeholder);
    detachedRows.delete(placeholder);
    let rows: HTMLTableRowElement[];
    if (cached?.html === html) {
        rows = cached.rows;
    } else {
        const body = document.createElement("tbody");
        body.innerHTML = html;
        rows = Array.from(body.rows);
    }
    placeholder.replaceWith(...rows);
    placeholder.removeAttribute(TABLE_VIRTUAL_ROWS);
    return rows;
};

// 占位行携带完整源内容，克隆、撤销快照和编辑器销毁后仍能独立还原。
export const restoreTableVirtualizationDOM = (root: ParentNode) => {
    root.querySelectorAll<HTMLTableRowElement>(`tr[${TABLE_VIRTUAL_ROWS}]`).forEach(placeholder => {
        restoreTableVirtualizationRows(placeholder);
    });
    root.querySelectorAll(`[${TABLE_VIRTUAL_COLUMNS}]`).forEach(columns => {
        const table = document.createElement("table");
        table.innerHTML = columns.getAttribute(TABLE_VIRTUAL_COLUMNS);
        columns.replaceWith(...Array.from(table.childNodes));
    });
    root.querySelectorAll(`[${TABLE_VIRTUAL_ID}]`).forEach(table => table.removeAttribute(TABLE_VIRTUAL_ID));
    if (root instanceof Element) {
        root.removeAttribute(TABLE_VIRTUAL_ID);
    }
};

export const cleanTableVirtualizationHTML = (html: string): string => {
    if (!html.includes(TABLE_VIRTUAL_ROWS) && !html.includes(TABLE_VIRTUAL_ID) && !html.includes(TABLE_VIRTUAL_COLUMNS)) {
        return html;
    }
    const template = document.createElement("template");
    template.innerHTML = html;
    restoreTableVirtualizationDOM(template.content);
    return template.innerHTML;
};

// 所有消费块 DOM 的转换都先恢复源内容，避免占位行进入 Markdown、导出或表格变换。
export const protectLuteTableVirtualization = (lute: Lute): Lute => new Proxy(lute, {
    get(target, property) {
        const value = Reflect.get(target, property);
        if (typeof value !== "function") {
            return value;
        }
        return (...args: unknown[]) => {
            if (typeof args[0] === "string") {
                args[0] = cleanTableVirtualizationHTML(args[0]);
            }
            return value.apply(target, args);
        };
    },
});
