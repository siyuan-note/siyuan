import type {DocTreeController} from "./DocTreeController";

export const refreshImportedDocTree = async (tree: DocTreeController, data: {notebook: string, parentPath: string}) => {
    const parts = data.parentPath.split("/").filter(Boolean);
    const parentID = parts.pop()?.replace(/\.sy$/, "") || "";
    if (parentID) {
        // 子文档数量属于上级目录中的目标行，空叶子的子目录刷新不会更新该行。
        await tree.reload({notebook: data.notebook, parentID: parts.pop() || ""});
    }
    await tree.reload({notebook: data.notebook, parentID});
};
