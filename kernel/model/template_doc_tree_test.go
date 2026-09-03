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
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"text/template"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestParseTemplateDocTreeDefinition(t *testing.T) {
	definition := []any{
		map[string]any{
			"title":    "第一章",
			"template": "chapters/overview.md",
			"children": []any{
				map[string]any{"title": "1.1 概念", "define": "concept"},
				map[string]any{"title": "1.2 实践"},
			},
		},
		map[string]any{"title": "第二章"},
	}

	nodes, err := parseTemplateDocTreeDefinition(definition)
	if nil != err {
		t.Fatalf("parse document tree definition failed: %v", err)
	}
	if 2 != len(nodes) {
		t.Fatalf("unexpected root node count: got %d, want 2", len(nodes))
	}
	if "第一章" != nodes[0].Title || "chapters/overview.md" != nodes[0].Template || "" != nodes[0].Define {
		t.Fatalf("unexpected first root node: %+v", nodes[0])
	}
	if 1 != nodes[0].Depth || 2 != len(nodes[0].Children) {
		t.Fatalf("unexpected first root hierarchy: %+v", nodes[0])
	}
	if "1.1 概念" != nodes[0].Children[0].Title || "concept" != nodes[0].Children[0].Define ||
		2 != nodes[0].Children[0].Depth {
		t.Fatalf("unexpected first child node: %+v", nodes[0].Children[0])
	}
	if "1.2 实践" != nodes[0].Children[1].Title || "第二章" != nodes[1].Title {
		t.Fatalf("document declaration order was not preserved: %+v", nodes)
	}

	ids := map[string]bool{}
	for _, node := range flattenTemplateDocTreeNodes(nodes) {
		if !ast.IsNodeIDPattern(node.ID) {
			t.Fatalf("document ID is invalid: %q", node.ID)
		}
		if node.RootID != node.ID {
			t.Fatalf("document root ID should match its preallocated ID: %+v", node)
		}
		if ids[node.ID] {
			t.Fatalf("document ID was allocated more than once: %q", node.ID)
		}
		ids[node.ID] = true
		if "" != node.ParentID || "" != node.HPath {
			t.Fatalf("pure parsing should not bind a document location: %+v", node)
		}
	}
}

func TestParseTemplateDocTreeDefinitionAllowsDuplicateTitles(t *testing.T) {
	nodes, err := parseTemplateDocTreeDefinition([]any{
		map[string]any{"title": "资料"},
		map[string]any{"title": "资料"},
	})
	if nil != err {
		t.Fatalf("duplicate titles should create independent documents: %v", err)
	}
	if 2 != len(nodes) || nodes[0].ID == nodes[1].ID {
		t.Fatalf("duplicate titles did not receive independent IDs: %+v", nodes)
	}
}

func TestParseTemplateDocTreeDefinitionRejectsInvalidSchema(t *testing.T) {
	tests := []struct {
		name       string
		definition any
	}{
		{name: "definition is not a list", definition: map[string]any{"title": "资料"}},
		{name: "node is not a dictionary", definition: []any{"资料"}},
		{name: "missing title", definition: []any{map[string]any{}}},
		{name: "non-string title", definition: []any{map[string]any{"title": true}}},
		{name: "empty title", definition: []any{map[string]any{"title": " \t\r\n"}}},
		{name: "title empty after normalization", definition: []any{map[string]any{"title": "/"}}},
		{name: "title is too long", definition: []any{map[string]any{"title": strings.Repeat("文", 513)}}},
		{name: "unknown field", definition: []any{map[string]any{"title": "资料", "titel": "typo"}}},
		{name: "non-string template", definition: []any{map[string]any{"title": "资料", "template": 1}}},
		{name: "non-string define", definition: []any{map[string]any{"title": "资料", "define": true}}},
		{name: "template and define", definition: []any{map[string]any{
			"title": "资料", "template": "source.md", "define": "source",
		}}},
		{name: "children is not a list", definition: []any{map[string]any{"title": "资料", "children": "子文档"}}},
		{name: "invalid child", definition: []any{map[string]any{"title": "资料", "children": []any{1}}}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if nodes, err := parseTemplateDocTreeDefinition(test.definition); nil == err {
				t.Fatalf("invalid definition was accepted: %+v", nodes)
			}
		})
	}
}

