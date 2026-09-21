export const getLiteSlashMenuHTML = (items: IHintData[]) => {
    const menu = document.createElement("div");
    let group: HTMLElement;
    items.forEach(item => {
        if (item.html === "separator") {
            group = undefined;
            return;
        }
        if (!group) {
            const space = document.createElement("div");
            space.className = "keyboard__slash-title";
            group = document.createElement("div");
            group.className = "keyboard__slash-block";
            menu.append(space, group);
        }
        const button = document.createElement("button");
        button.className = "keyboard__slash-item";
        button.dataset.id = item.id || "";
        button.dataset.value = encodeURIComponent(item.value);
        button.dataset.focus = item.focus === false ? "false" : "true";
        const content = document.createElement("div");
        content.innerHTML = item.html;
        const uploads = Array.from(content.querySelectorAll('input[type="file"]'));
        uploads.forEach(input => input.remove());
        const label = content.querySelector(".b3-list-item__text");
        const icon = content.querySelector(".b3-list-item__graphic, .color__square");
        if (icon) {
            icon.setAttribute("class", "keyboard__slash-icon");
            button.appendChild(icon);
        }
        const text = document.createElement("span");
        text.className = "keyboard__slash-text";
        text.innerHTML = label ? label.innerHTML : content.innerHTML;
        const description = content.querySelector(".b3-list-item__showall");
        if (label && description) {
            const detail = document.createElement("span");
            detail.className = "keyboard__slash-description";
            detail.textContent = description.textContent;
            text.appendChild(detail);
        }
        button.appendChild(text);
        // 附件控件保留在按钮内，继续由候选面板绑定上传事件。
        button.append(...uploads);
        group.appendChild(button);
    });
    return menu.innerHTML;
};

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
    }
    return () => {
        hint.enableExtend = false;
        hint.element.classList.add("fn__none");
        if (hint.element.parentElement === container) {
            parent.insertBefore(hint.element, next?.parentNode === parent ? next : null);
        }
    };
};
