package sql

import (
	"testing"

	"github.com/88250/lute/parse"
)

func TestUpsertIgnoredTreeDoesNotTouchDatabase(t *testing.T) {
	previousCached, previousLines := IndexIgnoreCached, indexIgnore
	IndexIgnoreCached, indexIgnore = true, []string{"/box/ignored.sy"}
	t.Cleanup(func() { IndexIgnoreCached, indexIgnore = previousCached, previousLines })
	tree := &parse.Tree{ID: "ignored", Box: "box", Path: "/ignored.sy"}
	// 忽略判断必须先于读取或删除索引，因此无需提供事务和文档内容。
	if err := upsertTree(nil, tree, nil); err != nil {
		t.Fatal(err)
	}
	if err := insertTree0(nil, tree, nil, nil, nil, nil, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	if isIndexIgnored(&parse.Tree{Box: "box", Path: "/included.sy"}) {
		t.Fatal("unmatched document was ignored")
	}
}
