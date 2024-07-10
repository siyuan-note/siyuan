import {fetchPost} from "../util/fetch";
import {Dialog} from "../dialog";
import {Protyle} from "../protyle";
import {Constants} from "../constants";
import {disabledProtyle, onGet} from "../protyle/util/onGet";
import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {escapeAttr, escapeHtml} from "../util/escape";
import * as dayjs from "dayjs";
import {isMobile} from "../util/functions";
import {App} from "../index";
import {pathPosix} from "../util/pathName";
import {renderAssetsPreview} from "../asset/renderAssets";

const genItem = (data: [], data2?: { title: string, fileID: string }[]) => {
    if (!data || data.length === 0) {
        return `<li style="padding-left: 40px;" class="b3-list--empty">${window.siyuan.languages.emptyContent}</li>`;
    }
    let html = "";
    data.forEach((item: { title: string, fileID: string, path: string, hSize: string }, index) => {
        let id2 = "";
        if (data2) {
            id2 = `data-id2="${data2[index].fileID}"`;
        }
        html += `<li style="padding-left: 40px;" class="b3-list-item" ${id2} data-id="${item.fileID}">
    <span class="b3-list-item__text" title="${escapeAttr(item.path)} ${item.hSize}">${escapeHtml(item.title)}</span>
</li>`;
    });
    return html;
};

let leftEditor: Protyle;
let rightEditor: Protyle;
const renderCompare = (app: App, element: HTMLElement) => {
    const listElement = hasClosestByClassName(element, "history__diff");
    if (!listElement) {
        return;
    }
    const dialogContainerElement = hasClosestByClassName(element, "b3-dialog__container");
    if (!dialogContainerElement) {
        return;
    }
    const leftElement = listElement.nextElementSibling.firstElementChild;
    const rightElement = listElement.nextElementSibling.lastElementChild;
    if (!leftEditor) {
        leftEditor = new Protyle(app, leftElement.lastElementChild as HTMLElement, {
            blockId: "",
            history: {
                snapshot: ""
            },
            action: [Constants.CB_GET_HISTORY],
            render: {
                background: false,
                gutter: false,
                breadcrumb: false,
                breadcrumbDocName: false,
            },
            typewriterMode: false
        });
        disabledProtyle(leftEditor.protyle);
        rightEditor = new Protyle(app, rightElement.lastElementChild as HTMLElement, {
            blockId: "",
            action: [Constants.CB_GET_HISTORY],
            history: {
                snapshot: ""
            },
            render: {
                background: false,
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
        const textElement = leftElement.querySelector("textarea");
        const type = pathPosix().extname(response.data.content).toLowerCase();
        if (Constants.SIYUAN_ASSETS_IMAGE.concat(Constants.SIYUAN_ASSETS_AUDIO).concat(Constants.SIYUAN_ASSETS_VIDEO).includes(type)) {
            textElement.previousElementSibling.innerHTML = renderAssetsPreview(response.data.content);
            textElement.previousElementSibling.classList.remove("fn__none");
            textElement.classList.add("fn__none");
            leftElement.lastElementChild.classList.add("fn__none");
        } else if (response.data.isProtyleDoc) {
            textElement.value = response.data.content;
            textElement.classList.remove("fn__none");
            leftElement.lastElementChild.classList.add("fn__none");
            textElement.previousElementSibling.classList.add("fn__none");
        } else {
            textElement.classList.add("fn__none");
            leftElement.lastElementChild.classList.remove("fn__none");
            textElement.previousElementSibling.classList.add("fn__none");
            leftEditor.protyle.options.history.snapshot = dialogContainerElement.querySelector(".b3-dialog__header code").getAttribute("data-snapshot");
            onGet({
                data: response,
                protyle: leftEditor.protyle,
                action: [Constants.CB_GET_HISTORY, Constants.CB_GET_HTML],
            });
        }
        leftElement.querySelector(".history__date").textContent = dayjs(response.data.updated).format("YYYY-MM-DD HH:mm");
    });
    const id2 = element.getAttribute("data-id2");
    if (id2) {
        rightElement.classList.remove("fn__none");
        fetchPost("/api/repo/openRepoSnapshotDoc", {id: id2}, (response) => {
            const textElement = rightElement.querySelector("textarea");
            const type = pathPosix().extname(response.data.content).toLowerCase();
            if (Constants.SIYUAN_ASSETS_IMAGE.concat(Constants.SIYUAN_ASSETS_AUDIO).concat(Constants.SIYUAN_ASSETS_VIDEO).includes(type)) {
                textElement.previousElementSibling.innerHTML = renderAssetsPreview(response.data.content);
                textElement.previousElementSibling.classList.remove("fn__none");
                textElement.classList.add("fn__none");
                rightElement.lastElementChild.classList.add("fn__none");
            } else if (response.data.isProtyleDoc) {
                textElement.value = response.data.content;
                textElement.classList.remove("fn__none");
                rightElement.lastElementChild.classList.add("fn__none");
                textElement.previousElementSibling.classList.add("fn__none");
            } else {
                textElement.classList.add("fn__none");
                rightElement.lastElementChild.classList.remove("fn__none");
                textElement.previousElementSibling.classList.add("fn__none");
                rightEditor.protyle.options.history.snapshot = dialogContainerElement.querySelectorAll(".b3-dialog__header code")[1].getAttribute("data-snapshot");
                onGet({
                    data: response,
                    protyle: rightEditor.protyle,
                    action: [Constants.CB_GET_HISTORY, Constants.CB_GET_HTML],
                });
            }
            rightElement.querySelector(".history__date").textContent = dayjs(response.data.updated).format("YYYY-MM-DD HH:mm");
        });
    } else {
        rightElement.classList.add("fn__none");
    }
};

export const showDiff = (app: App, data: { id: string, time: string }[]) => {
    if (data.length !== 2) {
        return;
    }
    let left: string;
    let right: string;
    if (data[0].time > data[1].time) {
        left = data[1].id;
        right = data[0].id;
    } else {
        left = data[0].id;
        right = data[1].id;
    }

    const dialog = new Dialog({
        title: window.siyuan.languages.compare,
        content: "",
        width: isMobile() ? "92vw" : "90vw",
        height: "80vh",
        destroyCallback() {
            leftEditor = undefined;
            rightEditor = undefined;
        }
    });
    dialog.element.setAttribute("data-key", Constants.DIALOG_HISTORYCOMPARE);
    dialog.element.addEventListener("click", (event) => {
        if (typeof event.detail === "string") {
            renderCompare(app, dialog.element.querySelector(".history__diff .b3-list-item--focus"));
            event.stopPropagation();
            event.preventDefault();
            return;
        }
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
                renderCompare(app, target);
                event.preventDefault();
                event.stopPropagation();
                break;
            } else if (target.classList.contains("block__icon")) {
                if (target.getAttribute("data-direct") === "left") {
                    target.setAttribute("data-direct", "right");
                    genHTML(right, left, dialog, "right");
                } else {
                    target.setAttribute("data-direct", "left");
                    genHTML(left, right, dialog, "left");
                }
                event.preventDefault();
                event.stopPropagation();
                break;
            }
            target = target.parentElement;
        }
    });
    genHTML(left, right, dialog, "left");
};

