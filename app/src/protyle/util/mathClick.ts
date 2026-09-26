export const isDirectMathClick = (math: HTMLElement, event: MouseEvent) => {
    if (math.tagName !== "SPAN" || !math.getAttribute("data-type")?.split(" ").includes("inline-math") ||
        event.detail === 0) {
        return true;
    }
    // 触摸目标可能被浏览器吸附到附近的公式，按实际坐标排除公式两侧和段末空白。
    return Array.from(math.getClientRects()).some(rect =>
        event.clientX >= rect.left && event.clientX < rect.right &&
        event.clientY >= rect.top && event.clientY < rect.bottom);
};
