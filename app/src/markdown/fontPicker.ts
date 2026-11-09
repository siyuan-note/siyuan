import {getUniqueFontFamilies, getFontFamilyDisplayName, IFontItem} from "../util/systemFontCore";
import {observeFontPreview} from "../util/fontPreview";
import type {MarkdownFont} from "./bridge";

export const markdownFontVariants = (fonts: IFontItem[], family: string) =>
    [...new Map(fonts.filter(font => font.family === family).map(font => [font.weight, font])).values()]
        .sort((a, b) => a.weight - b.weight);

export const filterMarkdownFonts = (fonts: IFontItem[], query: string, codeOnly: boolean, selected: MarkdownFont[]) => {
    const search = query.trim().toLocaleLowerCase();
    return getUniqueFontFamilies(fonts).filter(font =>
        (!codeOnly || ["monospace", "dual", "character-cell"].includes(font.spacing) || selected.some(item => item.family === font.family)) &&
        (!search || [font.family, font.displayName, ...font.aliases ?? []].some(name => name.toLocaleLowerCase().includes(search))));
};

export const reorderMarkdownFonts = (fonts: MarkdownFont[], from: number, to: number) => {
    if (from < 0 || from >= fonts.length || to < 0 || to >= fonts.length || from === to) return fonts;
    const result = [...fonts];
    result.splice(to, 0, result.splice(from, 1)[0]);
    return result;
};

