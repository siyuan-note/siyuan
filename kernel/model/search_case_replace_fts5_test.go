//go:build fts5

package model

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/88250/lute/render"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestFindReplaceCaseSensitivityAcrossTypes(t *testing.T) {
	for _, tc := range []struct {
		name, keyword, replacement       string
		method                           int
		caseSensitive, replaced, enabled bool
	}{
		{"literal-insensitive", "foo", "bar$1", 0, false, true, true},
		{"query-insensitive", "foo", "bar$1", 1, false, true, true},
		{"literal-tag-replacement", "foo", "#bar#", 0, false, true, true},
		{"query-tag-replacement", "foo", "#bar#", 1, false, true, true},
		{"regex-tag-replacement", "(?i)foo", "#bar#", 3, false, true, true},
		{"literal-sensitive", "foo", "bar", 0, true, false, true},
		{"regex-sensitive", "foo", "bar", 3, false, false, true},
		{"regex-folded-capture", "(?i)(foo)", "${1}bar", 3, true, true, true},
		{"disabled-types", "foo", "bar", 0, false, false, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fixture := setupStructureTransactionTest(t)
			setupFoldTransactionDatabase(t, fixture)
			Conf.Search = conf.NewSearch()
			Conf.Search.CaseSensitive = tc.caseSensitive
			tree, err := LoadTreeByBlockID(fixture.sourceID)
			if err != nil {
				t.Fatal(err)
			}
			tree.Root.SetIALAttr("title", "FOO")
			tree.Root.SetIALAttr("tags", "FOO")
			engine := util.NewLute()
			markdown := "FOO\n\n![FOO](assets/FOO.png \"FOO\")\n\n```text\nFOO\n```\n\n$$\nFOO\n$$\n\n<div>FOO</div>"
			parsed := parse.Parse("", []byte(markdown), engine.ParseOptions)
			parse.NestedInlines2FlattedSpans(parsed, false)
			for child := parsed.Root.FirstChild; child != nil; {
				next := child.Next
				child.Unlink()
				tree.Root.AppendChild(child)
				child = next
			}
			for _, mark := range []string{"a", "code", "em", "strong", "u", "s", "mark", "sup", "sub", "kbd", "tag", "inline-math", "inline-memo", "block-ref", "file-annotation-ref"} {
				paragraph := &ast.Node{Type: ast.NodeParagraph}
				node := &ast.Node{Type: ast.NodeTextMark, TextMarkType: mark, TextMarkTextContent: "FOO"}
				switch mark {
				case "a":
					node.TextMarkAHref, node.TextMarkATitle = "https://example.com/FOO", "FOO"
				case "inline-math":
					node.TextMarkInlineMathContent = "FOO"
				case "inline-memo":
					node.TextMarkInlineMemoContent = "FOO"
				case "block-ref":
					node.TextMarkBlockRefID, node.TextMarkBlockRefSubtype = fixture.targetID, "d"
				case "file-annotation-ref":
					node.TextMarkFileAnnotationRefID = "assets/test.pdf/" + fixture.targetID
				}
				paragraph.AppendChild(node)
				tree.Root.AppendChild(paragraph)
			}
			ids := []string{tree.ID}
			ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
				if entering && node != tree.Root && node.IsBlock() {
					if node.ID == "" {
						node.ID = ast.NewNodeID()
						node.SetIALAttr("id", node.ID)
					}
					ids = append(ids, node.ID)
				}
				return ast.WalkContinue
			})
			if _, err = filesys.WriteTree(tree); err != nil {
				t.Fatal(err)
			}
			treenode.UpsertBlockTree(tree)
			before, _ := json.Marshal(tree.Root)
			replaceTypes := map[string]bool{}
			for _, key := range []string{"text", "imgText", "imgTitle", "imgSrc", "aText", "aTitle", "aHref", "code", "em", "strong", "inlineMath", "inlineMemo", "blockRef", "fileAnnotationRef", "kbd", "mark", "s", "sub", "sup", "tag", "u", "docTitle", "codeBlock", "mathBlock", "htmlBlock"} {
				replaceTypes[key] = tc.enabled
			}
			if err = FindReplaceInBox(tc.keyword, tc.replacement, replaceTypes, ids, nil, nil, nil, nil, tc.method, ""); err != nil {
				t.Fatal(err)
			}
			cache.RemoveTreeData(tree.ID)
			restored, err := filesys.LoadTree(tree.Box, tree.Path, engine)
			if err != nil {
				t.Fatal(err)
			}
			after, _ := json.Marshal(restored.Root)
			want := strings.Count(string(before), "FOO")
			if !tc.replaced {
				if got := strings.Count(string(after), "FOO"); got != want {
					t.Fatalf("case-sensitive content changed: got %d original matches, want %d\n%s", got, want, after)
				}
				return
			}
			expected := tc.replacement
			if tc.name == "regex-folded-capture" {
				expected = "FOObar"
			}
			if tc.replacement == "#bar#" {
				after = render.NewJSONRenderer(restored, engine.RenderOptions, engine.ParseOptions).Render()
				if restored.Root.IALAttr("tags") != "bar" || restored.Root.IALAttr("title") != "#bar#" {
					t.Fatalf("tag replacement changed document replacement: tags %q, title %q", restored.Root.IALAttr("tags"), restored.Root.IALAttr("title"))
				}
				if strings.Count(string(after), "#bar#") < 10 {
					t.Fatalf("tag delimiters lost in following body replacements: %s", after)
				}
				return
			}
			if got := strings.Count(string(after), expected); got < want {
				t.Fatalf("not all fields replaced literally: got %d matches, want at least %d\n%s", got, want, after)
			}
			if tc.method != 3 && strings.Contains(string(after), "FOO") {
				t.Fatalf("unreplaced case-folded field: %s", after)
			}
			historyFound := false
			err = filepath.WalkDir(util.HistoryDir, func(path string, entry os.DirEntry, walkErr error) error {
				if walkErr != nil {
					return walkErr
				}
				if !entry.IsDir() && strings.HasSuffix(path, ".sy") {
					data, readErr := os.ReadFile(path)
					if readErr != nil {
						return readErr
					}
					historyFound = historyFound || strings.Contains(string(data), "FOO")
				}
				return nil
			})
			if err != nil || !historyFound {
				t.Fatalf("source history was not preserved: %v", err)
			}
		})
	}
}
