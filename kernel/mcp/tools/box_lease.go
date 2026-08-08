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
	"path/filepath"
	"sort"
	"strings"

	"github.com/88250/lute/ast"
	"github.com/siyuan-note/siyuan/kernel/av"
	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/treenode"
)

var encryptedBoxScopedToolNames = map[string]struct{}{
	"asset":     {},
	"attr":      {},
	"block":     {},
	"dailynote": {},
	"database":  {},
	"document":  {},
	"export":    {},
	"history":   {},
	"image":     {},
	"import":    {},
	"outline":   {},
	"ref":       {},
	"repo":      {},
	"search":    {},
	"sql":       {},
	"template":  {},
}

func attachEncryptedBoxLeaseResolver(tool *Tool) {
	if tool == nil || tool.BoxLeaseResolver != nil {
		return
	}
	if tool.Name == "notebook" {
		tool.BoxLeaseResolver = resolveNotebookToolBoxLeases
		return
	}
	if tool.Name == "repo" {
		tool.BoxLeaseResolver = resolveRepoToolBoxLeases
		return
	}
	if _, ok := encryptedBoxScopedToolNames[tool.Name]; ok {
		tool.BoxLeaseResolver = resolveEncryptedBoxLeases
	}
}

func resolveNotebookToolBoxLeases(args map[string]any) []string {
	action, _ := args["action"].(string)
	switch action {
	case "list":
		var ret []string
		for _, boxID := range model.ListAllEncryptedBoxIDs() {
			if model.IsBoxUnlocked(boxID) {
				ret = append(ret, boxID)
			}
		}
		return ret
	case "open", "rename", "set_icon":
		id, _ := args["id"].(string)
		return []string{id}
	case "random_icon":
		if id, _ := args["id"].(string); id != "" {
			return []string{id}
		}
		return model.ListAllEncryptedBoxIDs()
	default:
		return nil
	}
}

func resolveRepoToolBoxLeases(args map[string]any) []string {
	action, _ := args["action"].(string)
	if !strings.HasPrefix(action, "file_") {
		return nil
	}
	id, _ := args["id"].(string)
	if id == "" {
		return nil
	}
	boxID, err := model.ResolveRepoFileBoxID(id)
	if err != nil || boxID == "" {
		return nil
	}
	return []string{boxID}
}

func resolveEncryptedBoxLeases(args map[string]any) []string {
	boxIDs := map[string]struct{}{}
	addBoxID := func(boxID string) {
		boxID = strings.TrimSpace(boxID)
		if boxID != "" && model.IsEncryptedBox(boxID) {
			boxIDs[boxID] = struct{}{}
		}
	}
	addObjectID := func(id string) {
		id = strings.TrimSpace(id)
		if !ast.IsNodeIDPattern(id) {
			return
		}
		addBoxID(id)
		if block := treenode.GetBlockTree(id); block != nil {
			addBoxID(block.BoxID)
		}
		if _, boxID := av.FindAttributeViewPath(id); boxID != "" {
			addBoxID(boxID)
		}
	}
	addValue := func(value any, add func(string)) {
		switch typed := value.(type) {
		case string:
			for _, item := range strings.Split(typed, ",") {
				add(item)
			}
		case []string:
			for _, item := range typed {
				add(item)
			}
		case []any:
			for _, item := range typed {
				if text, ok := item.(string); ok {
					add(text)
				}
			}
		}
	}

	for _, key := range []string{"notebook", "notebooks", "box", "boxID", "boxIDs"} {
		addValue(args[key], addBoxID)
	}
	for _, key := range []string{
		"id", "ids", "blockID", "blockIDs", "documentID", "documentIDs", "parentID", "parentIDs", "rootID", "rootIDs",
		"nextID", "previousID",
	} {
		addValue(args[key], addObjectID)
	}
	for _, key := range []string{"path", "historyPath"} {
		pathValue, _ := args[key].(string)
		for _, segment := range strings.Split(filepath.ToSlash(pathValue), "/") {
			addBoxID(segment)
		}
	}

	ret := make([]string, 0, len(boxIDs))
	for boxID := range boxIDs {
		ret = append(ret, boxID)
	}
	sort.Strings(ret)
	return ret
}
