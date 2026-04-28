/** 配置项标题 */
export const genConfigItemName = (title: string): string =>
    `<div class="config-name">${title}</div>`;

/** 配置项左侧区域（标题 + 描述） */
export const genConfigItemMainHtml = (title: string, desc?: string): string =>
    `<div class="fn__flex-1">
    ${genConfigItemName(title)}
    ${desc ? `<div class="b3-label__text">${desc}</div>` : ""}
</div>`;

const genSwitchInputHtml = (id: string, checked: boolean): string =>
    `<input class="b3-switch fn__flex-center" id="${id}" type="checkbox"${checked ? " checked" : ""}/>`;

export const genSwitchRow = (id: string, title: string, desc: string | undefined, checked: boolean): string =>
    `<label class="fn__flex b3-label config-item">
    ${genConfigItemMainHtml(title, desc)}
    <span class="fn__space"></span>
    ${genSwitchInputHtml(id, checked)}
</label>`;

/** 列表项开关（`b3-list-item` 布局） */
export const genListSwitchItemHtml = (id: string, label: string, checked: boolean): string =>
    `<label class="b3-list-item">
    <div class="fn__flex-1 ft__on-surface">${label}</div>
    <span class="fn__space"></span>
    ${genSwitchInputHtml(id, checked)}
</label>`;

/** 为指定 `id` 的密码框绑定显隐图标（与 `textBlock` 中 `input-password` 分支的 DOM 结构配套） */
export const bindPasswordIconaToggle = (root: HTMLElement, inputId: string): void => {
    root.querySelector<HTMLElement>(`#${CSS.escape(inputId)} + .b3-form__icona-icon[data-action="togglePassword"]`)?.addEventListener("click", (event) => {
        const svg = event.currentTarget as SVGSVGElement;
        const icon = svg.firstElementChild as SVGUseElement;
        const field = svg.previousElementSibling as HTMLInputElement;
        if (!icon || !field) {
            return;
        }
        const isEye = icon.getAttribute("xlink:href") === "#iconEye";
        icon.setAttribute("xlink:href", isEye ? "#iconEyeoff" : "#iconEye");
        field.setAttribute("type", isEye ? "text" : "password");
    });
};
