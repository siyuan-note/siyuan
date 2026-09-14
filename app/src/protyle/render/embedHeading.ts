const EMBED_SELECTOR = "[data-type=\"NodeBlockQueryEmbed\"]";
const HEADING_CLASSES = ["h1", "h2", "h3", "h4", "h5", "h6"];

export const isDirectHeadingEmbed = (statement: string, id: string, type: string) => {
    const match = /^\s*select\s+\*\s+from\s+blocks\s+where\s+id\s*=\s*(['"])(\d{14}-[a-z0-9]{7})\1\s*;?\s*$/i.exec(statement);
    return type === "NodeHeading" && !!match && match[2] === id;
};

export const getEmbedHeadingLevel = (value: string | null) => /^[1-6]$/.test(value || "") ? Number(value) : 0;

export const getEmbedHeadingLevels = (levels: number[], target: number) => {
    const top = Math.min(...levels);
    return levels.map(level => target ? level - top + target : level);
};

export const isHeadingEmbed = (element: Element) =>
    !!element.querySelector(":scope > .protyle-wysiwyg__embed[data-embed-heading=\"true\"]");

// 仅切换显示样式，保留标题类型和源层级，避免编辑嵌入内容时改变源标题。
export const renderEmbedHeadings = (element: Element) => {
    const embeds = new Set<Element>(element.querySelectorAll(EMBED_SELECTOR));
    const ancestor = element.closest(EMBED_SELECTOR);
    if (ancestor) {
        embeds.add(ancestor);
    }
    embeds.forEach(embed => {
        if (!isHeadingEmbed(embed)) {
            return;
        }
        const headings = Array.from(embed.querySelectorAll("[data-type=\"NodeHeading\"]"))
            .filter(heading => heading.closest(EMBED_SELECTOR) === embed);
        const levels = headings.map(heading => Number(heading.getAttribute("data-subtype")?.slice(1)));
        const target = getEmbedHeadingLevel(embed.getAttribute("custom-heading-level"));
        getEmbedHeadingLevels(levels, target).forEach((level, index) => {
            const heading = headings[index];
            heading.classList.remove(...HEADING_CLASSES, "protyle-embed-heading--paragraph");
            heading.classList.add(level > 6 ? "protyle-embed-heading--paragraph" : `h${level}`);
        });
    });
};
