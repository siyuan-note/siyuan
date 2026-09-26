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
	"bytes"
	"net/http/httptest"
	"testing"
	"text/template"

	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
)

func testRoleContext(role Role) *gin.Context {
	context, _ := gin.CreateTestContext(httptest.NewRecorder())
	context.Set(RoleContextKey, role)
	return context
}

// TestDynamicIconTemplateFuncsAllowList 校验动态图标模板函数表等于白名单，只读角色只失去按块 ID 读取数据的函数。
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-cxwr-r7cq-xw52
func TestDynamicIconTemplateFuncsAllowList(t *testing.T) {
	gin.SetMode(gin.TestMode)

	writable := dynamicIconTemplateFuncs(testRoleContext(RoleAdministrator))
	if len(dynamicIconTemplateFuncNames) != len(writable) {
		var missing []string
		for _, name := range dynamicIconTemplateFuncNames {
			if _, ok := writable[name]; !ok {
				missing = append(missing, name)
			}
		}
		t.Fatalf("动态图标模板函数表与白名单不一致，白名单 %d 项、函数表 %d 项，缺失 %v",
			len(dynamicIconTemplateFuncNames), len(writable), missing)
	}

	// 只读角色只失去按块 ID 读取工作区数据的函数 https://github.com/siyuan-note/siyuan/security/advisories/GHSA-whcx-xxqh-c838
	for _, role := range []Role{RoleReader, RoleVisitor} {
		funcs := dynamicIconTemplateFuncs(testRoleContext(role))
		if len(writable)-2 != len(funcs) {
			t.Fatalf("只读角色 [%d] 的函数表应为 %d 项，实际 %d 项", role, len(writable)-2, len(funcs))
		}
		for name := range writable {
			if _, ok := funcs[name]; ok {
				continue
			}
			if "getHPathByID" != name && "statBlock" != name {
				t.Fatalf("只读角色 [%d] 不应失去函数 [%s]", role, name)
			}
		}
		for _, name := range []string{"getHPathByID", "statBlock"} {
			if _, ok := funcs[name]; ok {
				t.Fatalf("只读角色 [%d] 不应包含按块 ID 读取数据的函数 [%s]", role, name)
			}
		}
	}

	// 图标模板只需要字符串、日期与数值格式化，放大分配、慢速 KDF、环境网络与工作区读写函数必须缺席
	for _, name := range []string{
		"until", "untilStep", "repeat",
		"randBytes", "randAlphaNum", "randAlpha", "randAscii", "randNumeric",
		"bcrypt", "htpasswd", "derivePassword", "genPrivateKey",
		"env", "expandenv", "getHostByName",
		"indent", "nindent", "wrap", "wrapWith",
		"toJson", "toPrettyJson", "mustToJson", "fromJson", "fail",
		"querySQL", "queryBlocks", "querySpans", "getBlock", "readFile", "tpl",
	} {
		if _, ok := writable[name]; ok {
			t.Fatalf("动态图标模板不应包含函数 [%s]", name)
		}
	}

	for _, role := range []Role{RoleAdministrator, RoleReader, RoleVisitor} {
		funcs := dynamicIconTemplateFuncs(testRoleContext(role))
		for _, name := range []string{"now", "date", "upper", "add", "default"} {
			if _, ok := funcs[name]; !ok {
				t.Fatalf("角色 [%d] 的动态图标模板应保留函数 [%s]", role, name)
			}
		}
	}
}

