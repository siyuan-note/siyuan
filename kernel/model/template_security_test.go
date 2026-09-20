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

package model

import (
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func testRoleContext(role Role) *gin.Context {
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Set(RoleContextKey, role)
	return context
}

func TestDynamicIconTemplateFuncsExcludeSQL(t *testing.T) {
	funcs := dynamicIconTemplateFuncs(nil)
	for _, name := range []string{"queryBlocks", "querySpans", "querySQL", "getBlock"} {
		if _, ok := funcs[name]; ok {
			t.Fatalf("动态图标模板不应包含 SQL 函数 [%s]", name)
		}
	}
	if _, ok := funcs["date"]; !ok {
		t.Fatal("动态图标模板应保留内置模板函数")
	}
}

// TestDynamicIconTemplateFuncsDenyWorkspaceReadsForReadOnlyRole 防止只读角色通过模板函数绕过发布访问控制。
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-whcx-xxqh-c838
func TestDynamicIconTemplateFuncsDenyWorkspaceReadsForReadOnlyRole(t *testing.T) {
	gin.SetMode(gin.TestMode)
	for _, role := range []Role{RoleReader, RoleVisitor} {
		funcs := dynamicIconTemplateFuncs(testRoleContext(role))
		for _, name := range []string{"getHPathByID", "statBlock"} {
			if _, ok := funcs[name]; ok {
				t.Fatalf("只读角色 [%d] 的动态图标模板不应包含按块 ID 读取数据的函数 [%s]", role, name)
			}
		}
		for _, name := range []string{"date", "now"} {
			if _, ok := funcs[name]; !ok {
				t.Fatalf("只读角色 [%d] 的动态图标模板应保留 [%s]", role, name)
			}
		}
	}

	for _, role := range []Role{RoleAdministrator, RoleEditor} {
		funcs := dynamicIconTemplateFuncs(testRoleContext(role))
		for _, name := range []string{"getHPathByID", "statBlock"} {
			if _, ok := funcs[name]; !ok {
				t.Fatalf("可写角色 [%d] 的动态图标模板应保留 [%s]", role, name)
			}
		}
	}
}
