/// #if !BROWSER
import {shell} from "electron";
/// #endif
import {confirmDialog} from "../dialog/confirmDialog";
import {getSearch, isMobile, isValidAttrName} from "../util/functions";
import {isLocalPath, movePathTo, moveToPath, pathPosix} from "../util/pathName";
import {MenuItem} from "./Menu";
import {saveExport} from "../protyle/export";
import {openByMobile, writeText} from "../protyle/util/compatibility";
import {fetchPost, fetchSyncPost} from "../util/fetch";
import {hideMessage, showMessage} from "../dialog/message";
import {Dialog} from "../dialog";
import {focusBlock, focusByRange, getEditorRange} from "../protyle/util/selection";
/// #if !MOBILE
import {openAsset, openBy} from "../editor/util";
/// #endif
import {rename, replaceFileName} from "../editor/rename";
import * as dayjs from "dayjs";
import {Constants} from "../constants";
import {exportImage} from "../protyle/export/util";
import {App} from "../index";
import {renderAVAttribute} from "../protyle/render/av/render";

const bindAttrInput = (inputElement: HTMLInputElement, id: string) => {
    inputElement.addEventListener("change", () => {
        fetchPost("/api/attr/setBlockAttrs", {
            id,
            attrs: {[inputElement.dataset.name]: inputElement.value}
        });
    });
};

