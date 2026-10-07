import {showMessage} from "../../dialog/message";
import {escapeHtml} from "../../util/escape";

export type MobileEditorDialog = InstanceType<ReturnType<typeof createMobileEditorDialog>>;

const sheets = new Set<MobileEditorDialog>();
let dialogClass: ReturnType<typeof createMobileEditorDialog>;

export const closeMobileEditorSheets = () => {
    if (sheets.size) {
        return Promise.all(Array.from(sheets, dialog => dialog.close())).then(() => undefined);
    }
};

// 创建抽屉时再加载对话框基类，避免菜单和编辑器模块在启动期间形成循环依赖。
export const getMobileEditorDialog = () => dialogClass ??= createMobileEditorDialog();

const createMobileEditorDialog = () => {
    const {Dialog}: typeof import("../../dialog") = require("../../dialog");
    return class MobileEditorDialog extends Dialog {
        public beforeClose: () => Promise<void>;
        private closing?: Promise<void>;
        private discarded = false;

        public register() {
            sheets.add(this);
        }

        public close(): Promise<void> {
            if (this.discarded) {
                return Promise.resolve();
            }
            if (!this.closing) {
                this.closing = Promise.resolve().then(() => this.beforeClose?.()).then(() => {
                    sheets.delete(this);
                    super.destroy();
                }).catch(error => {
                    if (this.discarded) {
                        return;
                    }
                    this.closing = undefined;
                    showMessage(escapeHtml(String(error)));
                    throw error;
                });
            }
            return this.closing;
        }

        public destroy() {
            void this.close().catch(error => console.error(error));
        }

        // 笔记本锁定或内容删除时立即注销面板，不等待已经失去访问权限的保存请求。
        public discard() {
            this.discarded = true;
            sheets.delete(this);
            super.destroy();
        }
    };
};
