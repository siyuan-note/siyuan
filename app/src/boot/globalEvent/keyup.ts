import {fetchPost} from "../../util/fetch";
import {escapeHtml} from "../../util/escape";
import {openCard} from "../../card/openCard";
import {getDockByType} from "../../layout/util";
import {getAllTabs} from "../../layout/getAll";
import {App} from "../../index";

export const windowKeyUp  = (app: App,event:KeyboardEvent) => {
    window.siyuan.ctrlIsPressed = false;
    window.siyuan.shiftIsPressed = false;
    window.siyuan.altIsPressed = false;
    const switchDialog = window.siyuan.dialogs.find(item => {
        if (item.element.getAttribute("data-key") === "⌃⇥") {
            return true;
        }
    });
    if (switchDialog && switchDialog.element.parentElement) {
        if (event.key === "Tab") {
            let currentLiElement = switchDialog.element.querySelector(".b3-list-item--focus");
            currentLiElement.classList.remove("b3-list-item--focus");
            if (event.shiftKey) {
                if (currentLiElement.previousElementSibling) {
                    currentLiElement.previousElementSibling.classList.add("b3-list-item--focus");
                } else if (currentLiElement.getAttribute("data-original")) {
                    currentLiElement.parentElement.lastElementChild.classList.add("b3-list-item--focus");
                    currentLiElement.removeAttribute("data-original");
                } else if (currentLiElement.parentElement.nextElementSibling) {
                    if (currentLiElement.parentElement.nextElementSibling.lastElementChild) {
                        currentLiElement.parentElement.nextElementSibling.lastElementChild.classList.add("b3-list-item--focus");
                    } else {
                        currentLiElement.parentElement.lastElementChild.classList.add("b3-list-item--focus");
                    }
                } else if (currentLiElement.parentElement.previousElementSibling) {
                    currentLiElement.parentElement.previousElementSibling.lastElementChild.classList.add("b3-list-item--focus");
                }
            } else {
                if (currentLiElement.nextElementSibling) {
                    currentLiElement.nextElementSibling.classList.add("b3-list-item--focus");
                } else if (currentLiElement.getAttribute("data-original")) {
                    currentLiElement.parentElement.firstElementChild.classList.add("b3-list-item--focus");
                    currentLiElement.removeAttribute("data-original");
                } else if (currentLiElement.parentElement.nextElementSibling) {
                    if (currentLiElement.parentElement.nextElementSibling.firstElementChild) {
                        currentLiElement.parentElement.nextElementSibling.firstElementChild.classList.add("b3-list-item--focus");
                    } else {
                        currentLiElement.parentElement.firstElementChild.classList.add("b3-list-item--focus");
                    }
                } else if (currentLiElement.parentElement.previousElementSibling) {
                    currentLiElement.parentElement.previousElementSibling.firstElementChild.classList.add("b3-list-item--focus");
                }
            }
            currentLiElement = switchDialog.element.querySelector(".b3-list-item--focus");
            if (currentLiElement) {
                const rootId = currentLiElement.getAttribute("data-node-id");
                if (rootId) {
                    fetchPost("/api/filetree/getFullHPathByID", {
                        id: rootId
                    }, (response) => {
                        currentLiElement.parentElement.parentElement.nextElementSibling.innerHTML = escapeHtml(response.data);
                    });
                } else {
                    currentLiElement.parentElement.parentElement.nextElementSibling.innerHTML = currentLiElement.querySelector(".b3-list-item__text").innerHTML;
                }
                const currentRect = currentLiElement.getBoundingClientRect();
                const currentParentRect = currentLiElement.parentElement.getBoundingClientRect();
                if (currentRect.top < currentParentRect.top) {
                    currentLiElement.scrollIntoView(true);
                } else if (currentRect.bottom > currentParentRect.bottom) {
                    currentLiElement.scrollIntoView(false);
                }
            }
            const originalElement = switchDialog.element.querySelector('[data-original="true"]');
            if (originalElement) {
                originalElement.removeAttribute("data-original");
            }
        } else if (event.key === "Control") {
            let currentLiElement = switchDialog.element.querySelector(".b3-list-item--focus");
            // 快速切换时，不触发 Tab
            if (currentLiElement.getAttribute("data-original")) {
                currentLiElement.classList.remove("b3-list-item--focus");
                if (event.shiftKey) {
                    if (currentLiElement.previousElementSibling) {
                        currentLiElement.previousElementSibling.classList.add("b3-list-item--focus");
                    } else {
                        currentLiElement.parentElement.lastElementChild.classList.add("b3-list-item--focus");
                        currentLiElement.removeAttribute("data-original");
                    }
                } else {
                    if (currentLiElement.nextElementSibling) {
                        currentLiElement.nextElementSibling.classList.add("b3-list-item--focus");
                    } else {
                        currentLiElement.parentElement.firstElementChild.classList.add("b3-list-item--focus");
                    }
                }
                currentLiElement.removeAttribute("data-original");
                currentLiElement = switchDialog.element.querySelector(".b3-list-item--focus");
            }
            const currentType = currentLiElement.getAttribute("data-type");
            if (currentType) {
                if (currentType === "riffCard") {
                    openCard(app);
                } else {
                    getDockByType(currentType).toggleModel(currentType, true);
                }
                if (document.activeElement) {
                    (document.activeElement as HTMLElement).blur();
                }
            } else {
                const currentId = currentLiElement.getAttribute("data-id");
                getAllTabs().find(item => {
                    if (item.id === currentId) {
                        item.parent.switchTab(item.headElement);
                        item.parent.showHeading();
                        return true;
                    }
                });
            }
            switchDialog.destroy();
        }
    }
};
