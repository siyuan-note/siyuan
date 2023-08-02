import {fetchPost} from "../../util/fetch";
import {MenuItem} from "../../menus/Menu";
import {copySubMenu, movePathToMenu, openFileAttr, openFileWechatNotify} from "../../menus/commonMenuItem";
import {deleteFile} from "../../editor/deleteFile";
import {transferBlockRef} from "../../menus/block";
import {updateHotkeyTip} from "../util/compatibility";
/// #if !MOBILE
import {openBacklink, openGraph, openOutline} from "../../layout/dock/util";
/// #endif
import {Constants} from "../../constants";
import {openCardByData} from "../../card/openCard";
import {viewCards} from "../../card/viewCards";
import {getNotebookName, pathPosix} from "../../util/pathName";
import {makeCard, quickMakeCard} from "../../card/makeCard";
import {emitOpenMenu} from "../../plugin/EventBus";
import * as dayjs from "dayjs";
import {hideTooltip} from "../../dialog/tooltip";

export const openTitleMenu = (protyle: IProtyle, position: {
    x: number
    y: number
    isLeft?: boolean
}) => {
    hideTooltip();
    if (!window.siyuan.menus.menu.element.classList.contains("fn__none") &&
        window.siyuan.menus.menu.element.getAttribute("data-name") === "titleMenu") {
        window.siyuan.menus.menu.remove();
        return;
    }
    fetchPost("/api/block/getDocInfo", {
        id: protyle.block.rootID
    }, (response) => {
        window.siyuan.menus.menu.remove();
        window.siyuan.menus.menu.element.setAttribute("data-name", "titleMenu");
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.copy,
            icon: "iconCopy",
            type: "submenu",
            submenu: copySubMenu(protyle.block.rootID)
        }).element);
        if (!protyle.disabled) {
            window.siyuan.menus.menu.append(movePathToMenu([protyle.path]));
            window.siyuan.menus.menu.append(new MenuItem({
                icon: "iconTrashcan",
                label: window.siyuan.languages.delete,
                click: () => {
                    deleteFile(protyle.notebookId, protyle.path);
                }
            }).element);
            window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
            if (response.data.refCount && response.data.refCount > 0) {
                transferBlockRef(protyle.block.rootID);
            }
            window.siyuan.menus.menu.append(new MenuItem({
                label: window.siyuan.languages.attr,
                accelerator: window.siyuan.config.keymap.editor.general.attr.custom + "/" + updateHotkeyTip("⇧Click"),
                click() {
                    openFileAttr(response.data.ial);
                }
            }).element);
        }
        /// #if !MOBILE
        window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
        window.siyuan.menus.menu.append(new MenuItem({
            icon: "iconAlignCenter",
            label: window.siyuan.languages.outline,
            accelerator: window.siyuan.config.keymap.editor.general.outline.custom,
            click: () => {
                openOutline(protyle);
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            icon: "iconLink",
            label: window.siyuan.languages.backlinks,
            accelerator: window.siyuan.config.keymap.editor.general.backlinks.custom,
            click: () => {
                openBacklink(protyle);
            }
        }).element);
        window.siyuan.menus.menu.append(new MenuItem({
            icon: "iconGraph",
            label: window.siyuan.languages.graphView,
            accelerator: window.siyuan.config.keymap.editor.general.graphView.custom,
            click: () => {
                openGraph(protyle);
            }
        }).element);
        /// #endif
        window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.wechatReminder,
            icon: "iconMp",
            click() {
                openFileWechatNotify(protyle);
            }
        }).element);
        const riffCardMenu = [{
            iconHTML: Constants.ZWSP,
            label: window.siyuan.languages.spaceRepetition,
            accelerator: window.siyuan.config.keymap.editor.general.spaceRepetition.custom,
            click: () => {
                fetchPost("/api/riff/getTreeRiffDueCards", {rootID: protyle.block.rootID}, (response) => {
                    openCardByData(protyle.app, response.data, "doc", protyle.block.rootID, response.data.name);
                });
            }
        }, {
            iconHTML: Constants.ZWSP,
            label: window.siyuan.languages.manage,
            click: () => {
                fetchPost("/api/filetree/getHPathByID", {
                    id: protyle.block.rootID
                }, (response) => {
                    viewCards(protyle.app, protyle.block.rootID, pathPosix().join(getNotebookName(protyle.notebookId), (response.data)), "Tree");
                });
            }
        }, {
            iconHTML: Constants.ZWSP,
            label: window.siyuan.languages.quickMakeCard,
            accelerator: window.siyuan.config.keymap.editor.general.quickMakeCard.custom,
            click: () => {
                let titleElement = protyle.title?.element;
                if (!titleElement) {
                    titleElement = document.createElement("div");
                    titleElement.setAttribute("data-node-id", protyle.block.rootID);
                    titleElement.setAttribute("custom-riff-decks", response.data.ial["custom-riff-decks"]);
                }
                quickMakeCard(protyle, [titleElement]);
            }
        }];
        if (window.siyuan.config.flashcard.deck) {
            riffCardMenu.push({
                iconHTML: Constants.ZWSP,
                label: window.siyuan.languages.addToDeck,
                click: () => {
                    makeCard(protyle.app, [protyle.block.rootID]);
                }
            });
        }
        window.siyuan.menus.menu.append(new MenuItem({
            label: window.siyuan.languages.riffCard,
            type: "submenu",
            icon: "iconRiffCard",
            submenu: riffCardMenu,
        }).element);

        if (protyle?.app?.plugins) {
            emitOpenMenu({
                plugins: protyle.app.plugins,
                type: "click-editortitleicon",
                detail: {
                    protyle,
                    data: response.data,
                },
                separatorPosition: "top",
            });
        }

        window.siyuan.menus.menu.append(new MenuItem({type: "separator"}).element);
        window.siyuan.menus.menu.append(new MenuItem({
            iconHTML: Constants.ZWSP,
            type: "readonly",
            label: `${window.siyuan.languages.modifiedAt} ${dayjs(response.data.ial.updated).format("YYYY-MM-DD HH:mm:ss")}<br>
${window.siyuan.languages.createdAt} ${dayjs(response.data.ial.id.substr(0, 14)).format("YYYY-MM-DD HH:mm:ss")}`
        }).element);
        window.siyuan.menus.menu.popup(position, position.isLeft);
    });
};