const genHTML = (left: string, right: string, dialog: Dialog, direct: string) => {
    leftEditor = undefined;
    rightEditor = undefined;
    const isPhone = isMobile();
    fetchPost("/api/repo/diffRepoSnapshots", {left, right}, (response) => {
        const headElement = dialog.element.querySelector(".b3-dialog__header");
        headElement.innerHTML = `<div style="padding: 0;min-height: auto;" class="block__icons">
    <span class="fn__flex-1"></span>
    <code class="fn__code${isPhone ? " fn__none" : ""}" data-snapshot="${left}">${left.substring(0, 7)}</code>
    ${isPhone ? "" : '<span class="fn__space"></span>'}
    ${dayjs(response.data.left.created).format("YYYY-MM-DD HH:mm")}
    <span class="fn__space"></span>
    <span class="block__icon block__icon--show b3-tooltips b3-tooltips__s" aria-label="${window.siyuan.languages.switchDirect}" data-direct="${direct}"><svg><use xlink:href="#iconScrollHoriz"></use></svg></span>
    <span class="fn__space"></span>
    <code class="fn__code${isPhone ? " fn__none" : ""}" data-snapshot="${right}">${right.substring(0, 7)}</code>
    ${isPhone ? "" : '<span class="fn__space"></span>'}
    ${dayjs(response.data.right.created).format("YYYY-MM-DD HH:mm")}
    <span class="fn__flex-1"></span>
</div>`;
        headElement.nextElementSibling.innerHTML = `<div class="fn__flex history__panel" style="height: 100%">
    <div class="history__diff">
        <ul class="b3-list b3-list--background">
            <li class="b3-list-item">
                <span class="b3-list-item__toggle b3-list-item__toggle--hl">
                    <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
                </span>
                <span style="padding-left: 4px" class="b3-list-item__text">${window.siyuan.languages.update}</span>
                <span class="counter${response.data.updatesLeft.length === 0 ? " fn__none" : ""}">${response.data.updatesLeft.length}</span>
            </li>
            <ul class="fn__none">${genItem(response.data.updatesLeft, response.data.updatesRight)}</ul>
        </ul>
        <ul class="b3-list b3-list--background">
            <li class="b3-list-item">
                <span class="b3-list-item__toggle b3-list-item__toggle--hl">
                    <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
                </span>
                <span style="padding-left: 4px" class="b3-list-item__text">${window.siyuan.languages.addAttr}</span>
                <span class="counter${response.data.addsLeft.length === 0 ? " fn__none" : ""}">${response.data.addsLeft.length}</span>
            </li>
            <ul class="fn__none">${genItem(response.data.addsLeft)}</ul>
        </ul>
        <ul class="b3-list b3-list--background">
            <li class="b3-list-item">
                <span class="b3-list-item__toggle b3-list-item__toggle--hl">
                    <svg class="b3-list-item__arrow"><use xlink:href="#iconRight"></use></svg>
                </span>
                <span style="padding-left: 4px" class="b3-list-item__text">${window.siyuan.languages.remove}</span>
                <span class="counter${response.data.removesRight.length === 0 ? " fn__none" : ""}">${response.data.removesRight.length}</span>
            </li>
            <ul class="fn__none">${genItem(response.data.removesRight)}</ul>
        </ul>
    </div>
    <div class="fn__flex-1 fn__flex">
        <div class="fn__none fn__flex-1 fn__flex-column">
            <div class="history__date">${dayjs(response.data.left.created).format("YYYY-MM-DD HH:mm")}</div>
            <div class="ft__center"></div>
            <textarea class="history__text fn__none fn__flex-1" readonly></textarea>
            <div class="fn__flex-1"></div>
        </div>
        <div class="fn__none fn__flex-1 fn__flex-column" style="border-left: 1px solid var(--b3-border-color);">
            <div class="history__date">${dayjs(response.data.right.created).format("YYYY-MM-DD HH:mm")}</div>
            <div class="ft__center"></div>
            <textarea class="history__text fn__none fn__flex-1" readonly></textarea>
            <div class="fn__flex-1"></div>
        </div>
    </div>
</div>`;
    });
};
