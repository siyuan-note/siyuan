import {setPosition} from "../../../util/setPosition";

const menuAnchors = new WeakMap<HTMLElement, DOMRect>();

export const setFilterSelectPosition = (dropdown: HTMLElement, trigger: HTMLElement) => {
    const rect = trigger.getBoundingClientRect();
    const availableWidth = Math.max(0, window.innerWidth - 16);
    const minWidth = Math.min(Math.max(rect.width, 280), availableWidth);
    dropdown.style.boxSizing = "border-box";
    dropdown.style.minWidth = minWidth + "px";
    dropdown.style.width = minWidth + "px";
    dropdown.style.visibility = "hidden";
    dropdown.style.display = "block";
    // 按完整选项文本扩宽，并为复选框、标签内边距和滚动条预留空间。
    let contentWidth = minWidth;
    dropdown.querySelectorAll<HTMLElement>(".av__select-option .fn__ellipsis").forEach((label) => {
        contentWidth = Math.max(contentWidth, label.scrollWidth + 64);
    });
    const width = Math.min(Math.max(minWidth, Math.min(contentWidth, 560)), availableWidth);
    dropdown.style.width = width + "px";
    dropdown.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) + "px";
    const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - 12);
    const spaceAbove = Math.max(0, rect.top - 12);
    dropdown.style.maxHeight = Math.min(480, Math.max(spaceBelow, spaceAbove)) + "px";
    const openAbove = dropdown.offsetHeight > spaceBelow && spaceAbove > spaceBelow;
    dropdown.style.maxHeight = Math.min(480, openAbove ? spaceAbove : spaceBelow) + "px";
    dropdown.style.top = (openAbove ? rect.top - dropdown.offsetHeight - 4 : rect.bottom + 4) + "px";
    dropdown.style.visibility = "";
};

export const setSelectMenuPosition = (menuElement: HTMLElement, cellElement: HTMLElement) => {
    if (cellElement.isConnected) {
        menuAnchors.set(menuElement, cellElement.getBoundingClientRect());
    }
    // 属性刷新会替换字段元素，继续使用最近的有效锚点，避免菜单跳到窗口左上角。
    const rect = menuAnchors.get(menuElement);
    if (rect) {
        setPosition(menuElement, rect.left, rect.bottom, rect.height, 0, true);
    }
};