func TestParseTemplateDocTreeDefinitionLimitsDocumentCount(t *testing.T) {
	definition := make([]any, maxTemplateDocTreeDocs)
	for i := range definition {
		definition[i] = map[string]any{"title": "文档"}
	}
	if nodes, err := parseTemplateDocTreeDefinition(definition); nil != err || maxTemplateDocTreeDocs != len(nodes) {
		t.Fatalf("definition at the document limit should be accepted: nodes=%d, err=%v", len(nodes), err)
	}

	definition = append(definition, map[string]any{"title": "超出限额"})
	if nodes, err := parseTemplateDocTreeDefinition(definition); nil == err {
		t.Fatalf("definition above the document limit was accepted: %d", len(nodes))
	}

	children := make([]any, maxTemplateDocTreeDocs)
	for i := range children {
		children[i] = map[string]any{"title": "子文档"}
	}
	nestedDefinition := []any{map[string]any{"title": "父文档", "children": children}}
	if nodes, err := parseTemplateDocTreeDefinition(nestedDefinition); nil == err {
		t.Fatalf("nested documents above the total limit were accepted: %d", len(flattenTemplateDocTreeNodes(nodes)))
	}
}

func TestTemplateDocTreeCollectorLimitsDocumentsAcrossCalls(t *testing.T) {
	collector := &templateDocTreeCollector{
		rootID:        "20260830000000-root001",
		rootPath:      "/20260830000000-root001.sy",
		rootHPath:     "/Root",
		enabled:       true,
		allowCreation: true,
	}
	halfLimit := make([]any, maxTemplateDocTreeDocs/2)
	for index := range halfLimit {
		halfLimit[index] = map[string]any{"title": "文档"}
	}
	if _, err := collector.create(halfLimit); nil != err {
		t.Fatalf("first createDocTree call within the aggregate limit failed: %v", err)
	}
	if _, err := collector.create(halfLimit); nil != err {
		t.Fatalf("second createDocTree call at the aggregate limit failed: %v", err)
	}
	if _, err := collector.create([]any{map[string]any{"title": "超出限额"}}); nil == err {
		t.Fatal("multiple createDocTree calls exceeded the aggregate document limit")
	}
}

func TestTemplateDocTreePlanCacheIsBounded(t *testing.T) {
	clearTemplateDocTreePlansForTest()
	t.Cleanup(clearTemplateDocTreePlansForTest)
	var firstPlanID string
	for index := 0; index <= maxTemplateDocTreePlans; index++ {
		id := ast.NewNodeID()
		collector := &templateDocTreeCollector{
			rootID:   ast.NewNodeID(),
			boxID:    "box",
			rootPath: "/root.sy",
			nodes: []*TemplateDocTreeNode{{
				ID: id, RootID: id, Title: "Child",
			}},
		}
		summary := collector.storePlan()
		if 0 == index {
			firstPlanID = summary.ID
		}
		time.Sleep(time.Millisecond)
	}
	if count := templateDocTreePlanCountForTest(); maxTemplateDocTreePlans != count {
		t.Fatalf("unexpected cached document tree plan count: %d", count)
	}
	if _, ok := templateDocTreePlans.Load(firstPlanID); ok {
		t.Fatal("oldest document tree plan was not evicted")
	}
}

func TestParseTemplateDocTreeDefinitionLimitsDepth(t *testing.T) {
	definition := nestedTemplateDocTreeDefinition(maxTemplateDocTreeDepth)
	nodes, err := parseTemplateDocTreeDefinition(definition)
	if nil != err {
		t.Fatalf("definition at the depth limit should be accepted: %v", err)
	}
	flattened := flattenTemplateDocTreeNodes(nodes)
	if maxTemplateDocTreeDepth != len(flattened) || maxTemplateDocTreeDepth != flattened[len(flattened)-1].Depth {
		t.Fatalf("unexpected depth metadata at the limit: %+v", flattened)
	}

	definition = nestedTemplateDocTreeDefinition(maxTemplateDocTreeDepth + 1)
	if nodes, err = parseTemplateDocTreeDefinition(definition); nil == err {
		t.Fatalf("definition above the depth limit was accepted: %d", len(flattenTemplateDocTreeNodes(nodes)))
	}
}

