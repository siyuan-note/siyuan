import {Dialog} from "../dialog";
import {App} from "../index";
import {upDownHint} from "../util/upDownHint";
import {openSetting} from "../config";
import {updateHotkeyTip} from "../protyle/util/compatibility";

export const commandPanel = (app: App) => {
    const dialog = new Dialog({
        width: "80vw",
        height: "70vh",
        content: `<div class="fn__flex-column">
    <div class="b3-form__icon search__header">
        <svg class="b3-form__icon-icon"><use xlink:href="#iconSearch"></use></svg>
        <input class="b3-text-field b3-text-field--text" style="padding-left: 32px !important;">
    </div>
    <div class="fn__hr"></div>
    <ul class="b3-list b3-list--background fn__flex-1" id="commands"></ul>
    <div class="fn__hr"></div>
</div>`
    })
    const listElement = dialog.element.querySelector("#commands");
    app.plugins.forEach(plugin => {
        plugin.commands.forEach(command => {
            const liElement = document.createElement("li");
            liElement.classList.add("b3-list-item")
            liElement.innerHTML = `<span class="b3-list-item__text">${command.langText || plugin.i18n[command.langKey]}</span>
<span class="b3-list-item__meta">${updateHotkeyTip(command.customHotkey)}</span>`;
            liElement.addEventListener("click", () => {
                command.callback();
                dialog.destroy();
            })
            listElement.insertAdjacentElement("beforeend", liElement);
        })
    })

    if (listElement.childElementCount === 0) {
        const liElement = document.createElement("li");
        liElement.classList.add("b3-list-item");
        liElement.innerHTML = `<span class="b3-list-item__text">${window.siyuan.languages.commandEmpty}</span>`;
        liElement.addEventListener("click", () => {
            dialog.destroy();
            openSetting(app).element.querySelector('.b3-tab-bar [data-name="bazaar"]').dispatchEvent(new CustomEvent("click"));
        })
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
                currentElement.dispatchEvent(new CustomEvent("click"));
            }
            dialog.destroy();
        } else if (event.key === "Escape") {
            dialog.destroy();
        }
    });
    inputElement.addEventListener("compositionend", (event: InputEvent) => {
        filterList(inputElement, listElement);
    })
    inputElement.addEventListener("input", (event: InputEvent) => {
        if (event.isComposing) {
            return;
        }
        event.stopPropagation();
        filterList(inputElement, listElement);
    });
}

const filterList = (inputElement: HTMLInputElement, listElement: Element) => {
    const inputValue = inputElement.value.toLowerCase();
    Array.from(listElement.children).forEach((element: HTMLElement) => {
        const elementValue = element.querySelector(".b3-list-item__text").textContent.toLowerCase();
        if (inputValue.indexOf(elementValue) > -1 || elementValue.indexOf(inputValue) > -1) {
            element.classList.remove("fn__none");
        } else {
            element.classList.add("fn__none")
        }
    })
}
