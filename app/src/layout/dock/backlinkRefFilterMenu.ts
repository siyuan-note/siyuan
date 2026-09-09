import {fetchSyncPost} from "../../util/fetch";
import {escapeAttr, escapeHtml} from "../../util/escape";
import {Constants} from "../../constants";
import type {IBacklinkSourceFilter} from "./backlinkSourceFilter";

interface IRefDef {
    id: string;
    text: string;
    path: string;
}

export const loadBacklinkRefFilterMenu = async (options: {
    id: string;
    notebook: string;
    keyword: string;
    filter: IBacklinkSourceFilter;
    getSelected: () => string[];
    isCurrent: () => boolean;
    apply: (ids: string[]) => void;
}): Promise<IMenu[]> => {
    const languages = window.siyuan.languages;
    const response = await fetchSyncPost("/api/ref/getBacklink2", {
        id: options.id, k: options.keyword, mk: "", notebook: options.notebook,
        sourceFilter: options.filter, refDefCandidates: true,
    });
    if (!options.isCurrent() || response.code !== 0) {
        return [];
    }
    const candidates: IRefDef[] = response.data.refDefs || [];
    const byID = new Map(candidates.map(item => [item.id, item]));
    options.getSelected().forEach(id => {
        if (!byID.has(id)) {
            byID.set(id, {id, text: id, path: ""});
        }
    });
    const rows = new Map<string, HTMLElement>();
    let input: HTMLInputElement;
    let reset: HTMLElement;
    let empty: HTMLElement;
    const refresh = () => {
        const selected = options.getSelected();
        const keyword = input.value.toLocaleLowerCase();
        let visible = 0;
        rows.forEach((element, id) => {
            const item = byID.get(id);
            const checked = selected.includes(id);
            const hidden = !checked && !`${item.text} ${item.path} ${id}`.toLocaleLowerCase().includes(keyword);
            element.classList.toggle("fn__none", hidden);
            if (hidden) {
                element.classList.remove("b3-menu__item--current");
            }
            element.querySelector(".b3-menu__checked")?.remove();
            element.setAttribute("aria-checked", String(checked));
            if (checked) {
                element.insertAdjacentHTML("beforeend", '<svg class="b3-menu__checked"><use xlink:href="#iconSelect"></use></svg>');
            }
            if (!hidden) {
                visible++;
            }
        });
        empty?.classList.toggle("fn__none", visible > 0);
        reset?.toggleAttribute("disabled", selected.length === 0);
    };
    return [{
        type: "empty",
        label: `<input ${Constants.ATTRIBUTE_MENU_KEYMAP}="true" class="b3-text-field fn__block" style="margin: 4px 0" placeholder="${escapeAttr(escapeHtml(languages.search))}">`,
        bind: element => {
            input = element.querySelector("input");
            input.setAttribute("aria-label", languages.search);
            input.title = languages.backlinkExcludeRefDefsTip;
            input.addEventListener("input", refresh);
            input.addEventListener("click", event => event.stopPropagation());
        },
    }, {
        label: languages.reset,
        iconHTML: "",
        disabled: options.getSelected().length === 0,
        bind: element => { reset = element; },
        click: () => {
            if (options.isCurrent()) {
                options.apply([]);
                refresh();
            }
            return true;
        },
    }, ...Array.from(byID.values()).map((item): IMenu => ({
        label: `${escapeHtml(item.text || item.id)}<span class="ft__on-surface fn__block fn__ellipsis">${escapeHtml(item.path)}</span>`,
        iconHTML: "",
        checked: options.getSelected().includes(item.id),
        bind: element => {
            element.title = `${item.path}\n${item.id}`;
            element.setAttribute("role", "menuitemcheckbox");
            element.setAttribute("aria-checked", String(options.getSelected().includes(item.id)));
            rows.set(item.id, element);
        },
        click: () => {
            if (options.isCurrent()) {
                const ids = new Set(options.getSelected());
                if (ids.has(item.id)) {
                    ids.delete(item.id);
                } else {
                    ids.add(item.id);
                }
                options.apply(Array.from(ids));
                refresh();
            }
            return true;
        },
    })), {
        type: "readonly",
        label: languages.emptyContent,
        iconHTML: "",
        bind: element => {
            empty = element;
            refresh();
        },
    }];
};
