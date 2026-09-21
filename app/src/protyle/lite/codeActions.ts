import {MenuItem} from "../../menus/Menu";
import {showMessage} from "../../dialog/message";
import {isMobile} from "../../util/functions";
import {highlightRender} from "../render/highlightRender";
import {writeText} from "../util/compatibility";
import {nbsp2space, removeZWJ} from "../util/normalizeText";

export const getLiteCodeMenuItems = (node: Element, update: (attribute: string, value: string) => void): IMenu[] => {
    const editor = window.siyuan.config.editor;
    return [
        {attribute: "linewrap", label: "md31", fallback: editor.codeLineWrap},
        {attribute: "ligatures", label: "md2", fallback: editor.codeLigatures},
        {attribute: "linenumber", label: "md27", fallback: editor.codeSyntaxHighlightLineNum},
    ].map(({attribute, label, fallback}) => {
        const value = node.getAttribute(attribute);
        const checked = value === "true" || (value !== "false" && fallback);
        return {
            id: label,
            label: window.siyuan.languages[label],
            checked,
            click: () => update(attribute, String(!checked)),
        };
    });
};

export const bindLiteCodeActions = (host: HTMLElement, protyle: IProtyle, options: {
    signal: AbortSignal,
    canEdit: () => boolean,
    beforeChange?: () => void,
    onChange: () => void,
}) => {
    host.addEventListener("click", event => {
        const button = event.target instanceof Element ?
            event.target.closest(".protyle-action__copy, .protyle-action__menu") : null;
        const code = button?.closest('.code-block[data-type="NodeCodeBlock"]');
        const content = code?.querySelector(".hljs");
        if (!content || !protyle.wysiwyg.element.contains(code)) {
            return;
        }
        // 轻量编辑器隔离外层点击事件，代码操作在内部处理。
        event.preventDefault();
        event.stopImmediatePropagation();
        if (button.classList.contains("protyle-action__copy")) {
            writeText(removeZWJ(nbsp2space(content.textContent.replace(/\n$/, ""))));
            showMessage(window.siyuan.languages.copied, 2000);
            return;
        }
        if (!options.canEdit()) {
            return;
        }
        const menu = window.siyuan.menus.menu;
        menu.remove();
        getLiteCodeMenuItems(code, (attribute, value) => {
            if (options.signal.aborted || !options.canEdit() || !protyle.wysiwyg.element.contains(code)) {
                return;
            }
            options.beforeChange?.();
            code.setAttribute(attribute, value);
            // 属性变化不会触发片段的正文观察器，需显式交由宿主事务保存。
            options.onChange();
            content.removeAttribute("data-render");
            highlightRender(code);
        }).forEach(item => menu.append(new MenuItem(item).element));
        if (isMobile()) {
            menu.fullscreen();
        } else {
            const rect = button.getBoundingClientRect();
            menu.popup({x: rect.left, y: rect.top, isLeft: true});
        }
    }, {capture: true, signal: options.signal});
};
