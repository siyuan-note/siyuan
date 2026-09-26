// 仅展开选区副本中的查询结果，保留原始嵌入块供思源内部粘贴。
export const expandQueryEmbedsForClipboard = (blockDOM: string): string => {
    if (!blockDOM.includes("NodeBlockQueryEmbed") && !blockDOM.includes("protyle-wysiwyg__embed")) {
        return blockDOM;
    }
    const template = document.createElement("template");
    template.innerHTML = blockDOM;
    const elements = template.content.querySelectorAll('[data-type="NodeBlockQueryEmbed"], .protyle-wysiwyg__embed');
    if (elements.length === 0) {
        return blockDOM;
    }
    // 从内向外展开，避免嵌套结果重复输出，并排除面包屑、操作按钮和错误提示。
    Array.from(elements).reverse().forEach(element => {
        const isResult = element.classList.contains("protyle-wysiwyg__embed");
        const blocks = isResult && !element.hasAttribute("data-id") ? [] :
            Array.from(element.children).filter(child => child.hasAttribute("data-node-id"));
        element.replaceWith(...blocks);
    });
    return template.innerHTML;
};
