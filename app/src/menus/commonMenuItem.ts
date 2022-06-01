/// #if !BROWSER
import {shell} from "electron";
/// #endif
import {newFile} from "../util/newFile";
import {getDockByType} from "../layout/util";
import {confirmDialog} from "../dialog/confirmDialog";
import {getSearch, isMobile} from "../util/functions";
import {getDisplayName, isLocalPath, movePathTo} from "../util/pathName";
import {MenuItem} from "./Menu";
import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {saveExport} from "../protyle/export";
import {writeText} from "../protyle/util/compatibility";
import {fetchPost} from "../util/fetch";
import {hideMessage, showMessage} from "../dialog/message";
import {Dialog} from "../dialog";
import {getAllModels} from "../layout/getAll";
import {focusBlock, focusByRange, getEditorRange} from "../protyle/util/selection";
import {setPosition} from "../util/setPosition";
import {updateTransaction} from "../protyle/wysiwyg/transaction";
import {Bookmark} from "../layout/dock/Bookmark";
import {rename} from "../editor/rename";
import {openAsset, openBy} from "../editor/util";
import {matchHotKey} from "../protyle/util/hotKey";
import * as dayjs from "dayjs";
import {Constants} from "../constants";

const bindAttrInput = (inputElement: HTMLInputElement, confirmElement: Element) => {
    inputElement.addEventListener("keydown", (event) => {
        if (event.isComposing) {
            return;
        }
        if (matchHotKey("⌘Enter", event)) {
            confirmElement.dispatchEvent(new CustomEvent("click"));
            event.stopPropagation();
            event.preventDefault();
        }
    });
};

