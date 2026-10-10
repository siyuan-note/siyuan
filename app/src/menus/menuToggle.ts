import type {Menu} from "./Menu";

export interface IMenuSession {
    isCurrent: () => boolean;
    show: (render: () => void) => void;
}

export interface IToggleMenuOptions {
    target?: Element;
    toggle?: boolean;
    build: (menu: Menu, session: IMenuSession) => void | Promise<void>;
    show?: (menu: Menu) => void;
}

const sessions = new WeakMap<Menu, object>();

// 在构建前判断具体按钮归属；异步构建必须在回调中检查会话，并通过 show 发布菜单。
export const toggleMenu = (options: IToggleMenuOptions) => {
    const menu = window.siyuan.menus.menu;
    const anchor = options.target?.closest("[data-menu=\"true\"]") ?? options.target;
    const toggle = options.toggle ?? Boolean(anchor);
    if (toggle && anchor && menu.data === anchor &&
        (!menu.element.classList.contains("fn__none") || sessions.has(menu))) {
        sessions.delete(menu);
        menu.data = undefined;
        if (!menu.element.classList.contains("fn__none") && menu.element.classList.contains("b3-menu--sheet")) {
            menu.closeSheet();
        } else {
            menu.remove();
        }
        return;
    }
    menu.remove();
    const token = {};
    sessions.set(menu, token);
    menu.data = anchor;
    if (toggle && anchor) {
        anchor.setAttribute("data-menu", "true");
    }
    let building = true;
    const session: IMenuSession = {
        isCurrent: () => sessions.get(menu) === token && (building || menu.data === anchor),
        show: render => {
            if (sessions.get(menu) !== token) {
                return;
            }
            menu.data = anchor;
            render();
            if (sessions.get(menu) === token) {
                menu.data = anchor;
            }
        },
    };
    let built: void | Promise<void>;
    try {
        built = options.build(menu, session);
    } catch (error) {
        if (sessions.get(menu) === token) {
            sessions.delete(menu);
            menu.remove();
        }
        throw error;
    }
    building = false;
    if (sessions.get(menu) === token) {
        menu.data = anchor;
        if (options.show) {
            session.show(() => options.show(menu));
        }
    }
    return built;
};