func TestParseTemplateDocTreeDefinitionRejectsCyclicValue(t *testing.T) {
	node := map[string]any{"title": "循环"}
	node["children"] = []any{node}
	if nodes, err := parseTemplateDocTreeDefinition([]any{node}); nil == err {
		t.Fatalf("cyclic definition was accepted: %d", len(flattenTemplateDocTreeNodes(nodes)))
	}
}

func TestRenderTemplateWithModeHandlesDocumentTreePlans(t *testing.T) {
	fixture := setupFileOperationTest(t)
	clearTemplateDocTreePlansForTest()
	t.Cleanup(clearTemplateDocTreePlansForTest)
	templatePath := writeTemplateDocTreeTestFile(t, `.action{createDocTree (list
  (dict "title" "资料" "children" (list (dict "title" "摘录")))
  (dict "title" "复盘")
)}`)

	_, _, previewSummary, err := RenderTemplateWithMode(
		templatePath, fixture.sourceID, TemplateRenderModePreview,
	)
	if nil != err {
		t.Fatalf("preview document tree template failed: %v", err)
	}
	if nil == previewSummary || "" != previewSummary.ID || 3 != previewSummary.Count ||
		3 != len(previewSummary.Nodes) {
		t.Fatalf("unexpected preview plan summary: %+v", previewSummary)
	}
	if count := templateDocTreePlanCountForTest(); 0 != count {
		t.Fatalf("preview stored a committable document tree plan: %d", count)
	}
	for _, node := range previewSummary.Nodes {
		if fixture.box.Exist(node.path) || nil != treenode.GetBlockTree(node.ID) {
			t.Fatalf("preview created document [%s] outside the in-memory summary", node.ID)
		}
	}

	_, _, invalidSummary, err := RenderTemplateWithMode(
		templatePath, fixture.sourceID, TemplateRenderMode("unsupported"),
	)
	if nil == err || nil != invalidSummary || 0 != templateDocTreePlanCountForTest() {
		t.Fatalf("unsupported render mode retained a plan: summary=%+v, err=%v", invalidSummary, err)
	}

	_, _, summary, err := RenderTemplateWithMode(
		templatePath, fixture.sourceID, TemplateRenderModeEditorInsert,
	)
	if nil != err {
		t.Fatalf("editor insert document tree template failed: %v", err)
	}
	if nil == summary || "" == summary.ID || 3 != summary.Count || 3 != len(summary.Nodes) {
		t.Fatalf("unexpected editor insert plan summary: %+v", summary)
	}
	if _, ok := templateDocTreePlans.Load(summary.ID); !ok {
		t.Fatalf("editor insert plan [%s] was not stored", summary.ID)
	}

	clearTemplateDocTreePlansForTest()
	_, _, contentSummary, err := RenderTemplateWithMode(
		templatePath, fixture.sourceID, TemplateRenderModeContent,
	)
	if nil == err {
		t.Fatal("document content rendering should reject createDocTree")
	}
	if nil != contentSummary || 0 != templateDocTreePlanCountForTest() {
		t.Fatalf("document content rendering retained a plan: %+v", contentSummary)
	}
}

func TestRenderTemplateWithModeDiscardsPlanAfterExecutionError(t *testing.T) {
	fixture := setupFileOperationTest(t)
	clearTemplateDocTreePlansForTest()
	t.Cleanup(clearTemplateDocTreePlansForTest)
	templatePath := writeTemplateDocTreeTestFile(t, `.action{createDocTree (list (dict "title" "资料"))}
.action{index (list) 1}`)

	_, _, summary, err := RenderTemplateWithMode(
		templatePath, fixture.sourceID, TemplateRenderModeEditorInsert,
	)
	if nil == err {
		t.Fatal("template execution error was not returned")
	}
	if nil != summary || 0 != templateDocTreePlanCountForTest() {
		t.Fatalf("failed rendering retained a document tree plan: %+v", summary)
	}
}

func TestRenderTemplateWithModeCreatesTransactionAnchorForEmptyContent(t *testing.T) {
	fixture := setupFileOperationTest(t)
	clearTemplateDocTreePlansForTest()
	t.Cleanup(clearTemplateDocTreePlansForTest)
	templatePath := writeTemplateDocTreeTestFile(t,
		`.action{createDocTree (list (dict "title" "资料"))}`)

	tree, dom, summary, err := RenderTemplateWithMode(
		templatePath, fixture.sourceID, TemplateRenderModeEditorInsert,
	)
	if nil != err {
		t.Fatalf("render document-only tree template failed: %v", err)
	}
	if nil == summary || "" == summary.ID || nil == tree.Root.FirstChild || "" == strings.TrimSpace(dom) {
		t.Fatalf("document-only tree template did not return a transaction anchor: summary=%+v, dom=%q", summary, dom)
	}
}

