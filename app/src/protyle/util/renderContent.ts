import {processRender} from "./processCode";
import {highlightRender} from "../render/highlightRender";
import {avRender} from "../render/av/render";
import {blockRender} from "../render/blockRender";
import {beginPerformance} from "./performance";

// 只遍历插入边界以外的新兄弟节点，不扫描、搬移旧内容。
export const getInsertedRenderRoots = (container: Element, boundary: Element | null, before: boolean) => {
    const roots: Element[] = [];
    let node = before || !boundary ? container.firstElementChild : boundary.nextElementSibling;
    while (node && (!before || node !== boundary)) {
        roots.push(node);
        node = node.nextElementSibling;
    }
    return roots;
};

export const renderContent = (protyle: IProtyle, roots: Element[], beforeAVRender?: () => void,
                             isValid?: () => boolean) => {
    const container = protyle.wysiwyg.element;
    const rootID = protyle.block.rootID;
    const canRender = (root: Element) => (!isValid || isValid()) && protyle.block.rootID === rootID &&
        (root === container || (root.isConnected && root.parentElement === container));
    // 文档替换后先更新重载基准并恢复数据库容器，再检查渲染任务是否有效。
    beforeAVRender?.();
    const currentRoots = roots.filter(canRender);
    currentRoots.forEach(root => processRender(root));
    currentRoots.forEach(root => highlightRender(root));
    // 数据库仍按文档顺序串行初始化，保留原来的请求并发和完成回调边界。
    const renderDatabases = async () => {
        const timing = beginPerformance("editor.databases");
        timing?.count("roots", currentRoots.length);
        try {
            for (const root of currentRoots) {
                if (canRender(root)) {
                    await avRender(root, protyle);
                }
            }
            return (!isValid || isValid()) && protyle.block.rootID === rootID && currentRoots.every(canRender);
        } finally {
            timing?.finish();
        }
    };
    const databases = renderDatabases();
    currentRoots.forEach(root => {
        if (canRender(root)) {
            blockRender(protyle, root);
        }
    });
    return databases;
};
