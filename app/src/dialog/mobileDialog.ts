import {Dialog} from "./index";
import {isMobile} from "../util/functions";
import {bindBottomSheetDialog} from "../mobile/util/bindBottomSheetDialog";
import type {MobileSheetMode} from "../mobile/util/mobileSheetLayout";
import {Constants} from "../constants";
import {callMobileAppShowKeyboard} from "../mobile/util/mobileAppUtil";
import {scrollInputIntoView} from "../mobile/util/visibleViewport";
import {isNotCtrl} from "../protyle/util/compatibility";
import {showMessage} from "./message";

export type MobileDialogCloseReason = "confirm" | "cancel" | "scrim" | "drag" | "back" | "escape" | "programmatic" | "invalidate";
export type MobileSheetOptions = {
    mode?: MobileSheetMode,
    expandable?: boolean,
    beforeClose?: (reason: MobileDialogCloseReason) => boolean | Promise<boolean>
};
const passive = (reason: MobileDialogCloseReason) => ["scrim", "drag", "back", "escape"].includes(reason);

// 内部业务显式接入；不改变插件导出的 Dialog 或桌面默认行为。
const adaptedDialogs = new WeakSet<Dialog>();

type MobileDialogOptions = ConstructorParameters<typeof Dialog>[0] & {mobileSheet?: MobileSheetOptions};

export interface MobileDialog extends Dialog {
    requestClose(reason: MobileDialogCloseReason, options?: IObject): Promise<boolean>;
    // 调用前先清除敏感内容；跳过保存/脏数据守卫，最终执行 destroyCallback 资源清理。
    invalidate(options?: IObject): void;
    runPending(task: () => Promise<boolean>, options?: {close?: boolean}): Promise<boolean>;
    focusWhenReady(target: () => HTMLElement, options?: {select?: boolean, showKeyboard?: boolean}): void;
    setSheetMode(mode: MobileSheetMode): void;
}

