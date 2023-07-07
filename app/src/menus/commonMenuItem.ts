/// #if !BROWSER
import {shell} from "electron";
/// #endif
import {getDockByType} from "../layout/util";
import {confirmDialog} from "../dialog/confirmDialog";
import {getSearch, isMobile, isValidAttrName} from "../util/functions";
import {isLocalPath, movePathTo, moveToPath, pathPosix} from "../util/pathName";
import {MenuItem} from "./Menu";
import {hasClosestByClassName} from "../protyle/util/hasClosest";
import {saveExport} from "../protyle/export";
import {openByMobile, writeText} from "../protyle/util/compatibility";
import {fetchPost, fetchSyncPost} from "../util/fetch";
import {hideMessage, showMessage} from "../dialog/message";
import {Dialog} from "../dialog";
import {focusBlock, focusByRange, getEditorRange} from "../protyle/util/selection";
import {updateTransaction} from "../protyle/wysiwyg/transaction";
/// #if !MOBILE
import {getAllModels} from "../layout/getAll";
import {Bookmark} from "../layout/dock/Bookmark";
import {openAsset, openBy} from "../editor/util";
/// #endif
import {rename, replaceFileName} from "../editor/rename";
import {matchHotKey} from "../protyle/util/hotKey";
import * as dayjs from "dayjs";
import {Constants} from "../constants";
import {exportImage} from "../protyle/export/util";
import {App} from "../index";

