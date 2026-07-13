// SiYuan - Refactor your thinking
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

package tools

import (
	"fmt"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var BlockTool = &Tool{
	Name:        "block",
	Description: "Block operations. Actions: get(id), get_kramdown(id), get_children(id), tree_stat(id, by document), dom(id), insert(data, dataType, parentID?, nextID?, previousID?), append(data, dataType, parentID) / prepend(...) add a NEW child — use after block.update when both modifying and adding, update(id, data, dataType) replaces ONE block only (no append), delete(id), move(id, parentID, previousID?), breadcrumb(id), batch_get(ids) / batch_kramdown(ids) where ids is comma-separated.",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action":     {Type: "string", Description: "Operation", Enum: []string{"get", "get_kramdown", "get_children", "tree_stat", "dom", "insert", "append", "prepend", "update", "delete", "move", "breadcrumb", "batch_get", "batch_kramdown"}},
			"id":         {Type: "string", Description: "Block ID"},
			"ids":        {Type: "string", Description: "Comma-separated block IDs (for batch_get, batch_kramdown)"},
			"data":       {Type: "string", Description: "Content (markdown or dom)"},
			"dataType":   {Type: "string", Description: "Content type: markdown or dom", Enum: []string{"markdown", "dom"}},
			"parentID":   {Type: "string", Description: "Parent block ID"},
			"nextID":     {Type: "string", Description: "Next sibling block ID (for insert)"},
			"previousID": {Type: "string", Description: "Previous sibling block ID (for insert)"},
		},
		Required: []string{"action"},
	},
	Handler: blockHandler,
}

func init() {
	register(BlockTool)
}

func blockHandler(args map[string]any) (CallToolResult, error) {
	action, _ := args["action"].(string)
	switch action {
	case "get":
		return blockGet(args)
	case "get_kramdown":
		return blockGetKramdown(args)
	case "get_children":
		return blockGetChildren(args)
	case "tree_stat":
		return blockTreeStat(args)
	case "dom":
		return blockDom(args)
	case "insert":
		return blockInsert(args)
	case "append":
		return blockAppend(args)
	case "prepend":
		return blockPrepend(args)
	case "update":
		return blockUpdate(args)
	case "delete":
		return blockDelete(args)
	case "move":
		return blockMove(args)
	case "breadcrumb":
		return blockBreadcrumb(args)
	case "batch_get":
		return blockBatchGet(args)
	case "batch_kramdown":
		return blockBatchKramdown(args)
	}
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: "unknown action '" + action + "', expected one of: [get, get_kramdown, get_children, tree_stat, dom, insert, append, prepend, update, delete, move, breadcrumb, batch_get, batch_kramdown]"}},
		IsError: true,
	}, nil
}

func blockGet(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}

	b, err := model.GetBlock(id, nil)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("get block failed: %s", err)}}, IsError: true}, nil
	}
	if b == nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "block not found: " + id}}, IsError: true}, nil
	}

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf(
		"ID: %s\nType: %s\nHPath: %s\nContent: %s\nMarkdown: %s\nTags: %s\nCreated: %s\nUpdated: %s",
		b.ID, b.Type, b.HPath, b.Content, b.Markdown, b.Tag, b.Created, b.Updated,
	)}}}, nil
}

func blockGetKramdown(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}

	kramdown := model.GetBlockKramdown(id, "md")
	if kramdown == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "block not found or empty: " + id}}, IsError: true}, nil
	}

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: kramdown}}}, nil
}