const createMobileDialogClass = () => {
    class MobileDialogImplementation extends Dialog {
        private mobile = isMobile();
        private sheetOptions: MobileSheetOptions;
        private blocked: boolean;
        private pending = false;
        private checking = false;
        private invalidating = false;
        private disposed = false;
        private ready = false;
        private focusTask: () => void;
        private reason: MobileDialogCloseReason;
        private closeTask: Promise<boolean>;
        private disposeSheet: ReturnType<typeof bindBottomSheetDialog>;
        private disposeEvents: () => void;

        constructor(options: ConstructorParameters<typeof Dialog>[0] & {mobileSheet?: MobileSheetOptions}) {
            const state: {owner?: MobileDialogImplementation} = {};
            const mobile = isMobile();
            super(mobile ? {
                ...options, width: "100vw", height: "auto",
                beforeClose: () => {
                    if (!state.owner?.invalidating && options.beforeClose?.() === false) return false;
                    state.owner?.disposeSheet?.freeze();
                    return true;
                },
                destroyCallback: value => {
                    if (state.owner) {
                        state.owner.disposed = true;
                        state.owner.focusTask = undefined;
                        state.owner.disposeSheet?.();
                        state.owner.disposeEvents?.();
                    }
                    options.destroyCallback?.(value);
                },
            } : options);
            state.owner = this;
            adaptedDialogs.add(this);
            this.sheetOptions = options.mobileSheet || {};
            this.blocked = !!options.disableClose;
            if (!mobile) return;
            const scrollActive = () => {
                if (!this.ready || this.disposed || this.element.dataset.dialogClosing === "true" || !this.topmost()) return;
                const active = document.activeElement;
                if (active && this.element.contains(active)) scrollInputIntoView(active);
            };
            this.disposeSheet = bindBottomSheetDialog(this, async () => {
                await this.requestClose("drag");
            }, scrollActive, () => {
                this.ready = true;
                this.focusTask?.();
                this.focusTask = undefined;
            }, {mode: this.sheetOptions.mode, expandable: this.sheetOptions.expandable});
            const click = (event: MouseEvent) => {
                const target = event.target as HTMLElement;
                if (target.closest(".b3-dialog__scrim")) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    void this.requestClose("scrim");
                }
            };
            const keydown = (event: KeyboardEvent) => {
                if (event.defaultPrevented || event.key !== "Escape" || event.isComposing || event.keyCode === 229 || !this.topmost()) return;
                event.preventDefault();
                event.stopImmediatePropagation();
                void this.requestClose("escape");
            };
            this.element.addEventListener("click", click, true);
            this.element.addEventListener("keydown", keydown);
            this.element.addEventListener("focusin", scrollActive);
            this.disposeEvents = () => {
                this.element.removeEventListener("click", click, true);
                this.element.removeEventListener("keydown", keydown);
                this.element.removeEventListener("focusin", scrollActive);
            };
        }

        private topmost() {
            return window.siyuan.dialogs[window.siyuan.dialogs.length - 1] === this;
        }

        public requestClose(reason: MobileDialogCloseReason, options?: IObject): Promise<boolean> {
            if (!this.mobile) {
                this.destroy(options);
                return Promise.resolve(true);
            }
            if (passive(reason) && (this.blocked || !this.topmost())) return Promise.resolve(false);
            this.reason = reason;
            this.closeTask = undefined;
            try {
                // 保留业务 destroy 覆写（例如先询问未保存内容），不能绕过它直接销毁。
                this.destroy(options);
            } finally {
                this.reason = undefined;
            }
            return this.closeTask || Promise.resolve(this.element.dataset.dialogClosing === "true");
        }

        public destroy(options?: IObject) {
            if (!this.mobile) {
                super.destroy(options);
                return;
            }
            if (this.disposed || this.element.dataset.dialogClosing === "true") return;
            const reason = this.reason || "programmatic";
            if (!this.invalidating && (this.pending || this.checking)) return;
            const finish = () => {
                if (this.disposed || this.element.dataset.dialogClosing === "true") return false;
                super.destroy(options);
                return this.element.dataset.dialogClosing === "true";
            };
            if (this.invalidating || !this.sheetOptions.beforeClose) {
                this.closeTask = Promise.resolve(finish());
                return;
            }
            this.checking = true;
            const release = this.lockEditing();
            const failed = (error: unknown) => {
                console.error(error);
                if (!this.disposed) showMessage(window.siyuan.languages.settingsPendingSaveError);
                return false;
            };
            try {
                // 同步草稿 flush 仍在调用栈内完成，不能等源 DOM 被业务销毁后再保存。
                const decision = this.sheetOptions.beforeClose(reason);
                if (typeof decision === "boolean") {
                    this.checking = false;
                    release();
                    this.closeTask = Promise.resolve(decision && !this.disposed ? finish() : false);
                } else {
                    this.closeTask = Promise.resolve(decision).then(allowed =>
                        allowed === true && !this.disposed ? finish() : false
                    ).catch(failed).finally(() => {
                        this.checking = false;
                        release();
                    });
                }
            } catch (error) {
                this.checking = false;
                release();
                this.closeTask = Promise.resolve(failed(error));
            }
        }

        public invalidate(options?: IObject) {
            this.invalidating = true;
            this.reason = "invalidate";
            try {
                // 权限/源失效必须绕过业务的未保存询问；资源清理由 destroyCallback 统一执行。
                super.destroy(options);
            } finally {
                this.reason = undefined;
                this.invalidating = false;
            }
        }

        private lockEditing() {
            this.element.setAttribute("aria-busy", "true");
            const body = this.element.querySelector<HTMLElement>(".b3-dialog__body");
            const inert = body?.inert;
            if (body) body.inert = true;
            const buttons = Array.from(this.element.querySelectorAll<HTMLButtonElement>("button"))
                .filter(button => !button.disabled);
            buttons.forEach(button => { button.disabled = true; });
            return () => {
                if (this.disposed) return;
                this.element.removeAttribute("aria-busy");
                if (body) body.inert = inert;
                buttons.forEach(button => { if (button.isConnected) button.disabled = false; });
            };
        }

        public async runPending(task: () => Promise<boolean>, options: {close?: boolean} = {}) {
            if (this.pending || this.checking || this.disposed || this.element.dataset.dialogClosing === "true") return false;
            this.pending = true;
            const release = this.lockEditing();
            let success = false;
            try {
                success = await task() === true;
            } catch (error) {
                console.error(error);
                if (!this.disposed) showMessage(window.siyuan.languages.settingsPendingSaveError);
            } finally {
                this.pending = false;
                release();
            }
            if (!success || this.disposed || this.element.dataset.dialogClosing === "true") return false;
            if (options.close !== false) return this.requestClose("confirm");
            return true;
        }

        public focusWhenReady(target: () => HTMLElement, options: {select?: boolean, showKeyboard?: boolean} = {}) {
            const focus = () => {
                if (this.disposed || this.element.dataset.dialogClosing === "true" || !this.topmost()) return;
                const element = target();
                if (!element?.isConnected || element.closest("[inert]")) return;
                element.focus({preventScroll: true});
                if (options.select && "select" in element) (element as HTMLInputElement).select();
                if (this.mobile && options.showKeyboard && document.activeElement === element) callMobileAppShowKeyboard();
            };
            if (!this.mobile || this.ready) focus();
            else this.focusTask = focus;
        }

        public setSheetMode(mode: MobileSheetMode) {
            this.disposeSheet?.setMode(mode);
        }

        public bindInput(input: HTMLInputElement | HTMLTextAreaElement, enter?: () => void, bindEnter = true) {
            if (!this.mobile) {
                super.bindInput(input, enter, bindEnter);
                return;
            }
            this.focusWhenReady(() => input);
            let timestamp: number;
            input.addEventListener("keydown", (event: KeyboardEvent) => {
                if (event.isComposing || event.keyCode === 229) return;
                if (event.key === "Escape" && !event.repeat) {
                    void this.requestClose("escape");
                    event.preventDefault();
                    event.stopPropagation();
                } else if (!event.shiftKey && isNotCtrl(event) && event.key === "Enter" && enter && bindEnter && !event.repeat) {
                    if (timestamp && event.timeStamp - timestamp < Constants.TIMEOUT_INPUT) return;
                    timestamp = event.timeStamp;
                    enter();
                    event.preventDefault();
                    event.stopPropagation();
                }
            });
        }
    }
    return MobileDialogImplementation;
};

let implementation: new(options: MobileDialogOptions) => MobileDialog;
// Dialog 的依赖也会导入业务入口；延迟继承，避免模块初始化期间读取尚未导出的基类。
// 此内部构造器不是可继承的公共基类；业务组合生命周期，不派生子类。
export const MobileDialog = function(options: MobileDialogOptions) {
    implementation ||= createMobileDialogClass();
    return new implementation(options);
} as unknown as new(options: MobileDialogOptions) => MobileDialog;

export const requestMobileDialogClose = (dialog: Dialog, reason: MobileDialogCloseReason) => {
    if (adaptedDialogs.has(dialog)) return (dialog as MobileDialog).requestClose(reason);
    dialog.destroy();
    return Promise.resolve(dialog.element.dataset.dialogClosing === "true");
};
