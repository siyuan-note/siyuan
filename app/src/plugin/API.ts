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
import {newCardModel} from "../card/newCardTab";
import {App} from "../index";
import {Constants} from "../constants";

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
openTab = (options: {
    app: App,
    doc?: {
        fileName: string,
        rootIcon?: string, // 文档图标
        id: string,     // 块 id
        rootID: string, // 文档 id
        action: string [] // cb-get-all：获取所有内容；cb-get-focus：打开后光标定位在 id 所在的块；cb-get-hl: 打开后 id 块高亮
        zoomIn?: boolean // 是否缩放
    },
    pdf?: {
        path: string,
        page?: number,  // pdf 页码
        id?: string,    // File Annotation id
    },
    asset?: {
        path: string,
    },
    search?: ISearchOption
    card?: {
        cardType: TCardType,
        id?: string, //  cardType 为 all 时不传，否则传文档或笔记本 id
        title?: string //  cardType 为 all 时不传，否则传文档或笔记本名称
    },
    custom?: {
        title: string,
        icon: string,
        data?: any
        fn?: () => any,
    }
    position?: "right" | "bottom",
    keepCursor?: boolean // 是否跳转到新 tab 上
    removeCurrentTab?: boolean // 在当前页签打开时需移除原有页签
    afterOpen?: () => void // 打开后回调
}) => {
    if (options.doc) {
        if (options.doc.zoomIn && !options.doc.action.includes(Constants.CB_GET_ALL)) {
            options.doc.action.push(Constants.CB_GET_ALL);
        }
        openFile({
            app: options.app,
            keepCursor: options.keepCursor,
            removeCurrentTab: options.removeCurrentTab,
            position: options.position,
            afterOpen: options.afterOpen,
            fileName: options.doc.fileName,
            rootIcon: options.doc.rootIcon,
            id: options.doc.id,
            rootID: options.doc.rootID,
            action: options.doc.action,
            zoomIn: options.doc.zoomIn
        });
        return;
    }
    if (options.asset) {
        openFile({
            app: options.app,
            keepCursor: options.keepCursor,
            removeCurrentTab: options.removeCurrentTab,
            position: options.position,
            afterOpen: options.afterOpen,
            assetPath: options.asset.path,
        });
        return;
    }
    if (options.pdf) {
        openFile({
            app: options.app,
            keepCursor: options.keepCursor,
            removeCurrentTab: options.removeCurrentTab,
            position: options.position,
            afterOpen: options.afterOpen,
            assetPath: options.pdf.path,
            page: options.pdf.id || options.pdf.page,
        });
        return;
    }
    if (options.search) {
        openFile({
            app: options.app,
            keepCursor: options.keepCursor,
            removeCurrentTab: options.removeCurrentTab,
            position: options.position,
            afterOpen: options.afterOpen,
            searchData: options.search,
        });
        return;
    }
    if (options.card) {
        openFile({
            app: options.app,
            keepCursor: options.keepCursor,
            removeCurrentTab: options.removeCurrentTab,
            position: options.position,
            afterOpen: options.afterOpen,
            custom: {
                icon: "iconRiffCard",
                title: window.siyuan.languages.spaceRepetition,
                data: options.card,
                fn: newCardModel
            },
        });
        return;
    }
    if (options.custom) {
        openFile(options);
        return;
    }

}
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
};