const bindAttrInput = (inputElement: HTMLInputElement, confirmElement: Element) => {
    inputElement.addEventListener("keydown", (event) => {
        if (event.isComposing) {
            return;
        }
        if (matchHotKey("⌘↩", event)) {
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
        width: isMobile() ? "92vw" : "50vw",
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
            width: isMobile() ? "92vw" : "50vw",
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

const genAttr = (attrs: IObject, focusName = "bookmark", cb: (dialog: Dialog, rms: string[]) => void) => {
    let customHTML = "";
    let notifyHTML = "";
    const range = getSelection().rangeCount > 0 ? getSelection().getRangeAt(0) : null;
    Object.keys(attrs).forEach(item => {
        if ("custom-riff-decks" === item) {
            return;
        }
        if (item === "custom-reminder-wechat") {
            notifyHTML = `<label class="b3-label b3-label--noborder">
    ${window.siyuan.languages.wechatReminder}
    <div class="fn__hr"></div>
    <input class="b3-text-field fn__block" type="datetime-local" readonly data-name="${item}" value="${dayjs(attrs[item]).format("YYYY-MM-DDTHH:mm")}">
</label>`;
        } else if (item.indexOf("custom") > -1) {
            customHTML += `<label class="b3-label b3-label--noborder">
     <div class="fn__flex">
        <span class="fn__flex-1">${item.replace("custom-", "")}</span>
        <span data-action="remove" class="block__icon block__icon--show"><svg><use xlink:href="#iconMin"></use></svg></span>
    </div>
    <div class="fn__hr"></div>
    <textarea class="b3-text-field fn__block" rows="1" data-name="${item}">${attrs[item]}</textarea>
</label>`;
        }
    });
    const dialog = new Dialog({
        width: isMobile() ? "92vw" : "50vw",
        title: window.siyuan.languages.attr,
        content: `<div class="custom-attr" style="max-height: calc(100vh - 166px);overflow: auto;">
    <label class="b3-label b3-label--noborder">
        <div class="fn__flex">
            <span class="fn__flex-1">${window.siyuan.languages.bookmark}</span>
            <span data-action="bookmark" class="block__icon block__icon--show"><svg><use xlink:href="#iconDown"></use></svg></span>
        </div>
        <div class="fn__hr"></div>
        <input class="b3-text-field fn__block" placeholder="${window.siyuan.languages.attrBookmarkTip}" data-name="bookmark">
    </label>
    <label class="b3-label b3-label--noborder">
        ${window.siyuan.languages.name}
        <div class="fn__hr"></div>
        <input class="b3-text-field fn__block" placeholder="${window.siyuan.languages.attrNameTip}" data-name="name">
    </label>
    <label class="b3-label b3-label--noborder">
        ${window.siyuan.languages.alias}
        <div class="fn__hr"></div>
        <input class="b3-text-field fn__block" placeholder="${window.siyuan.languages.attrAliasTip}" data-name="alias">
    </label>
    <label class="b3-label b3-label--noborder">
        ${window.siyuan.languages.memo}
        <div class="fn__hr"></div>
        <textarea class="b3-text-field fn__block" placeholder="${window.siyuan.languages.attrMemoTip}" rows="2" data-name="memo">${attrs.memo || ""}</textarea>
    </label>
    ${notifyHTML}
    ${customHTML}
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--outline">
        <svg><use xlink:href="#iconAdd"></use></svg>${window.siyuan.languages.addAttr}
    </button><div class="fn__space"></div>
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        destroyCallback() {
            focusByRange(range);
        }
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
                if (actionElement.previousElementSibling.tagName === "SPAN") {
                    removeAttrs.push(actionElement.parentElement.parentElement.querySelector("textarea").getAttribute("data-name"));
                }
                actionElement.parentElement.parentElement.remove();
                break;
            case "bookmark":
                fetchPost("/api/attr/getBookmarkLabels", {}, (response) => {
                    window.siyuan.menus.menu.remove();
                    if (response.data.length === 0) {
                        window.siyuan.menus.menu.append(new MenuItem({
                            iconHTML: Constants.ZWSP,
                            label: window.siyuan.languages.emptyContent,
                            type: "readonly",
                        }).element);
                    } else {
                        response.data.forEach((item: string) => {
                            window.siyuan.menus.menu.append(new MenuItem({
                                label: item,
                                click() {
                                    actionElement.parentElement.parentElement.querySelector("input").value = item;
                                }
                            }).element);
                        });
                    }
                    window.siyuan.menus.menu.element.style.zIndex = "310";
                    window.siyuan.menus.menu.element.classList.add("b3-menu--list");
                    window.siyuan.menus.menu.popup({x: event.clientX, y: event.clientY + 16, w: 16});
                });
                break;
        }
    });
    const btnsElement = dialog.element.querySelectorAll(".b3-button");
    btnsElement[0].addEventListener("click", () => {
        dialog.element.querySelector(".custom-attr").insertAdjacentHTML("beforeend", `<div class="b3-label b3-label--noborder">
    <div class="fn__flex">
        <input placeholder="${window.siyuan.languages.attrName}" class="b3-text-field">
        <span class="fn__flex-1"></span>
        <span data-action="remove" class="block__icon block__icon--show"><svg><use xlink:href="#iconMin"></use></svg></span>
    </div>
    <div class="fn__hr"></div>
    <textarea class="b3-text-field fn__block" rows="1" placeholder="${window.siyuan.languages.attrValue1}"></textarea>
</div>`);
        const inputElements = dialog.element.querySelectorAll(".b3-text-field") as NodeListOf<HTMLInputElement>;
        inputElements[inputElements.length - 2].focus();
        bindAttrInput(inputElements[inputElements.length - 1], btnsElement[2]);
        bindAttrInput(inputElements[inputElements.length - 2], btnsElement[2]);
    });
    btnsElement[1].addEventListener("click", () => {
        dialog.destroy();
    });
    btnsElement[2].addEventListener("click", () => {
        cb(dialog, removeAttrs);
    });
    dialog.element.querySelectorAll(".b3-text-field").forEach((item: HTMLInputElement) => {
        if (focusName === item.getAttribute("data-name")) {
            item.focus();
        }
        bindAttrInput(item, btnsElement[2]);
    });
};

export const openFileAttr = (attrs: IObject, id: string, focusName = "bookmark") => {
    genAttr(attrs, focusName, (dialog) => {
        let nodeAttrHTML = "";
        let errorTip = "";
        const attrsResult: IObject = {};
        dialog.element.querySelectorAll(".b3-text-field").forEach((item: HTMLInputElement) => {
            let name = item.getAttribute("data-name");
            if (!name) {
                if (item.tagName === "INPUT") {
                    return;
                }
                name = "custom-" + (item.parentElement.querySelector(".b3-text-field") as HTMLInputElement).value;
            }
            if (item.value.trim()) {
                if (!isValidAttrName(name)) {
                    errorTip += name.replace(/^custom-/, "") + ", ";
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
        /// #if !MOBILE
        getAllModels().editor.forEach(item => {
            if (item.editor.protyle.block.rootID === id) {
                const refElement = item.editor.protyle.title.element.querySelector(".protyle-attr--refcount");
                if (refElement) {
                    nodeAttrHTML += refElement.outerHTML;
                }
                item.editor.protyle.title.element.querySelector(".protyle-attr").innerHTML = nodeAttrHTML;
                item.editor.protyle.wysiwyg.renderCustom(attrsResult);
            }
            // https://github.com/siyuan-note/siyuan/issues/6398
            item.editor.protyle.wysiwyg.element.querySelectorAll(`[data-type~="block-ref"][data-id="${id}"][data-subtype="d"]`).forEach(item => {
                fetchPost("/api/block/getRefText", {id: id}, (response) => {
                    item.innerHTML = response.data;
                });
            });
        });
        /// #endif
        fetchPost("/api/attr/resetBlockAttrs", {id, attrs: attrsResult}, () => {
            /// #if !MOBILE
            if (attrsResult.bookmark !== attrs.bookmark) {
                const bookmark = getDockByType("bookmark").data.bookmark;
                if (bookmark instanceof Bookmark) {
                    bookmark.update();
                }
            }
            /// #endif
        });
        dialog.destroy();
    });
};

export const openAttr = (nodeElement: Element, protyle: IProtyle, focusName = "bookmark") => {
    if (nodeElement.getAttribute("data-type") === "NodeThematicBreak") {
        return;
    }
    const id = nodeElement.getAttribute("data-node-id");
    fetchPost("/api/attr/getBlockAttrs", {id}, (response) => {
        genAttr(response.data, focusName, (dialog, removeAttrs) => {
            let nodeAttrHTML = "";
            const oldHTML = nodeElement.outerHTML;
            let errorTip = "";
            dialog.element.querySelectorAll(".b3-text-field").forEach((item: HTMLInputElement) => {
                let name = item.getAttribute("data-name");
                if (!name) {
                    if (item.tagName === "INPUT") {
                        return;
                    }
                    name = "custom-" + (item.parentElement.querySelector(".b3-text-field") as HTMLInputElement).value;
                }
                if (item.value.trim()) {
                    if (!isValidAttrName(name)) {
                        errorTip += name.replace(/^custom-/, "") + ", ";
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
                        /// #if !MOBILE
                        if (escapeHTML !== response.data.bookmark) {
                            const bookmark = getDockByType("bookmark").data.bookmark;
                            if (bookmark instanceof Bookmark) {
                                setTimeout(() => {
                                    bookmark.update();
                                }, 219);
                            }
                        }
                        /// #endif
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
            nodeElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
            updateTransaction(protyle, id, nodeElement.outerHTML, oldHTML);
            dialog.destroy();
        });
    });
};

export const copySubMenu = (id: string, accelerator = true, focusElement?: Element) => {
    return [{
        icon: "iconRef",
        accelerator: accelerator ? window.siyuan.config.keymap.editor.general.copyBlockRef.custom : undefined,
        label: window.siyuan.languages.copyBlockRef,
        click: () => {
            fetchPost("/api/block/getRefText", {id}, (response) => {
                writeText(`((${id} '${response.data}'))`);
            });
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
        label: window.siyuan.languages.copyProtocolInMd,
        click: () => {
            fetchPost("/api/block/getRefText", {id}, (response) => {
                writeText(`[${response.data}](siyuan://blocks/${id})`);
            });
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
        label: window.siyuan.languages.copyID,
        accelerator: accelerator ? window.siyuan.config.keymap.editor.general.copyID.custom : undefined,
        click: () => {
            writeText(id);
            if (focusElement) {
                focusBlock(focusElement);
            }
        }
    }];
};

export const exportMd = (id: string) => {
    return new MenuItem({
        label: window.siyuan.languages.export,
        type: "submenu",
        icon: "iconUpload",
        submenu: [{
            label: window.siyuan.languages.template,
            icon: "iconMarkdown",
            click: async () => {
                const result = await fetchSyncPost("/api/block/getRefText", {id: id});

                const dialog = new Dialog({
                    title: window.siyuan.languages.fileName,
                    content: `<div class="b3-dialog__content"><input class="b3-text-field fn__block" value=""></div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
                    width: isMobile() ? "92vw" : "520px",
                });
                const inputElement = dialog.element.querySelector("input") as HTMLInputElement;
                const btnsElement = dialog.element.querySelectorAll(".b3-button");
                dialog.bindInput(inputElement, () => {
                    (btnsElement[1] as HTMLButtonElement).click();
                });
                let name = replaceFileName(result.data);
                const maxNameLen = 32;
                if (name.length > maxNameLen) {
                    name = name.substring(0, maxNameLen);
                }
                inputElement.value = name;
                inputElement.focus();
                inputElement.select();
                btnsElement[0].addEventListener("click", () => {
                    dialog.destroy();
                });
                btnsElement[1].addEventListener("click", () => {
                    if (inputElement.value.trim() === "") {
                        inputElement.value = "Untitled";
                    } else {
                        inputElement.value = replaceFileName(inputElement.value);
                    }

                    if (name.length > maxNameLen) {
                        name = name.substring(0, maxNameLen);
                    }

                    fetchPost("/api/template/docSaveAsTemplate", {
                        id,
                        name,
                        overwrite: false
                    }, response => {
                        if (response.code === 1) {
                            // 重名
                            confirmDialog(window.siyuan.languages.export, window.siyuan.languages.exportTplTip, () => {
                                fetchPost("/api/template/docSaveAsTemplate", {
                                    id,
                                    name,
                                    overwrite: true
                                }, resp => {
                                    if (resp.code === 0) {
                                        showMessage(window.siyuan.languages.exportTplSucc);
                                    }
                                });
                            });
                            return;
                        }
                        showMessage(window.siyuan.languages.exportTplSucc);
                    });

                    dialog.destroy();
                });
            }
        }, {
            label: "Markdown",
            icon: "iconMarkdown",
            click: () => {
                const msgId = showMessage(window.siyuan.languages.exporting, -1);
                fetchPost("/api/export/exportMd", {
                    id,
                }, response => {
                    hideMessage(msgId);
                    openByMobile(response.data.zip);
                });
            }
        }, {
            label: "SiYuan .sy.zip",
            icon: "iconSiYuan",
            click: () => {
                const msgId = showMessage(window.siyuan.languages.exporting, -1);
                fetchPost("/api/export/exportSY", {
                    id,
                }, response => {
                    hideMessage(msgId);
                    openByMobile(response.data.zip);
                });
            }
        }, {
            label: window.siyuan.languages.image,
            icon: "iconImage",
            click: () => {
                exportImage(id);
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
            }, {
                label: window.siyuan.languages.more,
                icon: "iconMore",
                type: "submenu",
                submenu: [{
                    label: "reStructuredText",
                    click: () => {
                        const msgId = showMessage(window.siyuan.languages.exporting, -1);
                        fetchPost("/api/export/exportReStructuredText", {
                            id,
                        }, response => {
                            hideMessage(msgId);
                            openByMobile(response.data.zip);
                        });
                    }
                }, {
                    label: "AsciiDoc",
                    click: () => {
                        const msgId = showMessage(window.siyuan.languages.exporting, -1);
                        fetchPost("/api/export/exportAsciiDoc", {
                            id,
                        }, response => {
                            hideMessage(msgId);
                            openByMobile(response.data.zip);
                        });
                    }
                }, {
                    label: "Textile",
                    click: () => {
                        const msgId = showMessage(window.siyuan.languages.exporting, -1);
                        fetchPost("/api/export/exportTextile", {
                            id,
                        }, response => {
                            hideMessage(msgId);
                            openByMobile(response.data.zip);
                        });
                    }
                }, {
                    label: "OPML",
                    click: () => {
                        const msgId = showMessage(window.siyuan.languages.exporting, -1);
                        fetchPost("/api/export/exportOPML", {
                            id,
                        }, response => {
                            hideMessage(msgId);
                            openByMobile(response.data.zip);
                        });
                    }
                }, {
                    label: "Org-Mode",
                    click: () => {
                        const msgId = showMessage(window.siyuan.languages.exporting, -1);
                        fetchPost("/api/export/exportOrgMode", {
                            id,
                        }, response => {
                            hideMessage(msgId);
                            openByMobile(response.data.zip);
                        });
                    }
                }, {
                    label: "MediaWiki",
                    click: () => {
                        const msgId = showMessage(window.siyuan.languages.exporting, -1);
                        fetchPost("/api/export/exportMediaWiki", {
                            id,
                        }, response => {
                            hideMessage(msgId);
                            openByMobile(response.data.zip);
                        });
                    }
                }, {
                    label: "ODT",
                    click: () => {
                        const msgId = showMessage(window.siyuan.languages.exporting, -1);
                        fetchPost("/api/export/exportODT", {
                            id,
                        }, response => {
                            hideMessage(msgId);
                            openByMobile(response.data.zip);
                        });
                    }
                }, {
                    label: "RTF",
                    click: () => {
                        const msgId = showMessage(window.siyuan.languages.exporting, -1);
                        fetchPost("/api/export/exportRTF", {
                            id,
                        }, response => {
                            hideMessage(msgId);
                            openByMobile(response.data.zip);
                        });
                    }
                }, {
                    label: "EPUB",
                    click: () => {
                        const msgId = showMessage(window.siyuan.languages.exporting, -1);
                        fetchPost("/api/export/exportEPUB", {
                            id,
                        }, response => {
                            hideMessage(msgId);
                            openByMobile(response.data.zip);
                        });
                    }
                },
                ]
            }
            /// #endif
        ]
    }).element;
};

export const openMenu = (app: App, src: string, onlyMenu: boolean, showAccelerator: boolean) => {
    const submenu = [];
    if (isLocalPath(src)) {
        if (Constants.SIYUAN_ASSETS_EXTS.includes(pathPosix().extname(src)) &&
            (!src.endsWith(".pdf") ||
                (src.endsWith(".pdf") && !src.startsWith("file://")))
        ) {
            /// #if !MOBILE
            submenu.push({
                icon: "iconLayoutRight",
                label: window.siyuan.languages.insertRight,
                accelerator: showAccelerator ? "Click" : "",
                click() {
                    openAsset(app, src.trim(), parseInt(getSearch("page", src)), "right");
                }
            });
            /// #endif
            /// #if !BROWSER
            submenu.push({
                label: window.siyuan.languages.useDefault,
                accelerator: showAccelerator ? "⇧Click" : "",
                click() {
                    openBy(src, "app");
                }
            });
            /// #endif
        } else {
            /// #if !BROWSER
            submenu.push({
                label: window.siyuan.languages.useDefault,
                accelerator: showAccelerator ? "Click" : "",
                click() {
                    openBy(src, "app");
                }
            });
            /// #endif
        }
        /// #if !BROWSER
        submenu.push({
            icon: "iconFolder",
            label: window.siyuan.languages.showInFolder,
            accelerator: showAccelerator ? "⌘Click" : "",
            click: () => {
                openBy(src, "folder");
            }
        });
        /// #endif
    } else {
        /// #if !BROWSER
        submenu.push({
            label: window.siyuan.languages.useDefault,
            accelerator: showAccelerator ? "Click" : "",
            click: () => {
                shell.openExternal(src).catch((e) => {
                    showMessage(e);
                });
            }
        });
        /// #endif
    }
    /// #if BROWSER
    submenu.push({
        label: window.siyuan.languages.useBrowserView,
        accelerator: showAccelerator ? "Click" : "",
        click: () => {
            openByMobile(src);
        }
    });
    /// #endif
    if (onlyMenu) {
        return submenu;
    }
    window.siyuan.menus.menu.append(new MenuItem({
        label: window.siyuan.languages.openBy,
        submenu
    }).element);
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

export const movePathToMenu = (paths: string[]) => {
    return new MenuItem({
        label: window.siyuan.languages.move,
        icon: "iconMove",
        accelerator: window.siyuan.config.keymap.general.move.custom,
        click() {
            movePathTo((toPath, toNotebook) => {
                moveToPath(paths, toNotebook[0], toPath[0]);
            }, paths);
        }
    }).element;
};
