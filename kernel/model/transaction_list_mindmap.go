package model

import (
	"encoding/json"
	"math"
	"slices"

	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/siyuan/kernel/cache"
)

const listMindmapMetadataAttr = "custom-sy-list-mindmap-data"

// 只校验当前版本的已知字段，未知字段随配置保留，损坏和较新版本的配置不参与清理。
func validListMindmapMetadata(data map[string]any) bool {
	if data["version"] != float64(1) {
		return false
	}
	nodes, ok := data["nodes"].(map[string]any)
	if !ok {
		return false
	}
	relations, ok := data["relations"].([]any)
	if !ok {
		return false
	}
	if title, exists := data["rootTitle"]; exists {
		if _, ok = title.(string); !ok {
			return false
		}
	}
	validFields := func(value map[string]any, strings, numbers, booleans []string) bool {
		for _, key := range strings {
			if field, exists := value[key]; exists {
				if _, ok := field.(string); !ok {
					return false
				}
			}
		}
		for _, key := range numbers {
			if field, exists := value[key]; exists {
				number, ok := field.(float64)
				if !ok || number < 0 || math.IsInf(number, 0) || math.IsNaN(number) {
					return false
				}
			}
		}
		for _, key := range booleans {
			if field, exists := value[key]; exists {
				if _, ok := field.(bool); !ok {
					return false
				}
			}
		}
		return true
	}
	for id, value := range nodes {
		style, ok := value.(map[string]any)
		if id == "" || !ok || !validFields(style,
			[]string{"textColor", "backgroundColor", "borderColor", "lineColor"},
			[]string{"fontSize", "borderWidth", "borderRadius", "lineWidth"}, []string{"bold", "italic", "lineDash"}) {
			return false
		}
	}
	seen := map[string]bool{}
	for _, value := range relations {
		relation, ok := value.(map[string]any)
		if !ok || !validFields(relation, []string{"label", "color"}, []string{"width"}, []string{"dash"}) {
			return false
		}
		for _, key := range []string{"id", "from", "to"} {
			if field, ok := relation[key].(string); !ok || field == "" {
				return false
			}
		}
		if _, ok := relation["label"].(string); !ok || seen[relation["id"].(string)] {
			return false
		}
		if route, exists := relation["route"]; exists && !validListMindmapRoute(route) {
			return false
		}
		seen[relation["id"].(string)] = true
	}
	return true
}

func validListMindmapRoute(value any) bool {
	route, ok := value.(map[string]any)
	if !ok || route["version"] != float64(1) {
		return false
	}
	points, ok := route["points"].([]any)
	if !ok || len(points) == 0 || len(points) > 64 {
		return false
	}
	for _, value := range points {
		point, ok := value.(map[string]any)
		if !ok {
			return false
		}
		for _, key := range []string{"x", "y", "t"} {
			number, ok := point[key].(float64)
			if !ok || math.IsNaN(number) || math.IsInf(number, 0) || math.Abs(number) > 1e6 ||
				(key == "t" && (number < 0 || number > 1)) {
				return false
			}
		}
	}
	return true
}

func pruneListMindmapMetadata(list *ast.Node) (string, bool) {
	original := list.IALAttr(listMindmapMetadataAttr)
	var data map[string]any
	if json.Unmarshal([]byte(original), &data) != nil || !validListMindmapMetadata(data) {
		return original, false
	}
	// 列表根的样式在单根和虚拟根切换时仍需保留，折叠子树也属于有效节点。
	ids := map[string]bool{list.ID: true}
	pending := []*ast.Node{list}
	for len(pending) > 0 {
		current := pending[len(pending)-1]
		pending = pending[:len(pending)-1]
		for item := current.FirstChild; item != nil; item = item.Next {
			if item.Type != ast.NodeListItem {
				continue
			}
			ids[item.ID] = true
			for child := item.FirstChild; child != nil; child = child.Next {
				if child.Type == ast.NodeList {
					pending = append(pending, child)
				}
			}
		}
	}
	changed := false
	nodes := data["nodes"].(map[string]any)
	for id := range nodes {
		if !ids[id] {
			delete(nodes, id)
			changed = true
		}
	}
	relations := make([]any, 0)
	for _, value := range data["relations"].([]any) {
		relation := value.(map[string]any)
		if ids[relation["from"].(string)] && ids[relation["to"].(string)] {
			relations = append(relations, value)
		} else {
			changed = true
		}
	}
	if !changed {
		return original, false
	}
	// 使用原始 JSON 字段重组，避免扩展字段中的大整数在浮点解码后丢失精度。
	var raw map[string]json.RawMessage
	_ = json.Unmarshal([]byte(original), &raw)
	var rawNodes map[string]json.RawMessage
	_ = json.Unmarshal(raw["nodes"], &rawNodes)
	for id := range rawNodes {
		if !ids[id] {
			delete(rawNodes, id)
		}
	}
	var rawRelations []json.RawMessage
	_ = json.Unmarshal(raw["relations"], &rawRelations)
	kept := make([]json.RawMessage, 0, len(relations))
	for i, value := range data["relations"].([]any) {
		relation := value.(map[string]any)
		if ids[relation["from"].(string)] && ids[relation["to"].(string)] {
			kept = append(kept, rawRelations[i])
		}
	}
	raw["nodes"], _ = json.Marshal(rawNodes)
	raw["relations"], _ = json.Marshal(kept)
	encoded, err := json.Marshal(raw)
	return string(encoded), err == nil
}

// 在全部结构操作结束后清理，避免同一事务内先删除再插入的节点丢失配置。
func (tx *Transaction) normalizeListMindmapMetadata() (ret *TxErr) {
	if tx.isReplay {
		return nil
	}
	hasUndo := len(tx.UndoOperations) > 0
	var undo []*Operation
	for _, tree := range tx.trees {
		ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
			if !entering || node.Type != ast.NodeList || node.IALAttr(listMindmapMetadataAttr) == "" {
				return ast.WalkContinue
			}
			previous := node.IALAttr(listMindmapMetadataAttr)
			next, changed := pruneListMindmapMetadata(node)
			if !changed {
				return ast.WalkContinue
			}
			attrs := map[string]string{listMindmapMetadataAttr: next}
			if _, err := setNodeAttrs0(node, attrs, tree.Box); err != nil {
				ret = &TxErr{code: TxErrCodePushMsg, msg: err.Error(), id: node.ID}
				return ast.WalkStop
			}
			cache.PutBlockIALInBox(node.ID, tree.Box, parse.IAL2Map(node.KramdownIAL))
			encoded, _ := json.Marshal(attrs)
			tx.DoOperations = append(tx.DoOperations, &Operation{Action: "setAttrs", ID: node.ID, Data: string(encoded)})
			if hasUndo {
				encoded, _ = json.Marshal(map[string]string{listMindmapMetadataAttr: previous})
				undo = append(undo, &Operation{Action: "setAttrs", ID: node.ID, Data: string(encoded)})
			}
			return ast.WalkContinue
		})
		if ret != nil {
			return
		}
	}
	slices.Reverse(undo)
	tx.UndoOperations = append(undo, tx.UndoOperations...)
	return nil
}
