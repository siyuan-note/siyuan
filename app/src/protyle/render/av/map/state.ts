import {hasAVLocationCoordinates, validateAVLocation} from "../locationValue";
import type {AVMapPoint, AVMapProvider} from "./protocol";
import {isAVMapIdentifier, isAVMapProjectionSupported, supportsAVMapCoordinateSystem} from "./protocol";

export const getMapSettings = (view: IAVTable): IAVMapSettings => ({
    serviceID: view.map?.serviceID || "",
    locationKeyID: view.map?.locationKeyID || "",
    showRecordList: view.map?.showRecordList !== false,
});

// 只使用选定字段的已加载行，缺失或不兼容的来源坐标不会被猜测或改写。
export const getMapPoints = (view: IAVTable, provider: AVMapProvider) => {
    const points: AVMapPoint[] = [];
    const skipped = {empty: 0, invalid: 0, unknown: 0, mismatch: 0, projection: 0};
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
        } else if (!location.coordinateSystem || location.coordinateSystem === "unknown") {
            skipped.unknown++;
        } else if (!supportsAVMapCoordinateSystem(provider, location.coordinateSystem)) {
            skipped.mismatch++;
        } else if (!isAVMapProjectionSupported(provider, location.latitude)) {
            skipped.projection++;
        } else {
            used.add(row.id);
            points.push({id: row.id, longitude: location.longitude, latitude: location.latitude,
                coordinateSystem: location.coordinateSystem});
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
