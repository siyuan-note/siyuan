import {escapeAttr, escapeHtml} from "../../../util/escape";
import {setStorageVal} from "../../util/compatibility";

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
        fields.innerHTML = columns.map((column, index) => `<div class="av__relation-field">
<label class="fn__flex fn__flex-1"><input type="checkbox" class="b3-switch" data-column="${escapeAttr(column.id)}"
${index === 0 ? "checked disabled" : layout.hidden.includes(column.id) ? "" : "checked"}>
<span class="fn__space"></span><span class="fn__ellipsis">${escapeHtml(column.name)}</span></label>
<input type="number" class="b3-text-field" min="64" max="800" step="1" value="${parseFloat(widthOf(index))}"
data-width="${escapeAttr(column.id)}" aria-label="${escapeAttr(column.name + " " + window.siyuan.languages.width)}">
</div>`).join("");
    };
    button.addEventListener("click", event => {
        event.stopPropagation();
        fields.classList.toggle("fn__none");
        button.setAttribute("aria-expanded", String(!fields.classList.contains("fn__none")));
        renderFields();
        onResize();
    });
    fields.addEventListener("click", event => event.stopPropagation());
    fields.addEventListener("keydown", event => event.stopPropagation());
    fields.addEventListener("change", event => {
        event.stopPropagation();
        const input = event.target as HTMLInputElement;
        if (input.dataset.column) {
            layout.hidden = layout.hidden.filter(id => id !== input.dataset.column);
            if (!input.checked) {
                layout.hidden.push(input.dataset.column);
            }
        } else if (input.dataset.width) {
            if (!Number.isFinite(input.valueAsNumber)) {
                renderFields();
                return;
            }
            layout.widths[input.dataset.width] = Math.max(64, Math.min(800, Math.round(input.valueAsNumber)));
            input.value = String(layout.widths[input.dataset.width]);
        }
        apply();
        save();
        onResize();
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
        defaultWidths = gridTemplate.split(" ").slice(1);
        apply();
        if (!fields.classList.contains("fn__none")) {
            renderFields();
        }
    };
};