export const openWechatNotify = (nodeElement: Element) => {
    const id = nodeElement.getAttribute("data-node-id");
    const range = getEditorRange(nodeElement);
    const reminder = nodeElement.getAttribute(Constants.CUSTOM_REMINDER_WECHAT);
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
            nodeElement.removeAttribute(Constants.CUSTOM_REMINDER_WECHAT);
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
                nodeElement.setAttribute(Constants.CUSTOM_REMINDER_WECHAT, timed);
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
        const reminder = response.data.ial[Constants.CUSTOM_REMINDER_WECHAT];
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

export const openFileAttr = (attrs: IObject, focusName = "bookmark") => {
    let customHTML = "";
    let notifyHTML = "";
    let hasAV = false;
    const range = getSelection().rangeCount > 0 ? getSelection().getRangeAt(0) : null;
    Object.keys(attrs).forEach(item => {
        if (Constants.CUSTOM_RIFF_DECKS === item || item.startsWith("custom-sy-")) {
            return;
        }
        if (item === Constants.CUSTOM_REMINDER_WECHAT) {
            notifyHTML = `<label class="b3-label b3-label--noborder">
    ${window.siyuan.languages.wechatReminder}
    <div class="fn__hr"></div>
    <input class="b3-text-field fn__block" type="datetime-local" readonly data-name="${item}" value="${dayjs(attrs[item]).format("YYYY-MM-DDTHH:mm")}">
</label>`;
        } else if (item.indexOf("custom-av") > -1) {
            hasAV = true;
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
        height: "80vh",
        content: `<div class="fn__flex-column">
    <div class="layout-tab-bar fn__flex" style="flex-shrink:0;border-radius: var(--b3-border-radius-b) var(--b3-border-radius-b) 0 0">
        <div class="item item--full item--focus" data-type="attr">
            <span class="fn__flex-1"></span>
            <span class="item__text">${window.siyuan.languages.builtIn}</span>
            <span class="fn__flex-1"></span>
        </div>
        <div class="item item--full${hasAV ? "" : " fn__none"}" data-type="av">
            <span class="fn__flex-1"></span>
            <span class="item__text">${window.siyuan.languages.database}</span>
            <span class="fn__flex-1"></span>
        </div>
        <div class="item item--full" data-type="custom">
            <span class="fn__flex-1"></span>
            <span class="item__text">${window.siyuan.languages.custom}</span>
            <span class="fn__flex-1"></span>
        </div>
    </div>
    <div class="fn__flex-1">
        <div class="custom-attr" data-type="attr">
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
        </div>
        <div data-type="av" class="fn__none custom-attr"></div>
        <div data-type="custom" class="fn__none custom-attr">
           ${customHTML}
           <div class="b3-label">
               <button data-action="addCustom" class="b3-button b3-button--outline">
                   <svg><use xlink:href="#iconAdd"></use></svg>${window.siyuan.languages.addAttr}
               </button>
           </div>
        </div>
    </div>
</div>`,
        destroyCallback() {
            focusByRange(range);
        }
    });
    (dialog.element.querySelector('.b3-text-field[data-name="bookmark"]') as HTMLInputElement).value = attrs.bookmark || "";
    (dialog.element.querySelector('.b3-text-field[data-name="name"]') as HTMLInputElement).value = attrs.name || "";
    (dialog.element.querySelector('.b3-text-field[data-name="alias"]') as HTMLInputElement).value = attrs.alias || "";
    dialog.element.addEventListener("click", (event) => {
        let target = event.target as HTMLElement;
        while (!target.isSameNode(dialog.element)) {
            const type = target.dataset.action;
            if (target.classList.contains("item--full")) {
                target.parentElement.querySelector(".item--focus").classList.remove("item--focus");
                target.classList.add("item--focus");
                dialog.element.querySelectorAll(".custom-attr").forEach((item: HTMLElement) => {
                    if (item.dataset.type === target.dataset.type) {
                        if (item.dataset.type === "av" && item.innerHTML === "") {
                            renderAVAttribute(item, attrs.id);
                        }
                        item.classList.remove("fn__none");
                    } else {
                        item.classList.add("fn__none");
                    }
                });
            } else if (type === "remove") {
                fetchPost("/api/attr/setBlockAttrs", {
                    id: attrs.id,
                    attrs: {["custom-" + target.previousElementSibling.textContent]: ""}
                });
                target.parentElement.parentElement.remove();
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "bookmark") {
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
                                    const bookmarkInputElement = target.parentElement.parentElement.querySelector("input");
                                    bookmarkInputElement.value = item;
                                    bookmarkInputElement.dispatchEvent(new CustomEvent("change"));
                                }
                            }).element);
                        });
                    }
                    window.siyuan.menus.menu.element.classList.add("b3-menu--list");
                    window.siyuan.menus.menu.popup({x: event.clientX, y: event.clientY + 16, w: 16});
                });
                event.stopPropagation();
                event.preventDefault();
                break;
            } else if (type === "addCustom") {
                const addDialog = new Dialog({
                    title: window.siyuan.languages.attrName,
                    content: `<div class="b3-dialog__content"><input class="b3-text-field fn__block" value=""></div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
                    width: isMobile() ? "92vw" : "520px",
                });
                const inputElement = addDialog.element.querySelector("input") as HTMLInputElement;
                const btnsElement = addDialog.element.querySelectorAll(".b3-button");
                dialog.bindInput(inputElement, () => {
                    (btnsElement[1] as HTMLButtonElement).click();
                });
                inputElement.focus();
                inputElement.select();
                btnsElement[0].addEventListener("click", () => {
                    addDialog.destroy();
                });
                btnsElement[1].addEventListener("click", () => {
                    if (!isValidAttrName(inputElement.value)) {
                        showMessage(window.siyuan.languages.attrName + " <b>" + inputElement.value + "</b> " + window.siyuan.languages.invalid);
                        return false;
                    }
                    target.parentElement.insertAdjacentHTML("beforebegin", `<div class="b3-label b3-label--noborder">
    <div class="fn__flex">
        <span class="fn__flex-1">${inputElement.value}</span>
        <span data-action="remove" class="block__icon block__icon--show"><svg><use xlink:href="#iconMin"></use></svg></span>
    </div>
    <div class="fn__hr"></div>
    <textarea data-name="custom-${inputElement.value}" class="b3-text-field fn__block" rows="1" placeholder="${window.siyuan.languages.attrValue1}"></textarea>
</div>`);
                    const valueElement = target.parentElement.previousElementSibling.querySelector(".b3-text-field") as HTMLInputElement;
                    valueElement.focus();
                    bindAttrInput(valueElement, attrs.id);
                    addDialog.destroy();
                });
                event.stopPropagation();
                event.preventDefault();
                break;
            }
            target = target.parentElement;
        }
    });
    dialog.element.querySelectorAll(".b3-text-field").forEach((item: HTMLInputElement) => {
        if (focusName === item.getAttribute("data-name")) {
            item.focus();
        }
        bindAttrInput(item, attrs.id);
    });
};

export const openAttr = (nodeElement: Element, focusName = "bookmark") => {
    if (nodeElement.getAttribute("data-type") === "NodeThematicBreak") {
        return;
    }
    const id = nodeElement.getAttribute("data-node-id");
    fetchPost("/api/attr/getBlockAttrs", {id}, (response) => {
        openFileAttr(response.data, focusName);
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
                        name: inputElement.value,
                        overwrite: false
                    }, response => {
                        if (response.code === 1) {
                            // 重名
                            confirmDialog(window.siyuan.languages.export, window.siyuan.languages.exportTplTip, () => {
                                fetchPost("/api/template/docSaveAsTemplate", {
                                    id,
                                    name: inputElement.value,
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
