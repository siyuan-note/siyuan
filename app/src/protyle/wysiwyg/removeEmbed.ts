export const removeEmbed = (element: Element, type: "outerHTML" | "innerHTML" = "outerHTML") => {
    // 防止内容块引用嵌入的标签打断 lute 渲染
    // :zap:
    if (!element.querySelector("[data-type='block-render']")) {
        return element[type];
    }
    const cloneElement = element.cloneNode(true) as HTMLElement;
    cloneElement.querySelectorAll("span[data-render='1'][data-type='block-render']").forEach((item: HTMLElement) => {
        item.innerHTML = "";
        item.setAttribute("data-render", "2");
    });
    return cloneElement[type];
};
