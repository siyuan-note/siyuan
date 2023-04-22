import {fetchPost} from "../util/fetch";
import {Dialog} from "../dialog";
import {Protyle} from "../protyle";
import {Constants} from "../constants";
import {disabledProtyle, onGet} from "../protyle/util/onGet";
import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {escapeHtml} from "../util/escape";
import * as dayjs from "dayjs";
import {isMobile} from "../util/functions";

const genItem = (data: [], data2?: { title: string, fileID: string }[]) => {
    if (!data || data.length === 0) {
        return `<li style="padding-left: 40px;" class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>`;
    }
    let html = "";
    data.forEach((item: { title: string, fileID: string }, index) => {
        let id2 = "";
        if (data2) {
            id2 = `data-id2="${data2[index].fileID}"`;
        }
        html += `<li style="padding-left: 40px;" class="b3-list-item" ${id2} data-id="${item.fileID}">
    <span class="b3-list-item__text">${escapeHtml(item.title)}</span>
</li>`;
    });
    return html;
};

let leftEditor: Protyle;
let rightEditor: Protyle;
const renderCompare = (element: HTMLElement) => {
    const listElement = hasClosestByClassName(element, "history__diff");
    if (!listElement) {
        return;
    }
    const leftElement = listElement.nextElementSibling.firstElementChild;
    const rightElement = listElement.nextElementSibling.lastElementChild;
    if (!leftEditor) {
        leftEditor = new Protyle(leftElement.lastElementChild as HTMLElement, {
            blockId: "",
            action: [Constants.CB_GET_HISTORY],
            render: {
                background: false,
                title: false,
                gutter: false,
                breadcrumb: false,
                breadcrumbDocName: false,
            },
            typewriterMode: false
        });
        disabledProtyle(leftEditor.protyle);
        rightEditor = new Protyle(rightElement.lastElementChild as HTMLElement, {
            blockId: "",
            action: [Constants.CB_GET_HISTORY],
            render: {
                background: false,
                title: false,
                gutter: false,
                breadcrumb: false,
                breadcrumbDocName: false,
            },
            typewriterMode: false
        });
        disabledProtyle(rightEditor.protyle);
    }

    fetchPost("/api/repo/openRepoSnapshotDoc", {id: element.getAttribute("data-id")}, (response) => {
        leftElement.classList.remove("fn__none");
        const textElement = (leftElement.firstElementChild.nextElementSibling as HTMLTextAreaElement);
        if (response.data.isLargeDoc) {
            textElement.value = response.data.content;
            textElement.classList.remove("fn__none");
            leftElement.lastElementChild.classList.add("fn__none");
        } else {
            textElement.classList.add("fn__none");
            leftElement.lastElementChild.classList.remove("fn__none");
            onGet(response, leftEditor.protyle, [Constants.CB_GET_HISTORY, Constants.CB_GET_HTML]);
        }
        textElement.previousElementSibling.textContent = dayjs(response.data.updated).format("YYYY-MM-DD HH:mm")
    });
    const id2 = element.getAttribute("data-id2");
    if (id2) {
        rightElement.classList.remove("fn__none");
        fetchPost("/api/repo/openRepoSnapshotDoc", {id: id2}, (response) => {
            const textElement = (rightElement.firstElementChild.nextElementSibling as HTMLTextAreaElement);
            if (response.data.isLargeDoc) {
                textElement.value = response.data.content;
                textElement.classList.remove("fn__none");
                rightElement.lastElementChild.classList.add("fn__none");
            } else {
                textElement.classList.add("fn__none");
                rightElement.lastElementChild.classList.remove("fn__none");
                onGet(response, rightEditor.protyle, [Constants.CB_GET_HISTORY, Constants.CB_GET_HTML]);
            }
            textElement.previousElementSibling.textContent = dayjs(response.data.updated).format("YYYY-MM-DD HH:mm")
        });
    } else {
        rightElement.classList.add("fn__none");
    }
};

