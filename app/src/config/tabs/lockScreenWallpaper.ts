import {ContractFormData} from "../../util/contractFormData";
import {fetchSyncPost} from "../../util/fetch";
import {showMessage} from "../../dialog/message";
import {appearanceConfigApi} from "./appearanceRuntime";

const wallpaperURL = "/api/system/getLockScreenWallpaper";

export const genLockScreenWallpaperHtml = () => {
    const lang = window.siyuan.languages;
    return `<div class="fn__flex b3-label config-item" data-lock-screen-wallpaper>
    <div class="fn__flex-1 config-item__main">
        <div class="config-name">${lang.lockScreenWallpaper}</div>
        <div class="b3-label__text">${lang.lockScreenWallpaperTip}</div>
        <img class="config-lock-screen-wallpaper fn__none" alt="${lang.lockScreenWallpaper}" data-wallpaper-preview>
    </div>
    <span class="fn__space"></span>
    <div class="fn__flex fn__flex-column fn__flex-center fn__size200">
        <button class="b3-button b3-button--outline fn__flex-center fn__size200" data-wallpaper-upload><svg><use xlink:href="#iconUpload"></use></svg>${lang.upload}</button>
        <div class="fn__hr--small"></div>
        <button class="b3-button b3-button--outline fn__flex-center fn__size200" data-wallpaper-reset><svg><use xlink:href="#iconUndo"></use></svg>${lang.reset}</button>
    </div>
    <input class="fn__none" type="file" accept="image/jpeg,image/png,image/webp" data-wallpaper-file>
</div>`;
};

export const syncLockScreenWallpaper = () => {
    document.querySelectorAll<HTMLElement>("[data-lock-screen-wallpaper]").forEach(element => {
        const preview = element.querySelector<HTMLImageElement>("[data-wallpaper-preview]");
        preview.classList.add("fn__none");
        if (window.siyuan.config.appearance.lockScreenWallpaper) {
            preview.onload = () => preview.classList.remove("fn__none");
            preview.onerror = () => preview.classList.add("fn__none");
            preview.src = `${wallpaperURL}?v=${Date.now()}`;
        } else {
            preview.removeAttribute("src");
        }
    });
};

export const mountLockScreenWallpaper = (root: HTMLElement) => {
    const element = root.querySelector<HTMLElement>("[data-lock-screen-wallpaper]");
    if (!element) {
        return;
    }
    syncLockScreenWallpaper();
    const input = element.querySelector<HTMLInputElement>("[data-wallpaper-file]");
    const upload = element.querySelector<HTMLButtonElement>("[data-wallpaper-upload]");
    const reset = element.querySelector<HTMLButtonElement>("[data-wallpaper-reset]");
    let busy = false;
    const run = async (operation: () => Promise<void>) => {
        if (busy || window.siyuan.config.readonly) {
            return;
        }
        busy = true;
        upload.disabled = true;
        reset.disabled = true;
        try {
            await operation();
            syncLockScreenWallpaper();
        } catch (error) {
            showMessage(error instanceof Error ? error.message : String(error), 7000, "error");
        } finally {
            busy = false;
            upload.disabled = false;
            reset.disabled = false;
            input.value = "";
        }
    };
    const checkResponse = (response: IWebSocketData) => {
        if (response.code !== 0) {
            throw new Error(response.msg);
        }
    };
    upload.addEventListener("click", () => input.click());
    input.addEventListener("change", () => {
        const file = input.files?.[0];
        if (!file) {
            return;
        }
        void run(async () => {
            if (file.size > 10 * 1024 * 1024) {
                throw new Error(window.siyuan.languages._kernel[438]);
            }
            checkResponse(await fetchSyncPost("/api/system/uploadLockScreenWallpaper", new ContractFormData({file})));
            await appearanceConfigApi.patch("lockScreenWallpaper", true);
        });
    });
    reset.addEventListener("click", () => {
        void run(async () => {
            await appearanceConfigApi.patch("lockScreenWallpaper", false);
            checkResponse(await fetchSyncPost("/api/system/removeLockScreenWallpaper"));
        });
    });
};
