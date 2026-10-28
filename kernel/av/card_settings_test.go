// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package av

import (
	"encoding/json"
	"testing"
)

// 卡片布局和看板布局把共有的封面与卡片设置收进嵌入结构，持久化字段必须保持扁平：
// 旧文件是扁平 JSON，前端和插件按顶层字段名读写，出现嵌套对象就是格式变更。

func TestCardSettingsMarshalStaysFlat(t *testing.T) {
	keys := []string{
		"spec", "id", "showIcon", "wrapField",
		"coverFrom", "coverFromAssetKeyID", "cardAspectRatio", "cardAspectRatioValue",
		"cardSize", "cardWidth", "cardLayout", "fitImage", "displayFieldName", "displayEmptyFields",
		"fields",
	}
	for _, test := range []struct {
		name  string
		value any
	}{
		{"gallery", func() *LayoutGallery {
			gallery := NewLayoutGallery()
			gallery.CoverFromAssetKeyID = "asset"
			return gallery
		}()},
		{"kanban", func() *LayoutKanban {
			kanban := NewLayoutKanban()
			kanban.CoverFromAssetKeyID = "asset"
			return kanban
		}()},
	} {
		t.Run(test.name, func(t *testing.T) {
			data, err := json.Marshal(test.value)
			if err != nil {
				t.Fatal(err)
			}
			var decoded map[string]json.RawMessage
			if err = json.Unmarshal(data, &decoded); err != nil {
				t.Fatal(err)
			}
			for _, key := range keys {
				if _, found := decoded[key]; !found {
					t.Fatalf("序列化结果缺少顶层字段 %q：%s", key, data)
				}
			}
			for _, nested := range []string{"CardSettings", "cardSettings", "BaseLayout", "baseLayout"} {
				if _, found := decoded[nested]; found {
					t.Fatalf("嵌入结构不得出现在持久化字段中：%q", nested)
				}
			}
		})
	}
}

func TestCardSettingsUnmarshalLegacyFlatJSON(t *testing.T) {
	const galleryJSON = `{"spec":0,"id":"g","showIcon":true,"wrapField":true,` +
		`"coverFrom":2,"coverFromAssetKeyID":"asset","cardAspectRatio":5,"cardAspectRatioValue":1.5,` +
		`"cardSize":2,"cardWidth":300,"cardLayout":1,"fitImage":true,"displayFieldName":true,` +
		`"displayEmptyFields":true,"fields":[]}`
	var gallery LayoutGallery
	if err := json.Unmarshal([]byte(galleryJSON), &gallery); err != nil {
		t.Fatal(err)
	}
	if CoverFromAssetField != gallery.CoverFrom || "asset" != gallery.CoverFromAssetKeyID {
		t.Fatalf("封面设置未按扁平字段还原：%+v", gallery.CardSettings)
	}
	if 300 != gallery.CardWidth || CardLayoutCompact != gallery.CardLayout || !gallery.FitImage {
		t.Fatalf("卡片设置未按扁平字段还原：%+v", gallery.CardSettings)
	}
	if !gallery.DisplayFieldName || !gallery.DisplayEmptyFields || 2 != gallery.CardSize {
		t.Fatalf("显示设置未按扁平字段还原：%+v", gallery.CardSettings)
	}

	// 往返一次后字节保持不变，确认内嵌结构没有引入格式漂移。
	encoded, err := json.Marshal(&gallery)
	if err != nil {
		t.Fatal(err)
	}
	var again LayoutGallery
	if err = json.Unmarshal(encoded, &again); err != nil {
		t.Fatal(err)
	}
	second, err := json.Marshal(&again)
	if err != nil {
		t.Fatal(err)
	}
	if string(encoded) != string(second) {
		t.Fatalf("往返不稳定：\n%s\n%s", encoded, second)
	}
}

func TestViewAccessorsCoverCardAndBaseLayouts(t *testing.T) {
	gallery := &View{LayoutType: LayoutTypeGallery, Gallery: NewLayoutGallery()}
	if cards := gallery.GetCardSettings(); nil == cards || cards != &gallery.Gallery.CardSettings {
		t.Fatal("卡片视图应返回自己的卡片设置")
	}
	if base := gallery.GetBaseLayout(); nil == base || base != gallery.Gallery.BaseLayout {
		t.Fatal("卡片视图应返回自己的基础设置")
	}

	kanban := &View{LayoutType: LayoutTypeKanban, Kanban: NewLayoutKanban()}
	if cards := kanban.GetCardSettings(); nil == cards || cards != &kanban.Kanban.CardSettings {
		t.Fatal("看板视图应返回自己的卡片设置")
	}

	table := &View{LayoutType: LayoutTypeTable, Table: NewLayoutTable()}
	if nil != table.GetCardSettings() {
		t.Fatal("表格视图没有卡片设置")
	}
	if base := table.GetBaseLayout(); nil == base || base != table.Table.BaseLayout {
		t.Fatal("表格视图的基础设置来自表格布局")
	}

	list := &View{LayoutType: LayoutTypeList, List: NewLayoutList()}
	if base := list.GetBaseLayout(); nil == base {
		t.Fatal("列表视图的基础设置来自表格布局")
	}

	// 布局缺失时返回 nil，调用方用默认值，不因为字段缺失而崩溃。
	broken := &View{LayoutType: LayoutTypeGallery}
	if nil != broken.GetCardSettings() || nil != broken.GetBaseLayout() {
		t.Fatal("缺少布局数据时应返回 nil")
	}
}
