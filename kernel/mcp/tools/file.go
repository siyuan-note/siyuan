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
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/88250/gulu"
	"github.com/siyuan-note/siyuan/kernel/util"
)

var FileTool = &Tool{
	Name:        "file",
	Description: "Workspace file operations for SiYuan (paths are relative to workspace).\n- list: List directory contents. Requires: path.\n- read: Read file content. Requires: path.\n- write: Write file content. Requires: path, data.\n- delete: Delete file or directory. Requires: path.\n- rename: Rename or move file. Requires: old, new.\n- copy: Copy file or directory. Requires: src, dst.\n- grep: Search file contents using regex pattern. Requires: pattern, path. Optional: include (file glob filter, e.g. \"*.go\", \"*.{ts,tsx}\").",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action":  {Type: "string", Description: "Operation", Enum: []string{"list", "read", "write", "delete", "rename", "copy", "grep"}},
			"path":    {Type: "string", Description: "Relative path within workspace (for list, read, write, delete, grep)"},
			"data":    {Type: "string", Description: "File content (for write)"},
			"offset":  {Type: "number", Description: "Line number to start reading from (for read, 1-based). Negative means N lines from the end. Default: 0 (read from beginning)."},
			"limit":   {Type: "number", Description: "Maximum lines to read (for read). Default: all lines."},
			"old":     {Type: "string", Description: "Source path (for rename)"},
			"new":     {Type: "string", Description: "Destination path (for rename)"},
			"src":     {Type: "string", Description: "Source path (for copy)"},
			"dst":     {Type: "string", Description: "Destination path (for copy)"},
			"pattern": {Type: "string", Description: "Regex pattern to search for (for grep)"},
			"include": {Type: "string", Description: "File glob pattern to filter files (for grep, e.g. \"*.go\", \"*.{ts,tsx}\")"},
		},
		Required: []string{"action"},
	},
	Handler: fileHandler,
}

func init() {
	register(FileTool)
}

func fileHandler(args map[string]interface{}) (CallToolResult, error) {
	action, _ := args["action"].(string)
	switch action {
	case "list":
		return fileList(args)
	case "read":
		return fileRead(args)
	case "write":
		return fileWrite(args)
	case "delete":
		return fileDelete(args)
	case "rename":
		return fileRename(args)
	case "copy":
		return fileCopy(args)
	case "grep":
		return fileGrep(args)
	}
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: "unknown action '" + action + "', expected one of: [list, read, write, delete, rename, copy, grep]"}},
		IsError: true,
	}, nil
}

func resolvePath(rel string) (string, error) {
	rel = filepath.Clean(strings.ReplaceAll(rel, "/", string(os.PathSeparator)))
	abs := filepath.Join(util.WorkspaceDir, rel)
	if !gulu.File.IsSubPath(util.WorkspaceDir, abs) {
		return "", fmt.Errorf("path escapes workspace: %s", rel)
	}
	return abs, nil
}

func fileList(args map[string]interface{}) (CallToolResult, error) {
	p, _ := args["path"].(string)
	if p == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "path is required"}}, IsError: true}, nil
	}
	dir, err := resolvePath(p)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: err.Error()}}, IsError: true}, nil
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "read dir failed: " + err.Error()}}, IsError: true}, nil
	}
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Directory: %s (%d entries)\n\n", p, len(entries)))
	for _, e := range entries {
		info, _ := e.Info()
		size := ""
		if info != nil {
			size = fmt.Sprintf("%d", info.Size())
		}
		sb.WriteString(fmt.Sprintf("- %s [%s] %s\n", e.Name(), typeLabel(e.IsDir()), size))
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

func getFloat64Arg(args map[string]interface{}, key string) float64 {
	if v, ok := args[key]; ok {
		if f, ok := v.(float64); ok {
			return f
		}
	}
	return 0
}

func fileRead(args map[string]interface{}) (CallToolResult, error) {
	p, _ := args["path"].(string)
	if p == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "path is required"}}, IsError: true}, nil
	}
	abs, err := resolvePath(p)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: err.Error()}}, IsError: true}, nil
	}
	data, err := os.ReadFile(abs)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "read file failed: " + err.Error()}}, IsError: true}, nil
	}

	offset := int(getFloat64Arg(args, "offset"))
	limit := int(getFloat64Arg(args, "limit"))

	if offset == 0 && limit == 0 {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: string(data)}}}, nil
	}

	lines := strings.Split(string(data), "\n")
	total := len(lines)

	if offset < 0 {
		offset = total + offset
		if offset < 0 {
			offset = 0
		}
	} else {
		offset--
		if offset < 0 {
			offset = 0
		}
	}

	end := total
	if limit > 0 {
		end = offset + limit
		if end > total {
			end = total
		}
	}

	if offset >= total {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("(file has %d lines, offset out of range)", total)}}, IsError: true}, nil
	}

	result := strings.Join(lines[offset:end], "\n")
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: result}}}, nil
}

