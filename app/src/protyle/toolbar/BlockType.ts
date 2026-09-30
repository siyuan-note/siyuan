import {Menu} from "../../plugin/Menu";
import {ToolbarItem} from "./ToolbarItem";
import {
    captureTextBlockSelection,
    getBlockTypeKey,
    getBlockTypeOptions,
    getTextSelectionBlock,
    isSameTextRange,
    isTextBlockSelectionValid,
    TTextBlockSelection,
} from "./blockTypeCore";
import {getEmbedGutterOperationContext} from "../wysiwyg/getBlock";
import {turnsIntoOneTransaction, turnsIntoTransaction} from "../wysiwyg/transaction";
import {focusByRange} from "../util/selection";
import {closeSubElement} from "./subElementLifecycle";
import {escapeHtml} from "../../util/escape";
import {isMobile} from "../../util/functions";

const context = (protyle: IProtyle, range = protyle.toolbar.range) => ({
    editor: protyle.wysiwyg.element, range, lite: protyle.lite,
    disabled: protyle.disabled || window.siyuan.config.readonly,
});

export const getBlockTypeSelection = (protyle: IProtyle, range = protyle?.toolbar.range) => {
    if (!protyle) {
        return;
    }
    const block = getTextSelectionBlock(context(protyle, range));
    if (!block) {
        return;
    }
    if (block.closest('[data-type="NodeBlockQueryEmbed"]')) {
        const embed = getEmbedGutterOperationContext(block);
        if (!embed?.allowChildOperation || embed.targetElement === block) {
            return;
        }
    }
    return captureTextBlockSelection(context(protyle, range), protyle.block.rootID);
};

export const updateBlockTypeButton = (protyle: IProtyle, button: HTMLElement, range = protyle.toolbar.range) => {
    if (!button) {
        return;
    }
    const selection = getBlockTypeSelection(protyle, range);
    button.dataset.entryUnavailable = selection ? "false" : "true";
    const label = selection ? window.siyuan.languages[getBlockTypeKey(selection.block)] : window.siyuan.languages.turnInto;
    const labelElement = button.querySelector(".protyle-toolbar__select-label");
    if (labelElement) {
        labelElement.textContent = label;
    } else {
        button.textContent = label;
    }
    button.setAttribute("aria-label", window.siyuan.languages.turnInto);
};

export const openBlockTypeMenu = (protyle: IProtyle, button: HTMLElement, snapshot: TTextBlockSelection,
                                  options: {onClose?: () => void, isCurrent?: () => boolean} = {}) => {
    const valid = () => options.isCurrent?.() !== false && button.isConnected &&
        isTextBlockSelectionValid(snapshot, context(protyle), protyle.block.rootID) &&
        getBlockTypeSelection(protyle, snapshot.range)?.block === snapshot.block;
    if (!valid()) {
        return;
    }
    closeSubElement(protyle.toolbar);
    protyle.toolbar.subElement.classList.add("fn__none");
    let applied = false;
    let changedSelection = false;
    let restored = false;
    const selectionChanged = () => {
        const selection = window.getSelection();
        const active = document.activeElement;
        if (selection?.rangeCount && !isSameTextRange(selection.getRangeAt(0), snapshot.range) &&
            (!selection.isCollapsed || active && protyle.wysiwyg.element.contains(active))) {
            changedSelection = true;
        }
    };
    const movedOutside = (event: PointerEvent) => {
        if ((event.target as Element).closest?.("#commonMenuScrim")) {
            return;
        }
        if (!menu.element.contains(event.target as Node) && !button.contains(event.target as Node)) {
            changedSelection = true;
        }
    };
    const restoreSelection = () => {
        const active = document.activeElement;
        if (active && active !== document.body && active !== button &&
            !protyle.wysiwyg.element.contains(active) && !menu.element.contains(active)) {
            return;
        }
        selectionChanged();
        if (!restored && !applied && !changedSelection && valid()) {
            restored = true;
            if (options.onClose) {
                options.onClose();
            } else if (!isMobile()) {
                focusByRange(snapshot.range);
            }
        }
    };
    const menu = new Menu("selectionBlockType", () => {
        document.removeEventListener("selectionchange", selectionChanged);
        document.removeEventListener("pointerdown", movedOutside, true);
        restoreSelection();
    });
    if (menu.isOpen) {
        return;
    }
    document.addEventListener("selectionchange", selectionChanged);
    document.addEventListener("pointerdown", movedOutside, true);
    getBlockTypeOptions(snapshot.block).forEach(option => {
        const label = window.siyuan.languages[option.lang];
        const reason = option.disabled ? window.siyuan.languages.blockTypeParentChange : "";
        menu.addItem({
            icon: option.icon,
            checked: option.current,
            disabled: option.disabled,
            label: escapeHtml(label) + (reason ? `<span class="fn__block ft__smaller">${escapeHtml(reason)}</span>` : ""),
            bind: element => element.setAttribute("aria-label", reason ? `${label} ${reason}` : label),
            click: () => {
                selectionChanged();
                if (changedSelection || !valid()) {
                    return;
                }
                const current = getBlockTypeOptions(snapshot.block).find(item => item.key === option.key);
                if (!current || current.disabled || current.current) {
                    return;
                }
                // 菜单显式设置目标类型，不经过快捷键的同级标题切换和整块多选路径。
                applied = true;
                menu.close();
                protyle.toolbar.element.classList.add("fn__none");
                if (current.type === "Blocks2Ps" || current.type === "Blocks2Hs") {
                    turnsIntoTransaction({protyle, selectsElement: [snapshot.block], type: current.type, level: current.level});
                } else {
                    void turnsIntoOneTransaction({protyle, selectsElement: [snapshot.block], type: current.type});
                }
            },
        });
    });
    if (isMobile()) {
        window.siyuan.menus.menu.fullscreen("bottom", restoreSelection);
    } else {
        const rect = button.getBoundingClientRect();
        menu.open({x: rect.left, y: rect.bottom, h: rect.height, w: rect.width, target: button});
    }
};

export class BlockType extends ToolbarItem {
    constructor(protyle: IProtyle, item: IMenuItem) {
        super(protyle, item);
        this.element.classList.add("protyle-toolbar__select");
        this.element.dataset.entryUnavailable = "true";
        this.element.innerHTML = '<span class="protyle-toolbar__select-label"></span><svg aria-hidden="true"><use xlink:href="#iconDown"></use></svg>';
        this.element.setAttribute("aria-haspopup", "menu");
        this.element.setAttribute("data-menu", "true");
        this.element.addEventListener("mousedown", event => event.preventDefault());
        this.element.addEventListener("click", () => {
            const selection = window.getSelection();
            const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
            if (isSameTextRange(range, protyle.toolbar.range)) {
                openBlockTypeMenu(protyle, this.element, getBlockTypeSelection(protyle, range));
            }
        });
    }
}
