// 折叠标题：物理删除其管辖范围内的兄弟块 DOM（到同级 / 更高级标题为止）。
// 本地 foldHeading（setFold 乐观更新、远端 retData 未到等）依赖此函数；展开插入则直接使用内核已省略嵌套折叠的 HTML。
export const removeFoldHeading = (nodeElement: Element) => {
    const nodeH = parseInt(nodeElement.getAttribute("data-subtype").substr(1));
    let nextElement = nodeElement.nextElementSibling;
    while (nextElement) {
        const currentH = parseInt(nextElement.getAttribute("data-subtype")?.substr(1));
        if (!nextElement.classList.contains("protyle-attr") && // 超级块末尾为属性
            (isNaN(currentH) || currentH > nodeH)) {
            const tempElement = nextElement;
            nextElement = nextElement.nextElementSibling;
            tempElement.remove();
        } else {
            break;
        }
    }
};

// 展开标题时在标题后插入内核返回的子块 HTML。
// 嵌套折叠省略由内核 VisibleHeadingChildren + CollectRenderFoldHidden 完成；若调用方需去重，应先 removeUnfoldRepeatBlock 再调用。
export const insertUnfoldHeadingDOM = (heading: Element, retData: string) => {
    heading.insertAdjacentHTML("afterend", retData);
};
