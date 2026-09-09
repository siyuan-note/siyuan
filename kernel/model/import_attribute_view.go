package model

import (
	"encoding/json"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
)

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
	for _, id := range strings.Split(node.IALAttr(av.NodeAttrNameAvs), ",") {
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
