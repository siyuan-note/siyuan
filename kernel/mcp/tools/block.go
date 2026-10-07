// SiYuan - From thought to insight, with agents
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
	"encoding/json"
	"fmt"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/filesys"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var BlockTool = &Tool{
	Name: "block",
	Description: `Block operations, including native Tabs (NodeTabs/NodeTabItem) and Mindmap (NodeMindmap/NodeMindmapItem).
Actions: get(id), get_kramdown(id), get_children(id), tree_stat(id, by document), dom(id), insert(data, dataType, parentID?, nextID?, previousID?), append(data, dataType, parentID) / prepend(...) add a NEW child and return its ID — use after block.update when both modifying and adding, update(id, data, dataType, lockType?) replaces ONE block only (no append), delete(id), move(id, parentID, previousID?), breadcrumb(id), batch_get(ids) / batch_kramdown(ids) where ids is comma-separated.

Block placement:
- Headings (h1-h6) are leaf blocks; content shown below a heading is its following siblings, not its children. To place a block below a heading, use the heading ID (or the last block currently below it) as previousID, never as parentID.
- A list-item must have a NodeList parent and cannot directly contain another list-item. To nest lists, create a NodeList inside the outer list-item, then add list-items to the inner list.

Native container structure and operations:
- These are native, editable blocks; do not substitute HTML widgets, Mermaid diagrams, or plugins unless requested.
- Tabs: NodeTabs contains only NodeTabItem; each item contains at least one body block and may contain nested tabs. Use an empty paragraph for an empty body. Use attr.set for tabs-position (top/left) and tabs-active-id (an existing direct item ID).
- Mindmap: NodeMindmap contains only NodeMindmapItem. Each item contains content blocks and may contain a nested NodeMindmap for child branches; never put a plain NodeList, NodeListItem, or a bare NodeMindmapItem directly inside an item. A mindmap code fence creates an ordinary code block, not a native mindmap.
- To add tabs or sibling mindmap items, pass a group containing only the new items to insert/append/prepend. When the target container is of the same type, only the group's direct items are inserted and the target container's attributes are preserved. To add a child mindmap branch, insert a NodeMindmap under a NodeMindmapItem.
- Use move/delete on existing item IDs for reordering/removal, and edit body blocks individually.

Structural reads and updates:
- get/get_kramdown/batch_kramdown return Markdown for reading, which flattens tabs and renders mindmaps as lists; use dom before editing these containers. Never rebuild these containers from their reading Markdown.
- Preserve all existing data-node-id values and attributes, including active tabs and mindmap metadata. Update with dataType=dom and lockType=true unless the user explicitly requests a type conversion.`,
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action":   {Type: "string", Description: "Operation", Enum: []string{"get", "get_kramdown", "get_children", "tree_stat", "dom", "insert", "append", "prepend", "update", "delete", "move", "breadcrumb", "batch_get", "batch_kramdown"}},
			"notebook": {Type: "string", Description: "Notebook ID that owns the target blocks; required for encrypted notebooks"},
			"id":       {Type: "string", Description: "Block ID"},
			"ids":      {Type: "string", Description: "Comma-separated block IDs (for batch_get, batch_kramdown)"},
			"data": {Type: "string", Description: `Content in markdown or block DOM. Prefer markdown for ordinary blocks. Use insert/append/prepend to create native containers.

Native Tabs Markdown (dataType=markdown):
::: tabs
@tab First

Body

@tab:active Second

Other body

:::
The opening fence requires a space before tabs; never write :::tabs or :::tab. Nested groups require longer outer colon fences.

Native Mindmap DOM (dataType=dom):
<div data-type="NodeMindmap" data-subtype="u" class="mindmap"><div data-type="NodeMindmapItem" data-subtype="u" data-marker="-" class="mindmap-item"><div data-type="NodeParagraph" class="p"><div contenteditable="true">Root</div></div><div data-type="NodeMindmap" data-subtype="u" class="mindmap"><div data-type="NodeMindmapItem" data-subtype="u" data-marker="-" class="mindmap-item"><div data-type="NodeParagraph" class="p"><div contenteditable="true">Child</div></div></div></div></div></div>
Every block needs an explicit data-type. New native DOM blocks may omit data-node-id; the tool generates IDs.

Raw super-block DOM uses data-type="NodeSuperBlock" and data-sb-layout="row" or data-sb-layout="col", never data-layout, and every child needs an explicit data-type; otherwise content may become an HTML block.

` + markdownContentSyntax},
			"dataType":   {Type: "string", Description: "Content type: markdown or dom", Enum: []string{"markdown", "dom"}},
			"lockType":   {Type: "boolean", Description: "Reject update when the parsed block type differs from the existing block type; defaults to true for native Tabs/Mindmap containers and items, false otherwise. Set false only for an intentional type conversion"},
			"parentID":   {Type: "string", Description: "Parent container block ID; never a heading or another leaf block. A list-item requires a NodeList parent"},
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

	boxID, release, scopeErr := beginBlockToolScope(args, false, id)
	if scopeErr != nil {
		return blockToolError(scopeErr.Error())
	}
	defer release()

	var b *model.Block
	var err error
	if boxID != "" {
		b, err = model.GetBlockInBox(id, boxID)
	} else {
		b, err = model.GetBlock(id, nil)
	}
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

	boxID, release, scopeErr := beginBlockToolScope(args, false, id)
	if scopeErr != nil {
		return blockToolError(scopeErr.Error())
	}
	defer release()

	kramdown := model.GetBlockKramdownInBox(id, "md", boxID)
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

	boxID, release, scopeErr := beginBlockToolScope(args, false, id)
	if scopeErr != nil {
		return blockToolError(scopeErr.Error())
	}
	defer release()

	children := model.GetChildBlocksInBox(id, boxID)
	if len(children) == 0 {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "no child blocks found"}}}, nil
	}

	var sb strings.Builder
	for _, c := range children {
		content := c.Markdown
		if content == "" {
			content = c.Content
		}
		content = truncateText(content, 200)
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
	if parentID == "" && previousID == "" && nextID == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "parentID, previousID, or nextID is required"}}, IsError: true}, nil
	}
	boxID, release, scopeErr := beginBlockToolScope(args, true, parentID, previousID, nextID)
	if scopeErr != nil {
		return blockToolError(scopeErr.Error())
	}
	defer release()

	// 仅靠 parentID 定位目标时，目标必须是容器块，否则非法嵌套
	if parentID != "" && previousID == "" && nextID == "" {
		if err := treenode.CheckContainerParent(parentID); err != nil {
			return CallToolResult{Content: []ContentItem{{Type: "text", Text: err.Error()}}, IsError: true}, nil
		}
	}

	data, err := prepareBlockWriteData(data, dataType)
	if err != nil {
		return blockToolError("prepare block data failed: " + err.Error())
	}

	operation := &model.Operation{
		Action:     "insert",
		Data:       data,
		ParentID:   parentID,
		PreviousID: previousID,
		NextID:     nextID,
	}
	transaction := &model.Transaction{DoOperations: []*model.Operation{operation}}

	if err := model.PerformTxSync(transaction); err != nil {
		return blockToolError("insert block failed: " + err.Error())
	}

	reloadID := nextID
	if reloadID == "" {
		reloadID = previousID
	}
	if reloadID == "" {
		reloadID = parentID
	}
	if reloadID != "" {
		if bt := treenode.GetBlockTreeInExactBox(reloadID, boxID); bt != nil {
			util.PushReloadProtyle(bt.RootID)
		}
	}

	return blockWriteSuccess("insert", operation.ID)
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
	boxID, release, scopeErr := beginBlockToolScope(args, true, parentID)
	if scopeErr != nil {
		return blockToolError(scopeErr.Error())
	}
	defer release()
	// append 只用 parentID 定位目标，目标必须是容器块，否则非法嵌套
	if err := treenode.CheckContainerParent(parentID); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: err.Error()}}, IsError: true}, nil
	}

	data, err := prepareBlockWriteData(data, dataType)
	if err != nil {
		return blockToolError("prepare block data failed: " + err.Error())
	}

	operation := &model.Operation{
		Action:   "appendInsert",
		Data:     data,
		ParentID: parentID,
	}
	transaction := &model.Transaction{DoOperations: []*model.Operation{operation}}

	if err := model.PerformTxSync(transaction); err != nil {
		return blockToolError("append block failed: " + err.Error())
	}

	if bt := treenode.GetBlockTreeInExactBox(parentID, boxID); bt != nil {
		util.PushReloadProtyle(bt.RootID)
	}
	return blockWriteSuccess("append", operation.ID)
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
	boxID, release, scopeErr := beginBlockToolScope(args, true, parentID)
	if scopeErr != nil {
		return blockToolError(scopeErr.Error())
	}
	defer release()
	// prepend 只用 parentID 定位目标，目标必须是容器块，否则非法嵌套
	if err := treenode.CheckContainerParent(parentID); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: err.Error()}}, IsError: true}, nil
	}

	data, err := prepareBlockWriteData(data, dataType)
	if err != nil {
		return blockToolError("prepare block data failed: " + err.Error())
	}

	operation := &model.Operation{
		Action:   "prependInsert",
		Data:     data,
		ParentID: parentID,
	}
	transaction := &model.Transaction{DoOperations: []*model.Operation{operation}}

	if err := model.PerformTxSync(transaction); err != nil {
		return blockToolError("prepend block failed: " + err.Error())
	}

	if bt := treenode.GetBlockTreeInExactBox(parentID, boxID); bt != nil {
		util.PushReloadProtyle(bt.RootID)
	}
	return blockWriteSuccess("prepend", operation.ID)
}

