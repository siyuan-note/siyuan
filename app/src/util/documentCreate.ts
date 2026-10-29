import type {CreateDocByParentRequestInput} from "../types/api";

const documentIDPattern = /^\d{14}-[a-z0-9]{7}$/;

/** 从已知 ID 数据路径取得父身份，标题和展示路径不能传入这里。 */
export const documentParentID = (dataPath: string): string | null => {
    if (dataPath === "/") {
        return null;
    }
    const segments = dataPath.replace(/\.sy$/, "").split("/");
    if (segments.shift() !== "" || !segments.length || segments.some(segment => !documentIDPattern.test(segment))) {
        throw new Error("Invalid document data path");
    }
    return segments[segments.length - 1];
};

export const documentCreateRequest = (notebook: string, parentPath: string, id: string, title: string,
                                      markdown = ""): CreateDocByParentRequestInput => ({
    notebook,
    parentID: documentParentID(parentPath),
    id,
    title: {format: "plain", text: title},
    markdown,
});

/** 后续模板失败不抹掉已提交文档的身份；未知提交状态不能当作成功或换 ID 重试。 */
export const createdDocumentID = (data: unknown): string | undefined => {
    if (!data || typeof data !== "object" || !("id" in data) || typeof data.id !== "string" ||
        !documentIDPattern.test(data.id)) {
        return;
    }
    if ("document" in data || "commitState" in data && data.commitState === "committed") {
        return data.id;
    }
};
