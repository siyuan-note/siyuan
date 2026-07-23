// SiYuan - Refactor your thinking
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

package model

import "testing"

func TestDynamicIconTemplateFuncsExcludeSQL(t *testing.T) {
	funcs := dynamicIconTemplateFuncs()
	for _, name := range []string{"queryBlocks", "querySpans", "querySQL", "getBlock"} {
		if _, ok := funcs[name]; ok {
			t.Fatalf("动态图标模板不应包含 SQL 函数 [%s]", name)
		}
	}
	if _, ok := funcs["date"]; !ok {
		t.Fatal("动态图标模板应保留内置模板函数")
	}
}
