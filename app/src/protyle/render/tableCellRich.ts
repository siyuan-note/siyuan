import {highlightRender} from "./highlightRender";
import {mathRender} from "./mathRender";

export const renderTableCellRichElements = (root: Element) => {
    const elements = [...root.querySelectorAll<HTMLElement>(".table__cell-rich")];
    if (root.classList.contains("table__cell-rich")) {
        elements.unshift(root as HTMLElement);
    }
    elements.forEach(element => {
        element.classList.add("b3-typography");
        element.dataset.protyleLiteRender = "safe";
        element.querySelectorAll<HTMLElement>("div.language-math").forEach(math => {
            math.dataset.content = math.textContent || "";
            math.className = "render-node";
            math.dataset.subtype = "math";
            math.textContent = "";
        });
        element.querySelectorAll<HTMLElement>("pre > code").forEach(code => {
            code.parentElement.classList.add("code-block");
            code.parentElement.dataset.language = Array.from(code.classList)
                .find(name => name.startsWith("language-"))?.slice(9) || "plaintext";
        });
        element.querySelectorAll<HTMLInputElement>('input[type="checkbox"]').forEach(input => input.disabled = true);
        mathRender(element);
        highlightRender(element);
    });
};
