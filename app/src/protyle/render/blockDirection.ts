const blockSelector = "[data-node-id], [data-table-cell-node]";
const rtlClass = "protyle-block--rtl";

/** 从原始内联方向派生布局标记，不修改文档属性或读取计算样式。 */
export const syncBlockDirection = (element: Element) => {
    const rtl = element.matches(blockSelector) && (element as HTMLElement).style.direction === "rtl";
    if (element.classList.contains(rtlClass) !== rtl) {
        element.classList.toggle(rtlClass, rtl);
    }
};

/** 在布局测量前同步新渲染的块，也清理克隆内容中失效的标记。 */
export const renderBlockDirection = (root: Element) => {
    syncBlockDirection(root);
    root.querySelectorAll(`[data-node-id][style], [data-table-cell-node][style], .${rtlClass}`)
        .forEach(syncBlockDirection);
};

export const clearBlockDirection = (root: Element) => {
    if (root.classList.contains(rtlClass)) {
        root.classList.remove(rtlClass);
    }
    root.querySelectorAll(`.${rtlClass}`).forEach(element => element.classList.remove(rtlClass));
};