func TestRenderTemplateDocumentReferencesUsePlannedIDs(t *testing.T) {
	fixture := setupFileOperationTest(t)
	clearTemplateDocTreePlansForTest()
	t.Cleanup(clearTemplateDocTreePlansForTest)
	templatePath := writeTemplateDocTreeTestFile(t, `.action{createDocTree (list
  (dict "title" "第一章" "children" (list (dict "title" "1.1 概念")))
  (dict "title" "第二章")
)}
.action{range $doc := renderDocRef "children" .id}
- ((.action{$doc.RootID} ".action{$doc.HPath}"))
.action{end}
.action{renderDocRef "path" "/第一章/1.1 概念"}
.action{renderDocRef "path" "/Source/第一章/1.1 概念"}`)

	_, dom, summary, err := RenderTemplateWithMode(
		templatePath, fixture.sourceID, TemplateRenderModePreview,
	)
	if nil != err {
		t.Fatalf("render planned document references failed: %v", err)
	}
	if nil == summary || 3 != len(summary.Nodes) {
		t.Fatalf("unexpected document reference plan: %+v", summary)
	}
	for _, node := range summary.Nodes {
		if !strings.Contains(dom, node.ID) {
			t.Fatalf("rendered document references do not contain planned ID [%s]: %s", node.ID, dom)
		}
	}
	var nestedNode *TemplateDocTreeNode
	for _, node := range summary.Nodes {
		if "1.1 概念" == node.Title {
			nestedNode = node
			break
		}
	}
	if nil == nestedNode || 2 > strings.Count(dom, nestedNode.ID) {
		t.Fatalf("relative and absolute planned paths did not resolve to the nested document: %s", dom)
	}
	if 0 != templateDocTreePlanCountForTest() {
		t.Fatal("previewing planned document references stored a committable plan")
	}
}

func TestRenderTemplateDocTreeUsesChildTemplateContext(t *testing.T) {
	fixture := setupFileOperationTest(t)
	clearTemplateDocTreePlansForTest()
	t.Cleanup(clearTemplateDocTreePlansForTest)
	templatePath := writeTemplateDocTreeTestFile(t,
		`.action{createDocTree (list (dict "title" "资料" "template" "child.md"))}`)
	childTemplatePath := filepath.Join(filepath.Dir(templatePath), "child.md")
	if err := os.WriteFile(childTemplatePath, []byte("# .action{.title}\n.action{.hPath}"), 0644); nil != err {
		t.Fatalf("write child content template failed: %v", err)
	}

	_, _, summary, err := RenderTemplateWithMode(
		templatePath, fixture.sourceID, TemplateRenderModePreview,
	)
	if nil != err {
		t.Fatalf("render external child template failed: %v", err)
	}
	if nil == summary || 1 != len(summary.Nodes) || nil == summary.Nodes[0].tree {
		t.Fatalf("external child template did not produce a document snapshot: %+v", summary)
	}
	content := summary.Nodes[0].tree.Root.Text()
	if !strings.Contains(content, summary.Nodes[0].Title) || !strings.Contains(content, summary.Nodes[0].HPath) {
		t.Fatalf("external child template did not receive its document context: %q", content)
	}

	if err = os.WriteFile(childTemplatePath,
		[]byte(`.action{createDocTree (list (dict "title" "嵌套副作用"))}`), 0644); nil != err {
		t.Fatalf("rewrite child content template failed: %v", err)
	}
	if _, _, rejectedSummary, renderErr := RenderTemplateWithMode(
		templatePath, fixture.sourceID, TemplateRenderModePreview,
	); nil == renderErr || nil != rejectedSummary {
		t.Fatalf("child content template was allowed to create another document tree: summary=%+v, err=%v",
			rejectedSummary, renderErr)
	}
}

