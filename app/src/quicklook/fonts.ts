type PreviewFont = {family: string; weight: number};
const groups = ["global", "editor", "code"] as const;
const quote = (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const font = (value: unknown): value is PreviewFont => {
    if (!value || typeof value !== "object") return false;
    const item = value as PreviewFont;
    return typeof item.family === "string" && item.family.trim().length > 0 && item.family.length <= 256 &&
        !Array.from(item.family).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) &&
        Number.isInteger(item.weight) && item.weight >= 1 && item.weight <= 1000;
};

export const createQuickLookFonts = (root: HTMLElement,
                                   create = (family: string, source: string, descriptors: FontFaceDescriptors) => new FontFace(family, source, descriptors)) => {
    const doc = root.ownerDocument;
    let generation = 0;
    const faces = new Set<FontFace>();
    let release: () => void;
    const clear = () => {
        generation++;
        release?.(); release = undefined;
        faces.forEach(face => doc.fonts.delete(face)); faces.clear();
        for (const group of groups) {
            root.style.removeProperty(`--markdown-${group}-font-family`);
            root.style.removeProperty(`--markdown-${group}-font-weight`);
        }
    };
    return {
        clear,
        apply(id: string, payload: unknown): Promise<void> {
            clear();
            const ticket = generation;
            const value = payload && typeof payload === "object" ? payload as {
                fonts?: Partial<Record<typeof groups[number], unknown>>; customFonts?: unknown;
            } : {};
            const selected = {global: [], editor: [], code: []} as Record<typeof groups[number], PreviewFont[]>;
            for (const group of groups) {
                const items = value.fonts?.[group];
                selected[group] = Array.isArray(items) ? items.slice(0, 32).filter(font) : [];
            }
            for (const group of groups) {
                const items = selected[group];
                const fallback = {global: "--b3-font-family", editor: selected.global.length ?
                    "--markdown-global-font-family" : "--b3-font-family-protyle", code: "--b3-font-family-code"}[group];
                const family = items.length ? `var(--b3-font-family-emoji-reset), ${items.map(item => quote(item.family)).join(", ")}, var(${fallback})` : `var(${fallback})`;
                root.style.setProperty(`--markdown-${group}-font-family`, family);
                root.style.setProperty(`--markdown-${group}-font-weight`, String(items[0]?.weight ||
                    (group === "editor" ? selected.global[0]?.weight : 0) || 400));
            }
            const pending: Promise<unknown>[] = [];
            if (Array.isArray(value.customFonts)) {
                for (const item of value.customFonts.slice(0, 96)) {
                    if (!font(item) || !groups.some(group => selected[group].some(selectedFont =>
                        selectedFont.family === item.family && selectedFont.weight === item.weight))) continue;
                    const url = (item as PreviewFont & {url?: unknown}).url;
                    if (typeof url !== "string" || !/^siyuan-preview:\/\/bundle\/font\/[a-f0-9-]+\/[a-f0-9-]+$/.test(url) ||
                        url.split("/")[4] !== id) continue;
                    try {
                        const face = create(quote(item.family), `url(${quote(url)})`, {weight: String(item.weight)});
                        pending.push(face.load().then(() => {
                            // 取消或切换预览后不再注册旧字体。
                            if (ticket !== generation) return;
                            doc.fonts.add(face); faces.add(face);
                        }).catch((): void => undefined));
                    } catch {
                        // 损坏或不支持的字体使用字体列表中的后备字体。
                    }
                }
            }
            // 字体读取不得耗尽整个预览的时间预算，超时后也不再注册迟到的字体。
            return new Promise<void>(resolve => {
                const timer = setTimeout(() => {if (ticket === generation) generation++; finish();}, 2000);
                const finish = () => {clearTimeout(timer); if (release === finish) release = undefined; resolve();};
                release = finish;
                void Promise.all(pending).then(finish);
            });
        },
    };
};
