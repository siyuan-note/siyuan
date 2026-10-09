import {MenuItem} from "../../../menus/Menu";
import {Menu} from "../../../plugin/Menu";
import {isMobile} from "../../../util/functions";

export const bindLocationDefaultCoordinateSystem = (options: {
    menuElement: HTMLElement;
    column: IAVColumn;
    onChange: (system: IAVCellLocationValue["coordinateSystem"]) => void;
}) => {
    const target = options.menuElement.querySelector('[data-type="locationDefaultCoordinateSystem"]');
    if (!target) {
        return;
    }
    const systems: Array<[IAVCellLocationValue["coordinateSystem"], string]> = [
        ["unknown", window.siyuan.languages.coordinateSystemUnknown], ["wgs84", "WGS84"],
        ["gcj02", "GCJ-02"], ["bd09", "BD-09"],
    ];
    const items: IMenu[] = systems.map(([system, label]) => ({
        label,
        iconHTML: "",
        checked: (options.column.location?.defaultCoordinateSystem || "unknown") === system,
        click: () => {
            if (system !== (options.column.location?.defaultCoordinateSystem || "unknown")) {
                options.onChange(system);
            }
            options.menuElement.closest(".av__panel")?.remove();
        },
    }));
    const item = new MenuItem({icon: "iconPin", label: window.siyuan.languages.defaultCoordinateSystem, submenu: items});
    target.replaceWith(item.element);
    item.element.dataset.type = "locationDefaultCoordinateSystem";
    item.element.setAttribute("title", window.siyuan.languages.defaultCoordinateSystemTip);
    const submenu = item.element.querySelector<HTMLElement>(".b3-menu__submenu");
    const show = () => {
        item.element.classList.add("b3-menu__item--show");
        window.siyuan.menus.menu.showSubMenu(submenu);
    };
    if (!isMobile()) {
        item.element.addEventListener("mouseenter", show);
        item.element.addEventListener("keydown", event => {
            if (event.key === "ArrowRight") {
                event.preventDefault();
                event.stopPropagation();
                show();
                submenu.querySelector<HTMLButtonElement>(".b3-menu__item").focus();
            } else if (event.key === "ArrowLeft" || event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                item.element.classList.remove("b3-menu__item--show");
                item.element.focus();
            }
        });
        options.menuElement.addEventListener("mouseover", event => {
            const hovered = (event.target as Element).closest(".b3-menu__item");
            if (hovered && !item.element.contains(hovered)) {
                item.element.classList.remove("b3-menu__item--show");
            }
        });
    }
    item.element.addEventListener("click", event => {
        event.preventDefault();
        event.stopPropagation();
        if (isMobile()) {
            const menu = new Menu(undefined, undefined, true);
            items.forEach(choice => menu.addItem(choice));
            const rect = item.element.getBoundingClientRect();
            menu.open({x: rect.left, y: rect.bottom, h: rect.height});
        } else {
            show();
        }
    });
};
