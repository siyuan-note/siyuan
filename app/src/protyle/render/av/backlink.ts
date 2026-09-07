import {setAVLocateRequest} from "./locate";
import {trimAVRows} from "./virtualScroll";
import {stickyRow} from "./row";

const initialized = new WeakSet<HTMLElement>();

export interface IBacklinkAVTarget {
    blockID: string;
    matches: {
        itemID: string;
        keyID: string;
        valueID: string;
        title: string;
        keyName: string;
        defIDs: string[];
    }[];
}

// 每个反链副本独立定位，避免同 ID 的正文或其他反链数据库接收到定位请求。
export const prepareBacklinkAV = (element: HTMLElement, targets: IBacklinkAVTarget[]) => {
    const databases = element.matches(".av[data-node-id]") ? [element] :
        Array.from(element.querySelectorAll<HTMLElement>(".av[data-node-id]"));
    databases.forEach(database => {
        const target = targets.find(item => item.blockID === database.dataset.nodeId);
        if (!target?.matches.length) {
            return;
        }
        const match = target.matches[0];
        database.classList.add("av--backlink");
        if (!initialized.has(database)) {
            initialized.add(database);
            database.addEventListener("scroll", () => {
                stickyRow(database, database, "all");
                trimAVRows(database, database.getBoundingClientRect());
            }, {passive: true});
        }
        database.querySelectorAll(".def--mark").forEach(item => item.classList.remove("def--mark"));
        // 每个数据库副本独立展示命中条目，不移动外层阅读位置。
        setAVLocateRequest(database, {
            itemID: match.itemID,
            keyID: match.keyID,
            defIDs: match.defIDs,
            select: false,
            highlight: true,
            persistView: false,
            scroll: true,
        });
    });
};
