import {IColorValue, parseColor} from "./model";

export const createNativeColorInput = (doc: Document, value: IColorValue, label: string,
                                       changed: (value: IColorValue | undefined) => void,
                                       needsSync = () => false) => {
    const input = doc.createElement("input");
    input.type = "color";
    input.className = "b3-text-field" + (doc.getElementById("sidebar") ? " b3-text-field--touch" : "");
    input.setAttribute("aria-label", label);
    input.value = value.hex;
    let active = true;
    let last = value.hex;
    const update = () => {
        if (!active || input.disabled) { return; }
        const parsed = parseColor(input.value);
        if (!parsed) { changed(undefined); return; }
        if (parsed.hex === last && !needsSync()) { return; }
        last = parsed.hex;
        changed(parsed);
    };
    input.addEventListener("input", update);
    input.addEventListener("change", update);
    return {element: input, supported: input.type === "color", setValue: (color: IColorValue) => { last = color.hex; input.value = color.hex; },
        destroy: () => { active = false; input.removeEventListener("input", update); input.removeEventListener("change", update); }};
};
