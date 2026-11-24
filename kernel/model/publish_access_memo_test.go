// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// TestFilterBlockAttrsByPublishAccessRemovesMemo 校验读者属性副本移除备注且不修改原 map。
func TestFilterBlockAttrsByPublishAccessRemovesMemo(t *testing.T) {
	attrs := map[string]string{"id": "block", "memo": "MEMO_CANARY", "custom-key": "value"}
	filtered := FilterBlockAttrsByPublishAccess(nil, PublishAccess{}, attrs)
	if _, ok := filtered["memo"]; ok {
		t.Fatalf("reader attrs retained memo: %#v", filtered)
	}
	if "block" != filtered["id"] || "value" != filtered["custom-key"] {
		t.Fatalf("reader attrs lost ordinary attributes: %#v", filtered)
	}
	if "MEMO_CANARY" != attrs["memo"] {
		t.Fatal("filter mutated the source attrs")
	}
}

// TestFilterBlockIALByPublishAccessRemovesMemo 校验读者 IAL 副本移除备注且保留其他属性。
func TestFilterBlockIALByPublishAccessRemovesMemo(t *testing.T) {
	ial := [][]string{{"id", "block"}, {"memo", "MEMO_CANARY"}, {"custom-key", "value"}}
	filtered := FilterBlockIALByPublishAccess(nil, PublishAccess{}, ial)
	if 2 != len(filtered) || "id" != filtered[0][0] || "custom-key" != filtered[1][0] {
		t.Fatalf("reader IAL changed ordinary attributes: %#v", filtered)
	}
	if 3 != len(ial) {
		t.Fatal("filter mutated the source IAL")
	}
}

// TestGetBlockKramdownFilterRemovesChildMemo 校验导出父块时子块 IAL 的备注同样被过滤。
func TestGetBlockKramdownFilterRemovesChildMemo(t *testing.T) {
	const (
		canary = "CHILD_KRAMDOWN_MEMO_CANARY_6b1f"
		listID = "20261120000009-listmemo"
	)
	kramdown := "- item one\n{: id=\"20261120000010-item1\" memo=\"" + canary + "\" custom-key=\"value\"}\n"

	listInTree := func(t *testing.T, value string) *parse.Tree {
		t.Helper()
		tree := parse.Parse("", []byte(value), util.NewLute().ParseOptions)
		var list *ast.Node
		ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
			if entering && ast.NodeList == n.Type && nil == list {
				list = n
			}
			return ast.WalkContinue
		})
		if nil == list {
			t.Fatal("fixture has no list block")
		}
		list.ID = listID
		return tree
	}

	reader := getBlockKramdown0Filtered(listInTree(t, kramdown), listID, "md", util.NewLute(), func(ial [][]string) [][]string {
		return FilterBlockIALByPublishAccess(nil, PublishAccess{}, ial)
	})
	if strings.Contains(reader, canary) {
		t.Fatalf("reader kramdown leaked child memo: %s", reader)
	}
	if !strings.Contains(reader, "item one") || !strings.Contains(reader, "custom-key") {
		t.Fatalf("reader kramdown lost visible content or ordinary IAL: %s", reader)
	}
	admin := getBlockKramdown0Filtered(listInTree(t, kramdown), listID, "md", util.NewLute(), nil)
	if !strings.Contains(admin, canary) {
		t.Fatalf("administrator kramdown lost child memo: %s", admin)
	}
	if !strings.Contains(admin, "item one") || !strings.Contains(admin, "custom-key") {
		t.Fatalf("administrator kramdown lost visible content or ordinary IAL: %s", admin)
	}
}
