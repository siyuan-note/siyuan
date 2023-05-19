import {confirmDialog} from "../dialog/confirmDialog";
import {Plugin} from "./index";
import {showMessage} from "../dialog/message";
import {Dialog} from "../dialog";
import {Menu as SiyuanMenu} from "../menus/Menu";
import {fetchGet, fetchPost, fetchSyncPost} from "../util/fetch";
import {isMobile} from "../util/functions";
/// #if !MOBILE
import {openFile} from "../editor/util";
/// #endif
import {updateHotkeyTip} from "../protyle/util/compatibility";

export class Menu {
    private menu: SiyuanMenu;
    private isOpen: boolean;

    constructor(id?: string, closeCB?: () => void) {
        this.menu = window.siyuan.menus.menu;
        this.isOpen = false;
        if (id) {
            const dataName = this.menu.element.getAttribute("data-name");
            if (dataName && dataName === id) {
                this.isOpen = true;
            }
        }
        this.menu.remove();
        if (!this.isOpen) {
            this.menu.element.setAttribute("data-name", id);
            this.menu.removeCB = closeCB;
        }
    }

    showSubMenu(subMenuElement: HTMLElement) {
        this.menu.showSubMenu(subMenuElement);
    }

    addItem(option: IMenu) {
        if (this.isOpen) {
            return;
        }
        return this.menu.addItem(option);
    }

    addSeparator(index?: number) {
        if (this.isOpen) {
            return;
        }
        this.menu.addSeparator(index);
    }

    open(options: { x: number, y: number, h?: number, w?: number, isLeft: false }) {
        if (this.isOpen) {
            return;
        }
        this.menu.popup(options, options.isLeft);
    }

    fullscreen(position: "bottom" | "all" = "all") {
        if (this.isOpen) {
            return;
        }
        this.menu.fullscreen(position);
        this.menu.element.style.zIndex = "310";
    }

    close() {
        this.menu.remove();
    }
}

let openTab;
/// #if MOBILE
openTab = () => {
    // TODO: Mobile
};
/// #else
openTab = openFile;
/// #endif

export const API = {
    confirm: confirmDialog,
    showMessage,
    adaptHotkey: updateHotkeyTip,
    fetchPost,
    fetchSyncPost,
    fetchGet,
    isMobile,
    openTab,
    Plugin,
    Dialog,
    Menu,
    Lute
};
