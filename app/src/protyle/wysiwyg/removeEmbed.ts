import {hasClosestByClassName} from "../util/hasClosest";

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

export const getEnableHTML = (html: string) => {
    const tempElement = document.createElement("template");
    tempElement.innerHTML = html;
    tempElement.content.querySelectorAll('[contenteditable="false"][spellcheck]').forEach(item => {
        if (!hasClosestByClassName(item, "protyle-wysiwyg__embed")) {
            item.setAttribute("contenteditable", "true");
        }
    });
    return tempElement.innerHTML;
};
