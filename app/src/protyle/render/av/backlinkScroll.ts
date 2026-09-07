// 定位仅滚动当前数据库副本，不查找反链面板或正文的滚动容器。
export const getBacklinkScrollElement = (element: HTMLElement): HTMLElement | undefined => {
    return element.closest<HTMLElement>(".av--backlink") || undefined;
};

export const scrollBacklinkTarget = (database: HTMLElement, target: HTMLElement) => {
    const scroller = getBacklinkScrollElement(database);
    if (!scroller || !scroller.contains(target)) {
        return false;
    }
    const rect = scroller.getBoundingClientRect();
    scroller.scrollTop += target.getBoundingClientRect().top - rect.top - scroller.clientHeight / 2;
    return true;
};

// 单行或限高字段会裁剪引用，仅移动单元格内部视口。
export const revealBacklinkReference = (reference: HTMLElement, cell: HTMLElement) => {
    let parent = reference.parentElement;
    while (parent && cell.contains(parent)) {
        const rect = parent.getBoundingClientRect();
        const target = reference.getBoundingClientRect();
        if (parent.scrollWidth > parent.clientWidth && (target.left < rect.left || target.right > rect.right)) {
            parent.scrollLeft += target.left - rect.left;
        }
        if (parent.scrollHeight > parent.clientHeight && (target.top < rect.top || target.bottom > rect.bottom)) {
            parent.scrollTop += target.top - rect.top;
        }
        if (parent === cell) {
            break;
        }
        parent = parent.parentElement;
    }
};
