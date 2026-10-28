// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

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

func syncPerform(_ map[string]any) (CallToolResult, error) {
	if err := model.SyncData(true); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "sync failed: " + err.Error()}}, IsError: true}, nil
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "sync done: " + model.Conf.Sync.Load().Stat}}}, nil
}

func syncUpload(_ map[string]any) (CallToolResult, error) {
	if err := model.SyncDataUpload(); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "sync upload failed: " + err.Error()}}, IsError: true}, nil
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "sync upload done: " + model.Conf.Sync.Load().Stat}}}, nil
}

func syncDownload(_ map[string]any) (CallToolResult, error) {
	if err := model.SyncDataDownload(); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "sync download failed: " + err.Error()}}, IsError: true}, nil
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "sync download done: " + model.Conf.Sync.Load().Stat}}}, nil
}

func syncStatus(_ map[string]any) (CallToolResult, error) {
	s := model.Conf.Sync.Load()
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf(
		"Sync Status:\n  Enabled: %v\n  Mode: %d (0/1=auto, 2=manual, 3=full-manual)\n  Provider: %d\n  Cloud: %s\n  Perception: %v\n  Interval: %ds\n  Synced: %d\n  Stat: %s",
		s.Enabled, s.Mode, s.Provider, s.CloudName, s.Perception, s.Interval, s.Synced, s.Stat,
	)}}}, nil
}