// TestDynamicIconTemplateFuncsRejectAmplification 校验白名单外的放大写法无法解析。
func TestDynamicIconTemplateFuncsRejectAmplification(t *testing.T) {
	gin.SetMode(gin.TestMode)
	funcs := dynamicIconTemplateFuncs(testRoleContext(RoleAdministrator))

	for _, source := range []string{
		`.action{len (until 400000000)}`,
		`.action{untilStep 0 400000000 1}`,
		`.action{repeat 400000000 "A"}`,
		`.action{randBytes 400000000}`,
		`.action{randAlphaNum 400000000}`,
		`.action{bcrypt "x"}`,
		`.action{htpasswd "u" "p"}`,
		`.action{derivePassword 1 "long" "p" "u" "s"}`,
		`.action{querySQL "select 1"}`,
	} {
		if _, err := template.New("").Delims(".action{", "}").Funcs(funcs).Parse(source); nil == err {
			t.Fatalf("动态图标模板不应能解析 [%s]", source)
		}
	}

	// 白名单不放任何构造列表的函数，模板里的 range 只能遍历 4 项数据模型，
	// 无法把 printf 这类无法移除的内建函数放大成循环
	for _, name := range []string{"list", "tuple", "dict", "splitList", "seq", "until"} {
		if _, ok := funcs[name]; ok {
			t.Fatalf("动态图标模板不应包含构造列表的函数 [%s]", name)
		}
	}

	// printf 是 text/template 内建函数，无法通过函数表移除。fmt 自身的宽度解析上限为 1e7，
	// 超过上限时退化成很短的错误标记而不是按调用方给的宽度分配
	// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-cxwr-r7cq-xw52
	tpl, err := template.New("").Delims(".action{", "}").Funcs(funcs).Parse(`.action{printf "%40000000d" 1}`)
	if nil != err {
		t.Fatalf("parse failed: %s", err)
	}
	buf := &bytes.Buffer{}
	if err = tpl.Execute(buf, map[string]string{}); nil != err {
		t.Fatalf("render failed: %s", err)
	}
	if 64 < buf.Len() {
		t.Fatalf("超限的 printf 宽度未被 fmt 拒绝，输出 %d 字节", buf.Len())
	}
}

// TestSavedDynamicIconContent 校验只读角色的模板源码取自块已保存的图标属性。
func TestSavedDynamicIconContent(t *testing.T) {
	node := &ast.Node{Type: ast.NodeDocument}

	node.SetIALAttr("icon", "api/icon/getDynamicIcon?type=8&color=%23d23f31&content=.action%7B.title%7D&id=20260101000000-abcdefg")
	if content := savedDynamicIconContent(node); ".action{.title}" != content {
		t.Fatalf("unexpected content [%s]", content)
	}

	// 图标属性可能以 HTML 转义形式保存
	node.SetIALAttr("icon", "api/icon/getDynamicIcon?type=8&amp;content=SiYuan")
	if content := savedDynamicIconContent(node); "SiYuan" != content {
		t.Fatalf("unexpected escaped content [%s]", content)
	}

	node.SetIALAttr("icon", "api/icon/getDynamicIcon?type=1")
	if content := savedDynamicIconContent(node); "" != content {
		t.Fatalf("unexpected content without template [%s]", content)
	}

	node.SetIALAttr("icon", "1f4ca")
	if content := savedDynamicIconContent(node); "" != content {
		t.Fatalf("unexpected content for non dynamic icon [%s]", content)
	}

	node.RemoveIALAttr("icon")
	if content := savedDynamicIconContent(node); "" != content {
		t.Fatalf("unexpected content for missing icon [%s]", content)
	}
}

// TestLimitedBufferTruncates 校验渲染缓冲在超过上限后标记截断且不再增长。
func TestLimitedBufferTruncates(t *testing.T) {
	buf := newLimitedBuffer(16)
	if _, err := buf.Write([]byte("0123456789")); nil != err {
		t.Fatal(err)
	}
	if buf.Truncated() {
		t.Fatal("buffer should not be truncated yet")
	}
	if _, err := buf.Write([]byte("abcdefghij")); nil != err {
		t.Fatal(err)
	}
	if !buf.Truncated() {
		t.Fatal("buffer should be truncated")
	}
	if "0123456789abcdef" != buf.String() {
		t.Fatalf("unexpected content [%s]", buf.String())
	}
	if _, err := buf.Write([]byte("more")); nil != err {
		t.Fatal(err)
	}
	if "0123456789abcdef" != buf.String() {
		t.Fatalf("truncated buffer grew to [%s]", buf.String())
	}
}