func TestValidateTemplateCallGraphRejectsCyclesAndExcessiveDepth(t *testing.T) {
	cyclicTemplate, err := template.New("").Delims(".action{", "}").Parse(`
.action{define "first"}.action{template "second" .}.action{end}
.action{define "second"}.action{template "first" .}.action{end}`)
	if nil != err {
		t.Fatalf("parse cyclic test template failed: %v", err)
	}
	if err = validateTemplateCallGraph(cyclicTemplate, "first"); nil == err {
		t.Fatal("recursive template call graph was accepted")
	}

	if err = validateTemplateCallGraph(templateCallChainForTest(t, maxTemplateCallDepth), "call-0"); nil != err {
		t.Fatalf("template call graph at the depth limit should be accepted: %v", err)
	}
	if err = validateTemplateCallGraph(templateCallChainForTest(t, maxTemplateCallDepth+1), "call-0"); nil == err {
		t.Fatal("template call graph above the depth limit was accepted")
	}
}

func TestRenderTemplateDocTreeNodesLimitsAggregateOutput(t *testing.T) {
	setupFileOperationTest(t)
	Conf.Editor = conf.NewEditor()
	Conf.Export = conf.NewExport()
	rootTemplate, err := template.New("").Delims(".action{", "}").Parse(
		`.action{define "one-byte"}x.action{end}`,
	)
	if nil != err {
		t.Fatalf("parse child output test template failed: %v", err)
	}
	newNode := func() *TemplateDocTreeNode {
		id := ast.NewNodeID()
		return &TemplateDocTreeNode{ID: id, RootID: id, Title: "Child", Define: "one-byte"}
	}

	collector := &templateDocTreeCollector{
		totalOutput: maxTemplateDocTreeOutputSize - 2,
		nodes:       []*TemplateDocTreeNode{newNode(), newNode()},
	}
	if err = renderTemplateDocTreeNodes(collector, rootTemplate, template.FuncMap{}); nil != err {
		t.Fatalf("aggregate child output at the size limit should be accepted: %v", err)
	}
	if maxTemplateDocTreeOutputSize != collector.totalOutput {
		t.Fatalf("unexpected aggregate child output size: %d", collector.totalOutput)
	}

	collector = &templateDocTreeCollector{
		totalOutput: maxTemplateDocTreeOutputSize - 2,
		nodes:       []*TemplateDocTreeNode{newNode(), newNode(), newNode()},
	}
	if err = renderTemplateDocTreeNodes(collector, rootTemplate, template.FuncMap{}); nil == err {
		t.Fatal("aggregate child output above the size limit was accepted")
	}
}

func TestAttachTemplateDocTreePlansAddsServerOperations(t *testing.T) {
	fixture := setupFileOperationTest(t)
	clearTemplateDocTreePlansForTest()
	t.Cleanup(clearTemplateDocTreePlansForTest)
	templatePath := writeTemplateDocTreeTestFile(t, `.action{createDocTree (list
  (dict "title" "资料" "children" (list (dict "title" "摘录")))
  (dict "title" "复盘")
)}`)
	_, _, summary, err := RenderTemplateWithMode(
		templatePath, fixture.sourceID, TemplateRenderModeEditorInsert,
	)
	if nil != err {
		t.Fatalf("render document tree plan failed: %v", err)
	}

	transaction, insertedID := newTemplateDocTreeInsertTransaction(summary.ID, fixture.sourceID)
	attached, err := AttachTemplateDocTreePlans([]*Transaction{transaction})
	if nil != err || !attached {
		t.Fatalf("attach document tree plan failed: attached=%t, err=%v", attached, err)
	}
	if "" != transaction.TemplateDocTreePlanID {
		t.Fatalf("attached transaction retained plan ID %q", transaction.TemplateDocTreePlanID)
	}
	if _, ok := templateDocTreePlans.Load(summary.ID); ok {
		t.Fatalf("attached plan [%s] remained reusable", summary.ID)
	}
	if 1+summary.Count != len(transaction.DoOperations) || 1+summary.Count != len(transaction.UndoOperations) {
		t.Fatalf("unexpected attached operation counts: do=%d, undo=%d",
			len(transaction.DoOperations), len(transaction.UndoOperations))
	}
	if "insert" != transaction.DoOperations[0].Action || insertedID != transaction.DoOperations[0].ID ||
		"delete" != transaction.UndoOperations[0].Action || insertedID != transaction.UndoOperations[0].ID {
		t.Fatal("attaching a plan changed the parent document operations")
	}
	for index, node := range summary.Nodes {
		doOperation := transaction.DoOperations[index+1]
		if "restoreCreatedDoc" != doOperation.Action || node.ID != doOperation.ID || nil == doOperation.Tree {
			t.Fatalf("unexpected restore operation at %d: %+v", index, doOperation)
		}
		undoOperation := transaction.UndoOperations[summary.Count-index]
		if "removeCreatedDoc" != undoOperation.Action || node.ID != undoOperation.ID || nil == undoOperation.Tree {
			t.Fatalf("unexpected remove operation at %d: %+v", index, undoOperation)
		}
	}
	retryTransaction, _ := newTemplateDocTreeInsertTransaction(summary.ID, fixture.sourceID)
	if attached, attachErr := AttachTemplateDocTreePlans([]*Transaction{retryTransaction}); nil == attachErr || attached {
		t.Fatalf("consumed document tree plan was reusable: attached=%t, err=%v", attached, attachErr)
	}
}

