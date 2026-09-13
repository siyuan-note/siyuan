// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

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
