import IAppearance = Config.IAppearance;
import {exportLayout} from "../../layout/util";
import {appearance} from "../appearance";

export const updateAppearance = async (data:IAppearance) => {
    if (window.siyuan.config.appearance.themeJS) {
        if (data.mode !== window.siyuan.config.appearance.mode ||
            (data.mode === window.siyuan.config.appearance.mode && (
                    (data.mode === 0 && window.siyuan.config.appearance.themeLight !== data.themeLight) ||
                    (data.mode === 1 && window.siyuan.config.appearance.themeDark !== data.themeDark))
            )
        ) {
            if (window.destroyTheme) {
                try {
                    await window.destroyTheme();
                    window.destroyTheme = undefined;
                    document.getElementById("themeScript").remove();
                } catch (e) {
                    console.error("destroyTheme error: " + e);
                }
            } else {
                exportLayout({
                    errorExit: false,
                    cb() {
                        window.location.reload();
                    },
                });
                return;
            }
        }
    }
    if (data.hideStatusBar !== window.siyuan.config.appearance.hideStatusBar) {
        if (data.hideStatusBar) {
            document.getElementById("status").classList.add("fn__none");
        } else {
            document.getElementById("status").classList.remove("fn__none");
        }
    }
    appearance.onSetAppearance(data);
};
