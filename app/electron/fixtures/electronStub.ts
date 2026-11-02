// 测试专用的 Electron 替身。纯 Node 环境里 `require("electron")` 只返回可执行文件路径字符串，
// `app` / `BrowserWindow` 都是 undefined，因此被测模块的 `import {app} from "electron"` 需要这份替换。
import type {App, BrowserWindow as ElectronBrowserWindow, IpcMain, Session} from "electron";

/** 未提供实现时被调用即抛错，让缺失的替身立刻暴露而不是静默返回 undefined。 */
const missing = (name: string): never => {
    throw new Error("electron stub member [" + name + "] is not provided for this test");
};

const defaultApp = {
    getVersion: () => "0.0.0",
    getName: () => "SiYuan",
    getPath: () => "/tmp",
    getPreferredSystemLanguages: () => ["en"],
    getLocale: () => "en",
    isReady: () => true,
    isPackaged: false,
    commandLine: {appendSwitch: () => {}},
} as unknown as App;

const DefaultBrowserWindow = class {
    static getAllWindows(): unknown[] {
        return [];
    }

    static getFocusedWindow(): undefined {
        return undefined;
    }

    static fromWebContents(): undefined {
        return undefined;
    }
} as unknown as typeof ElectronBrowserWindow;

/** 被测代码会直接读取的 Electron 成员。测试只需覆盖真正用到的那几个。 */
type ElectronStub = {
    app: App;
    BrowserWindow: typeof ElectronBrowserWindow;
    screen: Record<string, unknown>;
    ipcMain: IpcMain;
    session: Session;
    net: Record<string, unknown>;
    dialog: Record<string, unknown>;
    shell: Record<string, unknown>;
    powerMonitor: Record<string, unknown>;
    Menu: Record<string, unknown>;
    Tray: Record<string, unknown>;
    globalShortcut: Record<string, unknown>;
    safeStorage: Record<string, unknown>;
    clipboard: Record<string, unknown>;
    nativeTheme: Record<string, unknown>;
};

const defaults = (): ElectronStub => ({
    app: defaultApp,
    BrowserWindow: DefaultBrowserWindow,
    screen: {getPrimaryDisplay: () => missing("screen.getPrimaryDisplay")},
    ipcMain: {} as IpcMain,
    session: {} as Session,
    net: {fetch: () => missing("net.fetch"), isOnline: () => true},
    dialog: {showMessageBox: () => missing("dialog.showMessageBox"), showErrorBox: () => missing("dialog.showErrorBox")},
    shell: {openExternal: () => missing("shell.openExternal")},
    powerMonitor: {},
    Menu: {},
    Tray: {},
    globalShortcut: {},
    safeStorage: {},
    clipboard: {},
    nativeTheme: {},
});

/** 被测代码看到的成员值。测试改这里即可影响已经加载的模块。 */
const electronStub: ElectronStub = defaults();

/** 交给 `t.mock.module` 的载体：它在调用时快照 exports，因此每个属性只做 getter，始终转发到当前的 `electronStub`。 */
const electronStubExports: Record<string, unknown> = {};
for (const key of Object.keys(electronStub)) {
    Object.defineProperty(electronStubExports, key, {
        enumerable: true,
        get: () => (electronStub as unknown as Record<string, unknown>)[key],
    });
}

/** 恢复默认替身。测试之间必须调用，否则上一个用例的桩会泄漏到下一个。 */
const resetElectronStub = (): void => {
    const fresh = defaults();
    for (const key of Object.keys(fresh) as (keyof ElectronStub)[]) {
        (electronStub as unknown as Record<string, unknown>)[key] = fresh[key];
    }
};

type MockableTest = {mock: {module: (specifier: string, options: {exports: unknown}) => void}};

// `t.mock.module` 对同一模块在同一条用例里只能调用一次，重复调用会抛 ERR_INVALID_STATE。
// 载体是稳定的，因此每条用例只需建立一次绑定，后续 setup 只改成员值。
const boundContexts = new WeakSet<MockableTest>();

/**
 * 把 `electron` 换成替身，并覆盖测试需要的成员。
 *
 * 必须在 `require("./被测模块")` 之前调用：模块首次加载时才会解析 `electron`。
 * 同一条用例内可重复调用，只有第一次会建立绑定。
 */
const mockElectron = (t: MockableTest, overrides: Partial<ElectronStub> = {}): ElectronStub => {
    for (const key of Object.keys(overrides) as (keyof ElectronStub)[]) {
        (electronStub as unknown as Record<string, unknown>)[key] = overrides[key];
    }
    if (!boundContexts.has(t)) {
        boundContexts.add(t);
        t.mock.module("electron", {exports: electronStubExports});
    }
    return electronStub;
};

export {mockElectron, resetElectronStub};
