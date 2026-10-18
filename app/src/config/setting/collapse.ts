type GroupCollapseState = {
    collapsed: Set<string>;
    searching: boolean;
};

const states = new WeakMap<HTMLElement, GroupCollapseState>();

/** 搜索期间临时展开分组，保留面板内的折叠选择。 */
export const syncSettingGroupCollapse = (element: HTMLElement, searching: boolean) => {
    element.querySelectorAll<HTMLElement>("[data-config-group-id]").forEach(group => {
        const state = states.get(group.parentElement);
        const button = group.querySelector<HTMLButtonElement>(":scope > .config-title [data-action='toggle-config-group']");
        if (!state || !button) return;
        state.searching = searching;
        const hidden = !searching && state.collapsed.has(group.dataset.configGroupId);
        group.querySelector(":scope > .config-items").classList.toggle("fn__none", hidden);
        button.disabled = searching;
        button.setAttribute("aria-expanded", String(!hidden));
        button.setAttribute("aria-label", `${window.siyuan.languages[hidden ? "expand" : "collapse"]} - ${button.previousElementSibling.textContent}`);
        button.querySelector("use").setAttribute("xlink:href", hidden ? "#iconRight" : "#iconDown");
    });
};

export const initSettingGroupCollapse = (root: HTMLElement) => {
    let state = states.get(root);
    if (!state) {
        state = {collapsed: new Set(), searching: false};
        states.set(root, state);
        // 在控件自身的点击处理之前响应折叠，兼容会阻止事件冒泡的设置页。
        root.addEventListener("click", event => {
            const button = (event.target as Element).closest<HTMLButtonElement>("[data-action='toggle-config-group']");
            const group = button?.closest<HTMLElement>("[data-config-group-id]");
            if (!group || group.parentElement !== root || state.searching || button.disabled) return;
            const id = group.dataset.configGroupId;
            if (state.collapsed.has(id)) {
                state.collapsed.delete(id);
            } else {
                state.collapsed.add(id);
            }
            syncSettingGroupCollapse(root, false);
            event.stopPropagation();
        }, true);
    }
    syncSettingGroupCollapse(root, state.searching);
};