type blockWriteOutput struct {
	Action string `json:"action"`
	ID     string `json:"id"`
}

func blockWriteSuccess(action, id string) (CallToolResult, error) {
	if id == "" {
		return blockToolError(action + " block failed: empty block ID")
	}
	output := &blockWriteOutput{Action: action, ID: id}
	serialized, err := json.Marshal(output)
	if err != nil {
		return CallToolResult{}, err
	}
	return CallToolResult{
		Content:              []ContentItem{{Type: "text", Text: string(serialized)}},
		StructuredContent:    output,
		StructuredContentSet: true,
	}, nil
}

func blockUpdate(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}
	data, dataType := getBlockData(args)
	if _, exists := args["data"]; !exists {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "data is required"}}, IsError: true}, nil
	}
	boxID, release, scopeErr := beginBlockToolScope(args, true, id)
	if scopeErr != nil {
		return blockToolError(scopeErr.Error())
	}
	defer release()

	lockType, explicitLockType := args["lockType"].(bool)
	if !explicitLockType {
		if block := treenode.GetBlockTreeInExactBox(id, boxID); block != nil {
			switch block.Type {
			case "tabs", "tab", "mindmap", "mindmap_item":
				lockType = true
			}
		}
	}

	if dataType == "dom" {
		var err error
		data, err = prepareBlockWriteData(data, dataType)
		if err != nil {
			return blockToolError("prepare block data failed: " + err.Error())
		}
	}

	_, rootIDs, err := model.PerformBlockUpdates([]model.BlockUpdateInput{{
		ID:       id,
		Data:     data,
		DataType: dataType,
		LockType: lockType,
	}})
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: err.Error()}}, IsError: true}, nil
	}

	for _, rootID := range rootIDs {
		util.PushReloadProtyle(rootID)
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "block updated"}}}, nil
}

