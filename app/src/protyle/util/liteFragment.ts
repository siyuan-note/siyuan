// 片段编辑器宿主的类名，供轻量工具与片段编辑器共用，避免工具模块依赖编辑器实现
export const PROTYLE_LITE_FRAGMENT_CLASS = "protyle-lite-fragment";

/**
 * 片段编辑器（表格单元格、数据库单元格等）内的块由前端生成临时块 ID，不对应任何文档块。
 * 返回最外层的片段宿主元素，便于继续向上解析所属文档块。
 */
export const getLiteFragmentHost = (element: HTMLElement) => {
    let hostElement: HTMLElement;
    let currentElement: HTMLElement = element;
    while (currentElement) {
        if (currentElement.classList.contains(PROTYLE_LITE_FRAGMENT_CLASS)) {
            hostElement = currentElement;
        }
        currentElement = currentElement.parentElement;
    }
    return hostElement;
};
