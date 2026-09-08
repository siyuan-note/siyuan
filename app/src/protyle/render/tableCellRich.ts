import {highlightRender} from "./highlightRender";
import {mathRender} from "./mathRender";
import {getTableCellRichBlockDOM} from "../util/tableCellRich";
import {TABLE_CELL_RICH_ATTRIBUTE} from "../util/tableCellRichValue";

export const renderTableCellRichElements = (root: Element) => {
    const elements = [...root.querySelectorAll<HTMLElement>(".table__cell-rich")];
    if (root.classList.contains("table__cell-rich")) {
        elements.unshift(root as HTMLElement);
    }
    elements.forEach(element => {
        const cell = element.closest(`th[${TABLE_CELL_RICH_ATTRIBUTE}], td[${TABLE_CELL_RICH_ATTRIBUTE}]`);
        if (!cell) {
            return;
        }
        // 预览复用编辑结构，但不携带文档块身份或编辑能力。
        const template = document.createElement("template");
        template.innerHTML = getTableCellRichBlockDOM(cell);
        template.content.querySelectorAll<HTMLElement>("*").forEach(node => {
            if (node.hasAttribute("data-node-id")) {
                node.setAttribute("data-table-cell-node", "");
            }
            ["id", "data-node-id", "data-node-index", "updated", "spellcheck", "draggable"].forEach(attribute =>
                node.removeAttribute(attribute));
            if (node.hasAttribute("contenteditable")) {
                node.contentEditable = "false";
            }
        });
        element.replaceChildren(template.content);
        element.classList.remove("b3-typography");
        element.dataset.protyleLiteRender = "safe";
        mathRender(element);
        highlightRender(element);
    });
};
