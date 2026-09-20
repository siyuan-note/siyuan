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

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// TestGetDynamicIconEnforcesPublishAccess 覆盖动态图标模板的发布访问控制。
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-whcx-xxqh-c838
func TestGetDynamicIconEnforcesPublishAccess(t *testing.T) {
	gin.SetMode(gin.TestMode)

	const (
		boxID      = "20260918000000-ic0nb0x"
		publicID   = "20260918000001-ic0n001"
		hiddenID   = "20260918000002-ic0n002"
		disabledID = "20260918000003-ic0n003"
		passwordID = "20260918000004-ic0n004"
		password   = "secret123"
	)

	oldWorkspaceDir, oldConfDir, oldDataDir := util.WorkspaceDir, util.ConfDir, util.DataDir
	oldHistoryDir, oldTempDir, oldQueueDir := util.HistoryDir, util.TempDir, util.QueueDir
	oldBlockTreeDBPath := util.BlockTreeDBPath
	oldConf := model.Conf

	root := t.TempDir()
	t.Cleanup(func() {
		treenode.CloseDatabase()
		model.Conf = oldConf
		util.WorkspaceDir, util.ConfDir, util.DataDir = oldWorkspaceDir, oldConfDir, oldDataDir
		util.HistoryDir, util.TempDir, util.QueueDir = oldHistoryDir, oldTempDir, oldQueueDir
		util.BlockTreeDBPath = oldBlockTreeDBPath
	})

	util.WorkspaceDir = root
	util.ConfDir = filepath.Join(root, "conf")
	util.DataDir = filepath.Join(root, "data")
	util.HistoryDir = filepath.Join(root, "history")
	util.TempDir = filepath.Join(root, "temp")
	util.QueueDir = filepath.Join(util.TempDir, "queue")
	util.BlockTreeDBPath = filepath.Join(util.TempDir, "blocktree.db")
	for _, dir := range []string{util.ConfDir, util.DataDir, util.HistoryDir, util.TempDir, util.QueueDir} {
		if err := os.MkdirAll(dir, 0755); err != nil {
			t.Fatal(err)
		}
	}

	model.Conf = model.NewAppConf()
	model.Conf.Sync = conf.NewSync()
	model.Conf.Lang = "en"
	model.Conf.Editor = conf.NewEditor()

	boxConf := conf.NewBoxConf()
	boxConf.Name = "Dynamic icon publish access"
	boxConf.Closed = false
	if err := (&model.Box{ID: boxID}).SaveConf(boxConf); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(util.DataDir, boxID, ".siyuan"), 0755); err != nil {
		t.Fatal(err)
	}

	treenode.InitBlockTree(true)

	addDoc := func(id, title string) {
		tree := treenode.NewTree(boxID, "/"+id+".sy", "/"+title, title)
		tree.Root.FirstChild.Unlink()
		node := &ast.Node{Type: ast.NodeParagraph, ID: id[:21] + "c"}
		node.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("body")})
		tree.Root.AppendChild(node)
		treenode.IndexBlockTree(tree)
		if _, err := filesys.WriteTree(tree); err != nil {
			t.Fatal(err)
		}
	}
	addDoc(publicID, "Public Doc")
	addDoc(hiddenID, "Hidden Doc")
	addDoc(disabledID, "Disabled Doc")
	addDoc(passwordID, "Password Doc")

	if err := model.SetPublishAccess(model.PublishAccess{
		{ID: hiddenID, Visible: false},
		{ID: disabledID, Disable: true},
		{ID: passwordID, Password: password},
	}); err != nil {
		t.Fatal(err)
	}

	// requestIcon 以指定角色请求动态图标，返回原始 SVG 响应
	requestIcon := func(role model.Role, id, content string, cookies ...*http.Cookie) string {
		recorder := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(recorder)
		context.Request = httptest.NewRequest(http.MethodGet, "/api/icon/getDynamicIcon", nil)
		context.Request.URL.RawQuery = "type=8&color=%23d23f31&id=" + id + "&content=" + content
		for _, cookie := range cookies {
			context.Request.AddCookie(cookie)
		}
		context.Set(model.RoleContextKey, role)
		getDynamicIcon(context)

		requireAPIContract(t, http.MethodGet, "/api/icon/getDynamicIcon", recorder)
		if http.StatusOK != recorder.Code {
			t.Fatalf("unexpected status code %d: %s", recorder.Code, recorder.Body.String())
		}
		if "Cookie" != recorder.Header().Get("Vary") {
			t.Fatalf("response varies by caller but Vary header is %q", recorder.Header().Get("Vary"))
		}
		return recorder.Body.String()
	}

	// 模板分隔符为 .action{ 与 }，动作只写一层花括号
	const titleContent = ".action%7B.title%7D"

	if svg := requestIcon(model.RoleReader, publicID, titleContent); !strings.Contains(svg, "Public Doc") {
		t.Fatalf("publish reader cannot render an accessible template icon: %s", svg)
	}
	if svg := requestIcon(model.RoleAdministrator, publicID, titleContent); !strings.Contains(svg, "Public Doc") {
		t.Fatalf("administrator cannot render a template icon: %s", svg)
	}

	// 隐藏（不列出）与禁止发布、密码保护不同：发布访问控制按设计仍允许按 ID 读取隐藏文档，
	// 仅禁止其被枚举，因此这里只断言禁止与密码保护两类
	for _, id := range []string{disabledID, passwordID} {
		if svg := requestIcon(model.RoleReader, id, titleContent); strings.Contains(svg, " Doc") {
			t.Fatalf("publish reader read a protected doc title through the dynamic icon: %s", svg)
		}
	}

	// 通过发布密码认证的读者必须仍能渲染
	authCookie := &http.Cookie{
		Name:  "publish-auth-" + passwordID,
		Value: util.SHA256Hash([]byte(passwordID + password)),
	}
	if svg := requestIcon(model.RoleReader, passwordID, titleContent, authCookie); !strings.Contains(svg, "Password Doc") {
		t.Fatalf("authenticated publish reader cannot render the template icon: %s", svg)
	}

	hPathContent := ".action%7BgetHPathByID%20%22" + disabledID + "%22%7D"
	statContent := ".action%7BstatBlock%20%22" + disabledID + "%22%7D"

	// 通用模板函数不得成为绕过发布访问控制的第二条通路
	if svg := requestIcon(model.RoleReader, publicID, hPathContent); strings.Contains(svg, "Disabled Doc") {
		t.Fatalf("publish reader read a protected doc path through getHPathByID: %s", svg)
	}
	// statBlock 返回结构体，模板渲染为 {runeCount wordCount linkCount imageCount refCount blockCount}
	if svg := requestIcon(model.RoleReader, publicID, statContent); strings.Contains(svg, "{4 1 0 0 0 1}") {
		t.Fatalf("publish reader read protected block stats through statBlock: %s", svg)
	}

	// 可写角色不受影响
	if svg := requestIcon(model.RoleAdministrator, publicID, hPathContent); !strings.Contains(svg, "Disabled Doc") {
		t.Fatalf("administrator cannot use getHPathByID in a template icon: %s", svg)
	}
	if svg := requestIcon(model.RoleAdministrator, publicID, statContent); !strings.Contains(svg, "{4 1 0 0 0 1}") {
		t.Fatalf("administrator cannot use statBlock in a template icon: %s", svg)
	}

	// 模板解析失败时不应回显模板原文
	if svg := requestIcon(model.RoleReader, publicID, ".action%7B%7B.title%7D%7D"); strings.Contains(svg, ".title") {
		t.Fatalf("dynamic icon echoed the raw template content: %s", svg)
	}
}