func TestAttachTemplateDocTreePlansValidatesTransactionBoundary(t *testing.T) {
	fixture := setupFileOperationTest(t)
	clearTemplateDocTreePlansForTest()
	t.Cleanup(clearTemplateDocTreePlansForTest)
	templatePath := writeTemplateDocTreeTestFile(t,
		`.action{createDocTree (list (dict "title" "资料"))}`)

	_, _, summary, err := RenderTemplateWithMode(
		templatePath, fixture.sourceID, TemplateRenderModeEditorInsert,
	)
	if nil != err {
		t.Fatalf("render document tree plan failed: %v", err)
	}
	transaction, _ := newTemplateDocTreeInsertTransaction(summary.ID, fixture.sourceID)
	if attached, attachErr := AttachTemplateDocTreePlans([]*Transaction{transaction, &Transaction{}}); nil == attachErr || attached {
		t.Fatalf("plan spanning multiple transactions was accepted: attached=%t, err=%v", attached, attachErr)
	}
	if _, ok := templateDocTreePlans.Load(summary.ID); !ok {
		t.Fatalf("transaction boundary validation consumed plan [%s]", summary.ID)
	}

	clearTemplateDocTreePlansForTest()
	_, _, summary, err = RenderTemplateWithMode(
		templatePath, fixture.sourceID, TemplateRenderModeEditorInsert,
	)
	if nil != err {
		t.Fatalf("rerender document tree plan failed: %v", err)
	}
	targetID := strings.TrimSuffix(strings.TrimPrefix(fixture.targetPath, "/"), ".sy")
	transaction, _ = newTemplateDocTreeInsertTransaction(summary.ID, targetID)
	if attached, attachErr := AttachTemplateDocTreePlans([]*Transaction{transaction}); nil == attachErr || attached {
		t.Fatalf("plan attached to another document was accepted: attached=%t, err=%v", attached, attachErr)
	}
	if 1 != len(transaction.DoOperations) || 1 != len(transaction.UndoOperations) {
		t.Fatal("rejected plan changed the target document operations")
	}

	clearTemplateDocTreePlansForTest()
	_, _, summary, err = RenderTemplateWithMode(
		templatePath, fixture.sourceID, TemplateRenderModeEditorInsert,
	)
	if nil != err {
		t.Fatalf("rerender mixed-root document tree plan failed: %v", err)
	}
	transaction, _ = newTemplateDocTreeInsertTransaction(summary.ID, fixture.sourceID)
	crossRootTransaction, _ := newTemplateDocTreeInsertTransaction("", targetID)
	transaction.DoOperations = append(transaction.DoOperations, crossRootTransaction.DoOperations...)
	transaction.UndoOperations = append(transaction.UndoOperations, crossRootTransaction.UndoOperations...)
	if attached, attachErr := AttachTemplateDocTreePlans([]*Transaction{transaction}); nil == attachErr || attached {
		t.Fatalf("plan with a later cross-root anchor was accepted: attached=%t, err=%v", attached, attachErr)
	}
	if 2 != len(transaction.DoOperations) || 2 != len(transaction.UndoOperations) {
		t.Fatal("rejected mixed-root plan changed the document operations")
	}

	clearTemplateDocTreePlansForTest()
	_, _, summary, err = RenderTemplateWithMode(
		templatePath, fixture.sourceID, TemplateRenderModeEditorInsert,
	)
	if nil != err {
		t.Fatalf("rerender undo-boundary document tree plan failed: %v", err)
	}
	transaction, _ = newTemplateDocTreeInsertTransaction(summary.ID, fixture.sourceID)
	transaction.UndoOperations = append(transaction.UndoOperations, &Operation{Action: "delete", ID: targetID})
	if attached, attachErr := AttachTemplateDocTreePlans([]*Transaction{transaction}); nil == attachErr || attached {
		t.Fatalf("plan with a cross-root undo anchor was accepted: attached=%t, err=%v", attached, attachErr)
	}
	if 1 != len(transaction.DoOperations) || 2 != len(transaction.UndoOperations) {
		t.Fatal("rejected cross-root undo plan changed the document operations")
	}

	clearTemplateDocTreePlansForTest()
	_, _, summary, err = RenderTemplateWithMode(
		templatePath, fixture.sourceID, TemplateRenderModeEditorInsert,
	)
	if nil != err {
		t.Fatalf("rerender changed-path document tree plan failed: %v", err)
	}
	value, ok := templateDocTreePlans.Load(summary.ID)
	if !ok {
		t.Fatalf("document tree plan [%s] was not stored", summary.ID)
	}
	value.(*templateDocTreePlan).rootHPath = "/Changed"
	transaction, _ = newTemplateDocTreeInsertTransaction(summary.ID, fixture.sourceID)
	if attached, attachErr := AttachTemplateDocTreePlans([]*Transaction{transaction}); nil == attachErr || attached {
		t.Fatalf("plan rendered for another human-readable path was accepted: attached=%t, err=%v", attached, attachErr)
	}

	clearTemplateDocTreePlansForTest()
	_, _, summary, err = RenderTemplateWithMode(
		templatePath, fixture.sourceID, TemplateRenderModeEditorInsert,
	)
	if nil != err {
		t.Fatalf("rerender forged-anchor document tree plan failed: %v", err)
	}
	forgedID := ast.NewNodeID()
	transaction = &Transaction{
		TemplateDocTreePlanID: summary.ID,
		DoOperations: []*Operation{{
			Action: "unsupported", ID: forgedID, RootID: fixture.sourceID,
		}},
		UndoOperations: []*Operation{{Action: "unsupported", ID: forgedID}},
	}
	if attached, attachErr := AttachTemplateDocTreePlans([]*Transaction{transaction}); nil == attachErr || attached {
		t.Fatalf("plan with a forged root anchor was accepted: attached=%t, err=%v", attached, attachErr)
	}
	if _, ok = templateDocTreePlans.Load(summary.ID); !ok {
		t.Fatal("parent operation validation consumed the rejected document tree plan")
	}

	clearTemplateDocTreePlansForTest()
	_, _, summary, err = RenderTemplateWithMode(
		templatePath, fixture.sourceID, TemplateRenderModeEditorInsert,
	)
	if nil != err {
		t.Fatalf("rerender irreversible document tree plan failed: %v", err)
	}
	transaction, _ = newTemplateDocTreeInsertTransaction(summary.ID, fixture.sourceID)
	transaction.UndoOperations[0].ID = ast.NewNodeID()
	if attached, attachErr := AttachTemplateDocTreePlans([]*Transaction{transaction}); nil == attachErr || attached {
		t.Fatalf("plan without a matching parent undo was accepted: attached=%t, err=%v", attached, attachErr)
	}
}

