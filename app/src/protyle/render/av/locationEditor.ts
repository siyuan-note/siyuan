import {Dialog} from "../../../dialog";
import {escapeHtml} from "../../../util/escape";
import {isMobile} from "../../../util/functions";
import {bindBottomSheetDialog} from "../../../mobile/util/bindBottomSheetDialog";
/// #if MOBILE
import {activeBlur} from "../../../mobile/util/keyboardToolbar";
/// #endif
import {beginAVEditorSession} from "./editorSession";
import {AV_CELL_EDITOR_CLOSE_EVENT} from "./cellEditor";
import {
    areAVLocationsEqual,
    createAVLocationReplacement,
    formatAVLocationCoordinate,
    isAVLocationCoordinateSystem,
    parseAVLocationCoordinate,
    parseAVLocationCoordinates,
    validateAVLocation,
} from "./locationValue";

interface AVLocationEditorOptions {
    value?: IAVCellLocationValue;
    onSave: (value: IAVCellLocationValue) => void | Promise<void>;
    onDestroy?: () => void;
    ownerElement?: HTMLElement;
    avBlockID?: string;
    isValid?: () => boolean;
}

export const openAVLocationEditor = (options: AVLocationEditorOptions) => {
    if (document.querySelector('[data-av-location-editor]:not([data-dialog-closing="true"])')) {
        options.onDestroy?.();
        return;
    }
    const initial = createAVLocationReplacement(options.value);
    const mobile = isMobile();
    const languages = window.siyuan.languages;
    let originalInput = initial.originalInput;
    let parsedInput: string | undefined;
    let saving = false;
    let closing = false;
    let composing = false;
    let disposeSheet: (() => void) | undefined;
    let ownerObserver: MutationObserver | undefined;
    const endEditorSession = options.ownerElement ? beginAVEditorSession(options.ownerElement) : undefined;
    const dialog = new Dialog({
        title: escapeHtml(languages.location),
        width: mobile ? "100vw" : "480px",
        content: `<div class="b3-dialog__content">
    <div class="b3-label b3-label--inner">
        <label>${escapeHtml(languages.locationName)}
            <span class="fn__hr"></span><input class="b3-text-field fn__block" data-field="name" type="text">
        </label>
    </div>
    <div class="b3-label b3-label--inner fn__flex">
        <label class="fn__flex-1">${escapeHtml(languages.latitude)}
            <span class="fn__hr"></span><input class="b3-text-field fn__block" data-field="latitude" type="text" inputmode="decimal" spellcheck="false">
        </label>
        <div class="fn__space"></div>
        <label class="fn__flex-1">${escapeHtml(languages.longitude)}
            <span class="fn__hr"></span><input class="b3-text-field fn__block" data-field="longitude" type="text" inputmode="decimal" spellcheck="false">
        </label>
    </div>
    <div class="b3-label b3-label--inner">
        <label>${escapeHtml(languages.coordinateSystem)}
            <span class="fn__hr"></span><select class="b3-select fn__block" data-field="coordinateSystem">
                <option value="" disabled>${escapeHtml(languages.selectCoordinateSystem)}</option>
                <option value="wgs84">${escapeHtml(languages.coordinateSystemWGS84)}</option>
                <option value="gcj02">${escapeHtml(languages.coordinateSystemGCJ02)}</option>
                <option value="bd09">${escapeHtml(languages.coordinateSystemBD09)}</option>
            </select>
        </label>
        <div class="b3-label__text">${escapeHtml(languages.coordinateSystemTip)}</div>
    </div>
    <div class="b3-label b3-label--inner">
        <label>${escapeHtml(languages.coordinateOrder)}
            <span class="fn__hr"></span><select class="b3-select fn__block" data-field="coordinateOrder">
                <option value="latitudeLongitude">${escapeHtml(languages.latitude)}, ${escapeHtml(languages.longitude)}</option>
                <option value="longitudeLatitude">${escapeHtml(languages.longitude)}, ${escapeHtml(languages.latitude)}</option>
            </select>
        </label>
    </div>
    <div class="b3-label b3-label--inner">
        <label>${escapeHtml(languages.pasteCoordinates)}
            <span class="fn__hr"></span><textarea class="b3-text-field fn__block" data-field="paste" rows="2" spellcheck="false"></textarea>
        </label>
    </div>
    <button type="button" class="b3-button b3-button--outline" data-action="parse">${escapeHtml(languages.confirm)}</button>
    <div class="ft__error fn__none" style="margin-top:8px" data-role="error" role="alert" aria-live="polite"></div>
</div>
<div class="b3-dialog__action">
    <button type="button" class="b3-button b3-button--text" data-action="clear">${escapeHtml(languages.clear)}</button>
    <span class="fn__flex-1"></span>
    <button type="button" class="b3-button b3-button--cancel" data-action="cancel">${escapeHtml(languages.cancel)}</button>
    <span class="fn__space"></span>
    <button type="button" class="b3-button b3-button--text" data-action="save">${escapeHtml(languages.save)}</button>
</div>`,
        destroyCallback: () => options.onDestroy?.(),
    });
    const root = dialog.element;
    root.dataset.avLocationEditor = "true";
    if (options.avBlockID) {
        root.dataset.avBlockId = options.avBlockID;
    }
    const container = root.querySelector<HTMLElement>(".b3-dialog__container");
    container.style.maxHeight = mobile ? "min(80vh, 100%)" : "90vh";
    const nameInput = root.querySelector<HTMLInputElement>('[data-field="name"]');
    const latitudeInput = root.querySelector<HTMLInputElement>('[data-field="latitude"]');
    const longitudeInput = root.querySelector<HTMLInputElement>('[data-field="longitude"]');
    const systemInput = root.querySelector<HTMLSelectElement>('[data-field="coordinateSystem"]');
    const orderInput = root.querySelector<HTMLSelectElement>('[data-field="coordinateOrder"]');
    orderInput.value = "latitudeLongitude";
    const pasteInput = root.querySelector<HTMLTextAreaElement>('[data-field="paste"]');
    const errorElement = root.querySelector<HTMLElement>('[data-role="error"]');
    const controls = root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement>(
        "input, select, textarea, button");
    nameInput.value = initial.name || "";
    latitudeInput.value = initial.latitude == null ? "" : formatAVLocationCoordinate(initial.latitude);
    longitudeInput.value = initial.longitude == null ? "" : formatAVLocationCoordinate(initial.longitude);
    pasteInput.value = initial.originalInput || "";
    parsedInput = pasteInput.value;
    // 旧值未注明坐标系时保留空选项，必须明确选择，不能打开即重标。
    systemInput.value = initial.coordinateSystem && initial.coordinateSystem !== "unknown" &&
        isAVLocationCoordinateSystem(initial.coordinateSystem) ? initial.coordinateSystem : "";
    const hasSelectedSystem = () => systemInput.value !== "unknown" && isAVLocationCoordinateSystem(systemInput.value);
    const parsePaste = () => parseAVLocationCoordinates(pasteInput.value,
        systemInput.value as IAVCellLocationValue["coordinateSystem"],
        orderInput.value === "longitudeLatitude" ? "longitudeLatitude" : "latitudeLongitude");

    const setError = (message = "") => {
        errorElement.textContent = message;
        errorElement.classList.toggle("fn__none", !message);
    };
    const destroy = dialog.destroy.bind(dialog);
    dialog.destroy = (destroyOptions?: IObject) => {
        if (closing) {
            return;
        }
        closing = true;
        ownerObserver?.disconnect();
        disposeSheet?.();
        /// #if MOBILE
        if (mobile && root.contains(document.activeElement)) {
            activeBlur(true);
        }
        /// #endif
        destroy(destroyOptions);
        endEditorSession?.();
    };

    const isOwnerConnected = () => (!options.ownerElement || options.ownerElement.isConnected) &&
        (!options.isValid || options.isValid());
    const submit = async (clear = false) => {
        if (saving || closing || composing) {
            return;
        }
        if (!isOwnerConnected()) {
            dialog.destroy();
            return;
        }
        let value: IAVCellLocationValue = {coordinateSystem: "unknown"};
        if (!clear) {
            if (!hasSelectedSystem()) {
                setError(languages.selectCoordinateSystem);
                systemInput.focus();
                return;
            }
            // 未确认的导入文本不能在保存时被静默丢弃，错误输入也保持原样可编辑。
            if (pasteInput.value.trim() && pasteInput.value !== parsedInput) {
                const valid = parsePaste();
                setError(valid ? `${languages.pasteCoordinates}: ${languages.confirm}` : languages.invalidCoordinates);
                if (valid) {
                    root.querySelector<HTMLButtonElement>('[data-action="parse"]').focus();
                } else {
                    pasteInput.focus();
                }
                return;
            }
            value = {name: nameInput.value.trim(), coordinateSystem: systemInput.value as IAVCellLocationValue["coordinateSystem"]};
            if (latitudeInput.value.trim() || longitudeInput.value.trim()) {
                value.latitude = parseAVLocationCoordinate(latitudeInput.value);
                value.longitude = parseAVLocationCoordinate(longitudeInput.value);
                if (value.latitude === undefined || value.longitude === undefined) {
                    setError(languages.invalidCoordinates);
                    (value.latitude === undefined ? latitudeInput : longitudeInput).focus();
                    return;
                }
            }
            if (originalInput !== undefined) {
                value.originalInput = originalInput;
            }
            if (!validateAVLocation(value)) {
                setError(languages.invalidCoordinates);
                (Math.abs(value.latitude) > 90 ? latitudeInput : longitudeInput).focus();
                return;
            }
        }
        value = createAVLocationReplacement(value);
        // 保存来源变化，但普通关闭与未修改的保存不产生事务。
        if (areAVLocationsEqual(initial, value) && initial.originalInput === value.originalInput) {
            dialog.destroy();
            return;
        }
        saving = true;
        controls.forEach(control => control.disabled = true);
        setError();
        try {
            await options.onSave(value);
            dialog.destroy();
        } catch (error) {
            if (!closing) {
                setError(error instanceof Error ? error.message : languages.invalid);
            }
        } finally {
            saving = false;
            if (!closing) {
                controls.forEach(control => control.disabled = false);
            }
        }
    };

    const clearProvenance = () => {
        originalInput = undefined;
        if (pasteInput.value === parsedInput) {
            pasteInput.value = "";
            parsedInput = undefined;
        }
        setError();
    };
    [latitudeInput, longitudeInput].forEach(input => input.addEventListener("input", clearProvenance));
    systemInput.addEventListener("change", clearProvenance);
    orderInput.addEventListener("change", () => {
        // 切换顺序不改已有坐标，只让当前粘贴文本重新等待确认。
        parsedInput = undefined;
        setError();
    });
    root.addEventListener("compositionstart", () => composing = true);
    root.addEventListener("compositionend", () => composing = false);
    root.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.isComposing || composing || event.keyCode === 229) {
            // 输入法候选确认与取消不得触发对话框提交或全局 Escape 处理。
            event.stopPropagation();
            return;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (!saving) {
                dialog.destroy();
            }
        } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.repeat) {
            event.preventDefault();
            event.stopPropagation();
            void submit();
        }
    }, true);
    root.querySelector('[data-action="cancel"]').addEventListener("click", () => dialog.destroy());
    root.addEventListener(AV_CELL_EDITOR_CLOSE_EVENT, () => dialog.destroy());
    root.querySelector('[data-action="clear"]').addEventListener("click", () => void submit(true));
    root.querySelector('[data-action="save"]').addEventListener("click", () => void submit());
    root.querySelector('[data-action="parse"]').addEventListener("click", () => {
        if (saving || closing || composing) {
            return;
        }
        if (!hasSelectedSystem()) {
            setError(languages.selectCoordinateSystem);
            systemInput.focus();
            return;
        }
        const parsed = parsePaste();
        if (!parsed) {
            setError(languages.invalidCoordinates);
            pasteInput.focus();
            return;
        }
        latitudeInput.value = formatAVLocationCoordinate(parsed.latitude);
        longitudeInput.value = formatAVLocationCoordinate(parsed.longitude);
        originalInput = parsed.originalInput;
        parsedInput = pasteInput.value;
        setError();
    });
    if (mobile) {
        disposeSheet = bindBottomSheetDialog(dialog, async () => dialog.destroy());
    } else {
        nameInput.focus();
    }
    if (options.ownerElement) {
        ownerObserver = new MutationObserver(() => {
            if (!isOwnerConnected()) {
                dialog.destroy();
            }
        });
        ownerObserver.observe(document.body, {childList: true, subtree: true});
        if (!isOwnerConnected()) {
            dialog.destroy();
        }
    }
    return dialog;
};
