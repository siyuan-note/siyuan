import type {MarkdownAppearance, MarkdownAppearanceGroup, MarkdownFont, MarkdownIndependentAppearance} from "./bridge";

export const createMarkdownAppearanceForm = (element: HTMLElement, group: MarkdownAppearanceGroup,
                                             initial: MarkdownIndependentAppearance, text: (key: string) => string,
                                             save: (value: MarkdownIndependentAppearance) => Promise<void>, close: () => void) => {
    element.replaceChildren();
    const form = document.createElement("form");
    form.className = "markdown-appearance-form";
    const title = document.createElement("strong");
    title.textContent = `${text("markdownIndependentAppearance")} · ${text({theme: "appearanceMode", fontSize: "fontSize", fonts: "fontFamily"}[group])}`;
    form.append(title);
    const field = (label: string, input: HTMLElement) => {
        const wrapper = document.createElement("label");
        wrapper.className = "markdown-appearance-form__field";
        const name = document.createElement("span");
        name.textContent = label;
        wrapper.append(name, input);
        return wrapper;
    };
    let value: () => MarkdownIndependentAppearance;
    if (group === "theme") {
        const select = document.createElement("select");
        select.className = "b3-select";
        for (const [key, label] of [["system", "themeOS"], ["light", "themeLight"], ["dark", "themeDark"]]) {
            const option = document.createElement("option");
            option.value = key; option.textContent = text(label); select.append(option);
        }
        select.value = initial.theme ?? "system";
        form.append(field(text("appearanceMode"), select));
        value = () => ({theme: select.value as MarkdownIndependentAppearance["theme"]});
    } else if (group === "fontSize") {
        const input = document.createElement("input");
        input.className = "b3-text-field"; input.type = "number";
        input.min = "9"; input.max = "72"; input.step = "1"; input.required = true;
        input.value = String(initial.fontSize ?? 16);
        form.append(field(text("fontSize"), input));
        value = () => ({fontSize: input.valueAsNumber});
    } else {
        const readers: Partial<Record<"global" | "editor" | "code", () => MarkdownFont[]>> = {};
        for (const key of ["global", "editor", "code"] as const) {
            const section = document.createElement("section");
            section.className = "markdown-appearance-form__fonts";
            const heading = document.createElement("strong");
            heading.textContent = text({global: "globalDefaultFont", editor: "font", code: "monospaceFont"}[key]);
            const rows = document.createElement("div");
            const addRow = (font: MarkdownFont) => {
                const row = document.createElement("div");
                row.className = "markdown-appearance-form__row";
                const family = document.createElement("input");
                family.className = "b3-text-field"; family.value = font.family;
                family.maxLength = 256; family.required = true; family.setAttribute("aria-label", text("fontFamily"));
                const validate = () => family.setCustomValidity(!family.value.trim() || family.value.trim().startsWith("SiYuanCustomFont-") ? text("markdownSystemFontName") : "");
                family.oninput = validate;
                validate();
                const weight = document.createElement("input");
                weight.className = "b3-text-field"; weight.type = "number"; weight.value = String(font.weight);
                weight.min = "1"; weight.max = "1000"; weight.step = "1"; weight.required = true;
                weight.setAttribute("aria-label", text("markdownFontWeight"));
                const remove = document.createElement("button");
                remove.type = "button"; remove.className = "b3-button b3-button--text"; remove.textContent = text("remove");
                remove.onclick = () => {row.remove(); add.disabled = rows.children.length >= 32;};
                row.append(family, weight, remove); rows.append(row);
                add.disabled = rows.children.length >= 32;
            };
            const add = document.createElement("button");
            add.type = "button"; add.className = "b3-button b3-button--text"; add.textContent = text("new");
            add.onclick = () => {addRow({family: "", weight: 400}); rows.lastElementChild.querySelector("input").focus();};
            section.append(heading, rows, add); form.append(section);
            for (const font of initial.fonts?.[key] ?? []) addRow(font);
            readers[key] = () => Array.from(rows.children).map(row => {
                const inputs = row.querySelectorAll("input");
                return {family: inputs[0].value.trim(), weight: inputs[1].valueAsNumber};
            }).filter(font => font.family.length > 0);
        }
        value = () => ({fonts: {global: readers.global(), editor: readers.editor(), code: readers.code()}});
    }
    const actions = document.createElement("div");
    actions.className = "markdown-recovery__actions";
    const submit = document.createElement("button");
    submit.type = "submit"; submit.className = "b3-button"; submit.textContent = text("save");
    const cancel = document.createElement("button");
    cancel.type = "button"; cancel.className = "b3-button b3-button--cancel"; cancel.textContent = text("cancel"); cancel.onclick = close;
    actions.append(submit, cancel); form.append(actions); element.append(form);
    form.onsubmit = event => {
        event.preventDefault();
        if (!form.reportValidity() || submit.disabled) return;
        submit.disabled = true;
        void save(value()).then(close).catch(() => {submit.disabled = false;});
    };
    form.onkeydown = event => {if (event.key === "Escape") {event.preventDefault(); close();}};
    (form.querySelector("input, select, button") as HTMLElement)?.focus();
};

