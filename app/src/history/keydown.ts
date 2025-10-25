import {Dialog} from "../dialog";

export const historyKeydown = (event: KeyboardEvent, dialog: Dialog) => {
    let currentItem = dialog.element.querySelector(".history__side .b3-list-item--focus");
    const items = Array.from(dialog.element.querySelectorAll(".history__side .b3-list-item[data-id]"));
    if (items.length < 2) {
        return;
    }
    if (!currentItem) {
        currentItem = items[0];
    } else {
        currentItem.classList.remove("b3-list-item--focus");
        if (event.key === "Home") {
            currentItem = items[0];
        } else if (event.key === "End") {
            currentItem = items[items.length - 1];
        } else {
            items.find((item, index) => {
                if (item === currentItem) {
                    if (event.key === "ArrowUp") {
                        if (index === 0) {
                            currentItem = items[items.length - 1];
                        } else {
                            currentItem = items[index - 1];
                        }
                    } else if (event.key === "ArrowDown") {
                        if (index === items.length - 1) {
                            currentItem = items[0];
                        } else {
                            currentItem = items[index + 1];
                        }
                    }
                    return true;
                }
            });
        }
    }
    currentItem.classList.add("b3-list-item--focus");
    if (currentItem.parentElement.classList.contains("fn__none")) {
        currentItem.parentElement.classList.remove("fn__none");
        currentItem.parentElement.previousElementSibling.querySelector("svg").classList.add("b3-list-item__arrow--open");
    }
    const currentItemRect = currentItem.getBoundingClientRect();
    const historyDiffElement = dialog.element.querySelector(".history__side");
    const historyDiffRect = historyDiffElement.getBoundingClientRect();
    if (currentItemRect.bottom > historyDiffRect.bottom) {
        currentItem.scrollIntoView(false);
    } else if (currentItemRect.top < historyDiffRect.top) {
        currentItem.scrollIntoView();
    }
    dialog.element.dispatchEvent(new CustomEvent("click", {detail: event.key.toLowerCase()}));
};
