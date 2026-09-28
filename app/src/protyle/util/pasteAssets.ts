import {fetchSyncPost} from "../../util/fetch";

// 只处理附件引用属性，代码和正文中展示的路径保持原样。
export const preparePasteAssets = async (notebook: string, html: string): Promise<string | null> => {
    const template = document.createElement("template");
    template.innerHTML = html;
    const references: Attr[] = [];
    template.content.querySelectorAll("*").forEach(element => {
        for (const attr of Array.from(element.attributes)) {
            if ((["src", "data-src", "href", "data-href", "poster", "data-assets"].includes(attr.name) ||
                attr.name.startsWith("custom-data-assets") ||
                attr.name === "data-id" && element.getAttribute("data-type")?.split(" ").includes("file-annotation-ref")) &&
                /^\/?assets\//.test(attr.value.trim())) {
                references.push(attr);
            }
        }
    });
    if (!references.length) {
        return html;
    }
    const response = await fetchSyncPost("/api/clipboard/preparePasteAssets", {
        notebook, assets: Array.from(new Set(references.map(attr => attr.value))),
    });
    if (response.code !== 0 || !response.data || references.some(attr => !response.data[attr.value])) {
        return null;
    }
    references.forEach(attr => attr.value = response.data[attr.value]);
    return template.innerHTML;
};
