export interface IAVItemLink {
    content: string;
    link: string;
}

export const genAVItemLink = (databaseBlockID: string, viewID: string, itemID: string, groupID?: string) => {
    const params = new URLSearchParams({
        avViewID: viewID,
        avItemID: itemID,
    });
    if (groupID) {
        params.set("avGroupID", groupID);
    }
    return `siyuan://blocks/${databaseBlockID}?${params.toString()}`;
};

export const escapeAVItemLinkText = (content: string) => content
    .replace(/[\r\n\u2028\u2029]+/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\[/g, "\\[")
    .replace(/]/g, "\\]");

export const formatAVItemLinks = (items: IAVItemLink[], markdown: boolean) => items.map(item => {
    const value = markdown
        ? `[${escapeAVItemLinkText(item.content || item.link)}](${item.link})`
        : item.link;
    return items.length > 1 ? `- ${value}` : value;
}).join("\n");
