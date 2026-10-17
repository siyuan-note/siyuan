// 按编辑器和路径识别触发器，点击下拉内容或原触发器时保留，其余下拉统一收起。
export const closeInlineFilterDropdowns = (root: HTMLElement, target: HTMLElement) => {
    const dropdownTypes = [
        ["selectDropdown", '[data-type="selectTrigger"]'],
        ["relationFilterDropdown", '[data-type="relationFilterTrigger"]'],
        ["relList", '[data-type-rel="relation"]'],
    ];
    dropdownTypes.forEach(([type, triggerSelector]) => {
        const trigger = target.closest<HTMLElement>(triggerSelector);
        root.querySelectorAll<HTMLElement>(`[data-type="${type}"]`).forEach(dropdown => {
            const sameTrigger = trigger && trigger.dataset.path === dropdown.dataset.path &&
                trigger.closest('[data-filter-events-bound="true"]') ===
                dropdown.closest('[data-filter-events-bound="true"]');
            if (!dropdown.contains(target) && !sameTrigger) {
                dropdown.style.display = "none";
            }
        });
    });
};
