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
)

var SyncTool = &Tool{
	Name:        "sync",
	Description: "Data sync operations. Actions: perform() (full upload+download), upload(), download(), status().",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action": {Type: "string", Description: "Operation", Enum: []string{"perform", "upload", "download", "status"}},
		},
		Required: []string{"action"},
	},
	Handler: syncHandler,
}

func init() {
	register(SyncTool)
}

func syncHandler(args map[string]any) (CallToolResult, error) {
	action, _ := args["action"].(string)
	switch action {
	case "perform":
		return syncPerform(args)
	case "upload":
		return syncUpload(args)
	case "download":
		return syncDownload(args)
	case "status":
		return syncStatus(args)
	}
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: "unknown action '" + action + "', expected one of: [perform, upload, download, status]"}},
		IsError: true,
	}, nil
}

func syncPerform(args map[string]any) (CallToolResult, error) {
	model.SyncData(true)
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "sync done: " + model.Conf.Sync.Stat}}}, nil
}

func syncUpload(args map[string]any) (CallToolResult, error) {
	model.SyncDataUpload()
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "sync upload done: " + model.Conf.Sync.Stat}}}, nil
}

func syncDownload(args map[string]any) (CallToolResult, error) {
	model.SyncDataDownload()
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "sync download done: " + model.Conf.Sync.Stat}}}, nil
}

func syncStatus(args map[string]any) (CallToolResult, error) {
	s := model.Conf.Sync
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf(
		"Sync Status:\n  Enabled: %v\n  Mode: %d (0/1=auto, 2=manual, 3=full-manual)\n  Provider: %d\n  Cloud: %s\n  Perception: %v\n  Interval: %ds\n  Synced: %d\n  Stat: %s",
		s.Enabled, s.Mode, s.Provider, s.CloudName, s.Perception, s.Interval, s.Synced, s.Stat,
	)}}}, nil
}
