import {fetchSyncPost} from "../util/fetch";
import {getFrontend} from "../util/functions";
import {genUUID} from "../util/genID";
import {upDownHint} from "../util/upDownHint";

export const createPluginSnapshotSelect = (host: HTMLElement, onSelect: () => void) => {
    const lang = window.siyuan.languages;
    const id = "plugin-snapshot-options-" + genUUID();
    host.classList.add("history__plugin-chooser");
    host.innerHTML = `<div class="fn__flex"><input class="b3-text-field fn__flex-1" required spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="${id}" aria-label="${lang.plugin}" placeholder="${lang.plugin}"><button type="button" class="block__icon block__icon--show" aria-label="${lang.plugin}"><svg><use xlink:href="#iconDown"></use></svg></button></div><ul id="${id}" class="b3-list b3-list--background history__plugin-options fn__none" role="listbox"></ul>`;
    const input = host.querySelector("input");
    const toggle = host.querySelector("button");
    const list = host.querySelector("ul");
    const abort = new AbortController();
    let packages: Array<{name: string, label: string}> = [];
    let loading = true;
    let message = "";
    let composing = false;
    let filter = "";
    const close = () => {
        list.classList.add("fn__none");
        input.setAttribute("aria-expanded", "false");
        input.removeAttribute("aria-activedescendant");
    };
    const choose = (name: string) => {
        if (input.disabled || abort.signal.aborted) { return; }
        input.value = name;
        close();
        onSelect();
    };
    const render = (keyword: string) => {
        if (input.disabled || abort.signal.aborted) { return; }
        filter = keyword;
        const query = keyword.trim().toLocaleLowerCase();
        list.replaceChildren();
        packages.filter(item => `${item.label}\n${item.name}`.toLocaleLowerCase().includes(query)).forEach((item, index) => {
            const row = document.createElement("li");
            row.className = "b3-list-item" + (index === 0 ? " b3-list-item--focus" : "");
            row.id = id + "-" + index;
            row.dataset.package = item.name;
            row.setAttribute("role", "option");
            row.setAttribute("aria-selected", String(item.name === input.value));
            const text = document.createElement("span");
            text.className = "b3-list-item__text";
            text.textContent = item.label === item.name ? item.name : `${item.label} (${item.name})`;
            row.append(text);
            list.append(row);
        });
        if (!list.children.length) {
            const row = document.createElement("li");
            row.className = "b3-list--empty";
            row.textContent = loading ? lang.loading : message || lang.emptyContent;
            list.append(row);
        }
        list.classList.remove("fn__none");
        input.setAttribute("aria-expanded", "true");
        const active = list.querySelector(".b3-list-item--focus");
        if (active) { input.setAttribute("aria-activedescendant", active.id); }
        else { input.removeAttribute("aria-activedescendant"); }
    };
    input.addEventListener("focus", () => render(input.value));
    input.addEventListener("input", (event: InputEvent) => { if (!composing && !event.isComposing) { render(input.value); } });
    input.addEventListener("compositionstart", () => { composing = true; });
    input.addEventListener("compositionend", () => { composing = false; render(input.value); });
    input.addEventListener("keydown", event => {
        if (event.isComposing || composing) { return; }
        const expanded = input.getAttribute("aria-expanded") === "true";
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!expanded) { render(input.value); }
            else {
                const active = upDownHint(list, event);
                if (active) { input.setAttribute("aria-activedescendant", active.id); }
            }
        } else if (expanded && event.key === "Enter") {
            const active = list.querySelector<HTMLElement>(".b3-list-item--focus");
            if (active) { event.preventDefault(); event.stopPropagation(); choose(active.dataset.package); }
        } else if (expanded && event.key === "Escape") {
            event.preventDefault(); event.stopPropagation(); close();
        } else if (event.key === "Tab") { close(); }
    });
    toggle.addEventListener("click", () => {
        const expanded = input.getAttribute("aria-expanded") === "true";
        input.focus();
        if (expanded) { close(); } else { render(""); }
    });
    list.addEventListener("pointerdown", event => { if ((event.target as Element).closest("[data-package]")) { event.preventDefault(); } });
    list.addEventListener("click", event => {
        const row = (event.target as Element).closest<HTMLElement>("[data-package]");
        if (row && list.contains(row)) { choose(row.dataset.package); }
    });
    const outside = (event: PointerEvent) => { if (!host.contains(event.target as Node)) { close(); } };
    document.addEventListener("pointerdown", outside);
    void (async () => {
        try {
            const response = await fetchSyncPost("/api/bazaar/getInstalledPlugin", {frontend: getFrontend(), keyword: ""}, undefined, false, abort.signal);
            if (abort.signal.aborted) { return; }
            if (response.code === 0) {
                packages = (response.data.packages || []).filter(item => item?.name)
                    .map(item => ({name: item.name, label: item.preferredName || item.name}));
                packages.sort((a, b) => a.label.localeCompare(b.label) || a.name.localeCompare(b.name));
            } else { message = response.msg; }
        } catch (error) { if (!abort.signal.aborted) { message = String(error); } }
        finally {
            loading = false;
            if (!abort.signal.aborted && input.getAttribute("aria-expanded") === "true") { render(filter); }
        }
    })();
    return {input, close, canSubmit: () => !composing, destroy: () => {
        abort.abort();
        document.removeEventListener("pointerdown", outside);
    }};
};
