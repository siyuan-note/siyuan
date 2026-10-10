const owners = new WeakMap<HTMLElement, {container: HTMLElement}>();

export const registerMapUnplacedMenu = (menu: HTMLElement, container: HTMLElement) => {
    const owner = {container};
    owners.set(menu, owner);
    return () => {
        // 共用菜单被新实例接管后，旧实例的清理不能移除新归属。
        if (owners.get(menu) === owner) owners.delete(menu);
    };
};

export const isMapUnplacedMenu = (menu: HTMLElement, container: HTMLElement) =>
    owners.get(menu)?.container === container;
