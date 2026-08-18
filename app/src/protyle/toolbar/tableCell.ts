import {setPosition} from "../../util/setPosition";
import {appearanceMenu, fontEvent, limitRecentFontStyleRows} from "./Font";
import {toolbarKeyToMenu} from "./util";
import {matchHotKey} from "../util/hotKey";
import {closeSubElement} from "./subElementLifecycle";

const TABLE_CELL_INLINE_TYPES = ["strong", "em", "u", "s", "mark", "sup", "sub", "kbd", "code"];

const applyTableCellFontStyle = (protyle: IProtyle, cellElements: HTMLTableCellElement[], type: string,
                                 color?: string) => {
    if (type === "clear") {
        protyle.toolbar.setTableCellsInlineMark(protyle, cellElements, "clear", {type: "text"});
    } else {
        protyle.toolbar.setTableCellsInlineMark(protyle, cellElements, "text", {type, color});
    }
};

export const openTableCellAppearance = (protyle: IProtyle, cellElements: HTMLTableCellElement[],
                                        onApply?: () => void) => {
    const cells = Array.from(new Set(cellElements)).filter(item => item.isConnected);
    if (cells.length === 0) {
        return;
    }
    window.siyuan.menus.menu.remove();
    protyle.toolbar.element.classList.add("fn__none");
    closeSubElement(protyle.toolbar);
    protyle.toolbar.subElement.innerHTML = "";
    protyle.toolbar.subElement.style.width = "";
    protyle.toolbar.subElement.style.padding = "";
    const fontElement = cells[0].querySelector('[data-type~="text"]') || cells[0];
    const appearanceElement = appearanceMenu(protyle, [fontElement], (type, color) => {
        applyTableCellFontStyle(protyle, cells, type, color);
        onApply?.();
    });
    protyle.toolbar.subElement.append(appearanceElement);
    protyle.toolbar.subElement.style.zIndex = (++window.siyuan.zIndex).toString();
    protyle.toolbar.subElement.classList.remove("fn__none");
    limitRecentFontStyleRows(appearanceElement);
    const rect = cells[0].getBoundingClientRect();
    const gap = 4;
    const top = rect.bottom + gap;
    const availableHeight = Math.max(0, window.innerHeight - top);
    appearanceElement.style.maxHeight = `${availableHeight}px`;
    const overflowHeight = Math.max(0, protyle.toolbar.subElement.offsetHeight - availableHeight);
    if (overflowHeight > 0) {
        appearanceElement.style.maxHeight = `${Math.max(0, appearanceElement.offsetHeight - overflowHeight)}px`;
    }
    setPosition(protyle.toolbar.subElement, rect.left, top);
    protyle.toolbar.subElement.style.top = `${top}px`;
};

export const getTableCellTextStyleMenus = (protyle: IProtyle, cellElements: HTMLTableCellElement[],
                                           onApply?: () => void): IMenu[] => {
    const menus: IMenu[] = toolbarKeyToMenu(TABLE_CELL_INLINE_TYPES).map(item => ({
        icon: item.icon,
        label: window.siyuan.languages[item.lang],
        accelerator: item.hotkey,
        checked: protyle.toolbar.hasTableCellsInlineMark(cellElements, item.name),
        click: () => {
            protyle.toolbar.setTableCellsInlineMark(protyle, cellElements, item.name);
            onApply?.();
        },
    }));
    menus.push({type: "separator"});
    menus.push({
        icon: "iconFont",
        label: window.siyuan.languages.appearance,
        accelerator: window.siyuan.config.keymap.editor.insert.appearance.custom,
        click: () => openTableCellAppearance(protyle, cellElements, onApply),
    });
    menus.push({
        icon: "iconClear",
        label: window.siyuan.languages.clearInline,
        accelerator: window.siyuan.config.keymap.editor.insert.clearInline.custom,
        click: () => {
            protyle.toolbar.setTableCellsInlineMark(protyle, cellElements, "clear");
            onApply?.();
        },
    });
    return menus;
};

export const applyTableCellStyleHotkey = (protyle: IProtyle, cellElements: HTMLTableCellElement[],
                                          event: KeyboardEvent, onApply?: () => void) => {
    if (event.repeat || cellElements.length === 0) {
        return false;
    }
    if (matchHotKey(window.siyuan.config.keymap.editor.insert.lastUsed.custom, event)) {
        fontEvent(protyle, [], undefined, undefined, false, (type, color) => {
            applyTableCellFontStyle(protyle, cellElements, type, color);
            onApply?.();
        });
        event.preventDefault();
        event.stopImmediatePropagation();
        return true;
    }
    let handled = false;
    protyle.options.toolbar.find((item: IMenuItem) => {
        if (!item.hotkey || !matchHotKey(item.hotkey, event)) {
            return false;
        }
        if (TABLE_CELL_INLINE_TYPES.includes(item.name) || item.name === "clear") {
            protyle.toolbar.setTableCellsInlineMark(protyle, cellElements, item.name);
            onApply?.();
        } else if (item.name === "text") {
            openTableCellAppearance(protyle, cellElements, onApply);
        } else {
            return false;
        }
        handled = true;
        return true;
    });
    if (handled) {
        event.preventDefault();
        event.stopImmediatePropagation();
    }
    return handled;
};
