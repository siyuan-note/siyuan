import {API as siyuan} from "./API";

const libs: Record<string, any> = {
    siyuan,
} as const;

export const PluginRequire = {
    require(module: string) {
        return libs[module];
    }
}