func fileWrite(args map[string]interface{}) (CallToolResult, error) {
	p, _ := args["path"].(string)
	dataStr, _ := args["data"].(string)
	if p == "" || dataStr == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "path and data are required"}}, IsError: true}, nil
	}
	abs, err := resolvePath(p)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: err.Error()}}, IsError: true}, nil
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0755); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "mkdir failed: " + err.Error()}}, IsError: true}, nil
	}
	if err := os.WriteFile(abs, []byte(dataStr), 0644); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "write file failed: " + err.Error()}}, IsError: true}, nil
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "file written: " + p}}}, nil
}

func fileDelete(args map[string]interface{}) (CallToolResult, error) {
	p, _ := args["path"].(string)
	if p == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "path is required"}}, IsError: true}, nil
	}
	abs, err := resolvePath(p)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: err.Error()}}, IsError: true}, nil
	}
	info, err := os.Stat(abs)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "stat failed: " + err.Error()}}, IsError: true}, nil
	}
	if info.IsDir() {
		err = os.RemoveAll(abs)
	} else {
		err = os.Remove(abs)
	}
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "delete failed: " + err.Error()}}, IsError: true}, nil
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "deleted: " + p}}}, nil
}

func fileRename(args map[string]interface{}) (CallToolResult, error) {
	old, _ := args["old"].(string)
	newP, _ := args["new"].(string)
	if old == "" || newP == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "old and new are required"}}, IsError: true}, nil
	}
	oldAbs, err := resolvePath(old)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: err.Error()}}, IsError: true}, nil
	}
	newAbs, err := resolvePath(newP)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: err.Error()}}, IsError: true}, nil
	}
	if err := os.MkdirAll(filepath.Dir(newAbs), 0755); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "mkdir failed: " + err.Error()}}, IsError: true}, nil
	}
	if err := os.Rename(oldAbs, newAbs); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "rename failed: " + err.Error()}}, IsError: true}, nil
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("renamed: %s -> %s", old, newP)}}}, nil
}

func fileCopy(args map[string]interface{}) (CallToolResult, error) {
	src, _ := args["src"].(string)
	dst, _ := args["dst"].(string)
	if src == "" || dst == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "src and dst are required"}}, IsError: true}, nil
	}
	srcAbs, err := resolvePath(src)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: err.Error()}}, IsError: true}, nil
	}
	dstAbs, err := resolvePath(dst)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: err.Error()}}, IsError: true}, nil
	}
	if err := copyPath(srcAbs, dstAbs); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "copy failed: " + err.Error()}}, IsError: true}, nil
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("copied: %s -> %s", src, dst)}}}, nil
}

func copyPath(src, dst string) error {
	srcInfo, err := os.Stat(src)
	if err != nil {
		return err
	}
	if srcInfo.IsDir() {
		return copyDir(src, dst)
	}
	return copyFile(src, dst)
}

func copyDir(src, dst string) error {
	if err := os.MkdirAll(dst, 0755); err != nil {
		return err
	}
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if err := copyPath(filepath.Join(src, e.Name()), filepath.Join(dst, e.Name())); err != nil {
			return err
		}
	}
	return nil
}

func copyFile(src, dst string) error {
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return err
	}
	srcF, err := os.Open(src)
	if err != nil {
		return err
	}
	defer srcF.Close()
	dstF, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer dstF.Close()
	_, err = io.Copy(dstF, srcF)
	return err
}

func typeLabel(isDir bool) string {
	if isDir {
		return "DIR"
	}
	return "FILE"
}

func fileGrep(args map[string]interface{}) (CallToolResult, error) {
	pattern, _ := args["pattern"].(string)
	if pattern == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "pattern is required"}}, IsError: true}, nil
	}

	p, _ := args["path"].(string)
	if p == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "path is required"}}, IsError: true}, nil
	}

	abs, err := resolvePath(p)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: err.Error()}}, IsError: true}, nil
	}

	include, _ := args["include"].(string)

	results, err := gulu.File.Grep(abs, include, pattern, 0)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "grep failed: " + err.Error()}}, IsError: true}, nil
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Found %d matches:\n\n", len(results)))
	for _, r := range results {
		rel, relErr := filepath.Rel(util.WorkspaceDir, r.File)
		if relErr != nil {
			rel = r.File
		}
		sb.WriteString(fmt.Sprintf("%s:%d: %s\n", rel, r.Line, r.Text))
	}

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}
