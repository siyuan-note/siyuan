import {Menu as SiyuanMenu} from "../menus/Menu";

export class Menu {
    private menu: SiyuanMenu;
    public isOpen: boolean;
    public element: HTMLElement;

    constructor(id?: string, closeCB?: () => void) {
        this.menu = window.siyuan.menus.menu;
        this.isOpen = false;
        this.element = this.menu.element;

        if (id) {
            const dataName = this.menu.element.getAttribute("data-name");
            if (dataName && dataName === id) {
                this.isOpen = true;
            }
        }
        this.menu.remove();
        if (!this.isOpen) {
            if (id) {
                this.menu.element.setAttribute("data-name", id);
            }
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

    addSeparator(options?: number | {
        index?: number,
        id?: string,
        ignore?: boolean
    }, ignoreParam = false) {
        // 兼容 3.1.24 之前的版本  addSeparator(index?: number, ignore?: boolean): HTMLElement;
        let id: string;
        let index: number;
        let ignore = false;
        if (typeof options === "object") {
            ignore = options.ignore || false;
            index = options.index;
            id = options.id;
        } else if (typeof options === "number") {
            index = options;
            ignore = ignoreParam;
        }
        if (ignore || this.isOpen) {
            return;
        }
        return this.menu.addItem({id, type: "separator", index});
    }

    open(options: IPosition) {
        if (this.isOpen) {
            return;
        }
        this.menu.popup(options);
    }

    fullscreen(position: "bottom" | "all" = "all") {
        if (this.isOpen) {
            return;
        }
        this.menu.fullscreen(position);
    }

    close() {
        this.menu.remove();
    }
}
