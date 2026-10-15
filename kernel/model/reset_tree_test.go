package model

import (
	"path"
	"strings"
	"testing"

	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestResetTreeTitleAndHPath(t *testing.T) {
	originalConf := Conf
	const testLang = "reset-tree-test"
	originalLang, hadLang := util.Langs[testLang]
	util.Langs[testLang] = map[int]string{16: "Untitled"}
	Conf = NewAppConf()
	Conf.Lang = testLang
	t.Cleanup(func() {
		Conf = originalConf
		if hadLang {
			util.Langs[testLang] = originalLang
		} else {
			delete(util.Langs, testLang)
		}
	})
	for _, test := range []struct {
		name   string
		title  string
		suffix string
	}{
		{name: "duplicate", title: "Example", suffix: "Duplicated"},
		{name: "conflict", title: "Example", suffix: "Conflicted"},
		{name: "reset without suffix", title: "Example"},
		{name: "untitled", title: Conf.language(16), suffix: "Duplicated"},
		{name: "preserve title spaces", title: "Example  Document ", suffix: "Duplicated"},
	} {
		for _, parent := range []string{"", "/Parent"} {
			t.Run(test.name+parent, func(t *testing.T) {
				docPath := "/20261004000001-doc0001.sy"
				if parent != "" {
					docPath = "/20261004000000-parent1" + docPath
				}
				tree := treenode.NewTree("20261004000000-box0001", docPath, parent+"/"+test.title, test.title)
				resetTree(tree, test.suffix, false)
				title := tree.Root.IALAttr("title")
				if tree.HPath != parent+"/"+title {
					t.Fatalf("title and path disagree: title=%q, hpath=%q", title, tree.HPath)
				}
				if test.suffix == "" || test.title == Conf.language(16) {
					if title != test.title {
						t.Fatalf("unexpected title: %q", title)
					}
				} else if !strings.HasPrefix(title, test.title+" ("+test.suffix+" ") || !strings.HasSuffix(title, ")") {
					t.Fatalf("unexpected suffix: %q", title)
				}
				if path.Dir(tree.Path) != path.Dir(docPath) || path.Base(tree.Path) != tree.ID+".sy" {
					t.Fatalf("unexpected document path: %q", tree.Path)
				}
			})
		}
	}
}
