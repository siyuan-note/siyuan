export const setUserSkillEnabled = (selected: string[], id: string, enabled: boolean): string[] => {
    const key = id.toLowerCase();
    const filtered = selected.filter((item) => item.toLowerCase() !== key);
    if (enabled) {
        filtered.push(id);
    }
    return filtered;
};

export const setBuiltinSkillEnabled = (disabled: string[], id: string, enabled: boolean): string[] => {
    const filtered = disabled.filter(item => item !== id);
    if (!enabled) {
        filtered.push(id);
    }
    return filtered;
};
