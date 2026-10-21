import type {ListMindmapFoldTarget} from "./fold";

export const getListMindmapFoldMenuItems = (select: (level: ListMindmapFoldTarget) => void,
                                          labels: Record<string, string>): IMenu[] => [
    {id: "expandAll", icon: "iconExpand", label: labels.expandAll, click: () => select("expandAll")},
    {id: "foldAll", icon: "iconContract", label: labels.foldAll, click: () => select("foldAll")},
    {id: "separator_all", type: "separator"},
    ...Array.from({length: 6}, (_, index): IMenu => ({
        id: `level${index + 1}`, iconHTML: "",
        label: labels.listMindmapExpandToLevel.replace("${level}", String(index + 1)),
        click: () => select(index + 1),
    })),
];
