import {hasAVLocationCoordinates, validateAVLocation} from "../locationValue";
import type {AVMapPoint} from "./protocol";
import {isAVMapIdentifier, isAVMapProjectionSupported} from "./protocol";

export const getMapSettings = (view: IAVTable): IAVMapSettings => ({
    locationKeyID: view.map?.locationKeyID || "",
});

// 只使用选定字段的已加载行，WGS84 坐标不会被裁切或改写。
export const getMapPoints = (view: IAVTable) => {
    const points: AVMapPoint[] = [];
    const skipped = {empty: 0, invalid: 0, projection: 0};
    const fieldID = getMapSettings(view).locationKeyID;
    const fieldIndex = view.columns.findIndex(column => column.id === fieldID && column.type === "location");
    if (fieldIndex < 0) {
        return {points, skipped, missingField: true};
    }
    const used = new Set<string>();
    view.rows.forEach(row => {
        const cell = row.cells.find(item => item.value?.keyID === fieldID) || row.cells[fieldIndex];
        const location = cell?.value?.type === "location" ? cell.value.location : undefined;
        if (!location || location.latitude == null && location.longitude == null) {
            skipped.empty++;
        } else if (!validateAVLocation(location) || !hasAVLocationCoordinates(location) || !isAVMapIdentifier(row.id) || used.has(row.id)) {
            skipped.invalid++;
        } else if (!isAVMapProjectionSupported(location.latitude)) {
            skipped.projection++;
        } else {
            used.add(row.id);
            points.push({id: row.id, longitude: location.longitude, latitude: location.latitude});
        }
    });
    return {points, skipped, missingField: false};
};

export const canLoadMapHost = (context: {
    published: boolean;
    history: boolean;
    protocol: string;
}) => !context.published && !context.history && ["http:", "https:"].includes(context.protocol);

interface IMapLifecycle {
    root: HTMLElement;
    destroy: () => void;
}

const lifecycles = new WeakMap<HTMLElement, IMapLifecycle>();
const mountedBlocks = new Set<HTMLElement>();
let removalObserver: MutationObserver;

export const destroyMap = (blockElement: HTMLElement) => {
    const state = lifecycles.get(blockElement);
    lifecycles.delete(blockElement);
    mountedBlocks.delete(blockElement);
    state?.destroy();
    if (mountedBlocks.size === 0) {
        removalObserver?.disconnect();
        removalObserver = undefined;
    }
};

export const registerMap = (blockElement: HTMLElement, state: IMapLifecycle) => {
    destroyMap(blockElement);
    lifecycles.set(blockElement, state);
    mountedBlocks.add(blockElement);
    if (!removalObserver) {
        removalObserver = new MutationObserver(() => {
            mountedBlocks.forEach(block => {
                const current = lifecycles.get(block);
                if (!block.isConnected || !current?.root.isConnected || !block.contains(current.root)) {
                    destroyMap(block);
                }
            });
        });
        removalObserver.observe(document.body, {childList: true, subtree: true});
    }
    return () => lifecycles.get(blockElement) === state && state.root.isConnected && blockElement.contains(state.root);
};
