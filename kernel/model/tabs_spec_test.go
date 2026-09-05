// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org

package model

import (
	"errors"
	"testing"

	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func TestDocumentVersionReadersRejectFutureSpecBeforeParsing(t *testing.T) {
	data := []byte(`{"ID":"20260905000000-root001","Type":"NodeDocument","Spec":"999","Children":[{"Type":"NodeFutureContainer","Children":[{"Type":"NodeParagraph","ID":"20260905000001-para001","Children":[{"Type":"NodeText","Data":"preserve future content"}]}]}]}`)
	readers := map[string]func([]byte) (*parse.Tree, error){
		"history": loadTreeByData0,
		"diff": func(data []byte) (*parse.Tree, error) {
			return parseDocVersionTree(data, "20260905000000-root001")
		},
		"snapshot": func(data []byte) (*parse.Tree, error) {
			_, tree, err := parseTreeInSnapshot(data, util.NewLute())
			return tree, err
		},
	}
	for name, read := range readers {
		t.Run(name, func(t *testing.T) {
			tree, err := read(data)
			if !errors.Is(err, treenode.ErrSpecTooNew) {
				t.Fatalf("expected unsupported spec error, got %v", err)
			}
			if nil != tree {
				t.Fatal("unsupported document must not yield a repaired tree")
			}
		})
	}
}

func TestHistoryReaderPreservesSupportedDocument(t *testing.T) {
	data := []byte(`{"ID":"20260905000000-root001","Type":"NodeDocument","Spec":"2","Properties":{"id":"20260905000000-root001","title":"Tabs compatibility"},"Children":[{"Type":"NodeParagraph","ID":"20260905000001-para001","Properties":{"id":"20260905000001-para001"},"Children":[{"Type":"NodeText","Data":"existing content"}]}]}`)
	tree, err := loadTreeByData0(data)
	if nil != err {
		t.Fatal(err)
	}
	if nil == tree || "2" != tree.Root.Spec || "existing content" != tree.Root.FirstChild.FirstChild.TokensStr() {
		t.Fatal("supported document changed while reading history")
	}
}