export const openWechatNotify = (nodeElement: Element) => {
    const id = nodeElement.getAttribute("data-node-id");
    const range = getEditorRange(nodeElement);
    const reminder = nodeElement.getAttribute("custom-reminder-wechat");
    let reminderFormat = "";
    if (reminder) {
        reminderFormat = dayjs(reminder).format("YYYY-MM-DDTHH:mm");
    }
    const dialog = new Dialog({
        width: isMobile() ? "80vw" : "50vw",
        title: window.siyuan.languages.wechatReminder,
        content: `<div class="b3-dialog__content custom-attr">
    <div class="fn__flex">
        <span class="ft__on-surface fn__flex-center" style="text-align: right;white-space: nowrap;width: 100px">${window.siyuan.languages.notifyTime}</span>
        <div class="fn__space"></div>
        <input class="b3-text-field fn__flex-1" type="datetime-local" value="${reminderFormat}">
    </div>
    <div class="b3-label__text" style="text-align: center">${window.siyuan.languages.wechatTip}</div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.remove}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        destroyCallback() {
            focusByRange(range);
        }
    });
    const btnsElement = dialog.element.querySelectorAll(".b3-button");
    btnsElement[0].addEventListener("click", () => {
        dialog.destroy();
    });
    btnsElement[1].addEventListener("click", () => {
        if (btnsElement[1].getAttribute("disabled")) {
            return;
        }
        btnsElement[1].setAttribute("disabled", "disabled");
        fetchPost("/api/block/setBlockReminder", {id, timed: "0"}, () => {
            nodeElement.removeAttribute("custom-reminder-wechat");
            dialog.destroy();
        });
    });
    btnsElement[2].addEventListener("click", () => {
        const date = dialog.element.querySelector("input").value;
        if (date) {
            if (new Date(date) <= new Date()) {
                showMessage(window.siyuan.languages.reminderTip);
                return;
            }
            if (btnsElement[2].getAttribute("disabled")) {
                return;
            }
            btnsElement[2].setAttribute("disabled", "disabled");
            const timed = dayjs(date).format("YYYYMMDDHHmmss");
            fetchPost("/api/block/setBlockReminder", {id, timed}, () => {
                nodeElement.setAttribute("custom-reminder-wechat", timed);
                dialog.destroy();
            });
        } else {
            showMessage(window.siyuan.languages.notEmpty);
        }
    });
};

export const openFileWechatNotify = (protyle: IProtyle) => {
    fetchPost("/api/block/getDocInfo", {
        id: protyle.block.rootID
    }, (response) => {
        const reminder = response.data.ial["custom-reminder-wechat"];
        let reminderFormat = "";
        if (reminder) {
            reminderFormat = dayjs(reminder).format("YYYY-MM-DDTHH:mm");
        }
        const dialog = new Dialog({
            width: isMobile() ? "80vw" : "50vw",
            title: window.siyuan.languages.wechatReminder,
            content: `<div class="b3-dialog__content custom-attr">
    <div class="fn__flex">
        <span class="ft__on-surface fn__flex-center" style="text-align: right;white-space: nowrap;width: 100px">${window.siyuan.languages.notifyTime}</span>
        <div class="fn__space"></div>
        <input class="b3-text-field fn__flex-1" type="datetime-local" value="${reminderFormat}">
    </div>
    <div class="b3-label__text" style="text-align: center">${window.siyuan.languages.wechatTip}</div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.remove}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`
        });
        const btnsElement = dialog.element.querySelectorAll(".b3-button");
        btnsElement[0].addEventListener("click", () => {
            dialog.destroy();
        });
        btnsElement[1].addEventListener("click", () => {
            fetchPost("/api/block/setBlockReminder", {id: protyle.block.rootID, timed: "0"}, () => {
                dialog.destroy();
            });
        });
        btnsElement[2].addEventListener("click", () => {
            const date = dialog.element.querySelector("input").value;
            if (date) {
                if (new Date(date) <= new Date()) {
                    showMessage(window.siyuan.languages.reminderTip);
                    return;
                }
                fetchPost("/api/block/setBlockReminder", {
                    id: protyle.block.rootID,
                    timed: dayjs(date).format("YYYYMMDDHHmmss")
                }, () => {
                    dialog.destroy();
                });
            } else {
                showMessage(window.siyuan.languages.notEmpty);
            }
        });
    });
};

export const openFileAttr = (attrs: IObject, id: string, focusName = "bookmark") => {
    let customHTML = "";
    let notifyHTML = "";
    Object.keys(attrs).forEach(item => {
        if (item === "custom-reminder-wechat") {
            notifyHTML = `<label class="fn__flex customItem">
    <span class="ft__on-surface fn__flex-center fn__ellipsis" style="text-align: right;width: 100px">${window.siyuan.languages.wechatReminder}</span>
    <div class="fn__space"></div>
    <input class="b3-text-field fn__flex-1" type="datetime-local" readonly data-name="${item}" value="${dayjs(attrs[item]).format("YYYY-MM-DDTHH:mm")}">
    <div class="fn__space"></div>
    <span class="block__icon fn__flex-center" style="opacity: 1;"><svg></svg></span>
</label><div class="fn__hr--b"></div>`;
        } else if (item.indexOf("custom") > -1) {
            customHTML += `<label class="fn__flex customItem">
    <span class="ft__on-surface fn__flex-center fn__ellipsis" title="${item.replace("custom-", "")}" style="text-align: right;width: 100px">${item.replace("custom-", "")}</span>
    <div class="fn__space"></div>
    <textarea class="b3-text-field fn__flex-1" rows="1" data-name="${item}">${attrs[item]}</textarea>
    <div class="fn__space"></div>
    <span data-action="remove" class="block__icon fn__flex-center" style="opacity: 1;"><svg><use xlink:href="#iconMin"></use></svg></span>
</label><div class="fn__hr--b"></div>`;
        }
    });
    const dialog = new Dialog({
        width: isMobile() ? "80vw" : "50vw",
        title: window.siyuan.languages.attr,
        content: `<div class="b3-dialog__content custom-attr">
    <div class="fn__flex">
        <span class="ft__on-surface fn__flex-center" style="text-align: right;white-space: nowrap;width: 100px">${window.siyuan.languages.bookmark}</span>
        <div class="fn__space"></div>
        <input class="b3-text-field fn__flex-1" data-name="bookmark">
        <div class="fn__space"></div>
        <span data-action="bookmark" class="block__icon fn__flex-center" style="opacity: 1;"><svg><use xlink:href="#iconDown"></use></svg></span>
    </div>
    <div class="fn__hr--b"></div>
    <label class="fn__flex">
        <span class="ft__on-surface fn__flex-center" style="text-align: right;white-space: nowrap;width: 100px">${window.siyuan.languages.name}</span>
        <div class="fn__space"></div>
        <input class="b3-text-field fn__flex-1" data-name="name">
        <div class="fn__space"></div>
        <span class="block__icon fn__flex-center"><svg></svg></span>
    </label>
    <div class="fn__hr--b"></div>
    <label class="fn__flex">
        <span class="ft__on-surface fn__flex-center" style="text-align: right;white-space: nowrap;width: 100px">${window.siyuan.languages.alias}</span>
        <div class="fn__space"></div>
        <input class="b3-text-field fn__flex-1" data-name="alias">
        <div class="fn__space"></div>
        <span class="block__icon fn__flex-center"><svg></svg></span>
    </label>
    <div class="fn__hr--b"></div>
    <label class="fn__flex">
        <span class="ft__on-surface fn__flex-center" style="text-align: right;white-space: nowrap;width: 100px">${window.siyuan.languages.memo}</span>
        <div class="fn__space"></div>
        <textarea rows="2" class="b3-text-field fn__flex-1" data-name="memo">${attrs.memo || ""}</textarea>
        <div class="fn__space"></div>
        <span class="block__icon fn__flex-center"><svg></svg></span>
    </label>
    <div style="background-color: var(--b3-border-color);height: 1px;margin: 16px 0;"></div>
    <div class="custom-attr__add">
        ${notifyHTML}
        ${customHTML}
        <button class="b3-button b3-button--outline" style="width: 100px">
            <svg><use xlink:href="#iconAdd"></use></svg>
            ${window.siyuan.languages.addAttr}
        </button>
    </div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
    });
    (dialog.element.querySelector('.b3-text-field[data-name="bookmark"]') as HTMLInputElement).value = attrs.bookmark || "";
    (dialog.element.querySelector('.b3-text-field[data-name="name"]') as HTMLInputElement).value = attrs.name || "";
    (dialog.element.querySelector('.b3-text-field[data-name="alias"]') as HTMLInputElement).value = attrs.alias || "";
    const removeAttrs: string[] = [];
    dialog.element.addEventListener("click", (event) => {
        const target = event.target as HTMLElement;
        const actionElement = hasClosestByClassName(target, "block__icon");
        if (!actionElement) {
            return;
        }
        switch (actionElement.getAttribute("data-action")) {
            case "remove":
                if (actionElement.parentElement.firstElementChild.tagName === "SPAN") {
                    removeAttrs.push(actionElement.parentElement.querySelector("textarea").getAttribute("data-name"));
                }
                actionElement.parentElement.nextElementSibling.remove();
                actionElement.parentElement.remove();
                break;
            case "bookmark":
                fetchPost("/api/attr/getBookmarkLabels", {}, (response) => {
                    window.siyuan.menus.menu.remove();
                    if (response.data.length === 0) {
                        window.siyuan.menus.menu.append(new MenuItem({
                            label: window.siyuan.languages.emptyContent,
                            type: "readonly",
                        }).element);
                    } else {
                        response.data.forEach((item: string) => {
                            window.siyuan.menus.menu.append(new MenuItem({
                                label: item,
                                click() {
                                    actionElement.parentElement.querySelector("input").value = item;
                                }
                            }).element);
                        });
                    }
                    window.siyuan.menus.menu.element.classList.remove("fn__none");
                    setPosition(window.siyuan.menus.menu.element, event.clientX, event.clientY + 16);
                });
                break;
        }
    });
    const btnsElement = dialog.element.querySelectorAll(".b3-button");
    btnsElement[0].addEventListener("click", () => {
        btnsElement[0].insertAdjacentHTML("beforebegin", `<div class="fn__flex customItem">
    <input placeholder="${window.siyuan.languages.attrName}" class="b3-text-field" style="width: 100px;text-align: right">
    <div class="fn__space"></div>
    <textarea rows="1" class="b3-text-field fn__flex-1" placeholder="${window.siyuan.languages.attrValue1}"></textarea>
    <div class="fn__space"></div>
    <span data-action="remove" class="block__icon fn__flex-center" style="opacity: 1;"><svg><use xlink:href="#iconMin"></use></svg></span>
</div><div class="fn__hr--b"></div>`);
        const inputElements = dialog.element.querySelectorAll(".b3-text-field") as NodeListOf<HTMLInputElement>;
        inputElements[inputElements.length - 2].focus();
        bindAttrInput(inputElements[inputElements.length - 1], btnsElement[2]);
        bindAttrInput(inputElements[inputElements.length - 2], btnsElement[2]);
    });
    btnsElement[1].addEventListener("click", () => {
        dialog.destroy();
    });
    btnsElement[2].addEventListener("click", () => {
        let nodeAttrHTML = "";
        let errorTip = "";
        const attrsResult: IObject = {};
        dialog.element.querySelectorAll(".fn__flex-1").forEach((item: HTMLInputElement) => {
            const name = item.getAttribute("data-name") || ("custom-" + (item.previousElementSibling.previousElementSibling as HTMLInputElement).value);
            if (item.value.trim()) {
                if (!/^[0-9a-zA-Z\-]*$/.test(name.replace("custom-", "")) || name === "custom-") {
                    errorTip += name.replace("custom-", "") + ", ";
                    return;
                }
                attrsResult[name] = item.value;
                const escapeHTML = Lute.EscapeHTMLStr(item.value);
                if (name === "bookmark") {
                    nodeAttrHTML += `<div class="protyle-attr--bookmark">${escapeHTML}</div>`;
                } else if (name === "name") {
                    nodeAttrHTML += `<div class="protyle-attr--name"><svg><use xlink:href="#iconN"></use></svg>${escapeHTML}</div>`;
                } else if (name === "alias") {
                    nodeAttrHTML += `<div class="protyle-attr--alias"><svg><use xlink:href="#iconA"></use></svg>${escapeHTML}</div>`;
                } else if (name === "memo") {
                    nodeAttrHTML += `<div class="protyle-attr--memo b3-tooltips b3-tooltips__sw" aria-label="${escapeHTML}"><svg><use xlink:href="#iconM"></use></svg></div>`;
                }
            }
        });
        if (errorTip) {
            showMessage(errorTip.substr(0, errorTip.length - 2) + " " + window.siyuan.languages.invalid);
        }
        getAllModels().editor.forEach(item => {
            if (item.editor.protyle.block.rootID === id) {
                const refElement = item.editor.protyle.title.element.querySelector(".protyle-attr--refcount");
                if (refElement) {
                    nodeAttrHTML += refElement.outerHTML;
                }
                item.editor.protyle.title.element.querySelector(".protyle-attr").innerHTML = nodeAttrHTML;
                item.editor.protyle.wysiwyg.renderCustom(attrsResult);
            }
        });
        fetchPost("/api/attr/resetBlockAttrs", {id, attrs: attrsResult}, () => {
            if (attrsResult.bookmark !== attrs.bookmark) {
                const bookmark = getDockByType("bookmark").data.bookmark;
                if (bookmark instanceof Bookmark) {
                    bookmark.update();
                }
            }
        });
        dialog.destroy();
    });
    dialog.element.querySelectorAll(".b3-text-field").forEach((item: HTMLInputElement) => {
        if (focusName === item.getAttribute("data-name")) {
            item.focus();
        }
        bindAttrInput(item, btnsElement[2]);
    });
};

