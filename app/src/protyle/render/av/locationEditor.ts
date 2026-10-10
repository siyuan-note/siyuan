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
    parseAVLocationCoordinate,
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
        <label class="fn__flex-1">${escapeHtml(languages.longitude)}
            <span class="fn__hr"></span><input class="b3-text-field fn__block" data-field="longitude" type="text" inputmode="decimal" spellcheck="false">
        </label>
        <div class="fn__space"></div>
        <label class="fn__flex-1">${escapeHtml(languages.latitude)}
            <span class="fn__hr"></span><input class="b3-text-field fn__block" data-field="latitude" type="text" inputmode="decimal" spellcheck="false">
        </label>
    </div>
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
    const errorElement = root.querySelector<HTMLElement>('[data-role="error"]');
    const controls = root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>(
        "input, select, button");
    nameInput.value = initial.name || "";
    latitudeInput.value = initial.latitude == null ? "" : formatAVLocationCoordinate(initial.latitude);
    longitudeInput.value = initial.longitude == null ? "" : formatAVLocationCoordinate(initial.longitude);

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
        let value: IAVCellLocationValue = {};
        if (!clear) {
            value = {name: nameInput.value.trim()};
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
        setError();
    };
    [latitudeInput, longitudeInput].forEach(input => input.addEventListener("input", clearProvenance));
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
