import {Menu} from "../../../plugin/Menu";
import {toggleMenu} from "../../../menus/menuToggle";
import {hasAVCapability} from "./capabilities";
import {getColIconByType} from "./col";
import {canUseReadonlyAVSort, getReadonlyAVSort, setReadonlyAVSort} from "./readonlyState";
import {avRender} from "./render";
import {getAVData} from "./virtualScroll";
import {getFieldsByData} from "./view";
import {getAVCurrentViewID} from "./viewVisibility";

export const openReadonlyAVSortMenu = (element: HTMLElement, protyle: IProtyle, target: HTMLElement) => {
    const data = getAVData(element);
    if (!data || !canUseReadonlyAVSort(protyle)) {
        return;
    }
    const fields = getFieldsByData(data).filter(field => hasAVCapability(field.type, "sortable"));
    const sort = getReadonlyAVSort(element, data.viewID);
    const apply = (value?: IAVSort) => {
        if (!canUseReadonlyAVSort(protyle) || getAVCurrentViewID(element) !== data.viewID) {
            return;
        }
        setReadonlyAVSort(element, data.viewID, value);
        element.removeAttribute("data-render");
        void avRender(element, protyle);
    };
    toggleMenu({
        target,
        build: () => {
            const menu = new Menu();
            menu.addItem({type: "readonly", label: window.siyuan.languages.avTemporarySort});
            fields.forEach(field => {
                menu.addItem({
                    label: field.name,
                    icon: getColIconByType(field.type),
                    checked: sort?.column === field.id,
                    type: "submenu",
                    submenu: (["ASC", "DESC"] as const).map(order => ({
                        label: order === "ASC" ? window.siyuan.languages.asc : window.siyuan.languages.desc,
                        checked: sort?.column === field.id && sort.order === order,
                        click: () => apply({column: field.id, order}),
                    })),
                });
            });
            menu.addSeparator();
            menu.addItem({
                label: window.siyuan.languages.avRestoreDefaultSort,
                checked: !sort,
                click: () => apply(),
            });
            const rect = target.getBoundingClientRect();
            menu.open({x: rect.left, y: rect.bottom, h: rect.height});
        },
    });
};
