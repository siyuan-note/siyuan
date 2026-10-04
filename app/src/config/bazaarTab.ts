import type {App} from "../index";
import {BAZAAR_PACKAGE_TYPES, isBazaarPackageType} from "./bazaar/packageConfig";

type BazaarModule = typeof import("./bazaar");

let bazaarModulePromise: Promise<BazaarModule> | undefined;
let activeMountState: {root: HTMLElement; token: symbol; app?: App} | undefined;
let activeMountPromise: Promise<BazaarModule> | undefined;
const pendingPackageTypes = new Set<TBazaarType>();
let refreshingPackages: Promise<void> | undefined;

/** 合并变更通知，读取期间的新通知在下一轮处理，未打开集市时不加载模块。 */
export const refreshMountedBazaar = (types: readonly TBazaarType[] = BAZAAR_PACKAGE_TYPES): Promise<void> => {
    if (!activeMountState) return Promise.resolve();
    types.filter(isBazaarPackageType).forEach(type => pendingPackageTypes.add(type));
    if (refreshingPackages) return refreshingPackages;
    refreshingPackages = Promise.resolve().then(async () => {
        while (pendingPackageTypes.size) {
            const types = [...pendingPackageTypes];
            pendingPackageTypes.clear();
            const state = activeMountState;
            if (!state) continue;
            const module = await activeMountPromise;
            if (activeMountState !== state) {
                if (activeMountState) types.forEach(type => pendingPackageTypes.add(type));
                continue;
            }
            if (module.bazaar.element !== state.root || !state.root.isConnected) continue;
            await module.bazaar.refreshPackages(types, state.app);
        }
    }).catch(error => console.error("Could not refresh marketplace packages", error)).finally(() => {
        refreshingPackages = undefined;
        if (pendingPackageTypes.size) void refreshMountedBazaar([]);
    });
    return refreshingPackages;
};

const loadBazaarModule = () => {
    if (!bazaarModulePromise) {
        bazaarModulePromise = import("./bazaar");
    }
    return bazaarModulePromise;
};

/** 集市 Tab 侧栏 / 全局搜索索引文案 */
export const collectBazaarTabSearchStrings = (): string[] => [
    window.siyuan.languages.bazaar,
    window.siyuan.languages.downloaded,
    window.siyuan.languages.update,
    window.siyuan.languages.plugin,
    window.siyuan.languages.theme,
    window.siyuan.languages.icon,
    window.siyuan.languages.template,
    window.siyuan.languages.widget,
];

/** 延迟加载并挂载集市，避免将集市的插件运行时依赖拉入移动端启动链 */
export const mountBazaarTab = (
    root: HTMLElement,
    keywords?: string,
    app?: App,
): Promise<void> => {
    const state = {root, token: Symbol(), app};
    activeMountState = state;
    const mountPromise = loadBazaarModule().then((module) => {
        if (activeMountState === state) {
            module.mountBazaarTab(root, keywords, app);
        }
        return module;
    });
    activeMountPromise = mountPromise;
    return mountPromise.then(() => undefined);
};

/** 释放已挂载或正在加载的集市 */
export const unmountBazaarTab = (root: HTMLElement) => {
    if (activeMountState?.root === root) {
        activeMountState = undefined;
    }
    if (bazaarModulePromise) {
        void bazaarModulePromise.then((module) => {
            if (activeMountState?.root !== root) {
                module.unmountBazaarTab(root);
            }
        });
    }
};

/** 在最近一次集市挂载仍有效时执行回调 */
export const withMountedBazaar = async (callback: (module: BazaarModule) => void): Promise<boolean> => {
    const state = activeMountState;
    const mountPromise = activeMountPromise;
    if (!state || !mountPromise) {
        return false;
    }
    const module = await mountPromise;
    if (activeMountState !== state || module.bazaar.element !== state.root) {
        return false;
    }
    callback(module);
    return true;
};
