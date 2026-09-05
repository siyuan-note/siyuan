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
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestRenderTemplateMapsDocumentReferenceToTargetRoot(t *testing.T) {
	fixture := setupFileOperationTest(t)
	const (
		templateRootID  = "20260901000000-root001"
		internalBlockID = "20260901000001-block01"
	)
	templatePath := writeTemplateDocTreeTestFile(t, fmt.Sprintf(`((%s "root"))
{: id="20260901000002-ref0001"}

Internal target
{: id="%s"}

((%s "internal"))
{: id="20260901000003-ref0002"}

((%s "external"))
{: id="20260901000004-ref0003"}

{: id="%s" title="Template" type="doc"}`, templateRootID, internalBlockID, internalBlockID, fixture.targetID, templateRootID))

	tree, _, _, err := RenderTemplateWithMode(templatePath, fixture.childID, TemplateRenderModePreview)
	if nil != err {
		t.Fatalf("render template failed: %v", err)
	}
	if fixture.sourceID != tree.Root.ID {
		t.Fatalf("template root was not mapped to target document: got %q, want %q", tree.Root.ID, fixture.sourceID)
	}

	refs := map[string]string{}
	var renderedInternalBlockID string
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		if node.IsTextMarkType("block-ref") {
			refs[node.TextMarkTextContent] = node.TextMarkBlockRefID
		} else if ast.NodeBlockRef == node.Type {
			if refID := node.ChildByType(ast.NodeBlockRefID); nil != refID {
				refs[strings.TrimSpace(node.Text())] = refID.TokensStr()
			}
		}
		if node.IsBlock() && "Internal target" == strings.TrimSpace(node.Text()) {
			renderedInternalBlockID = node.ID
		}
		return ast.WalkContinue
	})

	if fixture.sourceID != refs["root"] {
		t.Fatalf("document reference was not mapped to target root: got %q, want %q", refs["root"], fixture.sourceID)
	}
	if "" == renderedInternalBlockID || internalBlockID == renderedInternalBlockID {
		t.Fatalf("internal block ID was not regenerated: %q", renderedInternalBlockID)
	}
	if renderedInternalBlockID != refs["internal"] {
		t.Fatalf("internal reference was not mapped with its target: got %q, want %q", refs["internal"], renderedInternalBlockID)
	}
	if fixture.targetID != refs["external"] {
		t.Fatalf("external reference changed: got %q, want %q", refs["external"], fixture.targetID)
	}
}

type templateAttributeViewTestFixture struct {
	attrView *av.AttributeView
	nodes    []*ast.Node
}

func addTemplateAttributeViewTestFixture(t *testing.T, fixture *fileOperationTestFixture,
	avID string) *templateAttributeViewTestFixture {
	t.Helper()
	if nil == Conf.Editor {
		Conf.Editor = conf.NewEditor()
	}
	if nil == Conf.Export {
		Conf.Export = conf.NewExport()
	}
	if err := os.MkdirAll(filepath.Join(util.DataDir, "templates"), 0755); nil != err {
		t.Fatalf("create templates directory failed: %v", err)
	}
	oldLang, oldAttrViewLangs := util.Lang, util.AttrViewLangs
	util.Lang = "en"
	util.AttrViewLangs = map[string]map[string]any{
		"en": {
			"key": "Key", "select": "Select", "table": "Table", "gallery": "Gallery",
		},
	}
	t.Cleanup(func() { util.Lang, util.AttrViewLangs = oldLang, oldAttrViewLangs })
	attrView := av.NewAttributeView(avID)
	attrView.Name = "Template database"
	attrView.Views[0].Name = "Table"
	galleryView := av.NewGalleryView()
	galleryView.Name = "Gallery"
	for _, column := range attrView.Views[0].Table.Columns {
		galleryView.Gallery.CardFields = append(galleryView.Gallery.CardFields,
			&av.ViewGalleryCardField{BaseField: &av.BaseField{ID: column.ID}})
	}
	attrView.Views = append(attrView.Views, galleryView)

	itemID := ast.NewNodeID()
	blockKey := attrView.GetBlockKey()
	attrView.GetBlockKeyValues().Values = append(attrView.GetBlockKeyValues().Values, &av.Value{
		ID: ast.NewNodeID(), KeyID: blockKey.ID, BlockID: itemID, Type: av.KeyTypeBlock, IsDetached: true,
		Block: &av.ValueBlock{Content: "REFERENCE_TEMPLATE_PRIVATE_ROW"},
	})
	for _, view := range attrView.Views {
		view.ItemIDs = append(view.ItemIDs, itemID)
	}
	if err := av.SaveAttributeView(attrView); nil != err {
		t.Fatalf("save attribute view failed: %v", err)
	}
	t.Cleanup(func() { av.SetAVBoxID(attrView.ID, "") })

	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if nil != err {
		t.Fatalf("load source tree failed: %v", err)
	}
	for nil != tree.Root.FirstChild {
		tree.Root.FirstChild.Unlink()
	}
	first := &ast.Node{
		Type:              ast.NodeAttributeView,
		ID:                "20260904000001-avnode1",
		AttributeViewID:   attrView.ID,
		AttributeViewType: string(av.LayoutTypeTable),
	}
	first.SetIALAttr("id", first.ID)
	first.SetIALAttr(av.NodeAttrView, attrView.Views[0].ID)
	first.SetIALAttr(av.NodeAttrVisibleViewIDs, attrView.Views[0].ID+","+attrView.Views[1].ID)
	second := &ast.Node{
		Type:              ast.NodeAttributeView,
		ID:                "20260904000002-avnode2",
		AttributeViewID:   attrView.ID,
		AttributeViewType: string(av.LayoutTypeGallery),
	}
	second.SetIALAttr("id", second.ID)
	second.SetIALAttr(av.NodeAttrView, attrView.Views[1].ID)
	second.SetIALAttr(av.NodeAttrVisibleViewIDs, attrView.Views[1].ID)
	tree.Root.AppendChild(first)
	tree.Root.AppendChild(second)
	if _, err = filesys.WriteTree(tree); nil != err {
		t.Fatalf("write source tree failed: %v", err)
	}
	treenode.UpsertBlockTree(tree)
	av.BatchUpsertBlockRel([]*ast.Node{first, second})
	return &templateAttributeViewTestFixture{attrView: attrView, nodes: []*ast.Node{first, second}}
}

