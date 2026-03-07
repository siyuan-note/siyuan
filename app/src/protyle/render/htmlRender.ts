export const htmlRender = (element: Element) => {
    let htmlElements: Element[] | NodeListOf<Element> = [];
    if (element.getAttribute("data-type") === "NodeHTMLBlock" && element.getAttribute("data-render") !== "true") {
        htmlElements = [element];
    } else {
        htmlElements = element.querySelectorAll('[data-type="NodeHTMLBlock"]:not([data-render="true"])');
    }
    if (htmlElements.length === 0) {
        return;
    }
    htmlElements.forEach((e: any) => {
        e.setAttribute("data-render", "true");
        e.firstElementChild.firstElementChild.setAttribute("aria-label", window.siyuan.languages.edit);
        e.firstElementChild.lastElementChild.setAttribute("aria-label", window.siyuan.languages.more);
    });
};
