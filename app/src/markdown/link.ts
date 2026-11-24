import {isExternalMarkdownLink} from "./resourcePolicy";

export const markdownLinkDestination = (element: Element,
    originalAttribute: (element: Element, name: string) => string | null,
): string | undefined => {
    if (!element) return;
    // 即时渲染模式将链接地址放在标记节点中，所见即所得与预览模式使用受保护的 href。
    const destination = element.matches("span.vditor-ir__marker--link") &&
        element.parentElement?.getAttribute("data-type") === "a" ? element.textContent :
        element.tagName === "A" ? originalAttribute(element, "href") : undefined;
    if (destination) return destination;
};

export const externalMarkdownLink = (destination: string): boolean => {
    if (!isExternalMarkdownLink(destination) || destination.length > 8192) return false;
    try {
        const url = new URL(destination);
        return ["http:", "https:", "mailto:"].includes(url.protocol) && !url.username && !url.password;
    } catch { return false; }
};
