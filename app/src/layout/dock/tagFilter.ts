export const getTagFilterKeywords = (value: string) => {
    return value.toLowerCase().trim().split(/\s+/).filter(Boolean);
};

export const filterTagData = (
    data: IBlockTree[],
    keywords: string[],
    unescapeHTML: (value: string) => string = (value) => Lute.UnEscapeHTMLStr(value),
) => {
    return data.reduce<IBlockTree[]>((result, item) => {
        const children = filterTagData(item.children || [], keywords, unescapeHTML);
        const label = unescapeHTML(item.label || item.name).toLowerCase();
        if (keywords.every(keyword => label.includes(keyword)) || children.length > 0) {
            result.push({...item, children});
        }
        return result;
    }, []);
};
