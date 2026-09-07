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
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.

package model

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestTemplateFileManagement(t *testing.T) {
	previous := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = previous })
	call := func(request TemplateFileRequest) any {
		t.Helper()
		ret, err := ManageTemplateFiles(request)
		if err != nil {
			t.Fatalf("%s %s: %v", request.Action, request.Path, err)
		}
		return ret
	}
	call(TemplateFileRequest{Action: "mkdir", Path: "weekly"})
	call(TemplateFileRequest{Action: "write", Path: "weekly/week.md", Content: "原始模板\r\n"})
	read := call(TemplateFileRequest{Action: "read", Path: "weekly/week.md"}).(map[string]string)
	if read["content"] != "原始模板\r\n" {
		t.Fatal("source bytes changed")
	}
	if _, err := ManageTemplateFiles(TemplateFileRequest{Action: "write", Path: "weekly/week.md", Content: "overwrite"}); err == nil {
		t.Fatal("existing file overwritten without revision")
	}
	updated := call(TemplateFileRequest{Action: "write", Path: "weekly/week.md", Content: "updated", Revision: read["revision"]}).(map[string]string)
	if _, err := ManageTemplateFiles(TemplateFileRequest{Action: "remove", Path: "weekly/week.md", Revision: read["revision"]}); err == nil {
		t.Fatal("stale delete accepted")
	}
	call(TemplateFileRequest{Action: "move", Path: "weekly/week.md", Target: "renamed.md", Revision: updated["revision"]})
	if _, err := os.Stat(filepath.Join(util.DataDir, "templates", "weekly", "week.md")); !os.IsNotExist(err) {
		t.Fatal("source still exists")
	}
	call(TemplateFileRequest{Action: "write", Path: "weekly/child.md", Content: "child"})
	dir := call(TemplateFileRequest{Action: "read", Path: "weekly"}).(map[string]string)
	deleted := call(TemplateFileRequest{Action: "remove", Path: "weekly", Revision: dir["revision"]}).(map[string]string)
	content, err := os.ReadFile(filepath.Join(util.DataDir, "templates", deleted["recoveryPath"], "child.md"))
	if err != nil || string(content) != "child" {
		t.Fatalf("deleted directory is not recoverable: %s %v", content, err)
	}
	entries := call(TemplateFileRequest{Action: "list"}).([]TemplateFileEntry)
	if len(entries) != 1 || entries[0].Path != "renamed.md" {
		t.Fatalf("unexpected entries: %+v", entries)
	}
}

func TestTemplateFilePaths(t *testing.T) {
	previous := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = previous })
	for _, p := range []string{"", ".", "../outside.md", "/outside.md", "C:/outside.md", "a\\b.md", ".trash/a.md", "a/../b.md", "a:stream.md", "a /b.md"} {
		if _, err := ManageTemplateFiles(TemplateFileRequest{Action: "write", Path: p, Content: "bad"}); err == nil {
			t.Errorf("accepted unsafe path %q", p)
		}
	}
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(util.DataDir, "templates", "linked")); err != nil {
		t.Skipf("symlink unavailable: %v", err)
	}
	if _, err := ManageTemplateFiles(TemplateFileRequest{Action: "write", Path: "linked/outside.md"}); err == nil {
		t.Fatal("symlink escape accepted")
	}
}

func TestTemplateDocumentAttributes(t *testing.T) {
	icon := `api/icon/getDynamicIcon?type=5&date=.action{now | date "2006-01-02"}`
	attrs := templateDocumentAttributes([]byte(`{: icon="` + icon + `" custom-test=".action{printf "}"}" type="doc"}`))
	if len(attrs) != 3 || attrs[0][1] != icon || attrs[1][1] != `.action{printf "}"}` {
		t.Fatalf("actions were damaged: %#v", attrs)
	}
	for _, source := range []string{`{: icon="x"}`, "{: type=\"doc\"}\nother content", "{: type=\"doc\"}\n{: id=\"x\"}", `{: icon=".action{now" type="doc"}`} {
		if attrs := templateDocumentAttributes([]byte(source)); attrs != nil {
			t.Errorf("accepted non-document declaration %q: %#v", source, attrs)
		}
	}
}

