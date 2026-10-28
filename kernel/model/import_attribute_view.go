package model

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
)

// 原生导入先为整个包建立身份映射，再改写每个库，保证跨库普通关联与父子边一致。
// 无父子配置的旧包继续使用既有导入规则。
func remapImportedSubItemsDatabases(data map[string][]byte, databaseIDs, blockIDs map[string]string) (map[string][]byte, map[string]map[string]string, error) {
	sources := map[string]*av.AttributeView{}
	hasSubItems := false
	for id, encoded := range data {
		source, err := av.ParseAttributeViewData(id, encoded)
		if err != nil {
			return nil, nil, err
		}
		sources[id] = source
		hasSubItems = hasSubItems || source.SubItems != nil
	}
	if !hasSubItems {
		return nil, nil, nil
	}
	mappings := map[string]map[string]string{}
	for id, source := range sources {
		if source.ID != id {
			return nil, nil, fmt.Errorf("imported database identity [%s] does not match its file", id)
		}
		for _, kv := range source.KeyValues {
			if kv == nil || kv.Key == nil {
				return nil, nil, fmt.Errorf("invalid imported database field [%s]", id)
			}
			for _, value := range kv.Values {
				if value == nil {
					return nil, nil, fmt.Errorf("invalid imported database value [%s]", id)
				}
			}
		}
		mappings[id] = newAttributeViewIdentityMap(source)
	}
	ret := map[string][]byte{}
	for id, source := range sources {
		copied, err := remapAttributeViewLocalIdentities(source, mappings[id])
		if err != nil {
			return nil, nil, err
		}
		copied.ID = databaseIDs[id]
		remapAttributeViewReferences(source, copied, sources, mappings, databaseIDs)
		remapAttributeViewAutomations(source, copied, mappings, databaseIDs, false)
		if err = remapImportedAttributeViewBlockReferences(copied, blockIDs); err != nil {
			return nil, nil, err
		}
		if err = copied.ValidateSubItems(); err != nil {
			return nil, nil, err
		}
		ret[id], err = json.Marshal(copied)
		if err != nil {
			return nil, nil, err
		}
	}
	return ret, mappings, nil
}

// 只改写实际块引用和收集来源，普通文本、模板文字及外部链接保持原值。
func remapImportedAttributeViewBlockReferences(database *av.AttributeView, blockIDs map[string]string) (err error) {
	link := func(value string) string {
		const prefix = "siyuan://blocks/"
		if strings.HasPrefix(value, prefix) {
			if id := blockIDs[strings.TrimPrefix(value, prefix)]; id != "" {
				return prefix + id
			}
		}
		return value
	}
	database.VisitPersistedValues(func(value *av.Value) {
		if err != nil {
			return
		}
		if value.Block != nil {
			if id := blockIDs[value.Block.ID]; id != "" {
				value.Block.ID = id
			}
		}
		if value.URL != nil {
			value.URL.Content = link(value.URL.Content)
		}
		if value.Text == nil || value.Text.Rich == nil {
			return
		}
		tree, parseErr := av.ParseValueTextRich(value.Text.Rich)
		if parseErr != nil {
			err = parseErr
			return
		}
		changed := false
		ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
			if !entering {
				return ast.WalkContinue
			}
			switch node.Type {
			case ast.NodeBlockRefID:
				if id := blockIDs[node.TokensStr()]; id != "" {
					node.Tokens, changed = []byte(id), true
				}
			case ast.NodeLinkDest:
				if rewritten := link(node.TokensStr()); rewritten != node.TokensStr() {
					node.Tokens, changed = []byte(rewritten), true
				}
			case ast.NodeTextMark:
				if node.IsTextMarkType("block-ref") {
					if id := blockIDs[node.TextMarkBlockRefID]; id != "" {
						node.TextMarkBlockRefID, changed = id, true
					}
				}
				if node.IsTextMarkType("a") {
					if rewritten := link(node.TextMarkAHref); rewritten != node.TextMarkAHref {
						node.TextMarkAHref, changed = rewritten, true
					}
				}
			}
			return ast.WalkContinue
		})
		if changed {
			value.Text.Rich.Content, err = av.RenderValueTextRich(tree)
			if err == nil {
				err = value.Text.NormalizeRichContent()
			}
		}
	})
	if database.Automations != nil {
		for _, rule := range database.Automations.Rules {
			if rule == nil || rule.BlockSource == nil {
				continue
			}
			for i, id := range rule.BlockSource.DocumentIDs {
				if replacement := blockIDs[id]; replacement != "" {
					rule.BlockSource.DocumentIDs[i] = replacement
				}
			}
			for i, id := range rule.BlockSource.NotebookIDs {
				if replacement := blockIDs[id]; replacement != "" {
					rule.BlockSource.NotebookIDs[i] = replacement
				}
			}
			if replacement := blockIDs[rule.BlockSource.ReferenceID]; replacement != "" {
				rule.BlockSource.ReferenceID = replacement
			}
		}
	}
	for _, template := range database.NewItemTemplates {
		if template != nil && template.SaveLocation != nil {
			if replacement := blockIDs[template.SaveLocation.BoxID]; replacement != "" {
				template.SaveLocation.BoxID = replacement
			}
		}
	}
	return err
}

