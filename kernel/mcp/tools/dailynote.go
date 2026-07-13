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

	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var DailynoteTool = &Tool{
	Name:        "dailynote",
	Description: "Daily note operations. Actions: create(notebook) — create/open today's note, append(notebook, data, dataType?) / prepend(...) add a block.",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action":   {Type: "string", Description: "Operation", Enum: []string{"create", "append", "prepend"}},
			"notebook": {Type: "string", Description: "Notebook ID"},
			"data":     {Type: "string", Description: "Content in markdown or dom (for append/prepend)"},
			"dataType": {Type: "string", Description: "Content type: markdown or dom", Enum: []string{"markdown", "dom"}},
		},
		Required: []string{"action", "notebook"},
	},
	Handler: dailynoteHandler,
}

func init() {
	register(DailynoteTool)
}

func dailynoteHandler(args map[string]any) (CallToolResult, error) {
	action, _ := args["action"].(string)
	switch action {
	case "create":
		return dailynoteCreate(args)
	case "append":
		return dailynoteAppend(args)
	case "prepend":
		return dailynotePrepend(args)
	}
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: "unknown action '" + action + "', expected one of: [create, append, prepend]"}},
		IsError: true,
	}, nil
}

func dailynoteCreate(args map[string]any) (CallToolResult, error) {
	notebook, _ := args["notebook"].(string)
	if notebook == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "notebook is required"}}, IsError: true}, nil
	}

	p, existed, err := model.CreateDailyNote(notebook)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("create daily note failed: %s", err)}}, IsError: true}, nil
	}

	model.FlushTxQueue()
	util.PushReloadFiletree()
	id := util.GetTreeID(p)

	status := "created"
	if existed {
		status = "already exists"
	}

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("daily note %s: %s (path: %s)", status, id, p)}}}, nil
}

func dailynoteAppend(args map[string]any) (CallToolResult, error) {
	data, dataType := getBlockData(args)
	if data == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "data is required"}}, IsError: true}, nil
	}

	notebook, _ := args["notebook"].(string)
	if notebook == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "notebook is required"}}, IsError: true}, nil
	}

	p, _, err := model.CreateDailyNote(notebook)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("create daily note failed: %s", err)}}, IsError: true}, nil
	}

	if dataType == "markdown" {
		data, err = markdownToBlockDOM(data)
		if err != nil {
			return CallToolResult{Content: []ContentItem{{Type: "text", Text: "convert markdown failed: " + err.Error()}}, IsError: true}, nil
		}
	}

	parentID := util.GetTreeID(p)
	transactions := []*model.Transaction{{
		DoOperations: []*model.Operation{{
			Action:   "appendInsert",
			Data:     data,
			ParentID: parentID,
		}},
	}}

	model.PerformTransactions(&transactions)
	model.FlushTxQueue()
	util.PushReloadProtyle(parentID)
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("block appended to daily note: %s", parentID)}}}, nil
}

func dailynotePrepend(args map[string]any) (CallToolResult, error) {
	data, dataType := getBlockData(args)
	if data == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "data is required"}}, IsError: true}, nil
	}

	notebook, _ := args["notebook"].(string)
	if notebook == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "notebook is required"}}, IsError: true}, nil
	}

	p, _, err := model.CreateDailyNote(notebook)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("create daily note failed: %s", err)}}, IsError: true}, nil
	}

	if dataType == "markdown" {
		data, err = markdownToBlockDOM(data)
		if err != nil {
			return CallToolResult{Content: []ContentItem{{Type: "text", Text: "convert markdown failed: " + err.Error()}}, IsError: true}, nil
		}
	}

	parentID := util.GetTreeID(p)
	transactions := []*model.Transaction{{
		DoOperations: []*model.Operation{{
			Action:   "prependInsert",
			Data:     data,
			ParentID: parentID,
		}},
	}}

	model.PerformTransactions(&transactions)
	model.FlushTxQueue()
	util.PushReloadProtyle(parentID)
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("block prepended to daily note: %s", parentID)}}}, nil
}
