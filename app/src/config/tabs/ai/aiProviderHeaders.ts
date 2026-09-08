export const parseProviderHeaders = (value: string): Record<string, string> | null => {
    if (!value.trim()) {
        return {};
    }
    try {
        const parsed = JSON.parse(value);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return null;
        }
        const names = new Set<string>();
        for (const [name, headerValue] of Object.entries(parsed)) {
            const normalized = name.toLowerCase();
            if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || names.has(normalized) ||
                typeof headerValue !== "string" || Array.from(headerValue).some((character) => {
                    const code = character.charCodeAt(0);
                    return (code < 32 && code !== 9) || code === 127;
                })) {
                return null;
            }
            names.add(normalized);
        }
        return parsed;
    } catch {
        return null;
    }
};
