// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestSetNodeAttrsClaimsFoldState(t *testing.T) {
	node := &ast.Node{Type: ast.NodeListItem, ID: "item"}
	node.SetIALAttr("fold", "1")
	node.SetIALAttr("heading-fold", "1")

	if _, err := setNodeAttrs0(node, map[string]string{"fold": "1"}, ""); nil != err {
		t.Fatal(err)
	}
	if !treenode.IsSelfFolded(node) {
		t.Fatal("explicit fold attribute should become self fold")
	}
	if "" != node.IALAttr("heading-fold") {
		t.Fatal("explicit fold attribute should remove legacy heading-fold")
	}

	node.SetIALAttr("heading-fold", "1")
	if _, err := setNodeAttrs0(node, map[string]string{"fold": ""}, ""); nil != err {
		t.Fatal(err)
	}
	if "" != node.IALAttr("fold") || "" != node.IALAttr("heading-fold") {
		t.Fatal("explicit unfold should remove both fold attributes")
	}
}
