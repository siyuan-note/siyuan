package treenode

import (
	"errors"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/documentaddressing"
)

func TestDocumentAddressingSourceTitleConflict(t *testing.T) {
	for _, source := range []string{
		`{"Spec":"2","Properties":{"title":"A/B"}}`,
		`{"Spec":"2","Properties":{"title":"A\u002fB"}}`,
		`{"Spec":"2","Properties":{"title":"A&#47;B"}}`,
		`{"Spec":"2","Properties":{"title":"A/B","title":"Legacy"}}`,
		`{"Spec":"2","Properties":{"title":"A/B"},"Properties":{"title":"Legacy"}}`,
		`{"Spec":"999","Properties":{"title":"private/title"}}`,
		`{"Properties":{"title":"private/title"},"Spec":"999"}`,
	} {
		if err := CheckSpecJSON([]byte(source)); !errors.Is(err, documentaddressing.ErrModeConflict) {
			t.Errorf("source title conflict was not retained: %v", err)
		} else if strings.Contains(err.Error(), "private") {
			t.Fatal("source title leaked into error")
		}
	}
	for _, title := range []string{"A/B", "A&#47;B"} {
		root := &ast.Node{Type: ast.NodeDocument, Spec: "2"}
		root.KramdownIAL = [][]string{{"title", title}}
		if err := CheckSpec(&parse.Tree{Root: root}); !errors.Is(err, documentaddressing.ErrModeConflict) {
			t.Fatalf("in-memory source title was accepted: %v", err)
		}
	}
}

func TestDocumentAddressingSourcePreservesOrdinaryTitles(t *testing.T) {
	root := &ast.Node{Type: ast.NodeDocument, Spec: "2"}
	root.SetIALAttr("title", "A&#47;B")
	if err := CheckSpec(&parse.Tree{Root: root}); err != nil {
		t.Fatal("literal entity was decoded twice", err)
	}
	for _, source := range []string{
		`{"Spec":"2","Properties":{"title":"A／B A%2FB **literal** ` + "`code`" + `"}}`,
		`{"Spec":"2","Properties":{"title":"A&amp;#47;B"}}`,
		`{"Spec":"2","Properties":{"title":"","custom-sy-title-empty":"1"}}`,
		`{"Spec":"2","Properties":{"title":null}}`,
		`{"Spec":"2","Properties":{"title":"Legacy"},"Children":[{"Properties":{"title":"A/B"}}]}`,
		`{"Spec":"5","Properties":{"title":"Legacy"},"Children":[{"Type":"NodeMindmap"}]}`,
		`{"Spec":"4","Properties":{"title":"Legacy"},"Children":[{"Type":"NodeTable","Children":[{"Type":"NodeTableRow","Children":[{"Type":"NodeTableCell","TableCellRich":{"spec":1,"format":"kramdown","content":"A/B"}}]}]}]}`,
	} {
		if err := CheckSpecJSON([]byte(source)); err != nil {
			t.Fatalf("ordinary title or body format was rejected: %v", err)
		}
	}
}

func TestDocumentSourceVersionCannotBeShadowed(t *testing.T) {
	if err := CheckSpecJSON([]byte("null")); err == nil {
		t.Fatal("null is not a document source")
	}
	for _, source := range []string{
		`{"Spec":"999","Spec":"2","Properties":{"title":"Legacy"}}`,
		`{"spec":"999","Sp\u0065c":"2","Properties":{"title":"Legacy"}}`,
		`{"Spec":"999","Properties":{"title":{"text":"Future"}}}`,
		`{"Properties":{"title":{"text":"Future"}},"Spec":"999"}`,
	} {
		if err := CheckSpecJSON([]byte(source)); !errors.Is(err, ErrSpecTooNew) {
			t.Fatalf("unsupported source version was hidden: %v", err)
		}
	}
}
