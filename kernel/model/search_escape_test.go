package model

import (
	"regexp"
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestReplaceTextMarkEscapedContent(t *testing.T) {
	engine := util.NewLute()
	for _, mark := range []string{"em", "strong", "u", "s", "mark", "sup", "sub", "kbd", "text", "tag"} {
		for _, tc := range []struct {
			name, source, keyword, replacement, want string
			method                                   int
		}{
			{"literal", "hello &amp; tail", "hello", "<vitae>", "<vitae> & tail", 0},
			{"regex", "hello &amp; tail", "h(ello)", "<${1}>", "<ello> & tail", 3},
			{"entity-capture", "&lt;vitae&gt; &amp; tail", "(<[^>]+>)", "${1}&lt;", "<vitae>&lt; & tail", 3},
			{"entity-keyword", "&lt;vitae&gt; &amp; tail", "<vitae>", "<&>", "<&> & tail", 0},
			{"whole-visible-text", "&lt;vitae&gt; &amp; tail", "^(.*)$", "[$1]", "[<vitae> & tail]", 3},
		} {
			t.Run(mark+"/"+tc.name, func(t *testing.T) {
				node := &ast.Node{Type: ast.NodeTextMark, TextMarkType: mark, TextMarkTextContent: tc.source}
				replaceNodeTextMarkTextContent(node, tc.method, tc.keyword, util.EscapeHTML(tc.keyword), tc.replacement,
					regexp.MustCompile(tc.keyword), mark, engine)
				if got := util.UnescapeHTML(node.TextMarkTextContent); got != tc.want {
					t.Fatalf("want %q, got %q", tc.want, got)
				}
				if strings.ContainsAny(node.TextMarkTextContent, "<>") {
					t.Fatalf("replacement contains raw HTML: %q", node.TextMarkTextContent)
				}
			})
		}
	}
}

func TestReplaceEscapedTextMarkContentPreservesUnmatchedEntities(t *testing.T) {
	const source = "&#60;literal&#62; &amp;lt;"
	got, matched := replaceEscapedTextMarkContent(source, 3, "missing", "<value>", regexp.MustCompile("missing"))
	if matched || got != source {
		t.Fatalf("unmatched content changed: %q, matched %v", got, matched)
	}
}
