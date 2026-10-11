import {escapeAttr, escapeHtml} from "../../../util/escape";
import {setStorageVal} from "../../util/compatibility";
import {getColIconByType} from "./col";
import {unicode2Emoji} from "../../../emoji";
import {Menu} from "../../../plugin/Menu";

const STORAGE_KEY = "local-av-relation-layout";

interface IRelationLayout {
    hidden: string[];
    widths: Record<string, number>;
    order: string[];
}

export const bindRelationLayout = (root: HTMLElement, databaseID: string, onResize: () => void) => {
    const saved = window.siyuan.storage[STORAGE_KEY]?.[databaseID] as IRelationLayout | undefined;
    const layout: IRelationLayout = {hidden: [...(saved?.hidden || [])], widths: {...saved?.widths}, order: [...(saved?.order || [])]};
    const fields = document.createElement("div");
    fields.className = "av__relation-fields";
    const button = root.querySelector<HTMLElement>('[data-type="relationFields"]');
    let menu: Menu;
    const positionMenu = () => {
        const rect = button.getBoundingClientRect();
        menu?.open({x: rect.right, y: rect.bottom, h: rect.height, isLeft: true, target: button});
    };
    let columns: IAVColumn[] = [];
    let defaultWidths: string[] = [];
    let initialized = !!saved;
    const orderedColumns = () => {
        const byID = new Map(columns.slice(1).map(column => [column.id, column]));
        const ordered = columns.length ? [columns[0]] : [];
        [...layout.order, ...byID.keys()].forEach(id => {
            if (byID.has(id)) {
                ordered.push(byID.get(id));
                byID.delete(id);
            }
        });
        return ordered;
    };
    const widthOf = (index: number) => {
        const width = layout.widths[columns[index].id];
        return Number.isFinite(width) ? `${Math.max(64, Math.min(800, width))}px` : defaultWidths[index];
    };
    const apply = () => {
        const ordered = orderedColumns();
        const template = ["32px", ...ordered.map((column, index) =>
            index > 0 && layout.hidden.includes(column.id) ? "" : index === 0 ?
                `min(${widthOf(0)}, calc(100vw - 96px))` : widthOf(columns.indexOf(column))).filter(Boolean)].join(" ");
        root.querySelectorAll<HTMLElement>(".av__relation-table-header, .av__relation-table-row").forEach(row => {
            row.style.gridTemplateColumns = template;
            row.querySelectorAll<HTMLElement>("[data-relation-column]").forEach(cell => {
                cell.classList.toggle("fn__none", cell.dataset.relationColumn !== columns[0]?.id &&
                    layout.hidden.includes(cell.dataset.relationColumn));
            });
            const currentCells = Array.from(row.querySelectorAll<HTMLElement>("[data-relation-column]"));
            const cells = new Map(currentCells.map(cell => [cell.dataset.relationColumn, cell]));
            const nextCells = ordered.map(column => cells.get(column.id)).filter(Boolean);
            // 列宽拖动期间保持节点不动，避免中断指针捕获。
            if (nextCells.some((cell, index) => cell !== currentCells[index])) {
                nextCells.forEach(cell => row.append(cell));
            }
        });
    };
    const save = () => {
        const value = {...window.siyuan.storage[STORAGE_KEY], [databaseID]: layout};
        window.siyuan.storage[STORAGE_KEY] = value;
        setStorageVal(STORAGE_KEY, value);
    };
    const renderFields = () => {
        fields.innerHTML = [false, true].map(hidden => {
            const group = orderedColumns().filter((column, index) => (index > 0 && layout.hidden.includes(column.id)) === hidden);
            if (group.length === 0) {
                return "";
            }
            return `${hidden ? '<button class="b3-menu__separator"></button>' : ""}
<button class="b3-menu__item" data-type="nobg">
    <span class="b3-menu__label">${window.siyuan.languages[hidden ? "hideCol" : "showCol"]}</span>
    <span class="block__icon block__icon--show" data-all="${hidden ? "show" : "hide"}">${window.siyuan.languages[hidden ? "showAll" : "hideAll"]}
        <span class="fn__space"></span><svg><use xlink:href="#${hidden ? "iconEye" : "iconEyeoff"}"></use></svg>
    </span>
</button>${group.map(column => `<button class="b3-menu__item" data-column="${escapeAttr(column.id)}" ${column === columns[0] ? 'data-type="nobg" aria-disabled="true"' : 'draggable="true"'}>
    ${column === columns[0] ? "" : '<svg class="b3-menu__icon fn__grab"><use xlink:href="#iconDrag"></use></svg>'}
    ${column.icon ? unicode2Emoji(column.icon, "b3-menu__icon", true) : `<svg class="b3-menu__icon"><use xlink:href="#${getColIconByType(column.type)}"></use></svg>`}
    <span class="b3-menu__label">${escapeHtml(column.name) || "&nbsp;"}</span>
    <svg class="b3-menu__action b3-menu__action--show${column === columns[0] ? " fn__none" : ""}"><use xlink:href="#${hidden ? "iconEye" : "iconEyeoff"}"></use></svg>
</button>`).join("")}`;
        }).join("");
    };
    button.addEventListener("click", event => {
        event.stopPropagation();
        if (menu) {
            menu.close();
            return;
        }
        menu = new Menu("av-relation-fields", () => {
            clearDrag();
            fields.remove();
            menu = undefined;
            button.setAttribute("aria-expanded", "false");
        });
        menu.element.style.width = "280px";
        menu.element.lastElementChild.appendChild(fields);
        button.setAttribute("aria-expanded", "true");
        renderFields();
        positionMenu();
    });
    button.addEventListener("mousedown", event => event.preventDefault());
    let draggedID: string;
    let dropTarget: HTMLElement;
    const clearDrag = () => {
        fields.querySelectorAll(".dragover__top, .dragover__bottom").forEach(element =>
            element.classList.remove("dragover__top", "dragover__bottom"));
        draggedID = undefined;
        dropTarget = undefined;
    };
    fields.addEventListener("dragstart", (event: DragEvent) => {
        const row = (event.target as HTMLElement).closest<HTMLElement>("[data-column]");
        if (!row || row.dataset.column === columns[0]?.id) {
            event.preventDefault();
            return;
        }
        draggedID = row.dataset.column;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", draggedID);
        event.stopPropagation();
    });
    fields.addEventListener("dragover", (event: DragEvent) => {
        fields.querySelectorAll(".dragover__top, .dragover__bottom").forEach(element =>
            element.classList.remove("dragover__top", "dragover__bottom"));
        dropTarget = undefined;
        const row = (event.target as HTMLElement).closest<HTMLElement>("[data-column]");
        if (!draggedID || !row || row.dataset.column === draggedID || row.dataset.column === columns[0]?.id ||
            layout.hidden.includes(row.dataset.column) !== layout.hidden.includes(draggedID)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        dropTarget = row;
        const rect = row.getBoundingClientRect();
        row.classList.add(event.clientY < rect.top + rect.height / 2 ? "dragover__top" : "dragover__bottom");
    });
    fields.addEventListener("drop", event => {
        event.preventDefault();
        event.stopPropagation();
        if (draggedID && dropTarget) {
            const order = orderedColumns().map(column => column.id).filter(id => id !== draggedID);
            const index = order.indexOf(dropTarget.dataset.column) + (dropTarget.classList.contains("dragover__bottom") ? 1 : 0);
            order.splice(index, 0, draggedID);
            layout.order = order;
            apply();
            save();
            renderFields();
            onResize();
        }
        clearDrag();
    });
    fields.addEventListener("dragend", clearDrag);
    button.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            event.stopPropagation();
            button.dispatchEvent(new MouseEvent("click", {bubbles: true}));
        }
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
        positionMenu();
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
    const update = (nextColumns: IAVColumn[], gridTemplate: string) => {
        columns = nextColumns;
        if (!initialized && columns.length > 0) {
            layout.hidden = columns.slice(4).map(column => column.id);
            initialized = true;
        }
        defaultWidths = gridTemplate.split(" ").slice(1);
        apply();
        if (menu) {
            renderFields();
            positionMenu();
        }
    };
    return Object.assign(update, {close: () => menu?.close()});
};
