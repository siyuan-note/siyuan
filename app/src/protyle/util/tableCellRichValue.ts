export const TABLE_CELL_RICH_ATTRIBUTE = "data-sy-table-cell-rich";
export const TABLE_RICH_ATTRIBUTE = "custom-sy-table-rich";

export interface TableCellRich {
    spec: 1;
    format: "kramdown";
    content: string;
}

export const encodeTableCellRich = (content: string) => {
    const bytes = new TextEncoder().encode(JSON.stringify({spec: 1, format: "kramdown", content}));
    let binary = "";
    bytes.forEach(byte => binary += String.fromCharCode(byte));
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const decodeTableCellRich = (encoded: string): TableCellRich => {
    if (!/^[A-Za-z0-9_-]+$/.test(encoded)) {
        throw new Error("Invalid table cell rich text payload");
    }
    const bytes = Uint8Array.from(atob(encoded.replace(/-/g, "+").replace(/_/g, "/")), char => char.charCodeAt(0));
    const value = JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes));
    if (!value || Object.keys(value).length !== 3 || value.spec !== 1 || value.format !== "kramdown" ||
        typeof value.content !== "string" || value.content.includes("\u0000")) {
        throw new Error("Unsupported table cell rich text format");
    }
    return value;
};
