/// #if !BROWSER
import * as path from "path";
/// #endif
import {useShell} from "../../util/pathName";
import {getSettingsWindowHost} from "../setting/windowContext";

export const openBazaarPath = (type: TBazaarType, name: string, storage = false) => {
    const host = getSettingsWindowHost();
    if (host) {
        host.openBazaarPath(type, name, storage);
        return;
    }
    /// #if !BROWSER
    const dataDir = window.siyuan.config.system.dataDir;
    if (!dataDir || !name || (storage && type !== "plugins")) return;
    useShell("openPath", storage ? path.join(dataDir, "storage", "petal", name) : path.join(dataDir, type, name));
    /// #endif
};