// isolateImportedAttributeViewBindings 保留包内绑定，将边界外的绑定转为非绑定条目，并保留其他字段。
// 此时包内块 ID 已重映射，但文档尚未入索引，必须以本次导入的块集合判定包内绑定。
func isolateImportedAttributeViewBindings(data []byte, importedBlockIDs map[string]bool, encryptedTarget bool) ([]byte, error) {
	var attrView av.AttributeView
	if err := json.Unmarshal(data, &attrView); err != nil {
		return nil, err
	}
	if err := av.CheckSpec(&attrView); err != nil {
		return nil, err
	}
	if err := attrView.ValidateLayouts(); err != nil {
		return nil, err
	}
	if err := attrView.ValidateSubItems(); err != nil {
		return nil, err
	}
	if err := attrView.NormalizeLocations(); err != nil {
		return nil, err
	}
	var root map[string]json.RawMessage
	if err := json.Unmarshal(data, &root); err != nil {
		return nil, err
	}
	var keyValues []map[string]json.RawMessage
	if err := json.Unmarshal(root["keyValues"], &keyValues); err != nil {
		return nil, err
	}
	changed := false
	for _, kv := range keyValues {
		var key struct {
			Type av.KeyType `json:"type"`
		}
		if err := json.Unmarshal(kv["key"], &key); err != nil {
			return nil, err
		}
		if key.Type != av.KeyTypeBlock {
			continue
		}
		if _, exists := kv["values"]; !exists {
			// 空主键值可由 omitempty 合法省略，不补写字段，保持原始 JSON。
			continue
		}
		var values []map[string]json.RawMessage
		if err := json.Unmarshal(kv["values"], &values); err != nil {
			return nil, err
		}
		for _, value := range values {
			var blockValue av.Value
			valueData, err := json.Marshal(value)
			if err != nil {
				return nil, err
			}
			if err = json.Unmarshal(valueData, &blockValue); err != nil {
				return nil, err
			}
			if blockValue.IsDetached || blockValue.Block == nil || importedBlockIDs[blockValue.Block.ID] {
				continue
			}
			if !encryptedTarget && attributeViewBindingBlockTree(blockValue.Block.ID, "") != nil {
				continue
			}
			var block map[string]json.RawMessage
			if err = json.Unmarshal(value["block"], &block); err != nil {
				return nil, err
			}
			block["id"] = json.RawMessage(`""`)
			block["refSubtype"] = json.RawMessage(`""`)
			value["block"], err = json.Marshal(block)
			if err != nil {
				return nil, err
			}
			value["isDetached"] = json.RawMessage(`true`)
			changed = true
		}
		var err error
		kv["values"], err = json.Marshal(values)
		if err != nil {
			return nil, err
		}
	}
	if !changed {
		return data, nil
	}
	var err error
	root["keyValues"], err = json.Marshal(keyValues)
	if err != nil {
		return nil, err
	}
	return json.Marshal(root)
}

// retainImportedAttributeViewBindings 清理导入块指向包外数据库的反向绑定，不修改原文档。
func retainImportedAttributeViewBindings(node *ast.Node, avIDs map[string]string) {
	allowed := map[string]bool{}
	for _, id := range avIDs {
		allowed[id] = true
	}
	var retained []string
	for id := range strings.SplitSeq(node.IALAttr(av.NodeAttrNameAvs), ",") {
		id = strings.TrimSpace(id)
		if allowed[id] {
			retained = append(retained, id)
		} else {
			node.RemoveIALAttr(av.NodeAttrViewStaticText + "-" + id)
		}
	}
	node.RemoveIALAttr(av.NodeAttrViewNames)
	if len(retained) == 0 {
		node.RemoveIALAttr(av.NodeAttrNameAvs)
	} else {
		node.SetIALAttr(av.NodeAttrNameAvs, strings.Join(retained, ","))
	}
}
