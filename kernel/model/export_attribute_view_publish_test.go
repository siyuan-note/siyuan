// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

//go:build fts5

package model

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// exportAVPublishTestFixture 构造发布读者导出数据库的场景：
// 可发布笔记本中的文档 HOST 内嵌数据库，其关联列指向禁止发布笔记本中的数据库，
// 目标行绑定禁止发布文档中的块。
type exportAVPublishTestFixture struct {
	hostDocID   string
	privateID   string
	blockID     string
	sourceAvID  string
	targetAvID  string
	publicBlkID string
	orphanRowID string
	canary      string
	detachedID  string
	detached    string
	orphanBlk   string
	orphan      string
}

func setupExportAVPublishTest(t *testing.T) *exportAVPublishTestFixture {
	t.Helper()

	setupExportPublishTest(t)
	oldLang, oldAttrViewLangs := util.Lang, util.AttrViewLangs
	util.Lang = "en"
	util.AttrViewLangs = map[string]map[string]any{
		"en": {"key": "Key", "select": "Select", "table": "Table"},
	}
	t.Cleanup(func() {
		util.Lang, util.AttrViewLangs = oldLang, oldAttrViewLangs
	})

	fixture := &exportAVPublishTestFixture{
		hostDocID:   "20260921000001-hostdoc",
		privateID:   "20260921000002-privdoc",
		blockID:     "20260921000003-avblock",
		sourceAvID:  "20260921000004-sourcea",
		targetAvID:  "20260921000005-targeta",
		publicBlkID: "20260921000010-publblk",
		orphanRowID: "20260921000009-orphanr",
		detachedID:  "20260921000007-detachd",
		orphanBlk:   "20260921000008-orphanb",
		canary:      "PRIVATE_AV_CANARY_20260921",
		detached:    "DETACHED_AV_ROW_20260921",
		orphan:      "ORPHAN_AV_ROW_20260921",
	}

	const (
		publicBoxID  = "20260921000100-pubbox1"
		privateBoxID = "20260921000101-prvbox1"
	)

	// 目标数据库位于禁止发布的笔记本中，其行绑定禁止发布文档中的块
	targetAttrView := av.NewAttributeView(fixture.targetAvID)
	targetBlockKey := targetAttrView.GetBlockKey()
	targetAttrView.GetBlockKeyValues().Values = []*av.Value{{
		ID: ast.NewNodeID(), KeyID: targetBlockKey.ID, BlockID: fixture.privateID, Type: av.KeyTypeBlock,
		Block: &av.ValueBlock{ID: fixture.privateID, Content: fixture.canary},
	}}
	if err := av.SaveAttributeView(targetAttrView); nil != err {
		t.Fatal(err)
	}

	// 源数据库位于可发布文档中，关联列指向目标数据库
	sourceAttrView := av.NewAttributeView(fixture.sourceAvID)
	sourceBlockKey := sourceAttrView.GetBlockKey()
	relationKey := av.NewKey(ast.NewNodeID(), "Relation", "", av.KeyTypeRelation)
	relationKey.Relation = &av.Relation{AvID: fixture.targetAvID}
	// 视图列固定为 主键 + 关联列，保证关联内容参与导出渲染
	sourceAttrView.Views[0].Table.Columns = []*av.ViewTableColumn{
		{BaseField: &av.BaseField{ID: sourceBlockKey.ID}},
		{BaseField: &av.BaseField{ID: relationKey.ID}},
	}
	sourceAttrView.GetBlockKeyValues().Values = []*av.Value{
		// 公开行：绑定宿主文档中的块
		{
			ID: ast.NewNodeID(), KeyID: sourceBlockKey.ID, BlockID: fixture.publicBlkID, Type: av.KeyTypeBlock,
			Block: &av.ValueBlock{ID: fixture.publicBlkID, Content: "public row"},
		},
		// 游离行：不对应任何文档块，发布读者应当仍然可见
		{
			ID: ast.NewNodeID(), KeyID: sourceBlockKey.ID, BlockID: fixture.detachedID, Type: av.KeyTypeBlock,
			IsDetached: true, Block: &av.ValueBlock{Content: fixture.detached},
		},
		// 孤儿行：绑定的块不在块树中，按不可确认可达处理，发布读者不可见
		{
			ID: ast.NewNodeID(), KeyID: sourceBlockKey.ID, BlockID: fixture.orphanRowID, Type: av.KeyTypeBlock,
			Block: &av.ValueBlock{ID: fixture.orphanBlk, Content: fixture.orphan},
		},
	}
	sourceAttrView.KeyValues = append(sourceAttrView.KeyValues, &av.KeyValues{
		Key: relationKey, Values: []*av.Value{{
			ID: ast.NewNodeID(), KeyID: relationKey.ID, BlockID: fixture.publicBlkID, Type: av.KeyTypeRelation,
			Relation: &av.ValueRelation{BlockIDs: []string{fixture.privateID}},
		}},
	})
	if err := av.SaveAttributeView(sourceAttrView); nil != err {
		t.Fatal(err)
	}

	hostTree := treenode.NewTree(publicBoxID, "/"+fixture.hostDocID+".sy", "/Host", "Host")
	for nil != hostTree.Root.FirstChild {
		hostTree.Root.FirstChild.Unlink()
	}
	database := &ast.Node{
		Type: ast.NodeAttributeView, ID: fixture.blockID, AttributeViewID: fixture.sourceAvID,
		AttributeViewType: string(av.LayoutTypeTable),
	}
	database.SetIALAttr("id", fixture.blockID)
	database.SetIALAttr(av.NodeAttrView, sourceAttrView.Views[0].ID)
	hostTree.Root.AppendChild(database)
	// 公开行绑定的块必须真实存在于块树中，否则会被发布访问过滤按不可确认可达处理
	publicParagraph := &ast.Node{Type: ast.NodeParagraph, ID: fixture.publicBlkID}
	publicParagraph.SetIALAttr("id", fixture.publicBlkID)
	publicParagraph.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("public row")})
	hostTree.Root.AppendChild(publicParagraph)

	privateTree := treenode.NewTree(privateBoxID, "/"+fixture.privateID+".sy", "/Private", "Private")
	privateTree.Root.FirstChild.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte(fixture.canary)})

	for _, tree := range []*parse.Tree{hostTree, privateTree} {
		if _, err := filesys.WriteTree(tree); nil != err {
			t.Fatalf("write synthetic tree: %v", err)
		}
		treenode.UpsertBlockTree(tree)
		sql.IndexTreeQueue(tree)
	}
	sql.FlushQueue()
	av.UpsertBlockRel(fixture.sourceAvID, fixture.hostDocID)

	t.Cleanup(func() {
		treenode.RemoveBlockTree(publicBoxID, fixture.hostDocID)
		treenode.RemoveBlockTree(privateBoxID, fixture.privateID)
		os.Remove(filepath.Join(util.DataDir, privateBoxID, fixture.privateID+".sy"))
	})
	return fixture
}