export const openAttr = (nodeElement: Element, protyle: IProtyle, focusName = "bookmark") => {
    if (nodeElement.getAttribute("data-type") === "NodeThematicBreak") {
        return;
    }
    const id = nodeElement.getAttribute("data-node-id");
    const range = getEditorRange(nodeElement);
    fetchPost("/api/attr/getBlockAttrs", {id}, (response) => {
        let customHTML = "";
        let notifyHTML = "";
        Object.keys(response.data).forEach(item => {
            if (item === "custom-reminder-wechat") {
                notifyHTML = `<label class="fn__flex customItem">
    <span class="ft__on-surface fn__flex-center fn__ellipsis" style="text-align: right;width: 100px">${window.siyuan.languages.wechatReminder}</span>
    <div class="fn__space"></div>
    <input class="b3-text-field fn__flex-1" type="datetime-local" readonly data-name="${item}" value="${dayjs(response.data[item]).format("YYYY-MM-DDTHH:mm")}">
    <div class="fn__space"></div>
    <span class="block__icon fn__flex-center" style="opacity: 1;"><svg></svg></span>
</label><div class="fn__hr--b"></div>`;
            } else if (item.indexOf("custom") > -1 && item !== "custom-reminder-wechat") {
                customHTML += `<label class="fn__flex customItem">
    <span class="ft__on-surface fn__flex-center fn__ellipsis" style="text-align: right;width: 100px" title="${item.replace("custom-", "")}">${item.replace("custom-", "")}</span>
    <div class="fn__space"></div>
    <textarea class="b3-text-field fn__flex-1" rows="1" data-name="${item}">${response.data[item]}</textarea>
    <div class="fn__space"></div>
    <span data-action="remove" class="block__icon fn__flex-center" style="opacity: 1;"><svg><use xlink:href="#iconMin"></use></svg></span>
</label><div class="fn__hr--b"></div>`;
            }
        });
        const dialog = new Dialog({
            width: isMobile() ? "80vw" : "50vw",
            title: window.siyuan.languages.attr,
            content: `<div class="b3-dialog__content custom-attr">
    <div class="fn__flex">
        <span class="ft__on-surface fn__flex-center" style="text-align: right;white-space: nowrap;width: 100px">${window.siyuan.languages.bookmark}</span>
        <div class="fn__space"></div>
        <input class="b3-text-field fn__flex-1" data-name="bookmark">
        <div class="fn__space"></div>
        <span data-action="bookmark" class="block__icon fn__flex-center" style="opacity: 1;"><svg><use xlink:href="#iconDown"></use></svg></span>
    </div>
    <div class="fn__hr--b"></div>
    <label class="fn__flex">
        <span class="ft__on-surface fn__flex-center" style="text-align: right;white-space: nowrap;width: 100px">${window.siyuan.languages.name}</span>
        <div class="fn__space"></div>
        <input class="b3-text-field fn__flex-1" data-name="name">
        <div class="fn__space"></div>
        <span class="block__icon fn__flex-center"><svg></svg></span>
    </label>
    <div class="fn__hr--b"></div>
    <label class="fn__flex">
        <span class="ft__on-surface fn__flex-center" style="text-align: right;white-space: nowrap;width: 100px">${window.siyuan.languages.alias}</span>
        <div class="fn__space"></div>
        <input class="b3-text-field fn__flex-1" data-name="alias">
        <div class="fn__space"></div>
        <span class="block__icon fn__flex-center"><svg></svg></span>
    </label>
    <div class="fn__hr--b"></div>
    <label class="fn__flex">
        <span class="ft__on-surface fn__flex-center" style="text-align: right;white-space: nowrap;width: 100px">${window.siyuan.languages.memo}</span>
        <div class="fn__space"></div>
        <textarea class="b3-text-field fn__flex-1" rows="2" data-name="memo">${response.data.memo || ""}</textarea>
        <div class="fn__space"></div>
        <span class="block__icon fn__flex-center"><svg></svg></span>
    </label>
    <div style="background-color: var(--b3-border-color);height: 1px;margin: 16px 0;"></div>
    <div class="custom-attr__add">
        ${notifyHTML}
        ${customHTML}
        <button class="b3-button b3-button--outline" style="width: 100px">
            <svg><use xlink:href="#iconAdd"></use></svg>
            ${window.siyuan.languages.addAttr}
        </button>
    </div>
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
            destroyCallback() {
                focusByRange(range);
            }
        });
        (dialog.element.querySelector('.b3-text-field[data-name="bookmark"]') as HTMLInputElement).value = response.data.bookmark || "";
        (dialog.element.querySelector('.b3-text-field[data-name="name"]') as HTMLInputElement).value = response.data.name || "";
        (dialog.element.querySelector('.b3-text-field[data-name="alias"]') as HTMLInputElement).value = response.data.alias || "";
        const removeAttrs: string[] = [];
        dialog.element.addEventListener("click", (event) => {
            const target = event.target as HTMLElement;
            const actionElement = hasClosestByClassName(target, "block__icon");
            if (!actionElement) {
                return;
            }
            switch (actionElement.getAttribute("data-action")) {
                case "remove":
                    if (actionElement.parentElement.firstElementChild.tagName === "SPAN") {
                        removeAttrs.push(actionElement.parentElement.querySelector("textarea").getAttribute("data-name"));
                    }
                    actionElement.parentElement.nextElementSibling.remove();
                    actionElement.parentElement.remove();
                    break;
                case "bookmark":
                    fetchPost("/api/attr/getBookmarkLabels", {}, (response) => {
                        window.siyuan.menus.menu.remove();
                        if (response.data.length === 0) {
                            window.siyuan.menus.menu.append(new MenuItem({
                                label: window.siyuan.languages.emptyContent,
                                type: "readonly",
                            }).element);
                        } else {
                            response.data.forEach((item: string) => {
                                window.siyuan.menus.menu.append(new MenuItem({
                                    label: item,
                                    click() {
                                        actionElement.parentElement.querySelector("input").value = item;
                                    }
                                }).element);
                            });
                        }
                        window.siyuan.menus.menu.element.classList.remove("fn__none");
                        setPosition(window.siyuan.menus.menu.element, event.clientX, event.clientY + 16);
                    });
                    break;
            }
        });
        const btnsElement = dialog.element.querySelectorAll(".b3-button");
        btnsElement[0].addEventListener("click", () => {
            btnsElement[0].insertAdjacentHTML("beforebegin", `<div class="fn__flex customItem">
    <input placeholder="${window.siyuan.languages.attrName}" class="b3-text-field" style="width: 100px;text-align: right">
    <div class="fn__space"></div>
    <textarea class="b3-text-field fn__flex-1" rows="1" placeholder="${window.siyuan.languages.attrValue1}"></textarea>
    <div class="fn__space"></div>
    <span data-action="remove" class="block__icon fn__flex-center" style="opacity: 1;"><svg><use xlink:href="#iconMin"></use></svg></span>
</div><div class="fn__hr--b"></div>`);
            const inputElements = dialog.element.querySelectorAll(".b3-text-field") as NodeListOf<HTMLInputElement>;
            inputElements[inputElements.length - 2].focus();
            bindAttrInput(inputElements[inputElements.length - 1], btnsElement[2]);
            bindAttrInput(inputElements[inputElements.length - 2], btnsElement[2]);
        });
        btnsElement[1].addEventListener("click", () => {
            dialog.destroy();
        });
        btnsElement[2].addEventListener("click", () => {
            let nodeAttrHTML = "";
            const oldHTML = nodeElement.outerHTML;
            let errorTip = "";
            dialog.element.querySelectorAll(".fn__flex-1").forEach((item: HTMLInputElement) => {
                const name = item.getAttribute("data-name") || ("custom-" + (item.previousElementSibling.previousElementSibling as HTMLInputElement).value);
                if (item.value.trim()) {
                    if (!/^[0-9a-zA-Z\-]*$/.test(name.replace("custom-", "")) || name === "custom-") {
                        errorTip += name.replace("custom-", "") + ", ";
                        return;
                    }
                    if (removeAttrs.includes(name)) {
                        removeAttrs.find((rmAttr, index) => {
                            if (rmAttr === name) {
                                removeAttrs.splice(index, 1);
                                return true;
                            }
                        });
                    }
                    const escapeHTML = Lute.EscapeHTMLStr(item.value);
                    nodeElement.setAttribute(name, escapeHTML);
                    if (name === "bookmark") {
                        if (escapeHTML !== response.data.bookmark && !isMobile()) {
                            const bookmark = getDockByType("bookmark").data.bookmark;
                            if (bookmark instanceof Bookmark) {
                                setTimeout(() => {
                                    bookmark.update();
                                }, 219);
                            }
                        }
                        nodeAttrHTML += `<div class="protyle-attr--bookmark">${escapeHTML}</div>`;
                    } else if (name === "name") {
                        nodeAttrHTML += `<div class="protyle-attr--name"><svg><use xlink:href="#iconN"></use></svg>${escapeHTML}</div>`;
                    } else if (name === "alias") {
                        nodeAttrHTML += `<div class="protyle-attr--alias"><svg><use xlink:href="#iconA"></use></svg>${escapeHTML}</div>`;
                    } else if (name === "memo") {
                        nodeAttrHTML += `<div class="protyle-attr--memo b3-tooltips b3-tooltips__sw" aria-label="${escapeHTML}"><svg><use xlink:href="#iconM"></use></svg></div>`;
                    }
                } else {
                    nodeElement.removeAttribute(name);
                }
            });
            removeAttrs.forEach(item => {
                nodeElement.removeAttribute(item);
            });
            if (errorTip) {
                showMessage(errorTip.substr(0, errorTip.length - 2) + " " + window.siyuan.languages.invalid);
            }
            const refElement = nodeElement.lastElementChild.querySelector(".protyle-attr--refcount");
            if (refElement) {
                nodeAttrHTML += refElement.outerHTML;
            }
            nodeElement.lastElementChild.innerHTML = nodeAttrHTML + Constants.ZWSP;
            updateTransaction(protyle, id, nodeElement.outerHTML, oldHTML);
            dialog.destroy();
        });
        dialog.element.querySelectorAll(".b3-text-field").forEach((item: HTMLInputElement) => {
            if (focusName === item.getAttribute("data-name")) {
                item.focus();
            }
            bindAttrInput(item, btnsElement[2]);
        });
    });
};

export const copySubMenu = (id: string, name: string, accelerator = true, focusElement?: Element) => {
    return [
        {
            icon: "iconGraph",
            accelerator: accelerator ? window.siyuan.config.keymap.editor.general.copyBlockRef.custom : undefined,
            label: window.siyuan.languages.copyBlockRef,
            click: () => {
                if (name) {
                    writeText(`((${id} "${name}"))`);
                } else {
                    fetchPost("/api/block/getRefText", {id}, (response) => {
                        writeText(`((${id} '${response.data}'))`);
                    });
                }
                if (focusElement) {
                    focusBlock(focusElement);
                }
            }
        }, {
            icon: "iconSQL",
            label: window.siyuan.languages.copyBlockEmbed,
            accelerator: accelerator ? window.siyuan.config.keymap.editor.general.copyBlockEmbed.custom : undefined,
            click: () => {
                writeText(`{{select * from blocks where id='${id}'}}`);
                if (focusElement) {
                    focusBlock(focusElement);
                }
            }
        }, {
            icon: "iconSiYuan",
            label: window.siyuan.languages.copyProtocol,
            accelerator: accelerator ? window.siyuan.config.keymap.editor.general.copyProtocol.custom : undefined,
            click: () => {
                writeText(`siyuan://blocks/${id}`);
                if (focusElement) {
                    focusBlock(focusElement);
                }
            }
        }, {
            label: window.siyuan.languages.copyHPath,
            accelerator: accelerator ? window.siyuan.config.keymap.editor.general.copyHPath.custom : undefined,
            click: () => {
                fetchPost("/api/filetree/getHPathByID", {
                    id
                }, (response) => {
                    writeText(response.data);
                });
            }
        }, {
            label: window.siyuan.languages.copy + " ID",
            click: () => {
                writeText(id);
                if (focusElement) {
                    focusBlock(focusElement);
                }
            }
        }
    ];
};

export const exportMd = (id: string) => {
    return new MenuItem({
        label: window.siyuan.languages.export,
        type: "submenu",
        icon: "iconUpload",
        submenu: [
            {
                label: window.siyuan.languages.template,
                icon: "iconMarkdown",
                click: () => {
                    fetchPost("/api/template/docSaveAsTemplate", {
                        id,
                        overwrite: false
                    }, response => {
                        if (response.code === 1) {
                            // 重名
                            confirmDialog(window.siyuan.languages.export, window.siyuan.languages.exportTplTip, () => {
                                fetchPost("/api/template/docSaveAsTemplate", {
                                    id,
                                    overwrite: true
                                });
                            });
                            return;
                        }
                        showMessage(window.siyuan.languages.exportTplSucc);
                    });
                }
            },
            {
                label: "Markdown",
                icon: "iconMarkdown",
                click: () => {
                    showMessage(window.siyuan.languages.exporting, -1);
                    fetchPost("/api/export/exportMd", {
                        id,
                    }, response => {
                        hideMessage();
                        if (window.siyuan.config.system.container === "ios") {
                            window.location.href = response.data.zip;
                        } else if (window.siyuan.config.system.container === "android" && window.JSAndroid) {
                            window.JSAndroid.openExternal(response.data.zip);
                        } else {
                            window.open(response.data.zip);
                        }
                    });
                }
            },
            {
                label: "SiYuan .sy.zip",
                icon: "iconSiYuan",
                click: () => {
                    showMessage(window.siyuan.languages.exporting, -1);
                    fetchPost("/api/export/exportSY", {
                        id,
                    }, response => {
                        hideMessage();
                        if (window.siyuan.config.system.container === "ios") {
                            window.location.href = response.data.zip;
                        } else if (window.siyuan.config.system.container === "android" && window.JSAndroid) {
                            window.JSAndroid.openExternal(response.data.zip);
                        } else {
                            window.open(response.data.zip);
                        }
                    });
                }
            },
            /// #if !BROWSER
            {
                label: "PDF",
                icon: "iconPDF",
                click: () => {
                    saveExport({type: "pdf", id});
                }
            }, {
                label: "HTML (SiYuan)",
                icon: "iconHTML5",
                click: () => {
                    saveExport({type: "html", id});
                }
            }, {
                label: "HTML (Markdown)",
                icon: "iconHTML5",
                click: () => {
                    saveExport({type: "htmlmd", id});
                }
            }, {
                label: "Word .docx",
                icon: "iconExact",
                click: () => {
                    saveExport({type: "word", id});
                }
            }
            /// #endif
        ]
    }).element;
};

export const openMenu = (src: string, onlyMenu = false) => {
    const submenu = [];
    if (isLocalPath(src)) {
        submenu.push({
            label: window.siyuan.languages.insertRight,
            accelerator: "Click",
            click() {
                openAsset(src.trim(), parseInt(getSearch("page", src)), "right");
            }
        });
        /// #if !BROWSER
        submenu.push({
            label: window.siyuan.languages.useDefault,
            accelerator: "⇧Click",
            click() {
                openBy(src, "app");
            }
        });
        submenu.push({
            label: window.siyuan.languages.showInFolder,
            accelerator: "⌘Click",
            click: () => {
                openBy(src, "folder");
            }
        });
        /// #endif
    } else {
        submenu.push({
            label: window.siyuan.languages.useBrowserView,
            accelerator: "Click",
            click: () => {
                /// #if !BROWSER
                shell.openExternal(src).catch((e) => {
                    console.log("openExternal error:" + e);
                });
                /// #else
                if (window.siyuan.config.system.container === "ios") {
                    window.location.href = src;
                } else {
                    window.open(src);
                }
                /// #endif
            }
        });
    }
    if (onlyMenu) {
        return submenu;
    }
    window.siyuan.menus.menu.append(new MenuItem({
        label: window.siyuan.languages.openBy,
        submenu
    }).element);
};

export const newFileMenu = (notebookId?: string, path?: string, open?: boolean) => {
    return new MenuItem({
        icon: "iconFile",
        label: window.siyuan.languages.newFile,
        click: () => {
            newFile(notebookId, path, open);
        }
    }).element;
};

export const deleteMenu = (notebookId: string, name: string, pathString: string) => {
    return new MenuItem({
        icon: "iconTrashcan",
        label: window.siyuan.languages.delete,
        accelerator: "⌦",
        click: () => {
            fetchPost("/api/block/getDocInfo", {
                id: getDisplayName(pathString, true, true)
            }, (response) => {
                let tip = `${window.siyuan.languages.confirmDelete} <b>${name}</b>?`;
                if (response.data.subFileCount > 0) {
                    tip = `${window.siyuan.languages.confirmDelete} <b>${name}</b> ${window.siyuan.languages.andSubFile.replace("x", response.data.subFileCount)}?`;
                }
                confirmDialog(window.siyuan.languages.delete, tip, () => {
                    fetchPost("/api/filetree/removeDoc", {
                        notebook: notebookId,
                        path: pathString
                    });
                });
            });
        }
    }).element;
};

export const renameMenu = (options: {
    path: string
    notebookId: string
    name: string,
    type: "notebook" | "file"
}) => {
    return new MenuItem({
        accelerator: window.siyuan.config.keymap.editor.general.rename.custom,
        label: window.siyuan.languages.rename,
        click: () => {
            rename(options);
        }
    }).element;
};

export const movePathToMenu = (notebookId: string, path: string) => {
    return new MenuItem({
        label: window.siyuan.languages.move,
        icon: "iconMove",
        accelerator: window.siyuan.config.keymap.general.move.custom,
        click() {
            movePathTo(notebookId, path);
        }
    }).element;
};
