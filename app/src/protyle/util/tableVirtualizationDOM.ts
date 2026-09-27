export const TABLE_VIRTUAL_ROWS = "data-sy-table-virtual-rows";
export const TABLE_VIRTUAL_ID = "data-sy-table-virtual-id";
export const TABLE_VIRTUAL_COLUMNS = "data-sy-table-virtual-columns";

// 占位行携带完整源内容，克隆、撤销快照和编辑器销毁后仍能独立还原。
export const restoreTableVirtualizationDOM = (root: ParentNode) => {
    root.querySelectorAll<HTMLTableRowElement>(`tr[${TABLE_VIRTUAL_ROWS}]`).forEach(placeholder => {
        const table = document.createElement("table");
        const body = table.createTBody();
        body.innerHTML = placeholder.getAttribute(TABLE_VIRTUAL_ROWS);
        placeholder.replaceWith(...Array.from(body.childNodes));
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
