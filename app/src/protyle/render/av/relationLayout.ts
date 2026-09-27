import {escapeAttr, escapeHtml} from "../../../util/escape";
import {setStorageVal} from "../../util/compatibility";
import {getColIconByType} from "./col";
import {unicode2Emoji} from "../../../emoji";

const STORAGE_KEY = "local-av-relation-layout";

interface IRelationLayout {
    hidden: string[];
    widths: Record<string, number>;
}

export const bindRelationLayout = (root: HTMLElement, databaseID: string, onResize: () => void) => {
    const saved = window.siyuan.storage[STORAGE_KEY]?.[databaseID] as IRelationLayout | undefined;
    const layout: IRelationLayout = {hidden: [...(saved?.hidden || [])], widths: {...saved?.widths}};
    const fields = root.querySelector<HTMLElement>(".av__relation-fields");
    const button = root.querySelector<HTMLButtonElement>('[data-type="relationFields"]');
    let columns: IAVColumn[] = [];
    let defaultWidths: string[] = [];
    let initialized = !!saved;
    const widthOf = (index: number) => {
        const width = layout.widths[columns[index].id];
        return Number.isFinite(width) ? `${Math.max(64, Math.min(800, width))}px` : defaultWidths[index];
    };
    const apply = () => {
        const template = ["32px", ...columns.map((column, index) =>
            index > 0 && layout.hidden.includes(column.id) ? "" : index === 0 ?
                `min(${widthOf(index)}, calc(100vw - 96px))` : widthOf(index)).filter(Boolean)].join(" ");
        root.querySelectorAll<HTMLElement>(".av__relation-table-header, .av__relation-table-row").forEach(row => {
            row.style.gridTemplateColumns = template;
            row.querySelectorAll<HTMLElement>("[data-relation-column]").forEach(cell => {
                cell.classList.toggle("fn__none", cell.dataset.relationColumn !== columns[0]?.id &&
                    layout.hidden.includes(cell.dataset.relationColumn));
            });
        });
    };
    const save = () => {
        const value = {...window.siyuan.storage[STORAGE_KEY], [databaseID]: layout};
        window.siyuan.storage[STORAGE_KEY] = value;
        setStorageVal(STORAGE_KEY, value);
    };
    const renderFields = () => {
        fields.innerHTML = [false, true].map(hidden => {
            const group = columns.filter((column, index) => (index > 0 && layout.hidden.includes(column.id)) === hidden);
            if (group.length === 0) {
                return "";
            }
            return `${hidden ? '<button class="b3-menu__separator"></button>' : ""}
<button class="b3-menu__item" data-type="nobg" data-all="${hidden ? "show" : "hide"}">
    <span class="b3-menu__label">${window.siyuan.languages[hidden ? "hideCol" : "showCol"]}</span>
    <span class="block__icon">${window.siyuan.languages[hidden ? "showAll" : "hideAll"]}
        <span class="fn__space"></span><svg><use xlink:href="#${hidden ? "iconEye" : "iconEyeoff"}"></use></svg>
    </span>
</button>${group.map(column => `<button class="b3-menu__item" data-column="${escapeAttr(column.id)}" ${column === columns[0] ? 'data-type="nobg" aria-disabled="true"' : ""}>
    ${column.icon ? unicode2Emoji(column.icon, "b3-menu__icon", true) : `<svg class="b3-menu__icon"><use xlink:href="#${getColIconByType(column.type)}"></use></svg>`}
    <span class="b3-menu__label">${escapeHtml(column.name) || "&nbsp;"}</span>
    <svg class="b3-menu__action b3-menu__action--show${column === columns[0] ? " fn__none" : ""}"><use xlink:href="#${hidden ? "iconEye" : "iconEyeoff"}"></use></svg>
</button>`).join("")}`;
        }).join("");
    };
    button.addEventListener("click", event => {
        event.stopPropagation();
        fields.classList.toggle("fn__none");
        button.setAttribute("aria-expanded", String(!fields.classList.contains("fn__none")));
        renderFields();
        onResize();
    });
    fields.addEventListener("click", event => {
        event.stopPropagation();
        const target = (event.target as HTMLElement).closest<HTMLElement>("[data-column], [data-all]");
        if (!target) {
            return;
        }
        if (target.dataset.all) {
            layout.hidden = target.dataset.all === "hide" ? columns.slice(1).map(column => column.id) : [];
        } else {
            const id = target.dataset.column;
            if (id === columns[0]?.id) {
                return;
            }
            layout.hidden = layout.hidden.includes(id) ? layout.hidden.filter(item => item !== id) : [...layout.hidden, id];
        }
        apply();
        save();
        renderFields();
        onResize();
    });
    fields.addEventListener("keydown", event => {
        if (event.key !== "Escape") {
            event.stopPropagation();
        }
    });
    root.addEventListener("pointerdown", event => {
        const handle = (event.target as HTMLElement).closest<HTMLElement>(".av__widthdrag");
        if (!handle || event.button !== 0) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const cell = handle.parentElement;
        const id = cell.dataset.relationColumn;
        const initialWidth = cell.getBoundingClientRect().width;
        const initialX = event.clientX;
        handle.setPointerCapture(event.pointerId);
        handle.classList.add("av__widthdrag--active");
        const move = (moveEvent: PointerEvent) => {
            layout.widths[id] = Math.max(64, Math.min(800, Math.round(initialWidth + moveEvent.clientX - initialX)));
            apply();
        };
        const finish = () => {
            handle.removeEventListener("pointermove", move);
            handle.removeEventListener("lostpointercapture", finish);
            handle.classList.remove("av__widthdrag--active");
            renderFields();
            save();
            onResize();
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("lostpointercapture", finish);
    });
    return (nextColumns: IAVColumn[], gridTemplate: string) => {
        columns = nextColumns;
        if (!initialized && columns.length > 0) {
            layout.hidden = columns.slice(4).map(column => column.id);
            initialized = true;
        }
        defaultWidths = gridTemplate.split(" ").slice(1);
        apply();
        if (!fields.classList.contains("fn__none")) {
            renderFields();
        }
    };
};