func blockDelete(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}

	boxID, release, scopeErr := beginBlockToolScope(args, true, id)
	if scopeErr != nil {
		return blockToolError(scopeErr.Error())
	}
	defer release()

	bt := treenode.GetBlockTreeInExactBox(id, boxID)

	transaction := &model.Transaction{
		DoOperations: []*model.Operation{{
			Action: "delete",
			ID:     id,
		}},
	}

	if err := model.PerformTxSync(transaction); err != nil {
		return blockToolError("delete block failed: " + err.Error())
	}

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

// prepareBlockWriteData 为原生页签和脑图 DOM 中的新块补全 ID，保留已有块的 ID 和属性。
func prepareBlockWriteData(data, dataType string) (string, error) {
	if dataType == "markdown" {
		return markdownToBlockDOM(data)
	}
	if dataType != "dom" {
		return "", fmt.Errorf("unsupported block data type [%s]", dataType)
	}
	engine := util.NewLute()
	tree := engine.BlockDOM2Tree(data)
	if tree == nil || tree.Root == nil {
		return "", fmt.Errorf("parse tree failed")
	}
	hasNativeContainer := false
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if entering && (node.Type == ast.NodeTabs || node.Type == ast.NodeTabItem ||
			node.Type == ast.NodeMindmap || node.Type == ast.NodeMindmapItem) {
			hasNativeContainer = true
			return ast.WalkStop
		}
		return ast.WalkContinue
	})
	if !hasNativeContainer {
		return data, nil
	}
	var err error
	ids := map[string]struct{}{}
	ast.Walk(tree.Root, func(node *ast.Node, entering bool) ast.WalkStatus {
		if !entering || !node.IsBlock() || node.Type == ast.NodeDocument || node.Type == ast.NodeKramdownBlockIAL {
			return ast.WalkContinue
		}
		if node.ID == "" {
			node.ID = ast.NewNodeID()
			node.SetIALAttr("id", node.ID)
		} else if !ast.IsNodeIDPattern(node.ID) {
			err = fmt.Errorf("found invalid ID [%s]", node.ID)
			return ast.WalkStop
		}
		if _, exists := ids[node.ID]; exists {
			err = fmt.Errorf("found duplicate ID [%s]", node.ID)
			return ast.WalkStop
		}
		ids[node.ID] = struct{}{}
		if node.IALAttr("updated") == "" {
			node.SetIALAttr("updated", node.ID[:14])
		}
		return ast.WalkContinue
	})
	if err != nil {
		return "", err
	}
	return engine.Tree2BlockDOM(tree, engine.RenderOptions, engine.ParseOptions), nil
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
	boxID, release, scopeErr := beginBlockToolScope(args, true, id, parentID, previousID)
	if scopeErr != nil {
		return blockToolError(scopeErr.Error())
	}
	defer release()

	// 仅靠 parentID 定位目标时（无 previousID），目标必须是容器块，否则 doMove parent-only 分支会形成非法嵌套
	if previousID == "" {
		if err := treenode.CheckListItemNesting(parentID, id); err != nil {
			return CallToolResult{Content: []ContentItem{{Type: "text", Text: err.Error()}}, IsError: true}, nil
		}
		if err := treenode.CheckContainerParent(parentID); err != nil {
			return CallToolResult{Content: []ContentItem{{Type: "text", Text: err.Error()}}, IsError: true}, nil
		}
	}

	transaction := &model.Transaction{
		DoOperations: []*model.Operation{{
			Action:     "move",
			ID:         id,
			ParentID:   parentID,
			PreviousID: previousID,
		}},
	}

	if err := model.PerformTxSync(transaction); err != nil {
		return blockToolError("move block failed: " + err.Error())
	}

	if bt := treenode.GetBlockTreeInExactBox(id, boxID); bt != nil {
		util.PushReloadProtyle(bt.RootID)
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "block moved: " + id}}}, nil
}