func TestCreateDocTreeIsNotAGlobalTemplateFunction(t *testing.T) {
	setupFileOperationTest(t)
	if _, ok := filesys.BuiltInTemplateFuncs()["createDocTree"]; ok {
		t.Fatal("createDocTree should not be available to global template consumers")
	}
	if _, err := RenderGoTemplate(`{{createDocTree (list (dict "title" "资料"))}}`); nil == err {
		t.Fatal("generic Go template rendering should not expose createDocTree")
	}
}

func TestResolveTemplateDocTreeTemplatePathRejectsEscape(t *testing.T) {
	setupFileOperationTest(t)
	packageDir := filepath.Join(util.DataDir, "templates", "project")
	childTemplateDir := filepath.Join(packageDir, "children")
	if err := os.MkdirAll(childTemplateDir, 0755); nil != err {
		t.Fatalf("create child template directory failed: %v", err)
	}
	rootTemplatePath := filepath.Join(packageDir, "main.md")
	if err := os.WriteFile(rootTemplatePath, []byte("main"), 0644); nil != err {
		t.Fatalf("write root template failed: %v", err)
	}
	childTemplatePath := filepath.Join(childTemplateDir, "source.md")
	if err := os.WriteFile(childTemplatePath, []byte("source"), 0644); nil != err {
		t.Fatalf("write child template failed: %v", err)
	}
	resolved, err := resolveTemplatePackageFile(rootTemplatePath, "children/source.md")
	if nil != err || filepath.Clean(childTemplatePath) != filepath.Clean(resolved) {
		t.Fatalf("resolve valid child template failed: path=%q, err=%v", resolved, err)
	}

	outsidePath := filepath.Join(util.DataDir, "templates", "private.md")
	if err = os.WriteFile(outsidePath, []byte("private"), 0644); nil != err {
		t.Fatalf("write outside file failed: %v", err)
	}
	for _, templatePath := range []string{"../private.md", outsidePath, "children", ""} {
		if resolved, resolveErr := resolveTemplatePackageFile(rootTemplatePath, templatePath); nil == resolveErr {
			t.Errorf("unsafe child template path %q was accepted as %q", templatePath, resolved)
		}
	}

	symlinkPath := filepath.Join(childTemplateDir, "outside.md")
	if err = os.Symlink(outsidePath, symlinkPath); nil != err {
		t.Logf("symlink is not supported on this platform: %v", err)
		return
	}
	if resolved, resolveErr := resolveTemplatePackageFile(rootTemplatePath, "children/outside.md"); nil == resolveErr {
		t.Fatalf("child template symlink escaping the templates directory was accepted as %q", resolved)
	}
}

