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
	"time"

	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/sql"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var NotebookTool = &Tool{
	Name:        "notebook",
	Description: "Notebook management. Actions: list(), open(id), close(id), create(name), rename(id, name), remove(id), set_icon(id, icon), random_icon(id?).",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action": {Type: "string", Description: "Operation", Enum: []string{"list", "open", "close", "create", "rename", "remove", "set_icon", "random_icon"}},
			"id":     {Type: "string", Description: "Notebook ID (for open, close, rename, remove, set_icon, random_icon)"},
			"name":   {Type: "string", Description: "Notebook name (for create, rename)"},
			"icon":   {Type: "string", Description: "Notebook icon (for set_icon). Emoji hex codepoint like \"1f4ca\", emoji character like \"📊\", custom image path like \"1/b3log.png\", or dynamic icon URL like \"api/icon/getDynamicIcon?type=8&color=%23d23f31&content=SiYuan&id=xxx\""},
		},
		Required: []string{"action"},
	},
	Handler: notebookHandler,
}

func init() {
	register(NotebookTool)
}

func notebookHandler(args map[string]any) (CallToolResult, error) {
	action, _ := args["action"].(string)
	switch action {
	case "list":
		return notebookList(args)
	case "open":
		return notebookOpen(args)
	case "close":
		return notebookClose(args)
	case "create":
		return notebookCreate(args)
	case "rename":
		return notebookRename(args)
	case "remove":
		return notebookRemove(args)
	case "set_icon":
		return notebookSetIcon(args)
	case "random_icon":
		return notebookRandomIcon(args)
	}
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: "unknown action '" + action + "', expected one of: [list, open, close, create, rename, remove, set_icon, random_icon]"}},
		IsError: true,
	}, nil
}

func notebookList(args map[string]any) (CallToolResult, error) {
	notebooks, err := model.ListNotebooks()
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "list notebooks failed: " + err.Error()}}, IsError: true}, nil
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Notebooks (%d):\n\n", len(notebooks)))
	for _, nb := range notebooks {
		sb.WriteString(fmt.Sprintf("- %s (id: %s, icon: %s, closed: %v)\n", nb.Name, nb.ID, nb.Icon, nb.Closed))
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

func notebookCreate(args map[string]any) (CallToolResult, error) {
	name, _ := args["name"].(string)
	if name == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "name is required"}}, IsError: true}, nil
	}

	id, err := model.CreateBox(name)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "create notebook failed: " + err.Error()}}, IsError: true}, nil
	}

	if box := model.Conf.Box(id); nil != box {
		evt := util.NewCmdResult("createnotebook", 0, util.PushModeBroadcast)
		evt.Data = map[string]any{"box": box}
		util.PushEvent(evt)
	}

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "notebook created: " + name + " (id: " + id + ")"}}}, nil
}

func notebookRename(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	name, _ := args["name"].(string)
	if id == "" || name == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id and name are required"}}, IsError: true}, nil
	}

	if err := model.RenameBox(id, name); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "rename notebook failed: " + err.Error()}}, IsError: true}, nil
	}

	evt := util.NewCmdResult("renamenotebook", 0, util.PushModeBroadcast)
	evt.Data = map[string]any{"box": id}
	util.PushEvent(evt)

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "notebook renamed: " + id + " -> " + name}}}, nil
}

func notebookRemove(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}

	if err := model.RemoveBox(id); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "remove notebook failed: " + err.Error()}}, IsError: true}, nil
	}

	evt := util.NewCmdResult("removeBox", 0, util.PushModeBroadcast)
	evt.Data = map[string]any{"box": id}
	util.PushEvent(evt)

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "notebook removed: " + id}}}, nil
}

func notebookOpen(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}

	existed, err := model.Mount(id)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "open notebook failed: " + err.Error()}}, IsError: true}, nil
	}

	if box := model.Conf.Box(id); nil != box {
		evt := util.NewCmdResult("mount", 0, util.PushModeBroadcast)
		evt.Data = map[string]any{
			"box":     box,
			"existed": existed,
		}
		util.PushEvent(evt)
	}

	time.Sleep(1 * time.Second)
	sql.FlushQueue()

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "notebook opened: " + id}}}, nil
}

func notebookClose(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}

	model.Unmount(id)

	time.Sleep(1 * time.Second)
	sql.FlushQueue()

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "notebook closed: " + id}}}, nil
}

func notebookSetIcon(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)
	icon, _ := args["icon"].(string)
	if id == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "id is required"}}, IsError: true}, nil
	}

	// 校验笔记本存在，避免对一个不存在的 id 静默写入图标。
	exists := false
	if notebooks, err := model.ListNotebooks(); err == nil {
		for _, nb := range notebooks {
			if nb.ID == id {
				exists = true
				break
			}
		}
	}
	if !exists {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "notebook not found: " + id}}, IsError: true}, nil
	}

	// icon 取值格式与 attr 工具一致；SetBoxIcon 内部对自定义图片名做 XSS 过滤。
	model.SetBoxIcon(id, icon)
	util.PushReloadFiletree()

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "notebook icon set: " + id + " -> " + icon}}}, nil
}

func notebookRandomIcon(args map[string]any) (CallToolResult, error) {
	id, _ := args["id"].(string)

	notebooks, err := model.ListNotebooks()
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "list notebooks failed: " + err.Error()}}, IsError: true}, nil
	}

	// 目标范围：传 id 仅换该笔记本；不传 id 则对全部笔记本各随机换一个。
	targets := notebooks
	if id != "" {
		var found bool
		for _, nb := range notebooks {
			if nb.ID == id {
				targets = []*model.Box{nb}
				found = true
				break
			}
		}
		if !found {
			return CallToolResult{Content: []ContentItem{{Type: "text", Text: "notebook not found: " + id}}, IsError: true}, nil
		}
	}
	if len(targets) == 0 {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "no notebooks to update"}}, IsError: true}, nil
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Randomized icons for %d notebook(s):\n", len(targets)))
	for _, nb := range targets {
		oldIcon := nb.Icon
		newIcon := randomEmoji()
		model.SetBoxIcon(nb.ID, newIcon)
		sb.WriteString(fmt.Sprintf("- %s (id: %s): %s -> %s\n", nb.Name, nb.ID, oldIcon, newIcon))
	}

	util.PushReloadFiletree()

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}