export const quoteMarkdownFont = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\n\r\f]/g, " ")}"`;

export const markdownFontStyle = (fonts: MarkdownFont[], fallback: string) => ({
    family: fonts.length ? `var(--b3-font-family-emoji-reset), ${fonts.map(font => quoteMarkdownFont(font.family)).join(", ")}, var(${fallback})` : `var(${fallback})`,
    weight: String(fonts[0]?.weight || 400),
});

export const createMarkdownFontAppearance = (root: HTMLElement, options: {
    create?: (family: string, source: string, descriptors: FontFaceDescriptors) => FontFace;
    fonts?: Pick<FontFaceSet, "add" | "delete">;
} = {}) => {
    const fonts = options.fonts ?? document.fonts;
    const create = options.create ?? ((family, source, descriptors) => new FontFace(family, source, descriptors));
    let sequence = 0;
    let signature: string;
    const loaded = new Set<FontFace>();
    const clear = () => {loaded.forEach(face => fonts.delete(face)); loaded.clear();};
    return {
        apply(appearance: MarkdownAppearance) {
            const nextSignature = JSON.stringify([appearance.fonts, appearance.customFonts]);
            if (signature === nextSignature) return;
            signature = nextSignature;
            const current = ++sequence;
            clear();
            const defaults = {global: "--b3-font-family", editor: appearance.fonts.global.length ? "--markdown-global-font-family" : "--b3-font-family-protyle", code: "--b3-font-family-code"};
            for (const group of ["global", "editor", "code"] as const) {
                const style = markdownFontStyle(appearance.fonts[group], defaults[group]);
                if (group === "editor" && !appearance.fonts.editor.length && appearance.fonts.global.length) {
                    style.weight = String(appearance.fonts.global[0].weight || 400);
                }
                root.style.setProperty(`--markdown-${group}-font-family`, style.family);
                root.style.setProperty(`--markdown-${group}-font-weight`, style.weight);
            }
            for (const font of appearance.customFonts) {
                try {
                    const face = create(quoteMarkdownFont(font.family), `url(${quoteMarkdownFont(font.url)})`, {weight: String(font.weight)});
                    void face.load().then(() => {
                        // 字体解码完成时仍须属于当前来源，窗口销毁或切换来源后不能重新注册。
                        if (current !== sequence) return;
                        fonts.add(face);
                        loaded.add(face);
                    }).catch((): void => undefined);
                } catch {
                    // 无法解码或宿主不支持字体加载时，使用字体列表中的后续字体。
                }
            }
        },
        destroy() {
            sequence++;
            clear();
            for (const group of ["global", "editor", "code"]) {
                root.style.removeProperty(`--markdown-${group}-font-family`);
                root.style.removeProperty(`--markdown-${group}-font-weight`);
            }
        },
    };
};
