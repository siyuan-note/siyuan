import {Dialog} from "../../dialog";
import {App} from "../../index";
import {upDownHint} from "../../util/upDownHint";
/// #if !MOBILE
import {openSetting} from "../../config";
/// #endif
import {updateHotkeyTip} from "../../protyle/util/compatibility";
import {isMobile} from "../../util/functions";
import {Constants} from "../../constants";

export const commandPanel = (app: App) => {
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
        <kbd>Enter/Click</kbd> ${window.siyuan.languages.confirm}
        <kbd>Esc</kbd> ${window.siyuan.languages.close}
    </div>
</div>`
    });
    dialog.element.setAttribute("data-key", Constants.DIALOG_COMMANDPANEL);
    const listElement = dialog.element.querySelector("#commands");
    /// #if !MOBILE
    let html = ""
    Object.keys(window.siyuan.config.keymap.general).forEach((key) => {
        html += `<li class="b3-list-item" data-command="${key}">
    <span class="b3-list-item__text">${window.siyuan.languages[key]}</span>
    <span class="b3-list-item__meta${isMobile() ? " fn__none" : ""}">${updateHotkeyTip(window.siyuan.config.keymap.general[key].custom)}</span>
</li>`;
    });
    listElement.insertAdjacentHTML("beforeend", html);
    /// #endif
    app.plugins.forEach(plugin => {
        plugin.commands.forEach(command => {
            const liElement = document.createElement("li");
            liElement.classList.add("b3-list-item");
            liElement.innerHTML = `<span class="b3-list-item__text">${plugin.displayName}: ${command.langText || plugin.i18n[command.langKey]}</span>
<span class="b3-list-item__meta${isMobile() ? " fn__none" : ""}">${updateHotkeyTip(command.customHotkey)}</span>`;
            liElement.addEventListener("click", () => {
                if (command.callback) {
                    command.callback();
                } else if (command.globalCallback) {
                    command.globalCallback();
                }
                dialog.destroy();
            });
            listElement.insertAdjacentElement("beforeend", liElement);
        });
    });

    if (listElement.childElementCount === 0) {
        const liElement = document.createElement("li");
        liElement.classList.add("b3-list-item", "b3-list-item--focus");
        liElement.innerHTML = `<span class="b3-list-item__text" style="-webkit-line-clamp: inherit;">${window.siyuan.languages._kernel[122]}</span>`;
        liElement.addEventListener("click", () => {
            dialog.destroy();
        });
        listElement.insertAdjacentElement("beforeend", liElement);
    } else {
        listElement.firstElementChild.classList.add("b3-list-item--focus");
    }

    const inputElement = dialog.element.querySelector(".b3-text-field") as HTMLInputElement;
    inputElement.focus();
    inputElement.addEventListener("keydown", (event: KeyboardEvent) => {
        event.stopPropagation();
        if (event.isComposing) {
            return;
        }
        upDownHint(listElement, event);
        if (event.key === "Enter") {
            const currentElement = listElement.querySelector(".b3-list-item--focus");
            if (currentElement) {
                const command = currentElement.getAttribute("data-command");
                if (command) {
                    execByCommand(command, app);
                } else {
                    currentElement.dispatchEvent(new CustomEvent("click"));
                }
            }
            dialog.destroy();
        } else if (event.key === "Escape") {
            dialog.destroy();
        }
    });
    inputElement.addEventListener("compositionend", () => {
        filterList(inputElement, listElement);
    });
    inputElement.addEventListener("input", (event: InputEvent) => {
        if (event.isComposing) {
            return;
        }
        event.stopPropagation();
        filterList(inputElement, listElement);
    });
};

const filterList = (inputElement: HTMLInputElement, listElement: Element) => {
    const inputValue = inputElement.value.toLowerCase();
    listElement.querySelector(".b3-list-item--focus")?.classList.remove("b3-list-item--focus");
    let hasFocus = false;
    Array.from(listElement.children).forEach((element: HTMLElement) => {
        const elementValue = element.querySelector(".b3-list-item__text").textContent.toLowerCase();
        if (inputValue.indexOf(elementValue) > -1 || elementValue.indexOf(inputValue) > -1) {
            if (!hasFocus) {
                element.classList.add("b3-list-item--focus");
            }
            hasFocus = true;
            element.classList.remove("fn__none");
        } else {
            element.classList.add("fn__none");
        }
    });
};

const execByCommand = (command: string, app: App) => {
    switch (command) {
        case "openSetting":
            break;
    }
};
