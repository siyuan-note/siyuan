import {Dialog} from "../../dialog";
import {fetchPost} from "../../util/fetch";
import {escapeAttr, escapeHtml} from "../../util/escape";
import type {IBacklinkSourceFilter} from "./backlinkSourceFilter";

interface IRefDef {
    id: string;
    text: string;
    path: string;
}

export const showBacklinkRefFilter = (options: {
    id: string;
    notebook: string;
    keyword: string;
    filter: IBacklinkSourceFilter;
    getSelected: () => string[];
    isCurrent: () => boolean;
    apply: (ids: string[]) => void;
}) => {
    const languages = window.siyuan.languages;
    const dialog = new Dialog({
        title: languages.backlinkExcludeRefDefs,
        width: "520px",
        content: `<div class="b3-dialog__content">
<div class="ft__secondary">${languages.backlinkExcludeRefDefsTip}</div>
<div class="fn__hr"></div>
<input class="b3-text-field fn__block" aria-label="${escapeAttr(escapeHtml(languages.search))}" placeholder="${escapeAttr(escapeHtml(languages.search))}">
<div class="fn__hr"></div>
<div data-type="candidates" style="max-height: 50vh; overflow: auto"></div>
</div><div class="b3-dialog__action"><span class="ft__secondary fn__flex-1" data-type="count"></span>
<button class="b3-button b3-button--cancel" data-type="reset">${languages.reset}</button>
<div class="fn__space"></div><button class="b3-button b3-button--text" data-type="close">${languages.close}</button></div>`,
    });
    const input = dialog.element.querySelector("input") as HTMLInputElement;
    const list = dialog.element.querySelector('[data-type="candidates"]');
    const count = dialog.element.querySelector('[data-type="count"]');
    const reset = dialog.element.querySelector('[data-type="reset"]') as HTMLButtonElement;
    let candidates: IRefDef[] = [];
    const active = () => {
        if (!options.isCurrent()) {
            dialog.destroy();
            return false;
        }
        return dialog.element.isConnected;
    };
    const render = () => {
        if (!active()) {
            return;
        }
        const selected = options.getSelected();
        count.textContent = `${languages.backlinkExcludeRefDefs} (${selected.length})`;
        reset.disabled = selected.length === 0;
        const byID = new Map(candidates.map(item => [item.id, item]));
        selected.forEach(id => {
            if (!byID.has(id)) {
                byID.set(id, {id, text: id, path: ""});
            }
        });
        const keyword = input.value.toLocaleLowerCase();
        list.replaceChildren();
        Array.from(byID.values()).filter(item => selected.includes(item.id) ||
            `${item.text} ${item.path} ${item.id}`.toLocaleLowerCase().includes(keyword)).forEach(item => {
            const row = document.createElement("label");
            row.className = "b3-list-item";
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.className = "b3-switch fn__flex-shrink";
            checkbox.checked = selected.includes(item.id);
            const text = document.createElement("span");
            text.className = "b3-list-item__text";
            text.textContent = item.text || item.id;
            row.title = `${item.path}\n${item.id}`;
            const path = document.createElement("span");
            path.className = "ft__secondary fn__ellipsis";
            path.style.maxWidth = "40%";
            path.textContent = item.path;
            checkbox.addEventListener("change", () => {
                if (!active()) {
                    return;
                }
                const ids = new Set(options.getSelected());
                if (checkbox.checked) {
                    ids.add(item.id);
                } else {
                    ids.delete(item.id);
                }
                options.apply(Array.from(ids));
                render();
            });
            row.append(checkbox, text, path);
            list.appendChild(row);
        });
        if (!list.childElementCount) {
            list.textContent = languages.emptyContent;
        }
    };
    input.addEventListener("input", render);
    reset.addEventListener("click", () => {
        if (active()) {
            options.apply([]);
            render();
        }
    });
    dialog.element.querySelector('[data-type="close"]').addEventListener("click", () => dialog.destroy());
    render();
    list.textContent = languages.loading;
    void fetchPost("/api/ref/getBacklink2", {
        id: options.id, k: options.keyword, mk: "", notebook: options.notebook,
        sourceFilter: options.filter, refDefCandidates: true,
    }, response => {
        if (response.code === 0 && active()) {
            candidates = response.data.refDefs || [];
            render();
        }
    }).then(render);
    input.focus();
};
