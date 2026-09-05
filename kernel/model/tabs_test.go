// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"strings"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

func TestTabTitleAssetScanRewriteAndExport(t *testing.T) {
	tree := treenode.NewTree("20260905120000-box0001", "/20260905120000-doc0001.sy", "/Tabs", "Tabs")
	tabs := &ast.Node{Type: ast.NodeTabs, ID: "20260905120000-tabs001"}
	item := &ast.Node{Type: ast.NodeTabItem, ID: "20260905120000-item001",
		TabItemTitle: `**Title** ![image](assets/image-20260905120000-asset01.png)`}
	body := treenode.NewParagraph("20260905120000-para001")
	item.AppendChild(body)
	tabs.AppendChild(item)
	tree.Root.AppendChild(tabs)
	dests := getAssetsLinkDests(tree.Root, false)
	if len(dests) != 1 || dests[0] != "assets/image-20260905120000-asset01.png" {
		t.Fatalf("title assets: %v", dests)
	}
	rewriteTreeAssetReferences(tree, assetReferenceRewriteOptions{pathMap: map[string]string{
		"assets/image-20260905120000-asset01.png": "assets/renamed-20260905120000-asset01.png",
	}})
	if !strings.Contains(item.TabItemTitle, "assets/renamed-20260905120000-asset01.png") || item.FirstChild != body {
		t.Fatalf("title rewrite: %s", item.TabItemTitle)
	}
	oldConf := Conf
	Conf = &AppConf{Export: &conf.Export{RemoveAssetsID: true}}
	t.Cleanup(func() { Conf = oldConf })
	oldNew, newOld := map[string]string{}, map[string]string{}
	removeAssetsID(tree, oldNew, newOld)
	if !strings.Contains(item.TabItemTitle, "assets/renamed.png") || strings.Contains(item.TabItemTitle, "asset01") || item.FirstChild != body {
		t.Fatalf("export title asset: %s", item.TabItemTitle)
	}
	if oldNew["assets/renamed-20260905120000-asset01.png"] != "assets/renamed.png" {
		t.Fatalf("export asset map: %v", oldNew)
	}
}