func TestPreviewTemplateUnsavedSource(t *testing.T) {
	fixture := setupFileOperationTest(t)
	p := writeTemplateDocTreeTestFile(t, "saved content")
	_, dom, _, err := PreviewTemplateSource(p, fixture.sourceID, "unsaved .action{.id}")
	if err != nil || !strings.Contains(dom, "unsaved "+fixture.sourceID) || strings.Contains(dom, "saved content") {
		t.Fatalf("unexpected preview: %s %v", dom, err)
	}
	content, err := os.ReadFile(p)
	if err != nil || string(content) != "saved content" {
		t.Fatal("preview wrote to template file")
	}
}

func TestExportTemplateDocumentAttributesAndDirectory(t *testing.T) {
	fixture := setupFileOperationTest(t)
	Conf.Editor = conf.NewEditor()
	Conf.Export = conf.NewExport()
	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if err != nil {
		t.Fatal(err)
	}
	tree.Root.SetIALAttr("icon", "old-icon")
	tree.Root.SetIALAttr("custom-keep", "retained")
	engine := NewLute()
	codeTree := parse.Parse("", []byte("```template\n{: icon=\"api/icon/getDynamicIcon?type=5&date=.action{now | date \"2006-01-02\"}\" type=\"doc\"}\n```\n\nAfter declaration\n"), engine.ParseOptions)
	var codeID string
	for child := codeTree.Root.FirstChild; child != nil; {
		next := child.Next
		child.ID = ast.NewNodeID()
		child.SetIALAttr("id", child.ID)
		if child.Type == ast.NodeCodeBlock {
			codeID = child.ID
		}
		tree.Root.AppendChild(child)
		child = next
	}
	if _, err = filesys.WriteTree(tree); err != nil {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)
	if _, err = ManageTemplateFiles(TemplateFileRequest{Action: "mkdir", Path: "weekly"}); err != nil {
		t.Fatal(err)
	}
	code, err := DocSaveAsTemplateInDirectory(fixture.sourceID, "week", "weekly", false, TemplateDatabaseModeCopy)
	if code != 0 || err != nil {
		t.Fatalf("export failed: %d %v", code, err)
	}
	p := filepath.Join(util.DataDir, "templates", "weekly", "week.md")
	content, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Count(string(content), templateDocumentAttributeMarker) != 1 || strings.Contains(string(content), codeID) || !strings.Contains(string(content), "After declaration") {
		t.Fatalf("unexpected exported attributes/content: %s", content)
	}
	rendered, _, _, err := RenderTemplateWithMode(p, fixture.sourceID, TemplateRenderModePreview)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(rendered.Root.IALAttr("icon"), "api/icon/getDynamicIcon?type=5&date=") || strings.Contains(rendered.Root.IALAttr("icon"), ".action{") || rendered.Root.IALAttr("custom-keep") != "retained" {
		t.Fatalf("document attributes were not merged: %#v", rendered.Root.KramdownIAL)
	}
	code, err = DocSaveAsTemplateInDirectory(fixture.sourceID, "week", "weekly", false, TemplateDatabaseModeCopy)
	if code != 1 || err != nil {
		t.Fatalf("overwrite confirmation missing: %d %v", code, err)
	}
	if _, err = DocSaveAsTemplateInDirectory(fixture.sourceID, "week", "../escape", true, TemplateDatabaseModeCopy); err == nil {
		t.Fatal("export path escaped templates")
	}
}

