import {updateHotkeyTip} from "../../protyle/util/compatibility";
import {escapeAttr, escapeHtml} from "../../util/escape";
import {getDefaultKeymapBindings, getKeymapBindings, IShortcutKeymap} from "../../util/keymapBindings";

const attr = (text: string) => escapeAttr(escapeHtml(text));

export const keymapActionHtml = (type: string, icon: string, label: string, extra = "") =>
    `<button type="button" data-type="${type}" class="config-keymap__action b3-list-item__action b3-tooltips b3-tooltips__w" aria-label="${attr(label)}" ${extra}><svg><use xlink:href="#${icon}"></use></svg></button>`;

export const keymapBindingsHtml = (keys: string[], defaults: string[]) => {
    const languages = window.siyuan.languages;
    const changed = JSON.stringify(keys) !== JSON.stringify(defaults);
    return `<div class="config-keymap__bindings">${keys.map((key, index) =>
        `<span class="config-keymap__key config-keymap__chip" data-index="${index}">
            <span class="config-keymap__text">${escapeHtml(updateHotkeyTip(key))}</span>
            <button type="button" data-type="remove" class="b3-chip__close config-keymap__remove ariaLabel" aria-label="${attr(languages.remove)}"><svg><use xlink:href="#iconClose"></use></svg></button>
        </span>`).join("")}</div>
        ${keymapActionHtml("reset", "iconUndo", languages.reset, changed ? "" : 'style="display:none" tabindex="-1"')}
        ${keymapActionHtml("add", "iconAdd", languages.keymapAdd)}`;
};

export const genKeymapRowHtml = (label: string, dataKey: string, item: IShortcutKeymap) => {
    const keys = getKeymapBindings(item);
    return `<div class="b3-list-item b3-list-item--narrow b3-list-item--hide-action config-keymap__row" data-key="${attr(dataKey)}" data-keys="${attr(JSON.stringify(keys))}" data-defaults="${attr(JSON.stringify(getDefaultKeymapBindings(item)))}">
        <span class="b3-list-item__text">${escapeHtml(label)}</span>
        <div class="config-keymap__controls">${keymapBindingsHtml(keys, getDefaultKeymapBindings(item))}</div>
    </div>`;
};

export const getRowBindings = (row: HTMLElement): string[] => JSON.parse(row.dataset.keys);

export const renderRowBindings = (row: HTMLElement, keys: string[]) => {
    row.dataset.keys = JSON.stringify(keys);
    row.querySelector(".config-keymap__controls").innerHTML = keymapBindingsHtml(keys, JSON.parse(row.dataset.defaults));
};
