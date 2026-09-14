import type {RepoSource} from "./repoBatch";

export const canPurgeRepo = (source: RepoSource, provider: number) => {
    // 官方云端未实现手动清理所需的单快照读取，仅对已支持的第三方存储开放云端清理。
    return source === "local" || provider === 2 || provider === 3 || provider === 4;
};
