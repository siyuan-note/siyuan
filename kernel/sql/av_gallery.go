package sql

import (
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

func RenderAttributeViewGallery(attrView *av.AttributeView, view *av.View, query string) (ret *av.Gallery) {
	ret = &av.Gallery{
		BaseInstance: &av.BaseInstance{
			ID:               view.ID,
			Icon:             view.Icon,
			Name:             view.Name,
			Desc:             view.Desc,
			HideAttrViewName: view.HideAttrViewName,
			Filters:          view.Gallery.Filters,
			Sorts:            view.Gallery.Sorts,
		},
		Fields: []*av.GalleryField{},
		Cards:  []*av.GalleryCard{},
	}

	// 组装字段
	for _, field := range view.Gallery.CardFields {
		key, getErr := attrView.GetKey(field.ID)
		if nil != getErr {
			// 找不到字段则在视图中删除
			removeMissingField(attrView, view, field.ID)
			continue
		}

		ret.Fields = append(ret.Fields, &av.GalleryField{
			BaseInstanceField: &av.BaseInstanceField{
				ID:           key.ID,
				Name:         key.Name,
				Type:         key.Type,
				Icon:         key.Icon,
				Hidden:       field.Hidden,
				Desc:         key.Desc,
				Options:      key.Options,
				NumberFormat: key.NumberFormat,
				Template:     key.Template,
				Relation:     key.Relation,
				Rollup:       key.Rollup,
				Date:         key.Date,
			},
		})
	}

	// 生成卡片
	cardsValues := map[string][]*av.KeyValues{}
	for _, keyValues := range attrView.KeyValues {
		for _, val := range keyValues.Values {
			values := cardsValues[val.BlockID]
			if nil == values {
				values = []*av.KeyValues{{Key: keyValues.Key, Values: []*av.Value{val}}}
			} else {
				values = append(values, &av.KeyValues{Key: keyValues.Key, Values: []*av.Value{val}})
			}
			cardsValues[val.BlockID] = values
		}
	}

	// 过滤掉不存在的卡片
	var notFound []string
	var toCheckBlockIDs []string
	for blockID, keyValues := range cardsValues {
		blockValue := getBlockValue(keyValues)
		if nil == blockValue {
			notFound = append(notFound, blockID)
			continue
		}

		if blockValue.IsDetached {
			continue
		}

		if nil != blockValue.Block && "" == blockValue.Block.ID {
			notFound = append(notFound, blockID)
			continue
		}

		toCheckBlockIDs = append(toCheckBlockIDs, blockID)
	}
	checkRet := treenode.ExistBlockTrees(toCheckBlockIDs)
	for blockID, exist := range checkRet {
		if !exist {
			notFound = append(notFound, blockID)
		}
	}
	for _, blockID := range notFound {
		delete(cardsValues, blockID)
	}

	// 生成卡片字段值
	for cardID, cardValues := range cardsValues {
		var galleryCard av.GalleryCard
		for _, field := range ret.Fields {
			var fieldValue *av.GalleryFieldValue
			for _, keyValues := range cardValues {
				if keyValues.Key.ID == field.ID {
					fieldValue = &av.GalleryFieldValue{
						BaseValue: &av.BaseValue{
							ID:        keyValues.Values[0].ID,
							Value:     keyValues.Values[0],
							ValueType: field.Type,
						},
					}
					break
				}
			}
			if nil == fieldValue {
				fieldValue = &av.GalleryFieldValue{
					BaseValue: &av.BaseValue{
						ID:        ast.NewNodeID(),
						ValueType: field.Type,
					},
				}
			}
			galleryCard.ID = cardID

			switch fieldValue.ValueType {
			case av.KeyTypeNumber: // 格式化数字
				if nil != fieldValue.Value && nil != fieldValue.Value.Number && fieldValue.Value.Number.IsNotEmpty {
					fieldValue.Value.Number.Format = field.NumberFormat
					fieldValue.Value.Number.FormatNumber()
				}
			case av.KeyTypeTemplate: // 渲染模板字段
				fieldValue.Value = &av.Value{ID: fieldValue.ID, KeyID: field.ID, BlockID: cardID, Type: av.KeyTypeTemplate, Template: &av.ValueTemplate{Content: field.Template}}
			case av.KeyTypeCreated: // 填充创建时间字段值，后面再渲染
				fieldValue.Value = &av.Value{ID: fieldValue.ID, KeyID: field.ID, BlockID: cardID, Type: av.KeyTypeCreated}
			case av.KeyTypeUpdated: // 填充更新时间字段值，后面再渲染
				fieldValue.Value = &av.Value{ID: fieldValue.ID, KeyID: field.ID, BlockID: cardID, Type: av.KeyTypeUpdated}
			case av.KeyTypeRelation: // 清空关联字段值，后面再渲染 https://ld246.com/article/1703831044435
				if nil != fieldValue.Value && nil != fieldValue.Value.Relation {
					fieldValue.Value.Relation.Contents = nil
				}
			}

			if nil == fieldValue.Value {
				fieldValue.Value = av.GetAttributeViewDefaultValue(fieldValue.ID, field.ID, cardID, fieldValue.ValueType)
			} else {
				fillAttributeViewNilValue(fieldValue.Value, fieldValue.ValueType)
			}

			galleryCard.Values = append(galleryCard.Values, fieldValue)
		}

		fillGalleryCardCover(attrView, view, cardValues, galleryCard, cardID)
		ret.Cards = append(ret.Cards, &galleryCard)
	}

	// 批量获取块属性以提升性能
	var ialIDs []string
	for _, card := range ret.Cards {
		block := card.GetBlockValue()
		if nil != block && !block.IsDetached {
			ialIDs = append(ialIDs, card.ID)
		}
	}
	ials := BatchGetBlockAttrs(ialIDs)

	// 渲染自动生成的字段值，比如关联字段、汇总字段、创建时间字段和更新时间字段
	avCache := map[string]*av.AttributeView{}
	avCache[attrView.ID] = attrView
	for _, card := range ret.Cards {
		for _, value := range card.Values {
			switch value.ValueType {
			case av.KeyTypeBlock: // 对于主键可能需要填充静态锚文本 Database-bound block primary key supports setting static anchor text https://github.com/siyuan-note/siyuan/issues/10049
				if nil != value.Value.Block {
					for k, v := range ials[card.ID] {
						if k == av.NodeAttrViewStaticText+"-"+attrView.ID {
							value.Value.Block.Content = v
							break
						}
					}
				}
			case av.KeyTypeRollup: // 渲染汇总字段
				rollupKey, _ := attrView.GetKey(value.Value.KeyID)
				if nil == rollupKey || nil == rollupKey.Rollup {
					break
				}

				relKey, _ := attrView.GetKey(rollupKey.Rollup.RelationKeyID)
				if nil == relKey || nil == relKey.Relation {
					break
				}

				relVal := attrView.GetValue(relKey.ID, card.ID)
				if nil == relVal || nil == relVal.Relation {
					break
				}

				destAv := avCache[relKey.Relation.AvID]
				if nil == destAv {
					destAv, _ = av.ParseAttributeView(relKey.Relation.AvID)
					if nil != destAv {
						avCache[relKey.Relation.AvID] = destAv
					}
				}
				if nil == destAv {
					break
				}

				destKey, _ := destAv.GetKey(rollupKey.Rollup.KeyID)
				if nil == destKey {
					continue
				}

				for _, blockID := range relVal.Relation.BlockIDs {
					destVal := destAv.GetValue(rollupKey.Rollup.KeyID, blockID)
					if nil == destVal {
						if destAv.ExistBlock(blockID) { // 数据库中存在但是值不存在是数据未初始化，这里补一个默认值
							destVal = av.GetAttributeViewDefaultValue(ast.NewNodeID(), rollupKey.Rollup.KeyID, blockID, destKey.Type)
						}
						if nil == destVal {
							continue
						}
					}
					if av.KeyTypeNumber == destKey.Type {
						destVal.Number.Format = destKey.NumberFormat
						destVal.Number.FormatNumber()
					}

					value.Value.Rollup.Contents = append(value.Value.Rollup.Contents, destVal.Clone())
				}

				value.Value.Rollup.RenderContents(rollupKey.Rollup.Calc, destKey)

				// 将汇总字段的值保存到 cardsValues 中，后续渲染模板字段的时候会用到，下同
				keyValues := cardsValues[card.ID]
				keyValues = append(keyValues, &av.KeyValues{Key: rollupKey, Values: []*av.Value{{ID: value.Value.ID, KeyID: rollupKey.ID, BlockID: card.ID, Type: av.KeyTypeRollup, Rollup: value.Value.Rollup}}})
				cardsValues[card.ID] = keyValues
			case av.KeyTypeRelation: // 渲染关联字段
				relKey, _ := attrView.GetKey(value.Value.KeyID)
				if nil != relKey && nil != relKey.Relation {
					destAv := avCache[relKey.Relation.AvID]
					if nil == destAv {
						destAv, _ = av.ParseAttributeView(relKey.Relation.AvID)
						if nil != destAv {
							avCache[relKey.Relation.AvID] = destAv
						}
					}
					if nil != destAv {
						blocks := map[string]*av.Value{}
						blockValues := destAv.GetBlockKeyValues()
						if nil != blockValues {
							for _, blockValue := range blockValues.Values {
								blocks[blockValue.BlockID] = blockValue
							}
							for _, blockID := range value.Value.Relation.BlockIDs {
								if val := blocks[blockID]; nil != val {
									value.Value.Relation.Contents = append(value.Value.Relation.Contents, val)
								}
							}
						}
					}
				}

				keyValues := cardsValues[card.ID]
				keyValues = append(keyValues, &av.KeyValues{Key: relKey, Values: []*av.Value{{ID: value.Value.ID, KeyID: relKey.ID, BlockID: card.ID, Type: av.KeyTypeRelation, Relation: value.Value.Relation}}})
				cardsValues[card.ID] = keyValues
			case av.KeyTypeCreated: // 渲染创建时间
				createdStr := card.ID[:len("20060102150405")]
				created, parseErr := time.ParseInLocation("20060102150405", createdStr, time.Local)
				if nil == parseErr {
					value.Value.Created = av.NewFormattedValueCreated(created.UnixMilli(), 0, av.CreatedFormatNone)
					value.Value.Created.IsNotEmpty = true
				} else {
					value.Value.Created = av.NewFormattedValueCreated(time.Now().UnixMilli(), 0, av.CreatedFormatNone)
				}

				keyValues := cardsValues[card.ID]
				createdKey, _ := attrView.GetKey(value.Value.KeyID)
				keyValues = append(keyValues, &av.KeyValues{Key: createdKey, Values: []*av.Value{{ID: value.Value.ID, KeyID: createdKey.ID, BlockID: card.ID, Type: av.KeyTypeCreated, Created: value.Value.Created}}})
				cardsValues[card.ID] = keyValues
			case av.KeyTypeUpdated: // 渲染更新时间
				ial := ials[card.ID]
				if nil == ial {
					ial = map[string]string{}
				}
				block := card.GetBlockValue()
				updatedStr := ial["updated"]
				if "" == updatedStr && nil != block {
					value.Value.Updated = av.NewFormattedValueUpdated(block.Block.Updated, 0, av.UpdatedFormatNone)
					value.Value.Updated.IsNotEmpty = true
				} else {
					updated, parseErr := time.ParseInLocation("20060102150405", updatedStr, time.Local)
					if nil == parseErr {
						value.Value.Updated = av.NewFormattedValueUpdated(updated.UnixMilli(), 0, av.UpdatedFormatNone)
						value.Value.Updated.IsNotEmpty = true
					} else {
						value.Value.Updated = av.NewFormattedValueUpdated(time.Now().UnixMilli(), 0, av.UpdatedFormatNone)
					}
				}

				keyValues := cardsValues[card.ID]
				updatedKey, _ := attrView.GetKey(value.Value.KeyID)
				keyValues = append(keyValues, &av.KeyValues{Key: updatedKey, Values: []*av.Value{{ID: value.Value.ID, KeyID: updatedKey.ID, BlockID: card.ID, Type: av.KeyTypeUpdated, Updated: value.Value.Updated}}})
				cardsValues[card.ID] = keyValues
			}
		}
	}

	// 最后单独渲染模板字段，这样模板字段就可以使用汇总、关联、创建时间和更新时间字段的值了

	var renderTemplateErr error
	for _, card := range ret.Cards {
		for _, value := range card.Values {
			switch value.ValueType {
			case av.KeyTypeTemplate: // 渲染模板字段
				keyValues := cardsValues[card.ID]
				ial := ials[card.ID]
				if nil == ial {
					ial = map[string]string{}
				}
				content, renderErr := RenderTemplateField(ial, keyValues, value.Value.Template.Content)
				value.Value.Template.Content = content
				if nil != renderErr {
					key, _ := attrView.GetKey(value.Value.KeyID)
					keyName := ""
					if nil != key {
						keyName = key.Name
					}
					renderTemplateErr = fmt.Errorf("database [%s] template field [%s] rendering failed: %s", getAttrViewName(attrView), keyName, renderErr)
				}
			}
		}
	}
	if nil != renderTemplateErr {
		util.PushErrMsg(fmt.Sprintf(util.Langs[util.Lang][44], util.EscapeHTML(renderTemplateErr.Error())), 30000)
	}

	// 根据搜索条件过滤
	query = strings.TrimSpace(query)
	if "" != query {
		// 将连续空格转换为一个空格
		query = strings.Join(strings.Fields(query), " ")
		// 按空格分割关键字
		keywords := strings.Split(query, " ")
		// 使用 AND 逻辑 https://github.com/siyuan-note/siyuan/issues/11535
		var hitCards []*av.GalleryCard
		for _, card := range ret.Cards {
			hit := false
			for _, value := range card.Values {
				allKeywordsHit := true
				for _, keyword := range keywords {
					if !strings.Contains(strings.ToLower(value.Value.String(true)), strings.ToLower(keyword)) {
						allKeywordsHit = false
						break
					}
				}
				if allKeywordsHit {
					hit = true
					break
				}
			}
			if hit {
				hitCards = append(hitCards, card)
			}
		}
		ret.Cards = hitCards
		if 1 > len(ret.Cards) {
			ret.Cards = []*av.GalleryCard{}
		}
	}

	// 自定义排序
	sortCardIDs := map[string]int{}
	if 0 < len(view.Gallery.CardIDs) {
		for i, cardID := range view.Gallery.CardIDs {
			sortCardIDs[cardID] = i
		}
	}

	sort.Slice(ret.Fields, func(i, j int) bool {
		iv := sortCardIDs[ret.Fields[i].ID]
		jv := sortCardIDs[ret.Fields[j].ID]
		if iv == jv {
			return ret.Fields[i].ID < ret.Fields[j].ID
		}
		return iv < jv
	})
	return
}

func fillGalleryCardCover(attrView *av.AttributeView, view *av.View, cardValues []*av.KeyValues, galleryCard av.GalleryCard, cardID string) {
	switch view.Gallery.CoverFrom {
	case av.CoverFromNone:
	case av.CoverFromContentImage:
		blockValue := getBlockValue(cardValues)
		if !blockValue.IsDetached {
			tree := loadTreeByBlockID(blockValue.BlockID)
			if nil == tree {
				break
			}
			node := treenode.GetNodeInTree(tree, blockValue.BlockID)
			if nil == node {
				break
			}

			if ast.NodeDocument == node.Type {
				if titleImg := node.IALAttr("title-img"); "" != titleImg {
					galleryCard.CoverURL = titleImg
					break
				}
			}

			ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
				if !entering {
					return ast.WalkContinue
				}

				if ast.NodeImage != n.Type {
					return ast.WalkContinue
				}

				dest := n.ChildByType(ast.NodeLinkDest)
				if nil == dest {
					return ast.WalkContinue
				}
				galleryCard.CoverURL = dest.TokensStr()
				return ast.WalkStop
			})
		}
	case av.CoverFromAssetField:
		if "" == view.Gallery.CoverFromAssetKeyID {
			break
		}

		assetValue := attrView.GetValue(view.Gallery.CoverFromAssetKeyID, cardID)
		if nil == assetValue || 1 > len(assetValue.MAsset) {
			break
		}

		galleryCard.CoverURL = assetValue.MAsset[0].Content
	}
}
