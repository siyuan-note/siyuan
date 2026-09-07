export interface TemplateEntry {
    path: string;
    isDir: boolean;
    isPackage?: boolean;
}

export interface TemplateTreeEntry extends TemplateEntry {
    name: string;
    depth: number;
    expanded: boolean;
}

export const getTemplateTree = (entries: TemplateEntry[], query: string, expandedPaths: Set<string>): TemplateTreeEntry[] => {
    const keyword = query.trim().toLowerCase();
    const children = new Map<string, TemplateEntry[]>();
    const matches = new Set<string>();
    entries.forEach(entry => {
        const parent = entry.path.substring(0, entry.path.lastIndexOf("/"));
        if (!children.has(parent)) {
            children.set(parent, []);
        }
        children.get(parent).push(entry);
        if (keyword && entry.path.toLowerCase().includes(keyword)) {
            // 搜索结果保留祖先目录，临时展开但不改变用户的展开状态。
            let path = entry.path;
            while (path) {
                matches.add(path);
                path = path.substring(0, path.lastIndexOf("/"));
            }
        }
    });
    children.forEach(items => items.sort((a, b) => Number(b.isDir) - Number(a.isDir) ||
        a.path.localeCompare(b.path, undefined, {numeric: true, sensitivity: "base"})));
    const result: TemplateTreeEntry[] = [];
    const visit = (parent: string, depth: number) => {
        children.get(parent)?.forEach(entry => {
            if (keyword && !matches.has(entry.path)) {
                return;
            }
            const expanded = entry.isDir && (!!keyword || expandedPaths.has(entry.path));
            result.push({...entry, name: entry.path.split("/").pop(), depth, expanded});
            if (expanded) {
                visit(entry.path, depth + 1);
            }
        });
    };
    visit("", 0);
    return result;
};
