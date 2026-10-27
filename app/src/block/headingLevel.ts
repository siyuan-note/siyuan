// 从块元素的 data-subtype 取标题级别（h1=1 … h6=6），非标题或属性缺失时返回 0。
// 大纲（桌面 / 移动）与超级块尾部展开共用同一解析，避免同一属性出现多份取值逻辑。
export const getHeadingLevel = (element: Element) => {
    return parseInt(element.getAttribute("data-subtype")?.replace("h", "") || "0");
};
