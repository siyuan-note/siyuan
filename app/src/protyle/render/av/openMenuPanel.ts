import {Menu} from "../../../plugin/Menu";
import {transaction} from "../../wysiwyg/transaction";
import {fetchPost} from "../../../util/fetch";
import {hideElements} from "../../ui/hideElements";

export const openMenuPanel = (protyle: IProtyle, blockElement: HTMLElement, type: "properties" | "config" = "config") => {
    let avMenuPanel = document.querySelector(".av__panel");
    if (avMenuPanel) {
        avMenuPanel.remove();
        return;
    }
    window.siyuan.menus.menu.remove();
    fetchPost("/api/av/renderAttributeView", {id: blockElement.getAttribute("data-av-id")}, (response) => {
        const data = response.data.av;
        const tabRect = blockElement.querySelector(".layout-tab-bar").getBoundingClientRect()
        let html
        if (type === "config") {
            html = `<div class="av__panel">
    <div class="b3-dialog__scrim" data-type="close"></div>
    <div class="b3-menu" style="width: 300px;right:${window.innerWidth - tabRect.right}px;top:${tabRect.bottom}px">
        <button class="b3-menu__item" data-type="title">
            <span class="b3-menu__label">${window.siyuan.languages.config}</span>
            <svg class="b3-menu__action" data-type="close" style="opacity: 1"><use xlink:href="#iconCloseRound"></use></svg>
        </button>
        <button class="b3-menu__item">
            <svg class="b3-menu__icon"></svg>
            <span class="b3-menu__label">${window.siyuan.languages.attr}</span>
            <span class="b3-menu__accelerator">${data.columns.filter((item: IAVColumn) => !item.hidden).length}/${data.columns.length}</span>
            <svg class="b3-menu__icon b3-menu__icon--arrow"><use xlink:href="#iconRight"></use></svg>
        </button>
        <button class="b3-menu__item">
            <svg class="b3-menu__icon"><use xlink:href="#iconFilter"></use></svg>
            <span class="b3-menu__label">${window.siyuan.languages.filter}</span>
            <span class="b3-menu__accelerator">${data.filters.length}</span>
            <svg class="b3-menu__icon b3-menu__icon--arrow"><use xlink:href="#iconRight"></use></svg>
        </button>
        <button class="b3-menu__item">
            <svg class="b3-menu__icon"><use xlink:href="#iconSort"></use></svg>
            <span class="b3-menu__label">${window.siyuan.languages.sort}</span>
            <span class="b3-menu__accelerator">${data.sorts.length}</span>
            <svg class="b3-menu__icon b3-menu__icon--arrow"><use xlink:href="#iconRight"></use></svg>
        </button>
        <button class="b3-menu__item">
            <svg class="b3-menu__icon"></svg>
            <span class="b3-menu__label">${window.siyuan.languages.pageCount}</span>
            <span class="b3-menu__accelerator">50</span>
            <svg class="b3-menu__icon b3-menu__icon--arrow"><use xlink:href="#iconRight"></use></svg>
        </button>
    </div>
</div>`
        } else if (type === "properties") {
            html = `<div class="av__panel">
    <div class="b3-dialog__scrim" data-type="close"></div>
    <div class="b3-menu" style="width: 300px;right:${window.innerWidth - tabRect.right}px;top:${tabRect.bottom}px">
        <button class="b3-menu__item">
            <svg class="b3-menu__icon"><use xlink:href="#iconLeft"></use></svg>
            <span class="b3-menu__label">${window.siyuan.languages.attr}</span>
            <svg class="b3-menu__action" data-type="close" style="opacity: 1"><use xlink:href="#iconCloseRound"></use></svg>
        </button>
        <button class="b3-menu__item">
            <svg class="b3-menu__icon"></svg>
            <span class="b3-menu__label">${window.siyuan.languages.attr}</span>
            <span class="b3-menu__accelerator">${data.columns.filter((item: IAVColumn) => !item.hidden).length}/${data.columns.length}</span>
            <svg class="b3-menu__icon b3-menu__icon--arrow"><use xlink:href="#iconRight"></use></svg>
        </button>
        <button class="b3-menu__item">
            <svg class="b3-menu__icon"><use xlink:href="#iconFilter"></use></svg>
            <span class="b3-menu__label">${window.siyuan.languages.filter}</span>
            <span class="b3-menu__accelerator">${data.filters.length}</span>
            <svg class="b3-menu__icon b3-menu__icon--arrow"><use xlink:href="#iconRight"></use></svg>
        </button>
        <button class="b3-menu__item">
            <svg class="b3-menu__icon"><use xlink:href="#iconSort"></use></svg>
            <span class="b3-menu__label">${window.siyuan.languages.sort}</span>
            <span class="b3-menu__accelerator">${data.sorts.length}</span>
            <svg class="b3-menu__icon b3-menu__icon--arrow"><use xlink:href="#iconRight"></use></svg>
        </button>
        <button class="b3-menu__item">
            <svg class="b3-menu__icon"></svg>
            <span class="b3-menu__label">${window.siyuan.languages.pageCount}</span>
            <span class="b3-menu__accelerator">50</span>
            <svg class="b3-menu__icon b3-menu__icon--arrow"><use xlink:href="#iconRight"></use></svg>
        </button>
    </div>
</div>`
        }
        document.body.insertAdjacentHTML("beforeend", html);
        avMenuPanel = document.querySelector(".av__panel");
        avMenuPanel.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            let target = event.target as HTMLElement;
            while (target && !target.isSameNode(avMenuPanel)) {
                const type = target.dataset.type;
                if (type === "close") {
                    avMenuPanel.remove();
                    break;
                }
                target = target.parentElement;
            }
        });
    });
}
