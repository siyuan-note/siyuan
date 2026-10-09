package model

import (
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/conf"
)

func TestExportMarkdownTaskMarkers(t *testing.T) {
	previousConf := Conf
	Conf = NewAppConf()
	Conf.Editor, Conf.Export = conf.NewEditor(), conf.NewExport()
	t.Cleanup(func() { Conf = previousConf })
	config := *conf.NewExport()
	config.AddTitle = false
	for _, preserve := range []bool{false, true} {
		engine := NewLute()
		tree := parse.Parse("", []byte("- [ ] todo\n- [/] progress\n  - [-] canceled\n- [X] done\n- [!] custom\n"), engine.ParseOptions)
		output := exportMarkdownContent0(tree.Root.ID, tree, markdownExportOptions{
			Config: config, Ext: ".md", PreserveTaskMarkers: preserve,
		})
		for _, task := range []struct{ marker, text string }{{" ", "todo"}, {"/", "progress"}, {"-", "canceled"}, {"X", "done"}, {"!", "custom"}} {
			marker := task.marker
			if !preserve && marker != " " {
				marker = "X"
			}
			if !strings.Contains(output, "["+marker+"] "+task.text) {
				t.Fatalf("preserve=%v: missing marker for %s: %s", preserve, task.text, output)
			}
		}
		markers := ""
		ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
			if entering && node.Type == ast.NodeTaskListItemMarker {
				markers += node.EffectiveTaskListItemMarker()
			}
			return ast.WalkContinue
		})
		if markers != " /-X!" {
			t.Fatalf("source task markers changed: %q", markers)
		}
	}
}
