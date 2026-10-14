import type {App} from "../index";

const settingsApps = new WeakSet<App>();

// 设置窗口的插件实例独立于宿主，设置界面的宿主操作仍通过原有桥接处理。
export const createSettingsPluginApp = (appId: string): App => {
    const app: App = {appId, plugins: []};
    settingsApps.add(app);
    return app;
};

export const isSettingsPluginApp = (app: App) => settingsApps.has(app);