func blockGetChildren(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}

	children := model.GetChildBlocks(id)
	if len(children) == 0 {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "no child blocks found"}}}, nil
	}

	var sb strings.Builder
	for _, c := range children {
		content := c.Markdown
		if content == "" {
			content = c.Content
		}
		if len(content) > 200 {
			content = content[:200] + "..."
		}
		sb.WriteString(fmt.Sprintf("- [%s] %s (%s)\n", c.Type, content, c.ID))
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

func blockInsert(args map[string]any) (CallToolResult, error) {
	data, dataType := getBlockData(args)
	if data == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "data is required"}}, IsError: true}, nil
	}

	var parentID, previousID, nextID string
	if v, ok := args["parentID"].(string); ok {
		parentID = v
	}
	if v, ok := args["previousID"].(string); ok {
		previousID = v
	}
	if v, ok := args["nextID"].(string); ok {
		nextID = v
	}

	// 仅靠 parentID 定位目标时，目标必须是容器块，否则非法嵌套
	if parentID != "" && previousID == "" && nextID == "" {
		if err := treenode.CheckContainerParent(parentID); err != nil {
			return CallToolResult{Content: []ContentItem{{Type: "text", Text: err.Error()}}, IsError: true}, nil
		}
	}

	if dataType == "markdown" {
		var err error
		data, err = markdownToBlockDOM(data)
		if err != nil {
			return CallToolResult{Content: []ContentItem{{Type: "text", Text: "convert markdown failed: " + err.Error()}}, IsError: true}, nil
		}
	}

	transactions := []*model.Transaction{{
		DoOperations: []*model.Operation{{
			Action:     "insert",
			Data:       data,
			ParentID:   parentID,
			PreviousID: previousID,
			NextID:     nextID,
		}},
	}}

	model.PerformTransactions(&transactions)
	model.FlushTxQueue()

	reloadID := nextID
	if reloadID == "" {
		reloadID = previousID
	}
	if reloadID == "" {
		reloadID = parentID
	}
	if reloadID != "" {
		if bt := treenode.GetBlockTree(reloadID); bt != nil {
			util.PushReloadProtyle(bt.RootID)
		}
	}

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "block inserted"}}}, nil
}

func blockAppend(args map[string]any) (CallToolResult, error) {
	data, dataType := getBlockData(args)
	if data == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "data is required"}}, IsError: true}, nil
	}
	parentID, _ := args["parentID"].(string)
	if parentID == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "parentID is required"}}, IsError: true}, nil
	}
	// append 只用 parentID 定位目标，目标必须是容器块，否则非法嵌套
	if err := treenode.CheckContainerParent(parentID); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: err.Error()}}, IsError: true}, nil
	}

	if dataType == "markdown" {
		var err error
		data, err = markdownToBlockDOM(data)
		if err != nil {
			return CallToolResult{Content: []ContentItem{{Type: "text", Text: "convert markdown failed: " + err.Error()}}, IsError: true}, nil
		}
	}

	transactions := []*model.Transaction{{
		DoOperations: []*model.Operation{{
			Action:   "appendInsert",
			Data:     data,
			ParentID: parentID,
		}},
	}}

	model.PerformTransactions(&transactions)
	model.FlushTxQueue()

	if bt := treenode.GetBlockTree(parentID); bt != nil {
		util.PushReloadProtyle(bt.RootID)
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "block appended"}}}, nil
}

func blockPrepend(args map[string]any) (CallToolResult, error) {
	data, dataType := getBlockData(args)
	if data == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "data is required"}}, IsError: true}, nil
	}
	parentID, _ := args["parentID"].(string)
	if parentID == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "parentID is required"}}, IsError: true}, nil
	}
	// prepend 只用 parentID 定位目标，目标必须是容器块，否则非法嵌套
	if err := treenode.CheckContainerParent(parentID); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: err.Error()}}, IsError: true}, nil
	}

	if dataType == "markdown" {
		var err error
		data, err = markdownToBlockDOM(data)
		if err != nil {
			return CallToolResult{Content: []ContentItem{{Type: "text", Text: "convert markdown failed: " + err.Error()}}, IsError: true}, nil
		}
	}

	transactions := []*model.Transaction{{
		DoOperations: []*model.Operation{{
			Action:   "prependInsert",
			Data:     data,
			ParentID: parentID,
		}},
	}}

	model.PerformTransactions(&transactions)
	model.FlushTxQueue()

	if bt := treenode.GetBlockTree(parentID); bt != nil {
		util.PushReloadProtyle(bt.RootID)
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "block prepended"}}}, nil
}

