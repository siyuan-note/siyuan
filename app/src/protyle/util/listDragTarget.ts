export const createListDragTarget = () => {
    let dragCache: {node: HTMLElement, indent: number, rgb: {r: number, g: number, b: number}, guides: string};
    return (htmlTarget: HTMLElement, event: Pick<DragEvent, "clientX" | "clientY">) => {
        const node = htmlTarget;
        if (!dragCache || dragCache.node !== node) {
            const contentBlock = Array.from(htmlTarget.children).find(c => (c.hasAttribute("data-node-id") || c.hasAttribute("data-table-cell-node"))) as HTMLElement;
            const indent = contentBlock ? parseFloat(getComputedStyle(contentBlock).marginLeft) || 34 : 34;
            const depth = getListDepth(htmlTarget);
            const computedColor = getComputedStyle(htmlTarget).getPropertyValue("--b3-theme-primary-lighter").trim();
            const rgb = parseHexColor(computedColor) || {r: 53, g: 115, b: 217};
            let siblingGuides = "";
            for (let n = 1; n <= depth; n++) {
                if (siblingGuides) siblingGuides += ", ";
                // guide 竖线透明度从 0.5（最近）渐变到 0.1（最远），均低于插入线（0.6）以突出目标位置
                const opacity = depth <= 1 ? 0.3 : 0.5 - (n - 1) / (depth - 1) * 0.4;
                siblingGuides += `${-n * indent}px 0 0 0 rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${opacity.toFixed(2)})`;
            }
            dragCache = {node, indent, rgb, guides: siblingGuides || "none"};
        }
        const {indent, rgb, guides} = dragCache;

        const liRect = htmlTarget.getBoundingClientRect();
        const isRTL = getComputedStyle(htmlTarget).direction === "rtl";
        const offsetX = isRTL ? (liRect.right - event.clientX) : (event.clientX - liRect.left);
        // 用内容块（不含子列表）的 rect 判断上下半，避免有子列表时下半区域过小难以命中
        const contentBlockForRect = Array.from(htmlTarget.children).find(c =>
            (c.hasAttribute("data-node-id") || c.hasAttribute("data-table-cell-node")) && !c.classList.contains("list")) as HTMLElement;
        const contentRect = contentBlockForRect ? contentBlockForRect.getBoundingClientRect() : liRect;
        const isBottom = event.clientY > contentRect.top + contentRect.height / 2;
        // 列表首项的上半保留顶部插入点；其余列表项整个区域统一使用底部插入点，避免下半区域过小难以命中
        const isFirstLi = !htmlTarget.previousElementSibling || !htmlTarget.previousElementSibling.classList.contains("li");
        let position = "bottom";
        if (isFirstLi && !isBottom) {
            position = "top";
        }
        // 有子列表时鼠标无法到达子列表区域（elementFromPoint 会命中子项的 .li），
        // 因此有子列表的列表项内容区域全部作为 sibling（在目标后插入同级），无子列表时用 offsetX 判断 child/sibling
        const hasChildList = !!Array.from(htmlTarget.children).find(c => c.classList.contains("list"));
        const isChild = position === "bottom" && !hasChildList && offsetX >= indent;
        const className = `dragover__${position}--${isChild ? "child" : "sibling"}`;
        return {position, isChild, className, apply: () => {
            htmlTarget.classList.add(className);
            htmlTarget.style.setProperty("--drag-indent", `${indent}px`);
            htmlTarget.style.setProperty("--drag-line-left", isChild ? `${indent}px` : "0");
            // guide 竖线在 sibling 和 child 时都显示（sibling 时 ::before 为 transparent 不会与 guide 线重叠）
            htmlTarget.style.setProperty("--drag-guides", guides);
            // ::before 目标标记仅在成为子项时显示，sibling 时由横线独占该区域避免半透明叠加变深
            htmlTarget.style.setProperty("--drag-base-bg",
                isChild ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.6)` : "transparent");
            // 横向插入线使用独立颜色，始终显示
            htmlTarget.style.setProperty("--drag-line-bg",
                `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.6)`);
        }};
    };
};

const getListDepth = (liElement: Element): number => {
    let depth = 0;
    let list = liElement.parentElement;
    while (list && list.classList.contains("list")) {
        const parentLi = list.parentElement;
        if (parentLi && parentLi.classList.contains("li")) {
            depth++;
            list = parentLi.parentElement;
        } else {
            break;
        }
    }
    return depth;
};

const parseHexColor = (color: string): { r: number, g: number, b: number } | null => {
    if (!color) return null;
    const hexMatch = color.match(/^#([0-9a-f]{3,8})$/i);
    if (hexMatch) {
        let hex = hexMatch[1];
        if (hex.length === 3) {
            hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
        }
        if (hex.length >= 6) {
            return {
                r: parseInt(hex.slice(0, 2), 16),
                g: parseInt(hex.slice(2, 4), 16),
                b: parseInt(hex.slice(4, 6), 16),
            };
        }
    }
    const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (rgbMatch) {
        return {
            r: parseInt(rgbMatch[1]),
            g: parseInt(rgbMatch[2]),
            b: parseInt(rgbMatch[3]),
        };
    }
    return null;
};
