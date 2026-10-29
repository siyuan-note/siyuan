// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package model

import (
	"crypto/sha256"
	"encoding/json"
	"strings"

	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/cache"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type attributeViewOrderReuse struct {
	key                 [32]byte
	avID                string
	version, generation uint64
	orderedIDs          []string
}

func planAttributeViewOrderReuse(attrView *av.AttributeView, view *av.View, nodeID string, writable bool) *attributeViewOrderReuse {
	version, generation := attrView.RenderSourceVersion()
	if version == 0 || generation != cache.GetAVCacheGeneration() || av.GetAVBoxID(attrView.ID) != "" ||
		version != cache.EnsureAVDataVersionInBox(attrView.ID, "") || !staticAttributeViewOrder(attrView, view) {
		return nil
	}
	templates := planAttributeViewTemplates(attrView, view, "", false)
	if templates == nil || len(templates.required) == 0 {
		return nil
	}
	// 实际内存值也参与指纹，避免预览或临时编辑沿用持久化源版本下的旧顺序。
	// 常见值以带长度边界的字节流编码，其他值分块使用完整 JSON。
	digest := sha256.New()
	encoder := json.NewEncoder(digest)
	definition := *attrView
	definition.KeyValues = nil
	err := encoder.Encode(struct {
		Format              string
		Data                *av.AttributeView
		View                *av.View
		Carrier, Language   string
		Writable            bool
		Version, Generation uint64
		KeyValues           int
	}{"stream1", &definition, view, nodeID, util.Lang, writable, version, generation, len(attrView.KeyValues)})
	if err != nil {
		return nil
	}
	valuesDigest := attributeViewOrderFingerprint{digest: digest}
	for _, values := range attrView.KeyValues {
		if err = encoder.Encode(struct {
			Key   *av.Key
			Count int
			Nil   bool
		}{values.Key, len(values.Values), values.Values == nil}); err != nil {
			return nil
		}
		if err = valuesDigest.writeValues(encoder, values.Values); err != nil {
			return nil
		}
	}
	var fingerprint [32]byte
	digest.Sum(fingerprint[:0])
	return &attributeViewOrderReuse{key: fingerprint, avID: attrView.ID, version: version, generation: generation}
}

func staticAttributeViewOrder(attrView *av.AttributeView, view *av.View) bool {
	if attrView == nil || view == nil {
		return false
	}
	if view.IsGroupView() || len(view.Groups) > 0 || view.GroupItemIDs != nil || view.GroupCalc != nil {
		return false
	}
	fields := []*av.BaseField{}
	switch view.LayoutType {
	case av.LayoutTypeTable, av.LayoutTypeList:
		if view.GetTableLayout() == nil {
			return false
		}
		for _, field := range view.GetTableLayout().Columns {
			if field == nil || field.BaseField == nil {
				return false
			}
			if field.Calc != nil && field.Calc.Operator != av.CalcOperatorNone {
				return false
			}
			fields = append(fields, field.BaseField)
		}
	case av.LayoutTypeGallery:
		if view.Gallery == nil || view.Gallery.CoverFrom != av.CoverFromNone {
			return false
		}
		for _, field := range view.Gallery.CardFields {
			if field == nil || field.BaseField == nil {
				return false
			}
			fields = append(fields, field.BaseField)
		}
	default:
		return false
	}
	for _, field := range fields {
		if field != nil && field.Calc != nil && field.Calc.Operator != av.CalcOperatorNone {
			return false
		}
	}
	primary := attrView.GetBlockKeyValues()
	if primary == nil || len(primary.Values) < 512 {
		return false
	}
	for _, value := range primary.Values {
		if value == nil || !value.IsDetached || value.Block == nil || value.Block.ID != "" {
			return false
		}
	}
	if _, resolved := sql.GetTemplateKeysByResolutionOrder(attrView); !resolved {
		return false
	}
	for _, values := range attrView.KeyValues {
		if values == nil || values.Key == nil || !staticAttributeViewOrderType(values.Key.Type) {
			return false
		}
		if values.Key.Type == av.KeyTypeTemplate || strings.TrimSpace(values.Key.RenderTemplate) != "" {
			if !sql.IsReusableTemplateKey(attrView, values.Key) {
				return false
			}
		}
		for _, value := range values.Values {
			if value != nil && value.Text != nil && (value.Text.IsRich() || strings.Contains(value.Text.Content, "<") || strings.Contains(value.Text.Content, "((") || strings.Contains(value.Text.Content, "siyuan://")) {
				return false
			}
		}
	}
	var staticFilters func([]*av.ViewFilter) bool
	staticFilters = func(filters []*av.ViewFilter) bool {
		for _, filter := range filters {
			if filter == nil {
				continue
			}
			if filter.RelativeDate != nil || filter.RelativeDate2 != nil || !staticFilters(filter.Filters) ||
				(filter.Value != nil && !staticAttributeViewOrderType(filter.Value.Type)) {
				return false
			}
		}
		return true
	}
	if !staticFilters(view.Filters) {
		return false
	}
	for _, rule := range view.EffectiveConditionalColors() {
		if rule != nil && !staticFilters([]*av.ViewFilter{rule.Filter}) {
			return false
		}
	}
	return true
}