func blockUpdate(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}
	data, dataType := getBlockData(args)
	if data == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "data is required"}}, IsError: true}, nil
	}

	// markdown 转 DOM 时 Lute 会给块生成全新的随机 ID，update 前必须把原块 id 钉回去，
	// 否则块 ID 每次更新都会变，后续按原 id 操作会报 block not found
	data = pinBlockID(data, dataType, id)

	transactions := []*model.Transaction{{
		DoOperations: []*model.Operation{{
			Action: "update",
			ID:     id,
			Data:   data,
		}},
	}}

	model.PerformTransactions(&transactions)
	model.FlushTxQueue()

	if bt := treenode.GetBlockTree(id); bt != nil {
		util.PushReloadProtyle(bt.RootID)
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "block updated"}}}, nil
}

// pinBlockID 把原块 id 钉回 markdown/dom 数据，保证 update 不改变块 ID。
// 参照 HTTP API /api/block/updateBlock 的 id 复位逻辑（block_op.go updateBlock 非 Document 分支）。
func pinBlockID(data, dataType, id string) string {
	luteEngine := util.NewLute()
	if dataType == "markdown" {
		var err error
		data, err = markdownToBlockDOM(data)
		if err != nil {
			return data
		}
	}

	tree := luteEngine.BlockDOM2Tree(data)
	if nil == tree || nil == tree.Root || nil == tree.Root.FirstChild {
		return data
	}

	// 更新列表项时 markdown 会渲染成 NodeList>ListItem，需要先把列表项提升到根下，渲染器才能正常工作
	// 使用 API `api/block/updateBlock` 更新列表项时渲染错误 https://github.com/siyuan-note/siyuan/issues/4658
	if ast.NodeList == tree.Root.FirstChild.Type {
		tree.Root.AppendChild(tree.Root.FirstChild.FirstChild) // 将列表下的第一个列表项移到文档结尾
		tree.Root.FirstChild.Unlink()                          // 删除列表
		if nil != tree.Root.FirstChild && ast.NodeKramdownBlockIAL == tree.Root.FirstChild.Type {
			tree.Root.FirstChild.Unlink() // 继续删除列表 IAL
		}
	}

	if nil != tree.Root.FirstChild {
		tree.Root.FirstChild.SetIALAttr("id", id)
	} else {
		tree.Root.AppendChild(treenode.NewParagraph(id))
	}

	return luteEngine.Tree2BlockDOM(tree, luteEngine.RenderOptions, luteEngine.ParseOptions)
}

func blockDelete(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}

	bt := treenode.GetBlockTree(id)

	transactions := []*model.Transaction{{
		DoOperations: []*model.Operation{{
			Action: "delete",
			ID:     id,
		}},
	}}

	model.PerformTransactions(&transactions)
	model.FlushTxQueue()

	if bt != nil {
		util.PushReloadProtyle(bt.RootID)
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "block deleted: " + id}}}, nil
}

func getBlockData(args map[string]any) (data, dataType string) {
	data, _ = args["data"].(string)
	dataType, _ = args["dataType"].(string)
	if dataType == "" {
		dataType = "markdown"
	}
	return
}

func markdownToBlockDOM(md string) (string, error) {
	luteEngine := util.NewLute()
	luteEngine.SetHTMLTag2TextMark(true)
	result, _ := luteEngine.Md2BlockDOMTree(md, true)
	if result == "" {
		return "", fmt.Errorf("empty result")
	}
	return result, nil
}

