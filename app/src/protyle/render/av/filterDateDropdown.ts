import {IDatePickerHandle, openInternalDatePicker} from "../../../datePicker";
import {validateDateValue} from "../../../datePicker/model";

export const createFilterDateDropdown = (current: () => boolean) => {
    let picker: IDatePickerHandle;
    let owner: HTMLInputElement;
    let disposed = false;
    let opening = false;
    const open = (input: HTMLInputElement) => {
        if (disposed || !current() || !input.isConnected || input.matches(":disabled") || input.readOnly ||
            input.closest(".fn__none, [hidden]") || !input.getClientRects().length || picker && owner === input) { return; }
        picker?.destroy();
        owner?.setAttribute("aria-expanded", "false");
        owner = input;
        const baseline = input.value;
        const constraints = {type: "date" as const, min: input.min, max: input.max, step: input.step, required: input.required};
        const valid = validateDateValue(baseline, constraints) === "valid";
        opening = true;
        input.setAttribute("aria-expanded", "true");
        let session: IDatePickerHandle;
        try {
            input.focus({preventScroll: true});
            session = picker = openInternalDatePicker({...constraints, ownerElement: input,
                value: valid ? baseline : "", initialBadInput: !valid, autoConfirm: true});
        } catch (error) {
            input.setAttribute("aria-expanded", "false");
            picker = undefined;
            owner = undefined;
            throw error;
        } finally { opening = false; }
        void session.result.then(result => {
            if (picker !== session) { return; }
            picker = undefined;
            owner = undefined;
            input.setAttribute("aria-expanded", "false");
            if (disposed || !current() || !input.isConnected || input.disabled || input.readOnly || input.value !== baseline ||
                result.type !== "confirm") { return; }
            input.value = result.value;
            input.dispatchEvent(new input.ownerDocument.defaultView.Event("input", {bubbles: true}));
            if (current() && input.isConnected) {
                input.dispatchEvent(new input.ownerDocument.defaultView.Event("change", {bubbles: true}));
            }
        });
    };
    return {open, isOpen: (input: HTMLInputElement) => opening || owner === input && !!picker,
        destroy: () => {
            disposed = true;
            picker?.destroy();
            owner?.setAttribute("aria-expanded", "false");
            picker = undefined;
            owner = undefined;
        }};
};
