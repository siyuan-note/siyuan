import {App} from "../index";
import {Plugin} from "../plugin";
import {getAllModels} from "../layout/getAll";
import {exportLayout, resizeTopBar} from "../layout/util";
import {Constants} from "../constants";

export const uninstall = (app: App, name: string) => {
    app.plugins.find((plugin: Plugin, index) => {
        if (plugin.name === name) {
            // rm command
            try {
                plugin.onunload();
            } catch (e) {
                console.error(`plugin ${plugin.name} onunload error:`, e);
            }
            // rm tab
            const modelsKeys = Object.keys(plugin.models);
            getAllModels().custom.forEach(custom => {
                if (modelsKeys.includes(custom.type)) {
                    custom.parent.parent.removeTab(custom.parent.id);
                }
            });
            // rm topBar
            plugin.topBarIcons.forEach(item => {
                item.remove();
            });
            resizeTopBar();
            // rm statusBar
            /// #if !MOBILE
            plugin.statusBarIcons.forEach(item => {
                item.remove();
            });
            /// #endif
            // rm dock
            const docksKeys = Object.keys(plugin.docks);
            docksKeys.forEach(key => {
                if (Object.keys(window.siyuan.layout.leftDock.data).includes(key)) {
                    window.siyuan.layout.leftDock.remove(key);
                } else if (Object.keys(window.siyuan.layout.rightDock.data).includes(key)) {
                    window.siyuan.layout.rightDock.remove(key);
                } else if (Object.keys(window.siyuan.layout.bottomDock.data).includes(key)) {
                    window.siyuan.layout.bottomDock.remove(key);
                }
            });
            // rm listen
            Array.from(document.childNodes).find(item => {
                if (item.nodeType === 8 && item.textContent === name) {
                    item.remove();
                    return true;
                }
            });
            // rm plugin
            app.plugins.splice(index, 1);

            setTimeout(() => {
                exportLayout({
                    reload: false,
                    onlyData: false,
                    errorExit: false
                });
            }, Constants.TIMEOUT_LOAD); // 移除页签时切换到新的文档页签，需等待新页签初始化完成，才有 editor.protyle.block 等数据
            return true;
        }
    });
};
