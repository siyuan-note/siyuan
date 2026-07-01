/**
 * 新建文档路径解析。输入为内核渲染后的路径模板。
 *
 * 调用方先采集 `path`，再转为 `hPath` 传入；跨笔记本时 `hPath` 固定为 `/`。
 *
 * 标题优先级：`name` > 路径末段（文档名模式）> 空。`name` 替换末段，非拼接。
 *
 * 三种形态：
 * - 尾 `/` → 父文档路径：路径为父文档链，新文档建在最内层父文档内；未传 `name` 时空标题
 * - 非尾 `/` → 文档名：末段为标题，其余为父路径
 * - 空 → 同笔记本 + 有上下文则当前文档子文档；跨笔记本或无上下文则目标笔记本根路径
 *
 * `/` 开头从根解析，否则相对 `hPath`；`..` 向上一级，已在根则停在 `/`。
 * 跨笔记本时相对路径在开头补 `/`，按目标笔记本根解析；空路径也回退到目标笔记本根路径。
 */

import {mergePathSegments} from "./mergePathSegments";

/** 内核 `createDocsByHPath` 按 HPath 逐级创建 */
export type NewDocTargetByHPath = {
    kind: "hPath";
    targetNotebookId: string;
    hPath: string;
    title: string;
};

/** 在已知父路径下创建子文档 */
export type NewDocTargetSubDoc = {
    kind: "subDoc";
    targetNotebookId: string;
    parentPath: string;
    title: string;
};

export type NewDocTarget = NewDocTargetByHPath | NewDocTargetSubDoc;

/** 按保存路径配置解析新建目标 */
export const getNewDocTargetFromSavePath = (request: {
    templatePath: string;
    hPath: string;
    targetNotebookId: string;
    currentNotebookId: string;
    name?: string;
    hasFocusTarget: boolean;
    currentPath?: string;
}): NewDocTarget => {
    const {targetNotebookId} = request;

    let templatePath = request.templatePath.trim();
    let isAbsolute = templatePath.startsWith("/");
    if (targetNotebookId !== request.currentNotebookId && templatePath && !isAbsolute) {
        // 跨笔记本时相对路径无锚点，在开头补 `/` 按目标笔记本根路径解析
        templatePath = "/" + templatePath;
        isAbsolute = true;
    }

    // 空路径 + 同笔记本 + 有上下文 + 无 name：在已知父路径下建空标题子文档
    // 跨笔记本时 currentPath 属于当前笔记本，在目标笔记本中无效，落到下方 hPath 逻辑回退到目标笔记本根
    if (!templatePath && request.hasFocusTarget && !request.name
        && targetNotebookId === request.currentNotebookId) {
        return {
            kind: "subDoc",
            targetNotebookId,
            parentPath: request.currentPath || "/",
            title: "",
        };
    }

    let parentTemplate: string;
    let title = "";
    if (!templatePath) {
        // 空路径 + 有上下文 → 当前路径下；空路径 + 无上下文 → 笔记本根
        parentTemplate = request.hasFocusTarget ? "" : "/";
        title = request.name || "";
    } else if (templatePath.endsWith("/")) {
        // 尾部有 `/`：解析父文档链，在最内层父文档内新建
        parentTemplate = templatePath;
        title = request.name || "";
    } else {
        const segments = templatePath.split("/").filter(Boolean);
        if (segments.length <= 1) {
            // 文档名
            parentTemplate = isAbsolute ? "/" : "";
        } else {
            // 路径：去掉末段（文档名），余下段拼成父路径模板
            const parentSegmentPath = segments.slice(0, -1).join("/");
            parentTemplate = isAbsolute ? "/" + parentSegmentPath : parentSegmentPath;
        }
        title = request.name || segments[segments.length - 1];
    }

    // 将路径模板合并进 hPath
    const templateSegments = parentTemplate.split("/").filter(Boolean);
    let parentPathSegments: string[];
    if (parentTemplate.startsWith("/")) {
        // 绝对路径：从笔记本根起算
        parentPathSegments = mergePathSegments([], templateSegments);
    } else {
        // 相对路径：从当前 hPath 起算
        parentPathSegments = mergePathSegments(request.hPath.split("/").filter(Boolean), templateSegments);
    }

    let hPath: string;
    if (title) {
        hPath = "/" + [...parentPathSegments, title].join("/");
    } else {
        // 空标题时保留尾 `/` 使 hPath 末段为空，内核按父文档链在其内新建子文档
        hPath = parentPathSegments.length === 0 ? "/" : "/" + parentPathSegments.join("/") + "/";
    }

    return {
        kind: "hPath",
        targetNotebookId,
        hPath,
        title,
    };
};

/** 文件树指定位置：在 `currentPath` 下建子文档，标题规则同保存路径 */
export const getNewDocTargetFromTree = (request: {
    templatePath: string;
    currentNotebookId: string;
    currentPath: string;
    name?: string;
}): NewDocTargetSubDoc => {
    const templatePath = request.templatePath.trim();
    let title = "";
    if (request.name) {
        title = request.name;
    } else if (templatePath && !templatePath.endsWith("/")) {
        const segments = templatePath.split("/").filter(Boolean);
        title = segments[segments.length - 1];
    }
    return {
        kind: "subDoc",
        targetNotebookId: request.currentNotebookId,
        parentPath: request.currentPath || "/",
        title,
    };
};
