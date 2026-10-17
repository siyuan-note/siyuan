let initialized = false;

// 检测实际高亮继承行为，避免仅支持选择器语法的旧内核丢失主题选中颜色。
export const initSelectionStyle = () => {
    if (initialized) {
        return;
    }
    const probe = document.createElement("div");
    probe.style.cssText = "position: fixed; visibility: hidden; pointer-events: none;";
    let inheritsSelection = false;
    try {
        // 使用独立样式树，防止主题和用户 CSS 的全局选中规则干扰检测。
        const shadow = probe.attachShadow({mode: "closed"});
        const style = document.createElement("style");
        style.textContent = "div::selection { background-color: rgb(1, 2, 3); }";
        const parent = document.createElement("div");
        const child = document.createElement("span");
        child.textContent = "selection";
        parent.appendChild(child);
        shadow.append(style, parent);
        document.documentElement.appendChild(probe);
        inheritsSelection = getComputedStyle(child, "::selection").backgroundColor === "rgb(1, 2, 3)";
    } catch {
        // 无法检测的内核继续使用全局规则。
    } finally {
        probe.remove();
    }
    if (!inheritsSelection) {
        const style = document.createElement("style");
        style.id = "selectionCompatibilityStyle";
        style.textContent = "::selection { background-color: var(--b3-theme-primary-lighter); }";
        document.head.prepend(style);
    }
    initialized = true;
};
