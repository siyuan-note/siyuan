export const htmlRender = (element: Element) => {
    let htmlElements: Element[] = [];
    if (element.getAttribute("data-type") === "NodeHTMLBlock") {
        // 编辑器内代码块编辑渲染
        htmlElements = [element];
    } else {
        htmlElements = Array.from(element.querySelectorAll('[data-type="NodeHTMLBlock"]'));
    }
    if (htmlElements.length === 0) {
        return;
    }
    if (htmlElements.length > 0) {
        htmlElements.forEach((e: HTMLDivElement) => {
           e.firstElementChild.firstElementChild.setAttribute("aria-label", window.siyuan.languages.edit);
           e.firstElementChild.lastElementChild.setAttribute("aria-label", window.siyuan.languages.more);
        });
    }
};
