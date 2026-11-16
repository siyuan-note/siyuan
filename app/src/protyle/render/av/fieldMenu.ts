import {Menu} from "../../../plugin/Menu";
import {MenuItem} from "../../../menus/Menu";
import {isMobile} from "../../../util/functions";
import {formatDateDisplay, getLabelByDateFormat} from "./dateFormat";
import {setDateFieldFormat} from "./dateFormatMenu";
import {getLabelByNumberFormat, setNumberFieldFormat} from "./number";

const bindFieldSubmenu = (placeholder: Element, menuElement: HTMLElement, options: IMenu) => {
    const item = new MenuItem(options);
    item.element.dataset.type = placeholder.getAttribute("data-type");
    item.element.classList.toggle("fn__none", placeholder.classList.contains("fn__none"));
    placeholder.replaceWith(item.element);
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
            options.submenu.forEach(choice => menu.addItem(choice));
            const rect = item.element.getBoundingClientRect();
            menu.open({x: rect.left, y: rect.bottom, h: rect.height});
        } else {
            show();
        }
    });
};

export const bindFieldMenus = (protyle: IProtyle, avID: string, field: IAVColumn, menuElement: HTMLElement) => {
    const type = field.type;
    const numberFormat = menuElement.querySelector('[data-type="numberFormat"]');
    if (type === "number" && numberFormat) {
        const oldFormat = field.numberFormat || "";
        bindFieldSubmenu(numberFormat, menuElement, {
            icon: "iconFormat", label: window.siyuan.languages.format,
            accelerator: getLabelByNumberFormat(oldFormat),
            submenu: ["", "commas", "percent", "USD", "CNY", "EUR", "GBP", "JPY", "RUB", "INR", "KRW",
                "TRY", "CAD", "CHF", "THB", "AUD", "HKD", "TWD", "MOP", "SGD", "NZD", "ILS"].map(format => ({
                label: getLabelByNumberFormat(format), iconHTML: "", checked: format === oldFormat,
                click: () => {
                    if (format !== oldFormat) {
                        setNumberFieldFormat(protyle, avID, field.id, format, oldFormat);
                    }
                    menuElement.closest(".av__panel")?.remove();
                },
            })),
        });
    }
    if (type !== "date" && type !== "created" && type !== "updated") {
        return;
    }
    const oldFormat = field.dateFormat || "";
    const select = (format: TAVDateFormat) => {
        if (format !== oldFormat) {
            setDateFieldFormat(protyle, avID, field.id, type, format, oldFormat);
        }
        menuElement.closest(".av__panel")?.remove();
    };
    const lang = window.siyuan.languages._attrView;
    const calendar = menuElement.querySelector('[data-type="dateCalendar"]');
    if (calendar) {
        bindFieldSubmenu(calendar, menuElement, {
            icon: "iconMode", label: lang.dateCalendar,
            accelerator: oldFormat === "lunar" ? lang.lunarCalendar : lang.solarCalendar,
            submenu: [false, true].map(lunar => ({
                label: lunar ? lang.lunarCalendar : lang.solarCalendar,
                iconHTML: "",
                checked: (oldFormat === "lunar") === lunar,
                click: () => select(lunar ? "lunar" : oldFormat === "lunar" ? "full" : oldFormat),
            })),
        });
    }
    const format = menuElement.querySelector('[data-type="dateFormat"]');
    if (format) {
        bindFieldSubmenu(format, menuElement, {
            icon: "iconFormat", label: lang.dateFormat, accelerator: getLabelByDateFormat(oldFormat),
            submenu: (["", "full", "month-day-year", "day-month-year", "year-month-day"] as TAVDateFormat[]).map(value => ({
                label: getLabelByDateFormat(value), iconHTML: "", checked: value === oldFormat,
                accelerator: value === "full" ? formatDateDisplay(Date.now(), value) : undefined,
                click: () => select(value),
            })),
        });
    }
};
