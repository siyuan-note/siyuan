import {fetchPost} from "../util/fetch";
import {Dialog} from "../dialog";

const genItem = (data: [], type: "add" | "update" | "remove") => {
    if (!data || data.length === 0) {
        return `<li style="padding-left: 44px;" class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>`
    }
    let html = "";
    data.forEach((item: { id: string, path: string }) => {
        html += `<li style="padding-left: 44px;" class="b3-list-item" data-id="${item.id}"><span class="b3-list-item__text">${item.path}</span></li>`;
    })
    return html;
}

const renderCompare = (element: HTMLElement) => {
    fetchPost("/api/repo/openRepoSnapshotDoc", {id: element.getAttribute("data-id")}, (response) => {

    })
}

export const showDiff = (ids: string) => {
    const idArray = ids.split(",");
    if (idArray.length !== 2) {
        return;
    }
    fetchPost("/api/repo/diffRepoSnapshots", {left: idArray[0], right: idArray[1]}, (response) => {
        const dialog = new Dialog({
            title: window.siyuan.languages.compare,
            content: `<div class="fn__flex" style="height: 100%">
    <div class="b3-dialog__diff">
        <ul class="b3-list b3-list--background">
            <li class="b3-list-item">
                <span class="b3-list-item__toggle b3-list-item__toggle--hl">
                    <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
                </span>
                <span style="padding-left: 4px" class="b3-list-item__text">${window.siyuan.languages.addAttr}</span>
            </li>
            <ul class="fn__none">${genItem(response.data.adds, "add")}</ul>
        </ul>
        <ul class="b3-list b3-list--background">
            <li class="b3-list-item">
                <span class="b3-list-item__toggle b3-list-item__toggle--hl">
                    <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
                </span>
                <span style="padding-left: 4px" class="b3-list-item__text">${window.siyuan.languages.update}</span>
            </li>
            <ul class="fn__none">${genItem(response.data.updates, "add")}</ul>
        </ul>
        <ul class="b3-list b3-list--background">
            <li class="b3-list-item">
                <span class="b3-list-item__toggle b3-list-item__toggle--hl">
                    <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
                </span>
                <span style="padding-left: 4px" class="b3-list-item__text">${window.siyuan.languages.remove}</span>
            </li>
            <ul class="fn__none">${genItem(response.data.removes, "add")}</ul>
        </ul>
    </div>
    <div class="fn__flex-1"></div>
</div>`,
            width: "80vw",
            height: "80vh",
        });
        dialog.element.addEventListener("click", (event) => {
            let target = event.target as HTMLElement;
            while (target && target !== dialog.element) {
                if (target.classList.contains("b3-list-item") && !target.dataset.id) {
                    target.nextElementSibling.classList.toggle("fn__none");
                    target.querySelector("svg").classList.toggle("b3-list-item__arrow--open");
                    break;
                } else if (target.classList.contains("b3-list-item") && target.dataset.id) {
                    if (target.classList.contains("b3-list-item--focus")) {
                        return;
                    }
                    dialog.element.querySelector(".b3-dialog__diff .b3-list-item--focus")?.classList.remove("b3-list-item--focus");
                    target.classList.add("b3-list-item--focus");
                    renderCompare(target)
                }
                target = target.parentElement;
            }
        });
    });
}
