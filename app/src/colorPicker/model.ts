export interface IColorValue {
    hex: string;
    rgb: {r: number; g: number; b: number};
}

export type TColorInput = string | {r: number; g: number; b: number};

export const parseColor = (input: TColorInput): IColorValue | undefined => {
    let rgb: IColorValue["rgb"];
    if (typeof input === "string") {
        const match = input.trim().match(/^#?([\da-f]{3}|[\da-f]{6})$/i);
        if (!match) { return; }
        const hex = match[1].length === 3 ? Array.from(match[1], char => char + char).join("") : match[1];
        rgb = {r: parseInt(hex.substring(0, 2), 16), g: parseInt(hex.substring(2, 4), 16), b: parseInt(hex.substring(4), 16)};
    } else {
        if (!input || ![input.r, input.g, input.b].every(value => Number.isInteger(value) && value >= 0 && value <= 255)) { return; }
        rgb = {r: input.r, g: input.g, b: input.b};
    }
    return {hex: "#" + [rgb.r, rgb.g, rgb.b].map(value => value.toString(16).padStart(2, "0")).join(""), rgb};
};

export const parseRGBText = (values: string[]): IColorValue | undefined => {
    if (values.length !== 3 || values.some(value => !/^\d+$/.test(value.trim()))) { return; }
    return parseColor({r: Number(values[0].trim()), g: Number(values[1].trim()), b: Number(values[2].trim())});
};
