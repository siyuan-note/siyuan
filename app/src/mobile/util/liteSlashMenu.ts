export const mountLiteSlashMenu = (protyle: IProtyle, container: Element) => {
    const hint = protyle.hint;
    const parent = hint.element.parentElement;
    const next = hint.element.nextSibling;
    hint.enableExtend = true;
    hint.element.replaceChildren();
    hint.element.classList.add("fn__none");
    // 保留候选面板本身，异步技能结果和附件事件继续使用同一节点。
    container.replaceChildren(hint.element);
    const items = protyle.options.hint.extend.find(item => item.key === "/")?.hint?.("", protyle, "hint") || [];
    if (items.length > 0 || hint.element.classList.contains("fn__none")) {
        hint.genHTML(items.length > 0 ? items : [{value: "", html: window.siyuan.languages.emptyContent}],
            protyle, false, "hint");
        hint.element.querySelectorAll<HTMLElement>(".b3-list-item[data-value]").forEach((element, index) => {
            element.dataset.focus = items[index]?.focus === false ? "false" : "true";
        });
    }
    return () => {
        hint.enableExtend = false;
        hint.element.classList.add("fn__none");
        if (hint.element.parentElement === container) {
            parent.insertBefore(hint.element, next?.parentNode === parent ? next : null);
        }
    };
};
