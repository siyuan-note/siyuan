interface IPreviewRect {
    top: number;
    bottom: number;
    left: number;
    right: number;
}

// 按实际尺寸避让目标日期列中的内容，换行条目和更多按钮也参与占位。
export const getCalendarPreviewTop = (top: number, height: number, left: number, right: number,
                                      obstacles: IPreviewRect[], gap: number) => {
    const occupied = obstacles.filter(rect => rect.left < right && rect.right > left)
        .sort((a, b) => a.top - b.top);
    for (const rect of occupied) {
        if (top + height + gap <= rect.top) {
            break;
        }
        if (top < rect.bottom + gap) {
            top = rect.bottom + gap;
        }
    }
    return top;
};

export const createCalendarPreviewLayout = () => {
    const heights = new Map<HTMLElement, {value: string; priority: string}>();
    return {
        place: (week: HTMLElement, layer: HTMLElement, card: HTMLElement) => {
            const layerRect = layer.getBoundingClientRect();
            const cardRect = card.getBoundingClientRect();
            const header = week.querySelector<HTMLElement>(".av__calendar-days").getBoundingClientRect();
            const grid = week.querySelector<HTMLElement>(".av__calendar-events");
            const gap = parseFloat(getComputedStyle(grid).rowGap) || 0;
            const obstacles = Array.from(week.querySelectorAll<HTMLElement>("[data-calendar-item], [data-calendar-expand]"))
                .map(element => element.getBoundingClientRect());
            const top = getCalendarPreviewTop(header.bottom, cardRect.height, cardRect.left, cardRect.right, obstacles, gap);
            card.style.top = `${top - layerRect.top}px`;
            const rect = week.getBoundingClientRect();
            const style = getComputedStyle(week);
            const bottomPadding = parseFloat(style.paddingBottom) || 0;
            const borders = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0);
            const required = top + cardRect.height + bottomPadding + (parseFloat(style.borderBottomWidth) || 0) - rect.top;
            if (required > rect.height) {
                if (!heights.has(week)) {
                    heights.set(week, {value: week.style.getPropertyValue("min-height"),
                        priority: week.style.getPropertyPriority("min-height")});
                }
                const extra = style.boxSizing === "border-box" ? 0 :
                    borders + bottomPadding + (parseFloat(style.paddingTop) || 0);
                // 一轮拖动内只增加占位，避免切换目标日期时周高度反复变化。
                week.style.minHeight = `${required - extra}px`;
            }
        },
        destroy: () => {
            heights.forEach(({value, priority}, week) => {
                if (value) {
                    week.style.setProperty("min-height", value, priority);
                } else {
                    week.style.removeProperty("min-height");
                }
            });
            heights.clear();
        },
    };
};
