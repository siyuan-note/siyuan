// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package api

// parseSearchSubTypes 仅解析已知分组，忽略未知键及旧的顶层子类型键。
func parseSearchSubTypes(value any) map[string]bool {
	groups, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	ret := map[string]bool{}
	for _, group := range []struct {
		name   string
		prefix string
		keys   []string
	}{
		{"heading", "", []string{"h1", "h2", "h3", "h4", "h5", "h6"}},
		{"list", "list:", []string{"o", "u", "t"}},
		{"listItem", "listItem:", []string{"o", "u", "t"}},
	} {
		values, _ := groups[group.name].(map[string]any)
		for _, key := range group.keys {
			if selected, _ := values[key].(bool); selected {
				ret[group.prefix+key] = true
			}
		}
	}
	return ret
}
