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

// TestDocAssetsFilterAttributeViewNestedValuesByPublishAccess 验证发布读者的资源清单不会包含
// 可见行关联或汇总内容中指向发布禁用文档的嵌套资源，可见文档自身的资源仍然保留。
func TestDocAssetsFilterAttributeViewNestedValuesByPublishAccess(t *testing.T) {
	const (
		publicBoxID       = "20261106010000-box0001"
		privateBoxID      = "20261106010001-box0002"
		publicDocID       = "20261106010002-pubdoc1"
		privateDocID      = "20261106010003-pridoc1"
		attributeViewID   = "20261106010004-av00001"
		avBlockID         = "20261106010005-avblk01"
		targetAttrViewID  = "20261106010006-targav0"
		outerAssetPath    = "assets/public-outer-row.txt"
		publicNestedPath  = "assets/public-nested.txt"
		publicRollupPath  = "assets/public-rollup.txt"
		privateNestedPath = "assets/private-nested.txt"
		privateURLPath    = "assets/private-nested-url.png"
		privateRichPath   = "assets/private-nested-rich.png"
		privateRollupPath = "assets/private-rollup.txt"
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

	outerRowID := ast.NewNodeID()
	privateTargetRowID := ast.NewNodeID()
	publicTargetRowID := ast.NewNodeID()

	assetKey := av.NewKey(ast.NewNodeID(), "Asset", "", av.KeyTypeMAsset)
	relationKey := av.NewKey(ast.NewNodeID(), "Relation", "", av.KeyTypeRelation)
	relationKey.Relation = &av.Relation{AvID: targetAttrViewID}
	rollupKey := av.NewKey(ast.NewNodeID(), "Rollup", "", av.KeyTypeRollup)
	rollupKey.Rollup = &av.Rollup{RelationKeyID: relationKey.ID, KeyID: ast.NewNodeID()}

	attrView := av.NewAttributeView(attributeViewID)
	blockKey := attrView.GetBlockKey()
	attrView.GetBlockKeyValues().Values = append(attrView.GetBlockKeyValues().Values, &av.Value{
		ID:      ast.NewNodeID(),
		KeyID:   blockKey.ID,
		BlockID: outerRowID,
		Type:    av.KeyTypeBlock,
		Block:   &av.ValueBlock{ID: publicDocID, Content: "Public row"},
	})
	attrView.KeyValues = append(attrView.KeyValues,
		&av.KeyValues{
			Key: assetKey,
			Values: []*av.Value{{
				ID:      ast.NewNodeID(),
				KeyID:   assetKey.ID,
				BlockID: outerRowID,
				Type:    av.KeyTypeMAsset,
				MAsset:  []*av.ValueAsset{{Type: av.AssetTypeFile, Content: outerAssetPath}},
			}},
		},
		&av.KeyValues{
			Key: relationKey,
			Values: []*av.Value{{
				ID:      ast.NewNodeID(),
				KeyID:   relationKey.ID,
				BlockID: outerRowID,
				Type:    av.KeyTypeRelation,
				Relation: &av.ValueRelation{
					BlockIDs: []string{privateTargetRowID, publicTargetRowID},
					// 嵌套内容绑定在目标行上，其中私有目标行绑定的是发布禁用文档
					Contents: []*av.Value{
						{
							ID: ast.NewNodeID(), KeyID: blockKey.ID, BlockID: privateTargetRowID,
							Type: av.KeyTypeBlock, Block: &av.ValueBlock{ID: privateDocID, Content: "Private target"},
						},
						{
							ID: ast.NewNodeID(), KeyID: relationKey.ID, BlockID: privateTargetRowID,
							Type: av.KeyTypeMAsset, Block: &av.ValueBlock{ID: privateDocID},
							MAsset: []*av.ValueAsset{{Type: av.AssetTypeFile, Content: privateNestedPath}},
						},
						{
							ID: ast.NewNodeID(), KeyID: relationKey.ID, BlockID: privateTargetRowID,
							Type: av.KeyTypeURL, Block: &av.ValueBlock{ID: privateDocID},
							URL: &av.ValueURL{Content: privateURLPath},
						},
						{
							ID: ast.NewNodeID(), KeyID: relationKey.ID, BlockID: privateTargetRowID,
							Type: av.KeyTypeText, Block: &av.ValueBlock{ID: privateDocID},
							Text: newAttributeViewRichText(t, "[Private]("+privateRichPath+")"),
						},
						{
							ID: ast.NewNodeID(), KeyID: relationKey.ID, BlockID: publicTargetRowID,
							Type: av.KeyTypeMAsset, Block: &av.ValueBlock{ID: publicDocID},
							MAsset: []*av.ValueAsset{{Type: av.AssetTypeFile, Content: publicNestedPath}},
						},
					},
				},
			}},
		},
		&av.KeyValues{
			Key: rollupKey,
			Values: []*av.Value{{
				ID:      ast.NewNodeID(),
				KeyID:   rollupKey.ID,
				BlockID: outerRowID,
				Type:    av.KeyTypeRollup,
				Rollup: &av.ValueRollup{Contents: []*av.Value{
					{
						ID: ast.NewNodeID(), KeyID: rollupKey.ID, BlockID: privateTargetRowID,
						Type: av.KeyTypeMAsset, Block: &av.ValueBlock{ID: privateDocID},
						MAsset: []*av.ValueAsset{{Type: av.AssetTypeFile, Content: privateRollupPath}},
					},
					{
						ID: ast.NewNodeID(), KeyID: rollupKey.ID, BlockID: publicTargetRowID,
						Type: av.KeyTypeMAsset, Block: &av.ValueBlock{ID: publicDocID},
						MAsset: []*av.ValueAsset{{Type: av.AssetTypeFile, Content: publicRollupPath}},
					},
				}},
			}},
		},
	)
	attrView.Views[0].ItemIDs = append(attrView.Views[0].ItemIDs, outerRowID)
	attrView.Views[0].Table.Columns = append(attrView.Views[0].Table.Columns,
		&av.ViewTableColumn{BaseField: &av.BaseField{ID: assetKey.ID}},
		&av.ViewTableColumn{BaseField: &av.BaseField{ID: relationKey.ID}},
		&av.ViewTableColumn{BaseField: &av.BaseField{ID: rollupKey.ID}},
	)
	if err := av.SaveAttributeView(attrView); err != nil {
		t.Fatal(err)
	}

	publicPaths := []string{outerAssetPath, publicNestedPath, publicRollupPath}
	privatePaths := []string{privateNestedPath, privateURLPath, privateRichPath, privateRollupPath}
	allPaths := append(append([]string{}, publicPaths...), privatePaths...)
	newAssetContents := func() (ret []*AssetContent) {
		for _, path := range allPaths {
			ret = append(ret, &AssetContent{Path: path})
		}
		return
	}

	adminAssets, err := DocAssets(publicDocID, true)
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range allPaths {
		if !slices.Contains(adminAssets, path) {
			t.Fatalf("admin asset list missing nested asset %s: %v", path, adminAssets)
		}
	}

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	c.Set(RoleContextKey, RoleReader)

	publishAccess := PublishAccess{{ID: privateDocID, Visible: true, Disable: true}}
	readerAssets, err := DocAssetsForPublishAccess(c, publishAccess, publicDocID, true)
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range publicPaths {
		if !slices.Contains(readerAssets, path) {
			t.Fatalf("reader asset list missing accessible asset %s: %v", path, readerAssets)
		}
	}
	for _, path := range privatePaths {
		if slices.Contains(readerAssets, path) {
			t.Fatalf("reader asset list leaked nested asset %s: %v", path, readerAssets)
		}
	}

	filtered := FilterAssetContentByPublishAccess(c, publishAccess, newAssetContents())
	filteredPaths := make([]string, 0, len(filtered))
	for _, asset := range filtered {
		filteredPaths = append(filteredPaths, asset.Path)
	}
	slices.Sort(filteredPaths)
	wantPaths := append([]string{}, publicPaths...)
	slices.Sort(wantPaths)
	if !slices.Equal(filteredPaths, wantPaths) {
		t.Fatalf("reader asset content set: got %v, want %v", filteredPaths, wantPaths)
	}

	unrestricted := FilterAssetContentByPublishAccess(c, PublishAccess{}, newAssetContents())
	if len(unrestricted) != len(allPaths) {
		t.Fatalf("accessible nested assets were filtered without publish rules: %+v", unrestricted)
	}
}