func blockMove(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}
	parentID, _ := args["parentID"].(string)
	if parentID == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "parentID is required"}}, IsError: true}, nil
	}
	previousID, _ := args["previousID"].(string)

	// 仅靠 parentID 定位目标时（无 previousID），目标必须是容器块，否则 doMove parent-only 分支会形成非法嵌套
	if previousID == "" {
		if err := treenode.CheckListItemNesting(parentID, id); err != nil {
			return CallToolResult{Content: []ContentItem{{Type: "text", Text: err.Error()}}, IsError: true}, nil
		}
		if err := treenode.CheckContainerParent(parentID); err != nil {
			return CallToolResult{Content: []ContentItem{{Type: "text", Text: err.Error()}}, IsError: true}, nil
		}
	}

	transactions := []*model.Transaction{{
		DoOperations: []*model.Operation{{
			Action:     "move",
			ID:         id,
			ParentID:   parentID,
			PreviousID: previousID,
		}},
	}}

	model.PerformTransactions(&transactions)
	model.FlushTxQueue()

	if bt := treenode.GetBlockTree(id); bt != nil {
		util.PushReloadProtyle(bt.RootID)
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "block moved: " + id}}}, nil
}

func blockBreadcrumb(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}

	paths, err := model.BuildBlockBreadcrumb(id, nil)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "breadcrumb failed: " + err.Error()}}, IsError: true}, nil
	}

	var sb strings.Builder
	for _, p := range paths {
		sb.WriteString(fmt.Sprintf("%s/%s (%s)\n", p.Type, p.Name, p.ID))
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

func blockTreeStat(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}
	stat := filesys.StatTree(id)
	if stat == nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "document not found or empty"}}, IsError: true}, nil
	}
	text := fmt.Sprintf("Document statistics:\n- Characters: %d\n- Words: %d\n- Blocks: %d\n- Links: %d\n- Images: %d\n- Refs: %d",
		stat.RuneCount, stat.WordCount, stat.BlockCount, stat.LinkCount, stat.ImageCount, stat.RefCount)
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: text}}}, nil
}

func blockDom(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}
	dom := model.GetBlockDOM(id)
	if dom == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "block not found or empty: " + id}}, IsError: true}, nil
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: dom}}}, nil
}

func blockBatchGet(args map[string]any) (CallToolResult, error) {
	idsStr, _ := args["ids"].(string)
	if idsStr == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "ids is required (comma-separated)"}}, IsError: true}, nil
	}

	ids := strings.Split(idsStr, ",")
	for i := range ids {
		ids[i] = strings.TrimSpace(ids[i])
	}

	if len(ids) == 0 {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "no valid IDs provided"}}, IsError: true}, nil
	}

	infos := model.GetDocsInfo(ids, false, false)

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Batch get %d blocks (found %d):\n\n", len(ids), len(infos)))
	for _, info := range infos {
		sb.WriteString(fmt.Sprintf("- %s: %s (rootID: %s, refCount: %d)\n", info.ID, info.Name, info.RootID, info.RefCount))
	}
	for _, id := range ids {
		found := false
		for _, info := range infos {
			if info.ID == id {
				found = true
				break
			}
		}
		if !found {
			sb.WriteString(fmt.Sprintf("- %s: not found\n", id))
		}
	}

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

func blockBatchKramdown(args map[string]any) (CallToolResult, error) {
	idsStr, _ := args["ids"].(string)
	if idsStr == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "ids is required (comma-separated)"}}, IsError: true}, nil
	}

	ids := strings.Split(idsStr, ",")
	for i := range ids {
		ids[i] = strings.TrimSpace(ids[i])
	}

	if len(ids) == 0 {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "no valid IDs provided"}}, IsError: true}, nil
	}

	kramdowns := model.GetBlockKramdowns(ids, "md")

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Batch kramdown %d blocks (found %d):\n\n", len(ids), len(kramdowns)))
	for _, id := range ids {
		if kd, ok := kramdowns[id]; ok {
			sb.WriteString(fmt.Sprintf("--- %s ---\n%s\n\n", id, kd))
		} else {
			sb.WriteString(fmt.Sprintf("--- %s ---\n(not found)\n\n", id))
		}
	}

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}
