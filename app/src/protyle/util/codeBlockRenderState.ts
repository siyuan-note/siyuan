export const resetCodeBlockRenderState = (element: Element) => {
    const codeBlockElements: Element[] = [];
    if (element.getAttribute("data-type") === "NodeCodeBlock") {
        codeBlockElements.push(element);
    }
    codeBlockElements.push(...element.querySelectorAll('[data-type="NodeCodeBlock"]'));
    codeBlockElements.forEach(codeBlockElement => {
        codeBlockElement.querySelector(".hljs")?.removeAttribute("data-render");
        if (!codeBlockElement.classList.contains("render-node")) {
            return;
        }
        codeBlockElement.querySelector(".protyle-icons")?.remove();
        const spinElement = codeBlockElement.querySelector<HTMLElement>('[spin="1"]');
        if (spinElement) {
            spinElement.innerHTML = "";
        }
        codeBlockElement.removeAttribute("data-render");
    });
};
