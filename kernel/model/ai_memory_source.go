package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/util"
)

type memoryNativeField struct {
	ID       string     `json:"id"`
	Name     string     `json:"name"`
	Type     av.KeyType `json:"type"`
	Value    *av.Value  `json:"value,omitempty"`
	Excluded bool       `json:"excluded,omitempty"`
}
type memoryNativeRow struct {
	BlockID string              `json:"blockID"`
	Fields  []memoryNativeField `json:"fields"`
}
type memoryNativeDatabase struct {
	ID                string              `json:"id"`
	Name              string              `json:"name"`
	Fields            []memoryNativeField `json:"fields"`
	Rows              []memoryNativeRow   `json:"rows"`
	OtherRowsExcluded bool                `json:"otherRowsExcluded"`
}

// memoryNativeEvidence 仅附加来源子树内绑定行的类型化值，不展开其他文档或关联汇总内容。
// 预算不足返回错误，不能把未处理的数据库伪装成完整原文。
func memoryNativeEvidence(tree *parse.Tree, node *ast.Node) ([]byte, error) {
	if tree == nil || node == nil || tree.Box == "" || IsEncryptedBox(tree.Box) {
		return nil, errors.New("memory native source unavailable")
	}
	ids := map[string]bool{}
	databases := map[string]bool{}
	nodes := 0
	ast.Walk(node, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		nodes++
		if nodes > 2048 {
			return ast.WalkStop
		}
		if n.ID != "" {
			ids[n.ID] = true
		}
		if n.Type == ast.NodeAttributeView && n.AttributeViewID != "" {
			databases[n.AttributeViewID] = true
		}
		for _, id := range strings.Split(n.IALAttr(av.NodeAttrNameAvs), ",") {
			if id != "" {
				databases[id] = true
			}
		}
		return ast.WalkContinue
	})
	if nodes > 2048 || len(databases) > 16 {
		return nil, errors.New("memory native source exceeds processing budget")
	}
	names := make([]string, 0, len(databases))
	for id := range databases {
		names = append(names, id)
	}
	sort.Strings(names)
	result := struct {
		Node      *ast.Node              `json:"node"`
		Databases []memoryNativeDatabase `json:"databases"`
	}{Node: node, Databases: []memoryNativeDatabase{}}
	for _, id := range names {
		if !ast.IsNodeIDPattern(id) {
			return nil, errors.New("invalid memory database reference")
		}
		// 普通来源只读取全局普通 AV 文件，不使用可能扫描已解锁加密笔记本的 fallback。
		raw, err := memorySyncRead(util.DataDir, "/storage/av/"+id+".json")
		if err != nil {
			return nil, fmt.Errorf("memory database source unavailable: %w", err)
		}
		var database av.AttributeView
		if err = json.Unmarshal(raw, &database); err != nil || database.ID != id || database.Spec > av.CurrentSpec {
			return nil, errors.New("invalid memory database source")
		}
		evidence, err := memoryDatabaseEvidence(&database, ids)
		if err != nil {
			return nil, err
		}
		result.Databases = append(result.Databases, evidence)
	}
	data, err := json.Marshal(result)
	if err != nil {
		return nil, err
	}
	if len(data) > 64*1024 {
		return nil, errors.New("memory native source exceeds processing budget")
	}
	return data, nil
}

func memoryDatabaseEvidence(database *av.AttributeView, sourceIDs map[string]bool) (memoryNativeDatabase, error) {
	ret := memoryNativeDatabase{ID: database.ID, Name: database.Name, Fields: []memoryNativeField{}, Rows: []memoryNativeRow{}, OtherRowsExcluded: true}
	if len(database.KeyValues) > 128 {
		return ret, errors.New("memory database columns exceed processing budget")
	}
	for _, kv := range database.KeyValues {
		if kv == nil || kv.Key == nil {
			return ret, errors.New("invalid memory database column")
		}
		for _, value := range kv.Values {
			if value == nil || value.Type != kv.Key.Type || (value.Type == av.KeyTypeBlock && value.Block == nil) {
				return ret, errors.New("invalid memory database value")
			}
		}
		ret.Fields = append(ret.Fields, memoryNativeField{ID: kv.Key.ID, Name: kv.Key.Name, Type: kv.Key.Type})
	}
	ids := make([]string, 0, len(sourceIDs))
	for id := range sourceIDs {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		block := database.GetBlockValueByBoundID(id)
		if block == nil {
			continue
		}
		if block.IsDetached || block.Block == nil || block.Block.ID != id {
			continue
		}
		row := memoryNativeRow{BlockID: id, Fields: []memoryNativeField{}}
		for _, kv := range database.KeyValues {
			value := kv.GetValue(block.BlockID)
			if value == nil {
				continue
			}
			field := memoryNativeField{ID: kv.Key.ID, Name: kv.Key.Name, Type: kv.Key.Type}
			// 关联、汇总、模板及未知类型可能包含其他来源的缓存明文，明确排除而不加载关联表。
			switch value.Type {
			case av.KeyTypeBlock, av.KeyTypeText, av.KeyTypeNumber, av.KeyTypeDate, av.KeyTypeSelect, av.KeyTypeMSelect, av.KeyTypeURL, av.KeyTypeEmail, av.KeyTypePhone, av.KeyTypeLocation, av.KeyTypeMAsset, av.KeyTypeCreated, av.KeyTypeUpdated, av.KeyTypeCheckbox:
				field.Value = memoryNativeValue(value)
			default:
				field.Excluded = true
			}
			row.Fields = append(row.Fields, field)
		}
		ret.Rows = append(ret.Rows, row)
		if len(ret.Rows) > 128 {
			return ret, errors.New("memory database rows exceed processing budget")
		}
	}
	return ret, nil
}

// memoryNativeValue 仅复制所声明类型的值，不传递缓存渲染或不匹配类型的字段。
func memoryNativeValue(value *av.Value) *av.Value {
	ret := &av.Value{ID: value.ID, KeyID: value.KeyID, BlockID: value.BlockID, Type: value.Type, CreatedAt: value.CreatedAt, UpdatedAt: value.UpdatedAt}
	switch value.Type {
	case av.KeyTypeBlock:
		ret.Block = value.Block
	case av.KeyTypeText:
		ret.Text = value.Text
	case av.KeyTypeNumber:
		ret.Number = value.Number
	case av.KeyTypeDate:
		ret.Date = value.Date
	case av.KeyTypeSelect, av.KeyTypeMSelect:
		ret.MSelect = value.MSelect
	case av.KeyTypeURL:
		ret.URL = value.URL
	case av.KeyTypeEmail:
		ret.Email = value.Email
	case av.KeyTypePhone:
		ret.Phone = value.Phone
	case av.KeyTypeLocation:
		ret.Location = value.Location
	case av.KeyTypeMAsset:
		ret.MAsset = value.MAsset
	case av.KeyTypeCreated:
		ret.Created = value.Created
	case av.KeyTypeUpdated:
		ret.Updated = value.Updated
	case av.KeyTypeCheckbox:
		ret.Checkbox = value.Checkbox
	}
	return ret
}
