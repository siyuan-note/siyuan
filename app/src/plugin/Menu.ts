import {Menu as SiyuanMenu} from "../menus/Menu";

export class Menu {
    private menu: SiyuanMenu;
    public isOpen: boolean;

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

    open(options: { x: number, y: number, h?: number, w?: number, isLeft?: boolean }) {
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
