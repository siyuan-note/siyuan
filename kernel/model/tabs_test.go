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

func TestResetTreeRemapsInternalReferences(t *testing.T) {
	const oldRootID = "20260919120000-doc0001"
	const oldID = "20260919120000-para001"
	const externalID = "20260919120000-extern1"
	tree := treenode.NewTree("20260919120000-box0001", "/"+oldRootID+".sy", "/Links", "Links")
	paragraph := treenode.NewParagraph(oldID)
	tree.Root.AppendChild(paragraph)
	var links []*ast.Node
	for _, target := range []string{oldRootID, oldID, externalID} {
		for _, suffix := range []string{"", "?focus=1#anchor"} {
			link := &ast.Node{Type: ast.NodeTextMark, TextMarkType: "a", TextMarkAHref: "siyuan://blocks/" + target + suffix}
			paragraph.AppendChild(link)
			links = append(links, link)
		}
	}
	internalRef := &ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: oldID}
	externalRef := &ast.Node{Type: ast.NodeTextMark, TextMarkType: "block-ref", TextMarkBlockRefID: externalID}
	paragraph.AppendChild(internalRef)
	paragraph.AppendChild(externalRef)
	tabs := &ast.Node{Type: ast.NodeTabs, ID: "20260919120000-tabs001"}
	item := &ast.Node{Type: ast.NodeTabItem, ID: "20260919120000-item001",
		TabItemTitle: "[link](siyuan://blocks/" + oldID + "?focus=1) ((" + externalID + " 'external'))"}
	item.AppendChild(treenode.NewParagraph("20260919120000-body001"))
	tabs.AppendChild(item)
	tabs.SetIALAttr(treenode.TabsActiveIDAttr, item.ID)
	tree.Root.AppendChild(tabs)

	resetTree(tree, "", false)
	if tree.ID == oldRootID || paragraph.ID == oldID {
		t.Fatal("block IDs were not regenerated")
	}
	for i, target := range []string{tree.ID, paragraph.ID, externalID} {
		for j, suffix := range []string{"", "?focus=1#anchor"} {
			if links[i*2+j].TextMarkAHref != "siyuan://blocks/"+target+suffix {
				t.Fatalf("incorrect remapped link: %s", links[i*2+j].TextMarkAHref)
			}
		}
	}
	if internalRef.TextMarkBlockRefID != paragraph.ID || externalRef.TextMarkBlockRefID != externalID {
		t.Fatal("internal or external block reference changed incorrectly")
	}
	if !strings.Contains(item.TabItemTitle, "siyuan://blocks/"+paragraph.ID+"?focus=1") ||
		!strings.Contains(item.TabItemTitle, externalID) || tabs.IALAttr(treenode.TabsActiveIDAttr) != item.ID {
		t.Fatalf("tab title or active item changed incorrectly: %s", item.TabItemTitle)
	}
}