func parseSavedTemplateAttributeViews(t *testing.T, name string) (*ast.Node, []*ast.Node) {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(util.DataDir, "templates", name+".md"))
	if nil != err {
		t.Fatalf("read saved template failed: %v", err)
	}
	tree := parseKTree(data)
	if nil == tree {
		t.Fatal("parse saved template failed")
	}
	return tree.Root, tree.Root.ChildrenByType(ast.NodeAttributeView)
}

func attributeViewFileCount(t *testing.T) int {
	t.Helper()
	files, err := filepath.Glob(filepath.Join(util.DataDir, "storage", "av", "*.json"))
	if nil != err {
		t.Fatalf("list attribute view files failed: %v", err)
	}
	return len(files)
}

func containsString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}

func TestTemplateDatabaseReferencePreservesViews(t *testing.T) {
	fixture := setupFileOperationTest(t)
	database := addTemplateAttributeViewTestFixture(t, fixture, "20260904000000-avtmpl1")
	code, err := DocSaveAsTemplateWithDatabaseMode(fixture.sourceID, "reference", false,
		TemplateDatabaseModeReference)
	if nil != err || 0 != code {
		t.Fatalf("save reference template failed: code=%d, err=%v", code, err)
	}

	_, templateNodes := parseSavedTemplateAttributeViews(t, "reference")
	if 2 != len(templateNodes) {
		t.Fatalf("unexpected saved database block count: %d", len(templateNodes))
	}
	for i, node := range templateNodes {
		if string(TemplateDatabaseModeReference) != node.IALAttr(templateDatabaseModeAttr) {
			t.Fatalf("reference marker missing from saved block %d", i)
		}
		if "" != database.nodes[i].IALAttr(templateDatabaseModeAttr) {
			t.Fatalf("reference marker leaked into source block %d", i)
		}
	}

	beforeFiles := attributeViewFileCount(t)
	beforeRels := av.GetBlockRels()[database.attrView.ID]
	previewTree, previewDOM, _, err := RenderTemplateWithMode(
		filepath.Join(util.DataDir, "templates", "reference.md"), fixture.targetID, TemplateRenderModePreview)
	if nil != err {
		t.Fatalf("preview reference template failed: %v", err)
	}
	if 0 != len(previewTree.Root.ChildrenByType(ast.NodeAttributeView)) {
		t.Fatal("reference preview should replace database blocks with structural tables")
	}
	if strings.Contains(previewDOM, "REFERENCE_TEMPLATE_PRIVATE_ROW") {
		t.Fatal("reference preview exposed database row content")
	}
	if !strings.Contains(previewDOM, "Key") {
		t.Fatal("reference preview did not retain the database table header")
	}
	if beforeFiles != attributeViewFileCount(t) {
		t.Fatal("reference preview persisted an attribute view copy")
	}
	if len(beforeRels) != len(av.GetBlockRels()[database.attrView.ID]) {
		t.Fatal("reference preview changed mirror registrations")
	}

	contentTree, _, _, err := RenderTemplateWithMode(
		filepath.Join(util.DataDir, "templates", "reference.md"), fixture.targetID, TemplateRenderModeContent)
	if nil != err {
		t.Fatalf("render reference template failed: %v", err)
	}
	renderedNodes := contentTree.Root.ChildrenByType(ast.NodeAttributeView)
	if 2 != len(renderedNodes) {
		t.Fatalf("unexpected rendered database block count: %d", len(renderedNodes))
	}
	for i, node := range renderedNodes {
		if database.attrView.ID != node.AttributeViewID {
			t.Fatalf("reference block %d changed database ID: %s", i, node.AttributeViewID)
		}
		if database.nodes[i].IALAttr(av.NodeAttrView) != node.IALAttr(av.NodeAttrView) ||
			database.nodes[i].IALAttr(av.NodeAttrVisibleViewIDs) != node.IALAttr(av.NodeAttrVisibleViewIDs) {
			t.Fatalf("reference block %d changed view selection", i)
		}
		if "" != node.IALAttr(templateDatabaseModeAttr) {
			t.Fatalf("reference marker leaked into rendered block %d", i)
		}
	}
	if beforeFiles != attributeViewFileCount(t) {
		t.Fatal("reference rendering persisted an attribute view copy")
	}
}

