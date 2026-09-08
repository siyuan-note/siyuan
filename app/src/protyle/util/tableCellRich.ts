import {getAVRichTextBlockDOM, getAVRichTextLute, sanitizeAVRichTextBlockDOM, serializeAVRichTextBlockDOM} from "../render/av/richText";
import {decodeTableCellRich, encodeTableCellRich, TABLE_CELL_RICH_ATTRIBUTE, TABLE_RICH_ATTRIBUTE} from "./tableCellRichValue";

export const TABLE_CELL_INLINE_ATTRIBUTE = "data-sy-table-cell-inline";

export const getTableCellInlineHTML = (blockDOM: string): string | null => {
    const template = document.createElement("template");
    template.innerHTML = blockDOM;
    const blocks = Array.from(template.content.children);
    if (blocks.length === 0) {
        return "";
    }
    if (blocks.length !== 1 || blocks[0].getAttribute("data-type") !== "NodeParagraph" ||
        blocks[0].querySelector('[data-type^="Node"]')) {
        return null;
    }
    const content = blocks[0].querySelector(':scope > [contenteditable="true"]');
    if (!content) {
        return null;
    }
    content.querySelectorAll('span[data-type="text"]:not([style])').forEach(span => span.replaceWith(...Array.from(span.childNodes)));
    // 表格的行级内容使用 br 保存软换行，片段编辑器使用文本换行。
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    while (walker.nextNode()) {
        texts.push(walker.currentNode as Text);
    }
    texts.forEach(text => {
        if (text.data.includes("\n")) {
            const lines = text.data.split("\n");
            text.replaceWith(...lines.flatMap((line, index) => index === 0 ? [line] : [document.createElement("br"), line]));
        }
    });
    return content.innerHTML;
};

export const getTableCellRichBlockDOM = (cell: Element) => {
    const encoded = cell.getAttribute(TABLE_CELL_RICH_ATTRIBUTE);
    // 普通单元格先转换已有的行级 DOM，文字中的 Markdown 标记保持字面含义。
    const blockDOM = encoded !== null ? getAVRichTextBlockDOM(decodeTableCellRich(encoded).content, true) :
        `<div class="p" data-type="NodeParagraph" data-node-id="${Lute.NewNodeID()}"><div contenteditable="true">` +
        `${(cell.getAttribute(TABLE_CELL_INLINE_ATTRIBUTE) ?? cell.innerHTML) || "\u200b"}</div></div>`;
    const template = document.createElement("template");
    template.innerHTML = blockDOM;
    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    while (walker.nextNode()) {
        const text = walker.currentNode as Text;
        if (text.parentElement?.closest('[contenteditable="true"]') &&
            !text.parentElement.closest('span[data-type], [data-type="NodeCodeBlock"], [data-type="NodeMathBlock"], .img') &&
            /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/.test(text.data)) {
            texts.push(text);
        }
    }
    // 已有标记符作为字面文本参与编辑，避免输入其他字符时被即时 Markdown 解析重新解释。
    texts.forEach(text => {
        const span = document.createElement("span");
        span.dataset.type = "text";
        text.replaceWith(span);
        span.appendChild(text);
    });
    return template.innerHTML;
};

export const serializeTableCellRich = (blockDOM: string) => {
    const template = document.createElement("template");
    template.innerHTML = sanitizeAVRichTextBlockDOM(blockDOM, true);
    let prefix = "SYTABLECELLWHITESPACE";
    while (template.innerHTML.includes(prefix)) {
        prefix += "X";
    }
    const whitespace: string[] = [];
    const protectWhitespace = (value: string) => {
        const token = `${prefix}${whitespace.length}END`;
        whitespace.push(value.replace(/ /g, "&#32;").replace(/\t/g, "&#9;").replace(/\n/g, "<br />"));
        return token;
    };
    template.content.querySelectorAll("br").forEach(br => {
        if (!br.closest('[data-type="NodeCodeBlock"], [data-type="NodeMathBlock"], .img')) {
            br.replaceWith(protectWhitespace("\n"));
        }
    });
    // 只转义正文文本中的 Markdown 标记，实际行级格式和代码、公式的源内容保持原样。
    const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
        const text = walker.currentNode as Text;
        if (text.parentElement?.closest('[contenteditable="true"]') &&
            !text.parentElement.closest('[data-type="NodeCodeBlock"], [data-type="NodeMathBlock"], .img')) {
            if (!text.parentElement.closest("span[data-type]")) {
                text.data = text.data.replace(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g, "\\$&");
            }
            // 软换行不能变成段落分隔，段首和段尾空白不能被 Markdown 格式化移除。
            text.data = text.data.replace(/^[ \t]+|[ \t]+$|\n/g, protectWhitespace);
        }
    }
    const lute = getAVRichTextLute();
    const value = serializeAVRichTextBlockDOM(template.innerHTML, lute, true);
    if (whitespace.length === 0) {
        return value;
    }
    const markdown = value.markdown.replace(new RegExp(`${prefix}(\\d+)END`, "g"),
        (_token, index) => whitespace[Number(index)]);
    const normalizedBlockDOM = getAVRichTextBlockDOM(markdown, true);
    return {blockDOM: normalizedBlockDOM, markdown, plainText: lute.BlockDOM2Content(normalizedBlockDOM)};
};

export const updateTableCellEditingValue = (cell: Element, value: {blockDOM: string, markdown: string}) => {
    const inline = getTableCellInlineHTML(value.blockDOM);
    if (cell.hasAttribute(TABLE_CELL_RICH_ATTRIBUTE) || inline === null) {
        cell.removeAttribute(TABLE_CELL_INLINE_ATTRIBUTE);
        cell.setAttribute(TABLE_CELL_RICH_ATTRIBUTE, encodeTableCellRich(value.markdown));
        cell.closest('[data-type="NodeTable"]')?.setAttribute(TABLE_RICH_ATTRIBUTE, "1");
    } else {
        cell.setAttribute(TABLE_CELL_INLINE_ATTRIBUTE, inline);
    }
};

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
        const inline = cell.getAttribute(TABLE_CELL_INLINE_ATTRIBUTE);
        if (inline !== null) {
            cell.innerHTML = inline;
            cell.removeAttribute(TABLE_CELL_INLINE_ATTRIBUTE);
        }
        return;
    }
    cell.removeAttribute(TABLE_CELL_INLINE_ATTRIBUTE);
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
    if (!html.includes(TABLE_CELL_RICH_ATTRIBUTE) && !html.includes(TABLE_CELL_INLINE_ATTRIBUTE)) {
        return html;
    }
    const template = document.createElement("template");
    template.innerHTML = html;
    template.content.querySelectorAll(`th[${TABLE_CELL_RICH_ATTRIBUTE}], td[${TABLE_CELL_RICH_ATTRIBUTE}], ` +
        `th[${TABLE_CELL_INLINE_ATTRIBUTE}], td[${TABLE_CELL_INLINE_ATTRIBUTE}]`)
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
