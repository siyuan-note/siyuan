import {isSensitiveLayoutData} from "../protyle/util/compatibility";

const key = "siyuan-ui-reload-layout";

const validLayout = (value: any): boolean => {
    const object = (node: any) => !!node && typeof node === "object" && !Array.isArray(node);
    const tree = (node: any, depth = 0): boolean => {
        if (!object(node) || depth > 100) return false;
        if (node.instance === "Layout" || node.instance === "Wnd") {
            return Array.isArray(node.children) && node.children.every((child: any) =>
                (node.instance === "Wnd" ? child?.instance === "Tab" :
                    child?.instance === "Layout" || child?.instance === "Wnd") && tree(child, depth + 1));
        }
        if (node.instance !== "Tab") return false;
        return (object(node.children) && !["Layout", "Wnd", "Tab"].includes(node.children.instance) &&
            !("children" in node.children)) ||
            (Array.isArray(node.children) && !node.children.length);
    };
    const root = value?.layout;
    if (!tree(root) || root.instance !== "Layout" || root.children.length !== 2 ||
        root.children[0]?.instance !== "Layout" || root.children[0].children.length !== 3 ||
        root.children[0].children[0]?.type !== "left" || root.children[0].children[1]?.type !== "center" ||
        root.children[0].children[2]?.type !== "right" || root.children[1]?.type !== "bottom") return false;
    if (root.children[0].children[1].instance !== "Layout" ||
        ![root.children[0].children[0], root.children[0].children[2], root.children[1]].every(dock =>
            dock.instance === "Layout" && dock.children.length === 2 &&
            dock.children.every((section: any) => section.instance === "Wnd"))) return false;
    return ["left", "right", "bottom"].every(side => object(value[side]) && Array.isArray(value[side].data) &&
        value[side].data.length <= 2 && value[side].data.every((section: any) => Array.isArray(section) &&
            section.every((tab: any) => object(tab) && typeof tab.type === "string" && object(tab.size))));
};

export const clearReloadSnapshot = () => {
    try {
        sessionStorage.removeItem(key);
    } catch (_) { /* 存储不可用时继续使用工作区布局。 */ }
};

export const removeLayoutScroll = (value: any): void => {
    if (!value || typeof value !== "object") return;
    delete value.scrollAttr;
    Object.values(value).forEach(removeLayoutScroll);
};

export const saveReloadSnapshot = (layout: any) => {
    clearReloadSnapshot();
    if (window.siyuan.config.readonly) return false;
    try {
        sessionStorage.setItem(key, JSON.stringify({workspace: window.siyuan.config.system.workspaceDir, layout}));
        return true;
    } catch (_) { /* 配额不足时不阻塞重载。 */ }
    return false;
};

export const consumeReloadSnapshot = () => {
    try {
        const raw = sessionStorage.getItem(key);
        clearReloadSnapshot();
        if (!raw || window.siyuan.config.readonly) return;
        const snapshot = JSON.parse(raw);
        if (snapshot?.workspace !== window.siyuan.config.system.workspaceDir || !validLayout(snapshot.layout)) return;
        const sanitize = (node: any) => {
            if (!node || typeof node !== "object") return;
            if (Array.isArray(node.children)) {
                node.children = node.children.filter((child: any) =>
                    child?.instance !== "Tab" || !isSensitiveLayoutData(child.children));
                node.children.forEach(sanitize);
            } else {
                sanitize(node.children);
            }
        };
        sanitize(snapshot.layout.layout);
        return snapshot.layout;
    } catch (_) { /* 损坏的快照回退到工作区布局。 */ }
};