export const showDiff = (data: { id: string, time: string }[]) => {
    if (data.length !== 2) {
        return;
    }
    let left: string;
    let right: string;
    if (data[0].time < data[1].time) {
        left = data[1].id;
        right = data[0].id;
    } else {
        left = data[0].id;
        right = data[1].id;
    }

    const dialog = new Dialog({
        title: window.siyuan.languages.compare,
        content: "",
        width: isMobile() ? "92vw" : "80vw",
        height: "80vh",
        destroyCallback() {
            leftEditor = undefined;
            rightEditor = undefined;
        }
    });
    dialog.element.addEventListener("click", (event) => {
        let target = event.target as HTMLElement;
        while (target && target !== dialog.element) {
            if (target.classList.contains("b3-list-item") && !target.dataset.id) {
                target.nextElementSibling.classList.toggle("fn__none");
                target.querySelector("svg").classList.toggle("b3-list-item__arrow--open");
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.classList.contains("b3-list-item") && target.dataset.id) {
                if (target.classList.contains("b3-list-item--focus")) {
                    return;
                }
                dialog.element.querySelector(".history__diff .b3-list-item--focus")?.classList.remove("b3-list-item--focus");
                target.classList.add("b3-list-item--focus");
                renderCompare(target);
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.classList.contains("block__icon")) {
                if (target.getAttribute("data-direct") === "left") {
                    target.setAttribute("data-direct", "right")
                    genHTML(right, left, dialog);
                } else {
                    target.setAttribute("data-direct", "left")
                    genHTML(left, right, dialog);
                }
                event.preventDefault();
                event.stopPropagation();
                break;
            }
            target = target.parentElement;
        }
    });
    genHTML(left, right, dialog);
};

const genHTML = (left: string, right: string, dialog: Dialog) => {
    leftEditor = undefined;
    rightEditor = undefined;
    fetchPost("/api/repo/diffRepoSnapshots", {left, right}, (response) => {
        const headElement = dialog.element.querySelector(".b3-dialog__header");
        headElement.innerHTML = `<div style="padding: 0;min-height: auto;" class="block__icons">
    <span class="fn__flex-1"></span>
    ${dayjs(response.data.left.created).format("YYYY-MM-DD HH:mm")}
    <span class="fn__space"></span>
    <span class="block__icon block__icon--show" data-direct="left"><svg><use xlink:href="#iconForward"></use></svg></span>
    <span class="fn__space"></span>
    ${dayjs(response.data.right.created).format("YYYY-MM-DD HH:mm")}
    <span class="fn__flex-1"></span>
</div>`
        headElement.nextElementSibling.innerHTML = `<div class="fn__flex" style="height: 100%;${isMobile() ? "flex-direction: column;" : ""}">
    <div class="history__diff"${isMobile() ? 'style="flex:1;width:auto"' : ""}>
        <ul class="b3-list b3-list--background">
            <li class="b3-list-item">
                <span class="b3-list-item__toggle b3-list-item__toggle--hl">
                    <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
                </span>
                <span style="padding-left: 4px" class="b3-list-item__text">${window.siyuan.languages.update}</span>
            </li>
            <ul class="fn__none">${genItem(response.data.updatesLeft, response.data.updatesRight)}</ul>
        </ul>
        <ul class="b3-list b3-list--background">
            <li class="b3-list-item">
                <span class="b3-list-item__toggle b3-list-item__toggle--hl">
                    <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
                </span>
                <span style="padding-left: 4px" class="b3-list-item__text">${window.siyuan.languages.addAttr}</span>
            </li>
            <ul class="fn__none">${genItem(response.data.addsLeft)}</ul>
        </ul>
        <ul class="b3-list b3-list--background">
            <li class="b3-list-item">
                <span class="b3-list-item__toggle b3-list-item__toggle--hl">
                    <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
                </span>
                <span style="padding-left: 4px" class="b3-list-item__text">${window.siyuan.languages.remove}</span>
            </li>
            <ul class="fn__none">${genItem(response.data.removesRight)}</ul>
        </ul>
    </div>
    <div class="fn__flex-1 fn__flex">
        <div class="fn__none fn__flex-1 fn__flex-column">
            <div class="history__date">${dayjs(response.data.left.created).format("YYYY-MM-DD HH:mm")}</div>
            <textarea class="history__text fn__none fn__flex-1"></textarea>
            <div class="fn__flex-1"></div>
        </div>
        <div class="fn__none fn__flex-1 fn__flex-column" style="border-left: 1px solid var(--b3-border-color);">
            <div class="history__date">${dayjs(response.data.right.created).format("YYYY-MM-DD HH:mm")}</div>
            <textarea class="history__text fn__none fn__flex-1"></textarea>
            <div class="fn__flex-1"></div>
        </div>
    </div>
</div>`;
    });
}
