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

// 展开标题后，对新插入子树内仍处于折叠态的子标题执行兜底删除。
// 折叠状态以标题自身的 fold 为唯一真相，内核展开父标题时不再清理子标题的 fold，
// 且以「折叠层级栈」在服务端省略折叠子标题之下的块；但若返回的 HTML 仍吐出这些块（假展开），
// 需要在前端对每个仍折叠的子标题调用 removeFoldHeading 物理删除其下内容，保证嵌套折叠 DOM 正确。
// startHeading 为刚展开的标题自身，遍历只覆盖其子树范围，不会误删该标题本身（此时它已无 fold）。
export const applyNestedHeadingFolds = (startHeading: Element) => {
    if (startHeading.getAttribute("data-type") !== "NodeHeading") {
        return;
    }
    const startH = parseInt(startHeading.getAttribute("data-subtype").substr(1));
    const foldedHeadings: Element[] = [];
    let nextElement = startHeading.nextElementSibling;
    while (nextElement) {
        const currentH = parseInt(nextElement.getAttribute("data-subtype")?.substr(1));
        if (nextElement.classList.contains("protyle-attr") || // 超级块末尾为属性
            (!isNaN(currentH) && currentH <= startH)) {
            // 遇到同级或更高级标题（或属性块），已超出当前标题子树范围
            break;
        }
        // 兄弟本身即为折叠的子标题
        if (nextElement.getAttribute("data-type") === "NodeHeading" && nextElement.getAttribute("fold") === "1") {
            foldedHeadings.push(nextElement);
        }
        // 容器块（列表项、引述、超级块等）内部嵌套的折叠子标题
        nextElement.querySelectorAll('[data-type="NodeHeading"][fold="1"]').forEach(item => {
            foldedHeadings.push(item);
        });
        nextElement = nextElement.nextElementSibling;
    }
    // 按文档顺序（外层在前）处理：外层折叠标题会一并删掉其内层折叠标题的 DOM，
    // 内层标题届时已脱离文档，removeFoldHeading 因无匹配兄弟而成为 noop
    foldedHeadings.forEach(item => {
        removeFoldHeading(item);
    });
};

// 展开标题时的公共操作：在标题后插入内核返回的子块 HTML，随即对新插入范围内仍折叠的子标题兜底。
// 抽出此三行避免在多处重复；若调用方在 insert 前还需去重（如 removeUnfoldRepeatBlock），
// 应先去重再调用本函数以保持顺序。
export const insertUnfoldHeadingDOM = (heading: Element, retData: string) => {
    heading.insertAdjacentHTML("afterend", retData);
    applyNestedHeadingFolds(heading);
};

// 文档加载/渲染完成后的兜底：对容器内所有仍折叠的标题执行 removeFoldHeading。
// 内核已用折叠层级栈省略折叠子标题之下的块时此处为 noop；若有残留则在前端修正 DOM。
// 仅遍历带 fold 的标题，数量通常极少，性能可控。
export const removeFoldedHeadings = (container: Element) => {
    container.querySelectorAll('[data-type="NodeHeading"][fold="1"]').forEach(item => {
        removeFoldHeading(item);
    });
};
