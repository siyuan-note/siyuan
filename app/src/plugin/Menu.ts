import {Menu as SiyuanMenu} from "../menus/Menu";

export class Menu {
    private menu: SiyuanMenu;
    public isOpen: boolean;
    public element: HTMLElement;

    constructor(id?: string, closeCB?: () => void, independent = false) {
        if (independent) {
            const element = window.siyuan.menus.menu.element.cloneNode(true) as HTMLElement;
            element.removeAttribute("id");
            element.removeAttribute("data-name");
            element.removeAttribute("data-from");
            element.removeAttribute("style");
            element.setAttribute("data-menu", "true");
            element.classList.add("fn__none");
            element.classList.remove("b3-menu--list", "b3-menu--fullscreen");
            element.firstElementChild.classList.add("fn__none");
            element.lastElementChild.innerHTML = "";
            document.body.append(element);
            this.menu = new SiyuanMenu(element);
        } else {
            this.menu = window.siyuan.menus.menu;
        }
        this.isOpen = false;
        this.element = this.menu.element;

        if (id && !independent) {
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
            if (independent) {
                const closeEvent = (event: MouseEvent) => {
                    if (!this.element.contains(event.target as Node)) {
                        this.close();
                    }
                };
                const keydownEvent = (event: KeyboardEvent) => {
                    event.stopPropagation();
                    if (event.key === "Escape") {
                        event.preventDefault();
                        this.close();
                    }
                };
                window.addEventListener("click", closeEvent, true);
                this.element.addEventListener("keydown", keydownEvent);
                this.menu.removeCB = () => {
                    window.removeEventListener("click", closeEvent, true);
                    this.element.removeEventListener("keydown", keydownEvent);
                    closeCB?.();
                    this.element.remove();
                };
            } else {
                this.menu.removeCB = closeCB;
            }
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
