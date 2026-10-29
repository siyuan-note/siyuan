// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package sql

import (
	"testing"

	"github.com/siyuan-note/siyuan/kernel/av"
)

func TestTIFFAssetFieldCardCovers(t *testing.T) {
	for _, source := range []string{"assets/image.tif", "assets/image.TIFF?box=20261021000000-tiffbox#preview"} {
		t.Run(source, func(t *testing.T) {
			attrView := &av.AttributeView{KeyValues: []*av.KeyValues{{
				Key: &av.Key{ID: "assets", Type: av.KeyTypeMAsset},
				Values: []*av.Value{{BlockID: "row", Type: av.KeyTypeMAsset, MAsset: []*av.ValueAsset{
					{Type: av.AssetTypeFile, Content: "assets/document.pdf"},
					{Type: av.AssetTypeImage, Content: source},
				}}},
			}}}
			view := &av.View{Gallery: av.NewLayoutGallery(), Kanban: av.NewLayoutKanban()}
			view.Gallery.CoverFrom, view.Gallery.CoverFromAssetKeyID = av.CoverFromAssetField, "assets"
			view.Kanban.CoverFrom, view.Kanban.CoverFromAssetKeyID = av.CoverFromAssetField, "assets"
			gallery, kanban := &av.GalleryCard{}, &av.KanbanCard{}
			fillAttributeViewGalleryCardCover(attrView, view, nil, gallery, "row", nil, nil)
			fillAttributeViewKanbanCardCover(attrView, view, nil, kanban, "row", nil, nil)
			if gallery.CoverURL != source || kanban.CoverURL != source {
				t.Fatalf("TIFF asset cover missing: gallery=%q kanban=%q", gallery.CoverURL, kanban.CoverURL)
			}
		})
	}
}
