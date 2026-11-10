import {IColorValue, parseColor, TColorInput} from "./model";

export type TColorCancelReason = "cancel" | "escape" | "dismiss" | "owner-destroyed" | "replaced" | "destroy";
export type TColorPickerResult = {type: "confirm"; value: IColorValue; changed: boolean} |
    {type: "cancel"; reason: TColorCancelReason};

export class ColorSession {
    readonly baseline: IColorValue;
    private draft: IColorValue;
    private ended = false;
    constructor(value: TColorInput) {
        this.baseline = parseColor(value);
        if (!this.baseline) { throw new TypeError("Invalid sRGB color"); }
        this.draft = this.baseline;
    }
    get value() { return parseColor(this.draft.hex); }
    get active() { return !this.ended; }
    update(value: TColorInput) {
        const parsed = parseColor(value);
        if (!this.active || !parsed || parsed.hex === this.draft.hex) { return false; }
        this.draft = parsed;
        return true;
    }
    finish(reason?: TColorCancelReason): TColorPickerResult | undefined {
        if (!this.active) { return; }
        this.ended = true;
        return reason ? {type: "cancel", reason} :
            {type: "confirm", value: this.value, changed: this.draft.hex !== this.baseline.hex};
    }
}