func TestTemplateDatabaseCopyClonesSharedDatabaseOnce(t *testing.T) {
	fixture := setupFileOperationTest(t)
	database := addTemplateAttributeViewTestFixture(t, fixture, "20260904000100-avtmpl2")
	code, err := DocSaveAsTemplate(fixture.sourceID, "copy", false)
	if nil != err || 0 != code {
		t.Fatalf("save copy template failed: code=%d, err=%v", code, err)
	}
	_, templateNodes := parseSavedTemplateAttributeViews(t, "copy")
	for i, node := range templateNodes {
		if "" != node.IALAttr(templateDatabaseModeAttr) {
			t.Fatalf("copy marker persisted on saved block %d", i)
		}
	}

	beforeFiles := attributeViewFileCount(t)
	if _, _, _, err = RenderTemplateWithMode(filepath.Join(util.DataDir, "templates", "copy.md"), fixture.targetID,
		TemplateRenderModePreview); nil != err {
		t.Fatalf("preview copy template failed: %v", err)
	}
	if beforeFiles != attributeViewFileCount(t) {
		t.Fatal("copy preview persisted an attribute view")
	}

	contentTree, _, _, err := RenderTemplateWithMode(filepath.Join(util.DataDir, "templates", "copy.md"), fixture.targetID,
		TemplateRenderModeContent)
	if nil != err {
		t.Fatalf("render copy template failed: %v", err)
	}
	if beforeFiles+1 != attributeViewFileCount(t) {
		t.Fatalf("shared database should be cloned once: before=%d, after=%d", beforeFiles, attributeViewFileCount(t))
	}
	renderedNodes := contentTree.Root.ChildrenByType(ast.NodeAttributeView)
	if 2 != len(renderedNodes) || renderedNodes[0].AttributeViewID != renderedNodes[1].AttributeViewID {
		t.Fatalf("shared database blocks did not reuse one copy: %+v", renderedNodes)
	}
	if database.attrView.ID == renderedNodes[0].AttributeViewID {
		t.Fatal("copy template retained the source database ID")
	}
	cloned, err := av.ParseAttributeViewInBox(renderedNodes[0].AttributeViewID, "")
	if nil != err {
		t.Fatalf("parse cloned attribute view failed: %v", err)
	}
	if database.attrView.Views[0].ID == cloned.Views[0].ID || database.attrView.Views[1].ID == cloned.Views[1].ID {
		t.Fatal("copied database retained source view IDs")
	}
	if cloned.Views[0].ID != renderedNodes[0].IALAttr(av.NodeAttrView) ||
		cloned.Views[1].ID != renderedNodes[1].IALAttr(av.NodeAttrView) {
		t.Fatal("copied database block view IDs were not remapped")
	}
	if cloned.Views[0].ID+","+cloned.Views[1].ID != renderedNodes[0].IALAttr(av.NodeAttrVisibleViewIDs) ||
		cloned.Views[1].ID != renderedNodes[1].IALAttr(av.NodeAttrVisibleViewIDs) {
		t.Fatal("copied database visible view IDs were not remapped")
	}
}

