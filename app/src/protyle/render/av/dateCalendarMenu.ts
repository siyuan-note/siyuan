import {Menu} from "../../../plugin/Menu";
import {MenuItem} from "../../../menus/Menu";
import {isMobile} from "../../../util/functions";
import {setDateFieldFormat} from "./dateFormatMenu";

export const bindDateCalendarMenu = (protyle: IProtyle, avID: string, field: IAVColumn, menuElement: HTMLElement) => {
    const placeholder = menuElement.querySelector('[data-type="dateCalendar"]');
    if (!placeholder) {
        return;
    }
    const lang = window.siyuan.languages._attrView;
    const items: IMenu[] = [false, true].map(lunar => ({
        label: lunar ? lang.lunarCalendar : lang.solarCalendar,
        iconHTML: "",
        checked: (field.dateFormat === "lunar") === lunar,
        click: () => {
            if ((field.dateFormat === "lunar") !== lunar) {
                setDateFieldFormat(protyle, avID, field.id, "date", lunar ? "lunar" : "full", field.dateFormat || "");
            }
            menuElement.closest(".av__panel")?.remove();
        },
    }));
    const item = new MenuItem({icon: "iconMode", label: lang.dateCalendar,
        accelerator: field.dateFormat === "lunar" ? lang.lunarCalendar : lang.solarCalendar, submenu: items});
    placeholder.replaceWith(item.element);
    item.element.dataset.type = "dateCalendar";
    const submenu = item.element.querySelector<HTMLElement>(".b3-menu__submenu");
    const show = () => {
        item.element.classList.add("b3-menu__item--show");
        window.siyuan.menus.menu.showSubMenu(submenu);
    };
    if (!isMobile()) {
        item.element.addEventListener("mouseenter", show);
        menuElement.addEventListener("mouseover", event => {
            const hovered = (event.target as Element).closest(".b3-menu__item");
            if (hovered && !item.element.contains(hovered)) {
                item.element.classList.remove("b3-menu__item--show");
            }
        });
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