func staticAttributeViewOrderType(typ av.KeyType) bool {
	switch typ {
	case av.KeyTypeBlock, av.KeyTypeText, av.KeyTypeNumber, av.KeyTypeCheckbox, av.KeyTypeSelect, av.KeyTypeMSelect,
		av.KeyTypeURL, av.KeyTypeEmail, av.KeyTypePhone, av.KeyTypeTemplate:
		return true
	}
	return false
}

func (reuse *attributeViewOrderReuse) capture(items []av.Item) {
	if reuse == nil {
		return
	}
	reuse.orderedIDs = make([]string, len(items))
	for i, item := range items {
		reuse.orderedIDs[i] = item.GetID()
	}
}

func (reuse *attributeViewOrderReuse) store(renderContext *sql.AttributeViewRenderContext) {
	if reuse != nil && reuse.orderedIDs != nil && !renderContext.HasTemplateErrors() {
		cache.SetAVOrderedIDs(reuse.avID, reuse.version, reuse.generation, reuse.key, reuse.orderedIDs)
	}
}

func (reuse *attributeViewOrderReuse) renderPage(attrView *av.AttributeView, view *av.View, page, pageSize int,
	renderContext *sql.AttributeViewRenderContext) (av.Viewable, bool) {
	if reuse == nil {
		return nil, false
	}
	ids, found := cache.GetAVOrderedIDs(reuse.avID, reuse.version, reuse.generation, reuse.key)
	if !found {
		return nil, false
	}
	start, end := getAttributeViewRenderRange(page, pageSize, -1, view.PageSize, len(ids))
	pageView := *view
	pageView.GroupItemIDs = ids[start:end]
	rendered := sql.RenderViewWithContext(attrView, &pageView, "", false, renderContext)
	collection := rendered.(av.Collection)
	byID := map[string]av.Item{}
	for _, item := range collection.GetItems() {
		byID[item.GetID()] = item
	}
	items := make([]av.Item, 0, end-start)
	for _, id := range ids[start:end] {
		item := byID[id]
		if item == nil {
			delete(attrView.RenderedViewables, view.ID)
			return nil, false
		}
		items = append(items, item)
	}
	collection.SetItems(items)
	if gallery, ok := rendered.(*av.Gallery); ok {
		gallery.CardCount = len(ids)
	} else {
		av.TableFromViewable(rendered).RowCount = len(ids)
	}
	av.RenderConditionalColors(rendered, view, attrView, nil, map[string]*av.AttributeView{})
	return rendered, true
}
