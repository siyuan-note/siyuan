import {getIconValueKind, unicode2Emoji} from "../../emoji/iconValue";

export const getBreadcrumbCustomIcon = (icon: string, className = "") => {
    if (!icon) return;
    const kind = getIconValueKind(icon);
    if (kind === "invalid") return;
    if (kind === "unicode" && (!/^[\da-f]+(?:-[\da-f]+)*$/i.test(icon) || icon.split("-").some(value => {
        const codePoint = parseInt(value, 16);
        return codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff);
    }))) return;
    const html = unicode2Emoji(icon, className, true);
    return html && html !== `<span class="${className}"></span>` ? html : undefined;
};
