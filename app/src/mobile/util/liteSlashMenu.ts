import type {TSlashMenuItem} from "../../protyle/hint/slashMenu";

export const getFrequentSlashButtons = (container: HTMLElement, entryKeys: string[]) => {
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button[data-slash-entry-key]"));
    return entryKeys.map(entryKey => {
        const matches = buttons.filter(button => button.dataset.slashEntryKey === entryKey);
        // 安卓图片和拍照入口共用附件命令，常用区保留完整文件选择入口。
        return matches.find(button => !button.querySelector('input[capture], input[accept*="x-siyuan-image-picker"]')) || matches[0];
    }).filter((button, index, items) => button && items.indexOf(button) === index);
};

export const prependFrequentSlashButtons = (container: HTMLElement, buttons: HTMLButtonElement[]) => {
    if (buttons.length === 0) {
        return;
    }
    const group = document.createElement("div");
    group.className = "keyboard__slash-block";
    buttons.forEach(button => group.appendChild(button.cloneNode(true)));
    const separator = document.createElement("div");
    separator.className = "b3-menu__separator";
    separator.setAttribute("role", "separator");
    container.prepend(group, separator);
};

export const getLiteSlashMenuHTML = (items: IHintData[]) => {
    const menu = document.createElement("div");
    const hasFrequentItems = items.some(item => (item as TSlashMenuItem).entryKey === "__frequent_separator__");
    let group: HTMLElement;
    items.forEach(item => {
        const entryKey = (item as TSlashMenuItem).entryKey;
        if (item.html === "separator") {
            if (entryKey === "__frequent_separator__") {
                const separator = document.createElement("div");
                separator.className = "b3-menu__separator";
                separator.setAttribute("role", "separator");
                menu.appendChild(separator);
            }
            group = undefined;
            return;
        }
        if (!group) {
            if (menu.childElementCount > 0 || !hasFrequentItems) {
                const space = document.createElement("div");
                space.className = "keyboard__slash-title";
                menu.appendChild(space);
            }
            group = document.createElement("div");
            group.className = "keyboard__slash-block";
            menu.appendChild(group);
        }
        const button = document.createElement("button");
        button.className = "keyboard__slash-item";
        button.dataset.id = item.id || "";
        button.dataset.value = encodeURIComponent(item.value);
        button.dataset.focus = item.focus === false ? "false" : "true";
        if (typeof entryKey === "string" && entryKey) {
            button.dataset.slashEntryKey = entryKey;
        }
        const content = document.createElement("div");
        content.innerHTML = item.html;
        if (content.querySelector('[data-type="agent-skill"]')) {
            button.classList.add("keyboard__slash-item--full");
        }
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