func nestedTemplateDocTreeDefinition(depth int) []any {
	var child map[string]any
	for currentDepth := depth; 0 < currentDepth; currentDepth-- {
		node := map[string]any{"title": "层级"}
		if nil != child {
			node["children"] = []any{child}
		}
		child = node
	}
	return []any{child}
}

func templateCallChainForTest(t *testing.T, depth int) *template.Template {
	t.Helper()
	var source strings.Builder
	for index := 0; index < depth; index++ {
		fmt.Fprintf(&source, `.action{define "call-%d"}`, index)
		if index+1 < depth {
			fmt.Fprintf(&source, `.action{template "call-%d" .}`, index+1)
		}
		source.WriteString(`.action{end}`)
	}
	tpl, err := template.New("").Delims(".action{", "}").Parse(source.String())
	if nil != err {
		t.Fatalf("parse template call chain failed: %v", err)
	}
	return tpl
}

func flattenTemplateDocTreeNodes(nodes []*TemplateDocTreeNode) (ret []*TemplateDocTreeNode) {
	for _, node := range nodes {
		ret = append(ret, node)
		ret = append(ret, flattenTemplateDocTreeNodes(node.Children)...)
	}
	return
}

func newTemplateDocTreeInsertTransaction(planID, parentID string) (*Transaction, string) {
	dom := util.NewLute().Md2BlockDOM("父文档模板内容", false)
	tree := util.NewLute().BlockDOM2Tree(dom)
	insertedID := tree.Root.FirstChild.ID
	return &Transaction{
		TemplateDocTreePlanID: planID,
		DoOperations: []*Operation{{
			Action: "insert", ID: insertedID, ParentID: parentID, Data: dom,
		}},
		UndoOperations: []*Operation{{Action: "delete", ID: insertedID}},
	}, insertedID
}

func writeTemplateDocTreeTestFile(t *testing.T, content string) string {
	t.Helper()
	if nil == Conf.Editor {
		Conf.Editor = conf.NewEditor()
	}
	if nil == Conf.Export {
		Conf.Export = conf.NewExport()
	}
	templateDir := filepath.Join(util.DataDir, "templates")
	if err := os.MkdirAll(templateDir, 0755); nil != err {
		t.Fatalf("create templates directory failed: %v", err)
	}
	templatePath := filepath.Join(templateDir, "document-tree.md")
	if err := os.WriteFile(templatePath, []byte(content), 0644); nil != err {
		t.Fatalf("write document tree template failed: %v", err)
	}
	return templatePath
}

func clearTemplateDocTreePlansForTest() {
	templateDocTreePlans.Range(func(key, _ any) bool {
		templateDocTreePlans.Delete(key)
		return true
	})
}

func templateDocTreePlanCountForTest() (ret int) {
	templateDocTreePlans.Range(func(_, _ any) bool {
		ret++
		return true
	})
	return
}