export const createMarkdownFontPicker = (element: HTMLElement, initial: MarkdownFont[], codeOnly: boolean,
                                         load: () => Promise<IFontItem[]>, text: (key: string) => string) => {
    let selected = initial.map(font => ({...font}));
    let fonts: IFontItem[] = [];
    let destroyed = false;
    let preview: () => void;
    let closeWeights: () => void;
    let dragging = -1;
    let sequence = 0;
    const chips = document.createElement("div");
    chips.className = "b3-chips";
    const controls = document.createElement("div");
    controls.className = "markdown-font-picker__controls";
    const search = document.createElement("input");
    search.type = "search"; search.className = "b3-text-field"; search.placeholder = text("searchPlaceholder");
    search.setAttribute("aria-label", text("searchPlaceholder"));
    const all = document.createElement("button");
    all.type = "button"; all.className = "b3-button b3-button--outline"; all.textContent = text("showAll");
    all.hidden = !codeOnly; all.setAttribute("aria-pressed", "false");
    controls.append(search, all);
    const notice = document.createElement("div");
    notice.setAttribute("role", "status"); notice.textContent = text("loading");
    const retry = document.createElement("button");
    retry.type = "button"; retry.className = "b3-button b3-button--text"; retry.textContent = text("retry"); retry.hidden = true;
    const list = document.createElement("div");
    list.className = "b3-list b3-list--background markdown-font-picker__list";
    list.setAttribute("aria-label", text("fontFamily"));
    element.append(chips, controls, notice, retry, list);
    const icon = (id: string) => {
        const span = document.createElement("span");
        span.innerHTML = `<svg aria-hidden="true"><use href="#${id}"></use></svg>`;
        return span.firstChild;
    };
    const renderList = () => {
        preview?.();
        list.replaceChildren();
        for (const font of filterMarkdownFonts(fonts, search.value, codeOnly, selected)) {
            const button = document.createElement("button");
            button.type = "button"; button.className = "b3-list-item"; button.dataset.family = font.family;
            button.setAttribute("role", "checkbox");
            const checked = selected.some(item => item.family === font.family);
            button.setAttribute("aria-checked", String(checked)); button.disabled = !checked && selected.length >= 32;
            const label = document.createElement("span");
            label.className = "b3-menu__label"; label.dataset.family = font.family;
            label.textContent = font.displayName || font.family;
            button.append(label);
            if (checked) button.append(icon("iconSelect"));
            button.onclick = () => {
                selected = checked ? selected.filter(item => item.family !== font.family) : [...selected, {family: font.family, weight: font.weight}];
                renderChips(); renderList();
                list.querySelectorAll<HTMLButtonElement>("button").forEach(item => {if (item.dataset.family === font.family) item.focus();});
            };
            list.append(button);
        }
        preview = observeFontPreview(list, label => {
            label.style.fontFamily = `"${label.dataset.family.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
            label.style.fontWeight = String(fonts.find(font => font.family === label.dataset.family && font.weight === 400)?.weight ??
                fonts.find(font => font.family === label.dataset.family)?.weight ?? 400);
        });
        if (!notice.dataset.error) {notice.textContent = list.children.length ? "" : text("emptyContent"); notice.hidden = !!list.children.length;}
    };
    const weights = (target: HTMLElement, family: string) => {
        closeWeights?.();
        const variants = markdownFontVariants(fonts, family);
        if (!variants.length) return;
        const menu = document.createElement("div");
        menu.className = "b3-menu markdown-font-picker__weights";
        menu.setAttribute("role", "menu"); menu.setAttribute("aria-label", text("markdownFontWeight"));
        const events = new AbortController();
        closeWeights = () => {events.abort(); menu.remove(); closeWeights = undefined;};
        for (const variant of variants) {
            const button = document.createElement("button");
            button.type = "button"; button.className = "b3-menu__item"; button.dataset.weight = String(variant.weight);
            button.setAttribute("role", "menuitemradio");
            button.setAttribute("aria-checked", String(selected.find(font => font.family === family)?.weight === variant.weight));
            button.textContent = `${variant.displayName || family} (${variant.weight})`;
            button.style.fontWeight = String(variant.weight);
            button.style.fontFamily = `"${family.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
            button.onclick = () => {
                selected = selected.map(font => font.family === family ? {family, weight: variant.weight} : font);
                closeWeights(); renderChips();
                chips.querySelectorAll<HTMLElement>(".b3-chip").forEach(chip => {if (chip.dataset.family === family) chip.focus();});
            };
            menu.append(button);
        }
        element.append(menu);
        const rect = target.getBoundingClientRect();
        menu.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - menu.offsetWidth - 8))}px`;
        menu.style.top = `${Math.max(8, Math.min(rect.bottom, innerHeight - menu.offsetHeight - 8))}px`;
        menu.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
        if (!menu.contains(document.activeElement)) menu.querySelector("button").focus();
        document.addEventListener("pointerdown", event => {if (!menu.contains(event.target as Node)) closeWeights?.();}, {signal: events.signal});
        document.addEventListener("focusin", event => {if (!menu.contains(event.target as Node)) closeWeights?.();}, {signal: events.signal});
        window.addEventListener("resize", () => closeWeights?.(), {signal: events.signal});
        menu.onkeydown = event => {
            if (event.key === "Escape") {event.preventDefault(); event.stopPropagation(); closeWeights(); target.focus();}
            else if (["ArrowDown", "ArrowUp"].includes(event.key)) {
                event.preventDefault();
                const items = Array.from(menu.querySelectorAll("button"));
                items[(items.indexOf(document.activeElement as HTMLButtonElement) + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length].focus();
            }
        };
    };
    const renderChips = () => {
        closeWeights?.(); chips.replaceChildren();
        selected.forEach((font, index) => {
            const chip = document.createElement("span");
            chip.className = "b3-chip markdown-font-picker__chip"; chip.tabIndex = 0; chip.draggable = true; chip.dataset.family = font.family;
            chip.setAttribute("aria-label", `${getFontFamilyDisplayName(fonts, font.family)} (${font.weight})`);
            const label = document.createElement("span"); label.className = "fn__ellipsis";
            label.textContent = `${getFontFamilyDisplayName(fonts, font.family)} (${font.weight})`; chip.append(label);
            const action = (key: string, symbol: string, callback: () => void) => {
                const button = document.createElement("button"); button.type = "button"; button.className = "block__icon block__icon--show";
                button.setAttribute("aria-label", text(key)); button.title = text(key); button.append(icon(symbol));
                button.onclick = callback; chip.append(button); return button;
            };
            const move = (to: number) => {
                selected = reorderMarkdownFonts(selected, index, to); renderChips();
                chips.querySelectorAll<HTMLElement>(".b3-chip").forEach(item => {if (item.dataset.family === font.family) item.focus();});
            };
            const weight = action("markdownFontWeight", "iconFont", () => weights(weight, font.family));
            weight.setAttribute("aria-haspopup", "menu");
            action("moveToUp", "iconUp", () => move(index - 1)).disabled = index === 0;
            action("moveToDown", "iconDown", () => move(index + 1)).disabled = index === selected.length - 1;
            action("remove", "iconClose", () => {selected.splice(index, 1); renderChips(); renderList();});
            chip.oncontextmenu = event => {event.preventDefault(); weights(chip, font.family);};
            chip.onkeydown = event => {
                if (event.key === "ContextMenu" || event.key === "F10" && event.shiftKey) {event.preventDefault(); weights(chip, font.family);}
                if (event.altKey && ["ArrowUp", "ArrowDown"].includes(event.key)) {event.preventDefault(); move(index + (event.key === "ArrowDown" ? 1 : -1));}
            };
            chip.ondragstart = event => {dragging = index; event.dataTransfer.setData("text/plain", font.family);};
            chip.ondragend = () => {dragging = -1;};
            chip.ondragover = event => {if (dragging >= 0) event.preventDefault();};
            chip.ondrop = event => {event.preventDefault(); selected = reorderMarkdownFonts(selected, dragging, index); dragging = -1; renderChips();};
            chips.append(chip);
        });
    };
    const refresh = async () => {
        const current = ++sequence;
        notice.hidden = false; notice.textContent = text("loading"); retry.hidden = true;
        try {
            const loaded = await load();
            if (destroyed || current !== sequence) return;
            fonts = loaded.filter(font => !font.family.startsWith("SiYuanCustomFont-"));
            delete notice.dataset.error;
            renderChips(); renderList();
        } catch {
            if (destroyed || current !== sequence) return;
            notice.dataset.error = "true"; notice.textContent = text("markdownSystemFontsUnavailable"); retry.hidden = false;
        }
    };
    search.oninput = renderList;
    all.onclick = () => {codeOnly = false; all.setAttribute("aria-pressed", "true"); all.disabled = true; renderList();};
    retry.onclick = () => {void refresh();};
    renderChips(); void refresh();
    return {value: () => selected.map(font => ({...font})), destroy: () => {destroyed = true; sequence++; preview?.(); closeWeights?.();}};
};
