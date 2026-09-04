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
	"path/filepath"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestTemplateDatabaseReferencePreservesContextFilter(t *testing.T) {
	fixture := setupFileOperationTest(t)
	database := addTemplateAttributeViewTestFixture(t, fixture, "20260904001000-ctxref1")
	key := addTemplateContextFilterKey(t, database)
	setTemplateDatabaseContextFilters(t, fixture.sourceID, database, key.ID)

	code, err := DocSaveAsTemplateWithDatabaseMode(fixture.sourceID, "context-filter-reference", false,
		TemplateDatabaseModeReference)
	if nil != err || 0 != code {
		t.Fatalf("save reference template failed: code=%d, err=%v", code, err)
	}
	_, templateNodes := parseSavedTemplateAttributeViews(t, "context-filter-reference")
	assertTemplateDatabaseContextFilters(t, templateNodes, key.ID)

	contentTree, _, _, err := RenderTemplateWithMode(
		filepath.Join(util.DataDir, "templates", "context-filter-reference.md"),
		fixture.targetID, TemplateRenderModeContent)
	if nil != err {
		t.Fatal(err)
	}
	assertTemplateDatabaseContextFilters(t, contentTree.Root.ChildrenByType(ast.NodeAttributeView), key.ID)
}

func TestTemplateDatabaseCopyClearsContextFilterForDisconnectedRelation(t *testing.T) {
	fixture := setupFileOperationTest(t)
	database := addTemplateAttributeViewTestFixture(t, fixture, "20260904001100-ctxcopy")
	key := addTemplateContextFilterKey(t, database)
	setTemplateDatabaseContextFilters(t, fixture.sourceID, database, key.ID)

	code, err := DocSaveAsTemplate(fixture.sourceID, "context-filter-copy", false)
	if nil != err || 0 != code {
		t.Fatalf("save copy template failed: code=%d, err=%v", code, err)
	}
	_, templateNodes := parseSavedTemplateAttributeViews(t, "context-filter-copy")
	assertTemplateDatabaseContextFilters(t, templateNodes, key.ID)

	contentTree, _, _, err := RenderTemplateWithMode(
		filepath.Join(util.DataDir, "templates", "context-filter-copy.md"),
		fixture.targetID, TemplateRenderModeContent)
	if nil != err {
		t.Fatal(err)
	}
	renderedNodes := contentTree.Root.ChildrenByType(ast.NodeAttributeView)
	if len(database.nodes) != len(renderedNodes) {
		t.Fatalf("unexpected rendered database block count: %d", len(renderedNodes))
	}
	for i, node := range renderedNodes {
		if raw := node.IALAttr(av.NodeAttrContextFilter); "" != raw {
			t.Fatalf("copied database block %d retained disconnected context filter: %q", i, raw)
		}
	}
}

func addTemplateContextFilterKey(t *testing.T, database *templateAttributeViewTestFixture) *av.Key {
	t.Helper()
	key := &av.Key{
		ID: ast.NewNodeID(), Name: "Context relation", Type: av.KeyTypeRelation,
		Relation: &av.Relation{AvID: database.attrView.ID},
	}
	database.attrView.KeyValues = append(database.attrView.KeyValues, &av.KeyValues{Key: key})
	if err := av.SaveAttributeView(database.attrView); nil != err {
		t.Fatal(err)
	}
	return key
}

func setTemplateDatabaseContextFilters(t *testing.T, sourceID string,
	database *templateAttributeViewTestFixture, keyID string) {
	t.Helper()
	filter := &av.AttributeViewContextFilter{Spec: av.AttributeViewContextFilterSpec, KeyID: keyID}
	raw, err := filter.Marshal()
	if nil != err {
		t.Fatal(err)
	}
	tree, err := LoadTreeByBlockID(sourceID)
	if nil != err {
		t.Fatal(err)
	}
	for _, fixtureNode := range database.nodes {
		node := treenode.GetNodeInTree(tree, fixtureNode.ID)
		if nil == node {
			t.Fatalf("database block [%s] not found", fixtureNode.ID)
		}
		node.SetIALAttr(av.NodeAttrContextFilter, raw)
	}
	if _, err = filesys.WriteTree(tree); nil != err {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
}

func assertTemplateDatabaseContextFilters(t *testing.T, nodes []*ast.Node, expectedKeyID string) {
	t.Helper()
	if 2 != len(nodes) {
		t.Fatalf("unexpected database block count: %d", len(nodes))
	}
	for i, node := range nodes {
		filter, err := av.ParseAttributeViewContextFilter(node.IALAttr(av.NodeAttrContextFilter))
		if nil != err {
			t.Fatalf("parse database block %d context filter failed: %v", i, err)
		}
		if nil == filter || expectedKeyID != filter.KeyID {
			t.Fatalf("unexpected database block %d context filter: %#v", i, filter)
		}
	}
}
