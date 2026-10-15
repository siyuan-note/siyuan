// Claude Code 命令行环境变量：键为变量名，值为字符串；值中的 ${变量名} 由内核在运行时解析。
export const parseClaudeCodeEnv = (value: string): Record<string, string> | null => {
    if (!value.trim()) {
        return {};
    }
    try {
        const parsed = JSON.parse(value);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return null;
        }
        const env: Record<string, string> = {};
        for (const [name, envValue] of Object.entries(parsed)) {
            // 变量名与取值非法时直接报错，避免内核静默丢弃配置
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || typeof envValue !== "string" ||
                envValue.trim() === "" || /[\r\n\0]/.test(envValue)) {
                return null;
            }
            env[name] = envValue;
        }
        return env;
    } catch {
        return null;
    }
};

export const stringifyClaudeCodeEnv = (env?: Record<string, string>): string =>
    env && Object.keys(env).length ? JSON.stringify(env, null, 2) : "";