func TestTemplateDatabaseReferenceValidatesExistenceViewsAndEncryptionBoundary(t *testing.T) {
	fixture := setupFileOperationTest(t)
	database := addTemplateAttributeViewTestFixture(t, fixture, "20260904000200-avtmpl3")
	referenceNode := &ast.Node{Type: ast.NodeAttributeView, AttributeViewID: database.attrView.ID}
	referenceNode.SetIALAttr(templateDatabaseModeAttr, string(TemplateDatabaseModeReference))
	referenceNode.SetIALAttr(av.NodeAttrView, "20260904000201-missing")
	tree := &parse.Tree{Root: &ast.Node{Type: ast.NodeDocument}, Box: fixture.box.ID}
	tree.Root.AppendChild(referenceNode)
	if _, _, err := prepareTemplateAttributeViews(tree, false); nil == err {
		t.Fatal("reference template accepted a missing selected view")
	}

	referenceNode.SetIALAttr(av.NodeAttrView, database.attrView.Views[0].ID)
	referenceNode.SetIALAttr(av.NodeAttrVisibleViewIDs, "20260904000202-missing")
	if _, _, err := prepareTemplateAttributeViews(tree, false); nil == err {
		t.Fatal("reference template accepted a missing visible view")
	}

	referenceNode.SetIALAttr(templateDatabaseModeAttr, string(TemplateDatabaseModeCopy))
	referenceNode.SetIALAttr(av.NodeAttrView, "20260904000201-missing")
	referenceNode.SetIALAttr(av.NodeAttrVisibleViewIDs,
		database.attrView.Views[0].ID+",20260904000202-missing")
	plans, copies, err := prepareTemplateAttributeViews(tree, false)
	if nil != err || 1 != len(copies) {
		t.Fatalf("copy template should tolerate stale view IDs: copies=%d, err=%v", len(copies), err)
	}
	if _, err = applyTemplateAttributeViewPlan(referenceNode, plans[referenceNode]); nil != err {
		t.Fatalf("apply tolerant copy plan failed: %v", err)
	}
	if "" != referenceNode.IALAttr(av.NodeAttrView) {
		t.Fatal("copy template retained a stale selected view ID")
	}
	if copies[0].target.Views[0].ID != referenceNode.IALAttr(av.NodeAttrVisibleViewIDs) {
		t.Fatal("copy template did not retain the valid visible view ID")
	}

	referenceNode.AttributeViewID = database.attrView.ID
	referenceNode.SetIALAttr(templateDatabaseModeAttr, string(TemplateDatabaseModeCopy))
	markRuntimeEncryptedBox(fixture.box.ID)
	t.Cleanup(func() { forgetRuntimeEncryptedBox(fixture.box.ID) })
	if _, _, err := prepareTemplateAttributeViews(tree, false); nil != err {
		t.Fatalf("copy template should retain legacy cross-box fallback: %v", err)
	}
	referenceNode.SetIALAttr(templateDatabaseModeAttr, string(TemplateDatabaseModeReference))
	referenceNode.SetIALAttr(av.NodeAttrView, database.attrView.Views[0].ID)
	referenceNode.SetIALAttr(av.NodeAttrVisibleViewIDs, database.attrView.Views[0].ID)
	if _, _, err := prepareTemplateAttributeViews(tree, false); nil == err {
		t.Fatal("reference template crossed from an encrypted notebook to a global database")
	}

	if _, err := DocSaveAsTemplateWithDatabaseMode(fixture.sourceID, "invalid", false,
		TemplateDatabaseMode("invalid")); nil == err {
		t.Fatal("save template accepted an unsupported database mode")
	}
}

func TestTemplateDatabasePreviewDoesNotMutateSourceView(t *testing.T) {
	fixture := setupFileOperationTest(t)
	database := addTemplateAttributeViewTestFixture(t, fixture, "20260904000400-avtmpl5")
	gallery := database.attrView.Views[1]
	if nil != gallery.Table {
		t.Fatal("gallery test fixture unexpectedly has a table layout")
	}
	root := &ast.Node{Type: ast.NodeDocument}
	node := &ast.Node{Type: ast.NodeAttributeView, AttributeViewID: database.attrView.ID}
	root.AppendChild(node)
	templateAttributeViewPreviewTable(node, &templateAttributeViewPlan{
		mode: TemplateDatabaseModeReference, source: database.attrView, target: database.attrView, selectedView: gallery,
	})
	if nil != gallery.Table {
		t.Fatal("reference preview mutated the source gallery view")
	}
}