func TestDocSaveAsTemplateInfoAndRememberedAttrs(t *testing.T) {
	fixture := setupFileOperationTest(t)
	Conf.Editor = conf.NewEditor()
	Conf.Export = conf.NewExport()

	info, err := GetDocSaveAsTemplateInfo(fixture.sourceID)
	if nil != err {
		t.Fatal(err)
	}
	if "Source" != info.Name || "" != info.Directory || info.HasDatabase {
		t.Fatalf("unexpected initial export info: %+v", info)
	}

	tree, err := LoadTreeByBlockID(fixture.sourceID)
	if nil != err {
		t.Fatal(err)
	}
	heading := &ast.Node{Type: ast.NodeHeading, ID: "20260907000000-heading", HeadingLevel: 2}
	heading.SetIALAttr("id", heading.ID)
	heading.AppendChild(&ast.Node{Type: ast.NodeText, Tokens: []byte("Database section")})
	database := &ast.Node{
		Type:            ast.NodeAttributeView,
		ID:              "20260907000001-avblock",
		AttributeViewID: "20260907000002-attrview",
	}
	database.SetIALAttr("id", database.ID)
	tree.Root.AppendChild(heading)
	tree.Root.AppendChild(database)
	tree.Root.SetIALAttr(templateExportNameAttr, "weekly")
	tree.Root.SetIALAttr(templateExportDirectoryAttr, "reviews")
	if _, err = filesys.WriteTree(tree); nil != err {
		t.Fatal(err)
	}
	treenode.UpsertBlockTree(tree)

	childInfo, err := GetDocSaveAsTemplateInfo(fixture.childID)
	if nil != err {
		t.Fatal(err)
	}
	if "weekly" != childInfo.Name || "reviews" != childInfo.Directory || childInfo.HasDatabase {
		t.Fatalf("unexpected child export info: %+v", childInfo)
	}
	headingInfo, err := GetDocSaveAsTemplateInfo(heading.ID)
	if nil != err || !headingInfo.HasDatabase {
		t.Fatalf("database in the exported heading subtree was not detected: %+v %v", headingInfo, err)
	}
	docInfo, err := GetDocSaveAsTemplateInfo(fixture.sourceID)
	if nil != err || !docInfo.HasDatabase {
		t.Fatalf("document database was not detected: %+v %v", docInfo, err)
	}

	if _, err = ManageTemplateFiles(TemplateFileRequest{Action: "mkdir", Path: "reviews"}); nil != err {
		t.Fatal(err)
	}
	code, err := DocSaveAsTemplateInDirectory(fixture.sourceID, "weekly", "reviews", false,
		TemplateDatabaseModeCopy)
	if nil != err || 0 != code {
		t.Fatalf("export failed: %d %v", code, err)
	}
	info, err = GetDocSaveAsTemplateInfo(fixture.childID)
	if nil != err || "weekly" != info.Name || "reviews" != info.Directory {
		t.Fatalf("document export settings were not remembered from a child: %+v %v", info, err)
	}

	if _, err = ManageTemplateFiles(TemplateFileRequest{Action: "write", Path: "existing.md", Content: "existing"}); nil != err {
		t.Fatal(err)
	}
	code, err = DocSaveAsTemplateInDirectory(fixture.sourceID, "existing", "", false,
		TemplateDatabaseModeCopy)
	if nil != err || 1 != code {
		t.Fatalf("existing template did not request overwrite: %d %v", code, err)
	}
	info, err = GetDocSaveAsTemplateInfo(fixture.sourceID)
	if nil != err || "weekly" != info.Name || "reviews" != info.Directory {
		t.Fatalf("rejected export changed remembered settings: %+v %v", info, err)
	}

	code, err = DocSaveAsTemplateInDirectory(fixture.sourceID, "weekly", "reviews", true,
		TemplateDatabaseModeCopy)
	if nil != err || 0 != code {
		t.Fatalf("overwrite export failed: %d %v", code, err)
	}
	content, err := os.ReadFile(filepath.Join(util.DataDir, "templates", "reviews", "weekly.md"))
	if nil != err {
		t.Fatal(err)
	}
	if strings.Contains(string(content), templateExportNameAttr) ||
		strings.Contains(string(content), templateExportDirectoryAttr) {
		t.Fatalf("remembered settings leaked into template: %s", content)
	}
	source, err := LoadTreeByBlockID(fixture.sourceID)
	if nil != err || "weekly" != source.Root.IALAttr(templateExportNameAttr) ||
		"reviews" != source.Root.IALAttr(templateExportDirectoryAttr) {
		t.Fatalf("source document lost remembered settings: %+v %v", source.Root.KramdownIAL, err)
	}
}