func blockBreadcrumb(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}

	boxID, release, scopeErr := beginBlockToolScope(args, false, id)
	if scopeErr != nil {
		return blockToolError(scopeErr.Error())
	}
	defer release()

	paths, err := model.BuildBlockBreadcrumbInBox(id, nil, boxID)
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
	boxID, release, scopeErr := beginBlockToolScope(args, false, id)
	if scopeErr != nil {
		return blockToolError(scopeErr.Error())
	}
	defer release()

	stat := filesys.StatTreeInBox(id, boxID)
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
	boxID, release, scopeErr := beginBlockToolScope(args, false, id)
	if scopeErr != nil {
		return blockToolError(scopeErr.Error())
	}
	defer release()

	dom := model.GetBlockDOMInBox(id, boxID)
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

	boxID, release, scopeErr := beginBlockToolScope(args, false, ids...)
	if scopeErr != nil {
		return blockToolError(scopeErr.Error())
	}
	defer release()

	var infos []*model.BlockInfo
	if boxID == "" {
		infos = model.GetDocsInfo(ids, false, false)
	} else {
		for _, id := range ids {
			info, err := model.GetDocInfoInBox(id, boxID)
			if err == nil && info != nil {
				infos = append(infos, info)
			}
		}
	}

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

	boxID, release, scopeErr := beginBlockToolScope(args, false, ids...)
	if scopeErr != nil {
		return blockToolError(scopeErr.Error())
	}
	defer release()

	kramdowns := model.GetBlockKramdownsInBox(ids, "md", boxID)

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

func beginBlockToolScope(args map[string]any, mutation bool, ids ...string) (boxID string, release func(), err error) {
	release = func() {}
	notebook, _ := args["notebook"].(string)
	notebook = strings.TrimSpace(notebook)
	encrypted := notebook != "" && model.IsEncryptedBox(notebook)
	if encrypted {
		model.HoldBoxReadLock(notebook)
		if !model.IsBoxUnlocked(notebook) {
			model.ReleaseBoxReadLock(notebook)
			return "", release, fmt.Errorf("encrypted notebook is locked, please unlock it first")
		}
		release = func() {
			model.ReleaseBoxReadLock(notebook)
		}
		boxID = notebook
	}

	fail := func(format string, values ...any) (string, func(), error) {
		release()
		return "", func() {}, fmt.Errorf(format, values...)
	}
	for _, id := range ids {
		if id == "" {
			continue
		}
		queryBoxID := ""
		if encrypted {
			queryBoxID = notebook
		}
		bt := treenode.GetBlockTreeInExactBox(id, queryBoxID)
		if bt == nil || (notebook != "" && bt.BoxID != notebook) {
			if notebook == "" {
				return fail("block %s was not found in a normal notebook; provide notebook for encrypted targets", id)
			}
			return fail("block %s does not belong to notebook %s", id, notebook)
		}
		if mutation && encrypted {
			if treenode.GetBlockTreeInExactBox(id, "") != nil {
				return fail("block ID %s is ambiguous across notebook boundaries", id)
			}
			for _, openedBoxID := range treenode.GetOpenedEncryptedBoxIDs() {
				if openedBoxID != notebook && treenode.GetBlockTreeInExactBox(id, openedBoxID) != nil {
					return fail("block ID %s is ambiguous across notebook boundaries", id)
				}
			}
		}
	}
	return
}

func blockToolError(message string) (CallToolResult, error) {
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: message}},
		IsError: true,
	}, nil
}
