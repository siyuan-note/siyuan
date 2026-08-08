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

package bazaar

// IsIncompatibleTheme 判断主题是否与当前前端不兼容
func IsIncompatibleTheme(theme *Package, frontend string) bool {
	// frontend 为空时不检查兼容性（视为兼容）
	if "" == frontend {
		return false
	}

	return !IsTargetSupported(theme.Frontends, frontend)
}