func TestTemplateExistingNames(t *testing.T) {
	previous := util.DataDir
	util.DataDir = t.TempDir()
	t.Cleanup(func() { util.DataDir = previous })
	root, err := openTemplateRoot()
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	if err = root.Mkdir("O'Reilly", 0755); err != nil {
		t.Fatal(err)
	}
	if err = root.WriteFile("O'Reilly/one's.md", []byte("original"), 0644); err != nil {
		t.Fatal(err)
	}
	read, err := ManageTemplateFiles(TemplateFileRequest{Action: "read", Path: "O'Reilly/one's.md"})
	if err != nil {
		t.Fatal(err)
	}
	saved, err := ManageTemplateFiles(TemplateFileRequest{Action: "write", Path: "O'Reilly/one's.md", Revision: read.(map[string]string)["revision"], Content: "edited"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = ManageTemplateFiles(TemplateFileRequest{Action: "move", Path: "O'Reilly/one's.md", Target: "O'Reilly/two's.md", Revision: saved.(map[string]string)["revision"]}); err != nil {
		t.Fatal(err)
	}
	if _, err = ManageTemplateFiles(TemplateFileRequest{Action: "write", Path: "O'Reilly/new's.md", Content: "new"}); err != nil {
		t.Fatal(err)
	}
	if _, err = ManageTemplateFiles(TemplateFileRequest{Action: "remove", Path: "O'Reilly/two's.md", Revision: saved.(map[string]string)["revision"]}); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"CON.md", "trailing .", "line\nbreak.md", "bad<name.md"} {
		if _, err := ManageTemplateFiles(TemplateFileRequest{Action: "write", Path: name}); err == nil {
			t.Errorf("accepted invalid new name %q", name)
		}
	}
}

func TestTemplatePackageIdentity(t *testing.T) {
	previous, previousConf := util.DataDir, Conf
	util.DataDir = t.TempDir()
	Conf = NewAppConf()
	Conf.Search = conf.NewSearch()
	t.Cleanup(func() { util.DataDir, Conf = previous, previousConf })
	root, err := openTemplateRoot()
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	if err = root.Mkdir("package-one", 0755); err != nil {
		t.Fatal(err)
	}
	if err = root.WriteFile("package-one/template.json", []byte(`{"name":"package-one"}`), 0644); err != nil {
		t.Fatal(err)
	}
	if err = root.WriteFile("package-one/note.md", []byte("template"), 0644); err != nil {
		t.Fatal(err)
	}
	list, err := ManageTemplateFiles(TemplateFileRequest{Action: "list"})
	if err != nil || !list.([]TemplateFileEntry)[0].IsPackage {
		t.Fatalf("package not identified: %+v %v", list, err)
	}
	read, err := ManageTemplateFiles(TemplateFileRequest{Action: "read", Path: "package-one"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = ManageTemplateFiles(TemplateFileRequest{Action: "move", Path: "package-one", Target: "package-two", Revision: read.(map[string]string)["revision"]}); err == nil {
		t.Fatal("package directory renamed")
	}
	if got := SearchTemplate(""); len(got) != 1 {
		t.Fatalf("package templates disappeared: %+v", got)
	}
	read, err = ManageTemplateFiles(TemplateFileRequest{Action: "read", Path: "package-one/note.md"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = ManageTemplateFiles(TemplateFileRequest{Action: "write", Path: "package-one/note.md", Revision: read.(map[string]string)["revision"], Content: "edited"}); err != nil {
		t.Fatal(err)
	}
}

func TestExportTemplateDocumentAttributeScope(t *testing.T) {
	for _, test := range []struct {
		name   string
		chunks []string
		want   string
	}{
		{"if", []string{`.action{if true}.action{$icon := "conditional"}`, `{: icon=".action{$icon}" type="doc"}`, `.action{end}`}, "conditional"},
		{"false", []string{`.action{if false}.action{$icon := "conditional"}`, `{: icon=".action{$icon}" type="doc"}`, `.action{end}`}, "default"},
		{"range", []string{`.action{range list "first" "last"}`, `{: icon=".action{.}" type="doc"}`, `.action{end}`}, "last"},
		{"snapshot", []string{`.action{$icon := "before"}`, `{: icon=".action{$icon}" type="doc"}`, `.action{$icon = "after"}`}, "before"},
		{"definition", []string{`.action{define "attrs"}`, `{: icon=".action{.}" type="doc"}`, `.action{end}.action{template "attrs" "defined"}`}, "defined"},
	} {
		t.Run(test.name, func(t *testing.T) {
			fixture := setupFileOperationTest(t)
			Conf.Editor, Conf.Export = conf.NewEditor(), conf.NewExport()
			tree, err := LoadTreeByBlockID(fixture.sourceID)
			if err != nil {
				t.Fatal(err)
			}
			tree.Root.SetIALAttr("icon", "default")
			var markdown strings.Builder
			for _, chunk := range test.chunks {
				markdown.WriteString("```template\n" + chunk + "\n```\n\n")
			}
			engine := NewLute()
			codeTree := parse.Parse("", []byte(markdown.String()), engine.ParseOptions)
			for child := codeTree.Root.FirstChild; child != nil; {
				next := child.Next
				child.ID = ast.NewNodeID()
				child.SetIALAttr("id", child.ID)
				tree.Root.AppendChild(child)
				child = next
			}
			if _, err = filesys.WriteTree(tree); err != nil {
				t.Fatal(err)
			}
			treenode.UpsertBlockTree(tree)
			if _, err = DocSaveAsTemplate(fixture.sourceID, "scope", false); err != nil {
				t.Fatal(err)
			}
			p := filepath.Join(util.DataDir, "templates", "scope.md")
			rendered, dom, _, err := RenderTemplateWithMode(p, fixture.sourceID, TemplateRenderModePreview)
			if err != nil {
				t.Fatal(err)
			}
			if rendered.Root.IALAttr("icon") != test.want || strings.Contains(dom, templateDocumentAttributeMarker) {
				t.Fatalf("unexpected attributes or leaked marker: %#v %s", rendered.Root.KramdownIAL, dom)
			}
		})
	}
}

func TestTemplateDocumentAttributeFormats(t *testing.T) {
	setupFileOperationTest(t)
	Conf.Editor, Conf.Export = conf.NewEditor(), conf.NewExport()
	legacy, err := parseTemplateKTree([]byte(`Body

{: id="20260718000001-abcdefg" icon="legacy" type="doc"}`))
	if err != nil || legacy.Root.IALAttr("icon") != "legacy" {
		t.Fatalf("legacy attributes changed: %v", err)
	}
	markdown := "```" + templateDocumentAttributeMarker + "\n{: icon=\"child\" type=\"doc\"}\n```\n\n{: id=\"20260718000001-abcdefg\" icon=\"default\" type=\"doc\"}"
	child, err := renderTemplateDocTreeMarkdown([]byte(markdown), "")
	if err != nil || child.Root.IALAttr("icon") != "child" {
		t.Fatalf("child template attributes not applied: %v", err)
	}
	only, err := parseTemplateKTree([]byte("```" + templateDocumentAttributeMarker + "\n{: id=\"ignored\" updated=\"ignored\" icon=\"only\" type=\"doc\"}\n```"))
	if err != nil || only.Root.IALAttr("icon") != "only" || only.Root.ID == "ignored" || only.Root.IALAttr("updated") == "ignored" {
		t.Fatalf("standalone attributes or protected identity changed: %v", err)
	}
	if _, err = parseTemplateKTree([]byte("```" + templateDocumentAttributeMarker + "\ninvalid\n```")); err == nil {
		t.Fatal("invalid attributes silently accepted")
	}
	code, err := parseTemplateKTree([]byte("````html\n" + markdown + "\n````"))
	if err != nil || code.Root.IALAttr("icon") != "" {
		t.Fatal("literal code example interpreted as attributes")
	}
}

func TestPreviewTemplateDocumentTreeSummary(t *testing.T) {
	fixture := setupFileOperationTest(t)
	p := writeTemplateDocTreeTestFile(t, "saved")
	clearTemplateDocTreePlansForTest()
	t.Cleanup(clearTemplateDocTreePlansForTest)
	_, _, summary, err := PreviewTemplateSource(p, fixture.sourceID, `.action{createDocTree (list (dict "title" "Parent" "children" (list (dict "title" "Child"))))}`)
	if err != nil {
		t.Fatal(err)
	}
	if summary == nil || summary.Count != 2 || summary.Nodes[0].Title != "Parent" || summary.Nodes[1].Title != "Child" || summary.Nodes[1].Depth != summary.Nodes[0].Depth+1 {
		t.Fatalf("unexpected summary: %+v", summary)
	}
	if templateDocTreePlanCountForTest() != 0 {
		t.Fatal("preview persisted creation plan")
	}
}
