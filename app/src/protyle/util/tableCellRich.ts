import {getAVRichTextBlockDOM, getAVRichTextLute, serializeAVRichTextBlockDOM} from "../render/av/richText";
import {decodeTableCellRich, encodeTableCellRich, TABLE_CELL_RICH_ATTRIBUTE, TABLE_RICH_ATTRIBUTE} from "./tableCellRichValue";

export const getTableCellRichBlockDOM = (cell: Element) => {
    const encoded = cell.getAttribute(TABLE_CELL_RICH_ATTRIBUTE);
    if (encoded !== null) {
        return getAVRichTextBlockDOM(decodeTableCellRich(encoded).content, true);
    }
    // 普通单元格先转换已有的行级 DOM，文字中的 Markdown 标记保持字面含义。
    return `<div data-type="NodeParagraph" data-node-id="${Lute.NewNodeID()}"><div contenteditable="true">` +
        `${cell.innerHTML}</div></div>`;
};

export const serializeTableCellRich = (blockDOM: string) =>
    serializeAVRichTextBlockDOM(blockDOM, getAVRichTextLute(), true);

export const getTableCellRichInline = (cell: Element) => {
    const encoded = cell.getAttribute(TABLE_CELL_RICH_ATTRIBUTE);
    decodeTableCellRich(encoded);
    return getAVRichTextLute().BlockDOM2InlineBlockDOM(
        `<div data-type="NodeTable" data-node-id="${Lute.NewNodeID()}"><div contenteditable="true">` +
        `<table><thead><tr><th ${TABLE_CELL_RICH_ATTRIBUTE}="${encoded}"></th></tr></thead></table></div></div>`);
};

export const getTableCellRichPlainText = (cell: Element) => {
    const template = document.createElement("template");
    template.innerHTML = getTableCellRichInline(cell);
    template.content.querySelectorAll("br").forEach(br => br.replaceWith("\n"));
    return (template.content.textContent || "").replace(/\u200b/g, "").trim();
};

export const renderTableCellRich = (cell: Element) => {
    const encoded = cell.getAttribute(TABLE_CELL_RICH_ATTRIBUTE);
    if (encoded === null) {
        return;
    }
    decodeTableCellRich(encoded);
    const template = document.createElement("template");
    // 由 Lute 从源数据产生预览，事务、剪贴板和静态渲染使用同一套单元格协议。
    template.innerHTML = getAVRichTextLute().SpinBlockDOM(
        `<div data-type="NodeTable" data-node-id="${Lute.NewNodeID()}"><div contenteditable="true">` +
        `<table><thead><tr><th ${TABLE_CELL_RICH_ATTRIBUTE}="${encoded}"></th></tr></thead></table></div></div>`);
    cell.innerHTML = template.content.querySelector("th").innerHTML;
    cell.setAttribute("contenteditable", "false");
    cell.closest('[data-type="NodeTable"]')?.setAttribute(TABLE_RICH_ATTRIBUTE, "1");
};

export const setTableCellRich = (cell: Element, content: string) => {
    cell.setAttribute(TABLE_CELL_RICH_ATTRIBUTE, encodeTableCellRich(content));
    renderTableCellRich(cell);
};

export const clearTableCellContent = (cell: Element) => {
    if (cell.hasAttribute(TABLE_CELL_RICH_ATTRIBUTE)) {
        setTableCellRich(cell, "");
    } else {
        cell.innerHTML = "";
    }
};

export const mergeTableCellContents = (cells: HTMLTableCellElement[]) => {
    if (cells.some(cell => cell.hasAttribute(TABLE_CELL_RICH_ATTRIBUTE))) {
        const source = serializeTableCellRich(cells.map(getTableCellRichBlockDOM).join("\n"));
        setTableCellRich(cells[0], source.markdown);
    } else {
        cells[0].innerHTML = cells.map(cell => cell.innerHTML.trim().replace(/<br>$/, "")).filter(Boolean).join("<br>");
    }
    cells.slice(1).forEach(cell => {
        cell.removeAttribute(TABLE_CELL_RICH_ATTRIBUTE);
        cell.removeAttribute("contenteditable");
        cell.removeAttribute("tabindex");
        cell.innerHTML = "";
    });
};

export const copyTableCellContent = (target: Element, source: Element) => {
    const encoded = source.getAttribute(TABLE_CELL_RICH_ATTRIBUTE);
    if (encoded !== null) {
        decodeTableCellRich(encoded);
        target.setAttribute(TABLE_CELL_RICH_ATTRIBUTE, encoded);
        renderTableCellRich(target);
    } else if (target.hasAttribute(TABLE_CELL_RICH_ATTRIBUTE)) {
        setTableCellRich(target, serializeTableCellRich(getTableCellRichBlockDOM(source)).markdown);
    } else {
        target.innerHTML = source.innerHTML;
    }
};

export const cleanTableCellRichHTML = (html: string) => {
    if (!html.includes(TABLE_CELL_RICH_ATTRIBUTE)) {
        return html;
    }
    const template = document.createElement("template");
    template.innerHTML = html;
    template.content.querySelectorAll(`th[${TABLE_CELL_RICH_ATTRIBUTE}], td[${TABLE_CELL_RICH_ATTRIBUTE}]`)
        .forEach(cell => renderTableCellRich(cell));
    return template.innerHTML;
};

export const retainTableCellRichMetadata = (html: string, changedHTML: string) => {
    if (!changedHTML.includes(TABLE_RICH_ATTRIBUTE)) {
        return html;
    }
    const changed = document.createElement("template");
    changed.innerHTML = changedHTML;
    const original = document.createElement("template");
    original.innerHTML = html;
    changed.content.querySelectorAll(`[data-type="NodeTable"][${TABLE_RICH_ATTRIBUTE}="1"]`).forEach(table => {
        const id = table.getAttribute("data-node-id");
        original.content.querySelectorAll('[data-type="NodeTable"]').forEach(previous => {
            if (previous.getAttribute("data-node-id") === id) {
                previous.setAttribute(TABLE_RICH_ATTRIBUTE, "1");
            }
        });
    });
    return original.innerHTML;
};
