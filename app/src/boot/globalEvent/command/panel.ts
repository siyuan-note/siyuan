import {Dialog} from "../../../dialog";
import type {App} from "../../../index";
import {upDownHint} from "../../../util/upDownHint";
import {updateHotkeyTip} from "../../../protyle/util/compatibility";
import {isMobile} from "../../../util/functions";
import {Constants} from "../../../constants";
import {hasClosestByClassName} from "../../../protyle/util/hasClosest";
import {focusByRange} from "../../../protyle/util/selection";
import {matchHotKey} from "../../../protyle/util/hotKey";
import {captureCommandContext} from "../../../command/context";
import {ensureCommandSystem, executeCommandById} from "../../../command/executor";
import {initializeEnglishCommandTranslations} from "../../../command/english";
import {createPaletteFocusLifecycle, queryCommandPalette} from "../../../command/paletteCore";
import type {ICommandContextSnapshot, ICommandDefinition} from "../../../command/types";

const renderCommands = (listElement: HTMLElement, commands: ICommandDefinition[]) => {
    const fragment = document.createDocumentFragment();
    commands.forEach(command => {
        const itemElement = document.createElement("li");
        itemElement.className = "b3-list-item";
        itemElement.dataset.commandId = command.id;
        const textElement = document.createElement("span");
        textElement.className = "b3-list-item__text";
        textElement.textContent = command.label();
        const hotkeyElement = document.createElement("span");
        hotkeyElement.className = `b3-list-item__meta${isMobile() ? " fn__none" : ""}`;
        hotkeyElement.textContent = updateHotkeyTip(command.hotkey?.() || "");
        itemElement.append(textElement, hotkeyElement);
        fragment.append(itemElement);
    });
    listElement.replaceChildren(fragment);
    listElement.firstElementChild?.classList.add("b3-list-item--focus");
};

const executePaletteCommand = (app: App, commandId: string, context: ICommandContextSnapshot) => {
    void executeCommandById(app, commandId, context).catch(error => {
        console.error(`Unable to execute command "${commandId}":`, error);
    });
};

export const commandPanel = (app: App) => {
    const openCommandPanelDialog = window.siyuan.dialogs.find(item =>
        item.element.getAttribute("data-key") === Constants.DIALOG_COMMANDPANEL);
    if (openCommandPanelDialog) {
        openCommandPanelDialog.destroy();
        return;
    }
    const context = captureCommandContext({app, source: "commandPanel"});
    const registry = ensureCommandSystem(app);
    const focusLifecycle = createPaletteFocusLifecycle(() => {
        if (context.range?.startContainer.isConnected) {
            focusByRange(context.range);
        }
    });
    const dialog = new Dialog({
        width: isMobile() ? "92vw" : "80vw",
        height: isMobile() ? "80vh" : "70vh",
        title: window.siyuan.languages.commandPanel,
        content: `<div class="fn__flex-column">
    <div class="b3-form__icon search__header" style="border-top: 0;border-bottom: 1px solid var(--b3-theme-surface-lighter);">
        <svg class="b3-form__icon-icon"><use xlink:href="#iconSearch"></use></svg>
        <input class="b3-text-field b3-text-field--text" style="padding-left: 32px !important;">
    </div>
    <ul class="b3-list b3-list--background search__list" id="commands"></ul>
    <div class="search__tip">
        <kbd>↑/↓</kbd> ${window.siyuan.languages.searchTip1}
        <kbd>${window.siyuan.languages.enterKey}/${window.siyuan.languages.click}</kbd> ${window.siyuan.languages.confirm}
        <kbd>Esc</kbd> ${window.siyuan.languages.close}
    </div>
</div>`,
        disableAnimation: true,
        destroyCallback() {
            focusLifecycle.restoreAfterCancel();
        },
    });
    dialog.element.setAttribute("data-key", Constants.DIALOG_COMMANDPANEL);
    const listElement = dialog.element.querySelector("#commands") as HTMLElement;
    const inputElement = dialog.element.querySelector(".b3-text-field") as HTMLInputElement;
    const refresh = () => {
        renderCommands(listElement, queryCommandPalette(registry, context, inputElement.value));
    };
    refresh();
    inputElement.focus();

    const run = (commandId: string, event?: Event) => {
        focusLifecycle.prepareCommand(() => event?.preventDefault());
        executePaletteCommand(app, commandId, context);
        dialog.destroy();
    };

    listElement.addEventListener("click", (event: MouseEvent) => {
        const itemElement = hasClosestByClassName(event.target as HTMLElement, "b3-list-item");
        const commandId = itemElement && itemElement.dataset.commandId;
        if (commandId) {
            run(commandId, event);
            event.stopPropagation();
        }
    });
    inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
        event.stopPropagation();
        if (event.isComposing) {
            return;
        }
        if (!event.repeat && matchHotKey(window.siyuan.config.keymap.general.commandPanel.custom, event)) {
            dialog.destroy();
            event.preventDefault();
            return;
        }
        upDownHint(listElement, event);
        if (event.key === "Enter") {
            const commandId = listElement.querySelector<HTMLElement>(".b3-list-item--focus")?.dataset.commandId;
            if (commandId) {
                run(commandId, event);
            } else {
                event.preventDefault();
                dialog.destroy();
            }
        } else if (event.key === "Escape") {
            dialog.destroy();
        }
    });
    inputElement.addEventListener("compositionend", refresh);
    inputElement.addEventListener("input", (event: InputEvent) => {
        if (!event.isComposing) {
            event.stopPropagation();
            refresh();
        }
    });
    void initializeEnglishCommandTranslations(
        window.siyuan.config.appearance.lang,
        window.siyuan.languages as Record<string, string>,
        Constants.SIYUAN_VERSION,
    ).then(() => {
        if (dialog.element.isConnected) {
            refresh();
        }
    });
};
