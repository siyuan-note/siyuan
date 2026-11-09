import type {MarkdownAppearance, MarkdownFont} from "./bridge";

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
