import type {IBacklinkAVTarget} from "./backlink";

interface IBacklinkAVSource {
    element: HTMLElement;
    source: string;
    target: string;
}

export const captureBacklinkAVSources = (nodes: Node[], targets: IBacklinkAVTarget[]) => {
    const sources = new Map<string, IBacklinkAVSource>();
    nodes.forEach(node => {
        if (!(node instanceof HTMLElement)) {
            return;
        }
        const databases = node.matches(".av[data-node-id]") ? [node] :
            Array.from(node.querySelectorAll<HTMLElement>(".av[data-node-id]"));
        databases.forEach(element => {
            const target = targets.find(item => item.blockID === element.dataset.nodeId);
            if (!target?.matches.length) {
                return;
            }
            const source = element.cloneNode(true) as HTMLElement;
            // 修改时间不改变数据库副本的配置，单元格内容由事务刷新。
            source.removeAttribute("updated");
            sources.set(element.dataset.nodeId, {
                element,
                source: source.outerHTML,
                target: JSON.stringify(target.matches.map(item => ({
                    itemID: item.itemID,
                    keyID: item.keyID,
                    defIDs: item.defIDs,
                }))),
            });
        });
    });
    return sources;
};

// 同一反链条目内复用已渲染的数据库，保留滚动位置、虚拟窗口和选区。
export const reuseBacklinkAVSources = (nodes: Node[], sources: Map<string, IBacklinkAVSource>,
                                      previous: Map<string, IBacklinkAVSource>) => {
    const scrollPositions: {element: HTMLElement, top: number, left: number}[] = [];
    sources.forEach((source, id) => {
        const old = previous.get(id);
        if (!old || old.source !== source.source || old.target !== source.target ||
            !old.element.isConnected || old.element.getAttribute("data-render") !== "true") {
            return;
        }
        [old.element, ...Array.from(old.element.querySelectorAll<HTMLElement>("*"))].forEach(element => {
            if (element.scrollTop || element.scrollLeft) {
                scrollPositions.push({element, top: element.scrollTop, left: element.scrollLeft});
            }
        });
        const updated = source.element.getAttribute("updated");
        if (updated !== null) {
            old.element.setAttribute("updated", updated);
        } else {
            old.element.removeAttribute("updated");
        }
        const index = nodes.indexOf(source.element);
        source.element.replaceWith(old.element);
        if (index !== -1) {
            nodes[index] = old.element;
        }
        source.element = old.element;
    });
    // 节点重新接入文档后同步恢复各层滚动，避免移动节点时浏览器重置视口。
    return () => {
        scrollPositions.forEach(({element, top, left}) => {
            element.scrollTop = top;
            element.scrollLeft = left;
        });
    };
};
