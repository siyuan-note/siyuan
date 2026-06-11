export const img3115 = (imgElement: HTMLElement) => {
    // 移除 3.1.15 以前 .img width 样式
    if (imgElement.style.minWidth) {
        // 居中需要 minWidth 样式，不能移除 style 属性
        imgElement.style.width = "";
    } else {
        imgElement.removeAttribute("style");
    }
};