// newExportAVPublishReaderFilter 模拟 /api/export/preview 与 /api/lute/copyStdMarkdown 中
// 发布读者请求构造的属性视图过滤器，禁止发布笔记本对该读者不可访问。
func newExportAVPublishReaderFilter(t *testing.T, privateID string) AVExportPublishFilter {
	t.Helper()

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodPost, "/api/export/preview", nil)
	c.Set(RoleContextKey, RoleReader)
	return func(view av.Viewable, avID, blockID string) av.Viewable {
		return FilterAttributeViewByPublishAccess(c, PublishAccess{{ID: privateID, Disable: true}},
			avID, blockID, view)
	}
}

// TestExportAttributeViewFilteredByPublishAccess 验证发布读者导出内嵌数据库的文档时，
// 绑定到禁止发布文档的行和关联内容都不会出现在导出结果中，可访问的行保留，管理员导出不受影响。
func TestExportAttributeViewFilteredByPublishAccess(t *testing.T) {
	fixture := setupExportAVPublishTest(t)
	filter := newExportAVPublishReaderFilter(t, fixture.privateID)

	markdown := ExportStdMarkdown(fixture.hostDocID, false, false, false, false, filter)
	if strings.Contains(markdown, "PRIVATE") {
		t.Fatalf("publish reader received private attribute view content in markdown: %s", markdown)
	}
	if !strings.Contains(markdown, "public row") {
		t.Fatalf("publish reader lost the accessible row in markdown: %s", markdown)
	}

	stdHTML := ExportPreview(fixture.hostDocID, false, filter)
	if strings.Contains(stdHTML, "PRIVATE") {
		t.Fatalf("publish reader received private attribute view content in preview: %s", stdHTML)
	}
	if !strings.Contains(stdHTML, "public row") {
		t.Fatalf("publish reader lost the accessible row in preview: %s", stdHTML)
	}

	adminMarkdown := ExportStdMarkdown(fixture.hostDocID, false, false, false, false, nil)
	if !strings.Contains(adminMarkdown, "PRIVATE") {
		t.Fatalf("administrator export should include private attribute view content: %s", adminMarkdown)
	}

	// 导出过滤只针对本次导出的副本，不得改动属性视图存储的数据
	stored, err := av.ParseAttributeViewInBox(fixture.sourceAvID, "")
	if nil != err {
		t.Fatal(err)
	}
	if 3 != len(stored.GetBlockKeyValues().Values) {
		t.Fatalf("export filtering mutated the stored attribute view: %d rows left",
			len(stored.GetBlockKeyValues().Values))
	}
}

// TestExportAttributeViewRowPublishAccessSemantics 固定导出过滤的行可见性语义：
// 游离行可见，绑定块无法解析的行按不可确认可达处理并丢弃，与渲染路径保持一致。
func TestExportAttributeViewRowPublishAccessSemantics(t *testing.T) {
	fixture := setupExportAVPublishTest(t)
	filter := newExportAVPublishReaderFilter(t, fixture.privateID)

	markdown := ExportStdMarkdown(fixture.hostDocID, false, false, false, false, filter)
	if !strings.Contains(markdown, "DETACHED") {
		t.Fatalf("detached row should stay visible to publish readers: %s", markdown)
	}
	if strings.Contains(markdown, "ORPHAN") {
		t.Fatalf("row bound to an unresolvable block should be dropped for publish readers: %s", markdown)
	}
}
