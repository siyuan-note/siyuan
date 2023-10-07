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

    open(options:IPosition) {
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
