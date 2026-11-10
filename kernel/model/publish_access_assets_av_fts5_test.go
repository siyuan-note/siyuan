// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

//go:build fts5

package model

import (
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"github.com/88250/lute/ast"
	"github.com/gin-gonic/gin"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// TestDocAssetsFilterAttributeViewRowsByPublishAccess 验证发布读者的资源清单不会包含
// 绑定在禁用文档上的属性视图行资源，索引文本白名单也不会放行该资源。
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-q2x4-crw5-q567
func TestDocAssetsFilterAttributeViewRowsByPublishAccess(t *testing.T) {
	const (
		publicBoxID     = "20261105010000-box0001"
		privateBoxID    = "20261105010001-box0002"
		publicDocID     = "20261105010002-pubdoc1"
		privateDocID    = "20261105010003-pridoc1"
		attributeViewID = "20261105010004-av00001"
		avBlockID       = "20261105010005-avblk01"
		assetPath       = "assets/private-row.txt"
	)
	setupExportPublishTest(t)
	oldLang, oldAttrViewLangs := util.Lang, util.AttrViewLangs
	util.Lang = "en"
	util.AttrViewLangs = map[string]map[string]any{"en": {"key": "Key", "table": "Table", "select": "Select"}}
	t.Cleanup(func() { util.Lang, util.AttrViewLangs = oldLang, oldAttrViewLangs })

	publicTree := treenode.NewTree(publicBoxID, "/"+publicDocID+".sy", "/Public", "Public")
	publicTree.Root.AppendChild(&ast.Node{
		Type:              ast.NodeAttributeView,
		ID:                avBlockID,
		AttributeViewID:   attributeViewID,
		AttributeViewType: string(av.LayoutTypeTable),
	})
	writeExportRelatedTestTree(t, publicTree)

	privateTree := treenode.NewTree(privateBoxID, "/"+privateDocID+".sy", "/Private", "Private")
	writeExportRelatedTestTree(t, privateTree)

	attrView := av.NewAttributeView(attributeViewID)
	assetKey := av.NewKey(ast.NewNodeID(), "Asset", "", av.KeyTypeMAsset)
	assetValues := &av.KeyValues{Key: assetKey}
	attrView.KeyValues = append(attrView.KeyValues, assetValues)
	blockKey := attrView.GetBlockKey()
	attrView.GetBlockKeyValues().Values = append(attrView.GetBlockKeyValues().Values, &av.Value{
		ID:      ast.NewNodeID(),
		KeyID:   blockKey.ID,
		BlockID: privateDocID,
		Type:    av.KeyTypeBlock,
		Block:   &av.ValueBlock{ID: privateDocID, Content: "Private row"},
	})
	assetValues.Values = append(assetValues.Values, &av.Value{
		ID:      ast.NewNodeID(),
		KeyID:   assetKey.ID,
		BlockID: privateDocID,
		Type:    av.KeyTypeMAsset,
		MAsset:  []*av.ValueAsset{{Type: av.AssetTypeFile, Content: assetPath}},
	})
	attrView.Views[0].ItemIDs = append(attrView.Views[0].ItemIDs, privateDocID)
	attrView.Views[0].Table.Columns = append(attrView.Views[0].Table.Columns,
		&av.ViewTableColumn{BaseField: &av.BaseField{ID: assetKey.ID}})
	if err := av.SaveAttributeView(attrView); err != nil {
		t.Fatal(err)
	}

	adminAssets, err := DocAssets(publicDocID, true)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(adminAssets, assetPath) {
		t.Fatalf("admin asset list missing attribute view asset: %v", adminAssets)
	}

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	c.Set(RoleContextKey, RoleReader)

	publishAccess := PublishAccess{{ID: privateDocID, Visible: true, Disable: true}}
	readerAssets, err := DocAssetsForPublishAccess(c, publishAccess, publicDocID, true)
	if err != nil {
		t.Fatal(err)
	}
	if slices.Contains(readerAssets, assetPath) {
		t.Fatalf("reader asset list leaked disabled row asset: %v", readerAssets)
	}

	filtered := FilterAssetContentByPublishAccess(c, publishAccess, []*AssetContent{{Path: assetPath}})
	if len(filtered) != 0 {
		t.Fatalf("reader asset content allowed disabled row asset: %+v", filtered)
	}

	filtered = FilterAssetContentByPublishAccess(c, PublishAccess{}, []*AssetContent{{Path: assetPath}})
	if len(filtered) != 1 || filtered[0].Path != assetPath {
		t.Fatalf("accessible row asset was filtered: %+v", filtered)
	}
}
