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

	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"

	"github.com/88250/gulu"
)

var FileTool = &Tool{
	Name:        "file",
	Description: "Workspace file operations (paths relative to workspace; debugging/log reading only — never use for workspace data). Actions: list(path, limit=200, 0/-1=unlimited), read(path, offset, limit; default 200 lines, limit=-1 for full), write(path, data), delete(path), rename(old, new), copy(src, dst), grep(pattern, path, include?, context?, limit=200), find(path, include?, limit=200), stat(path).",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action":  {Type: "string", Description: "Operation", Enum: []string{"list", "read", "write", "delete", "rename", "copy", "grep", "find", "stat"}},
			"path":    {Type: "string", Description: "Relative path within workspace (for list, read, write, delete, grep, find, stat)"},
			"data":    {Type: "string", Description: "File content (for write)"},
			"offset":  {Type: "number", Description: "Line number to start reading from (for read, 1-based). Negative means N lines from the end. Default: 0 (read from beginning)."},
			"limit":   {Type: "number", Description: "Maximum lines/files/entries to return (for read, list, find, grep). Default: 200 lines when offset and limit are both 0 for read, 200 for list/find/grep. Use 0 or negative for unlimited."},
			"old":     {Type: "string", Description: "Source path (for rename)"},
			"new":     {Type: "string", Description: "Destination path (for rename)"},
			"src":     {Type: "string", Description: "Source path (for copy)"},
			"dst":     {Type: "string", Description: "Destination path (for copy)"},
			"pattern": {Type: "string", Description: "Regex pattern to search for (for grep)"},
			"include": {Type: "string", Description: "File glob pattern to filter files (for grep, find; e.g. \"*.go\", \"*.{ts,tsx}\")"},
			"context": {Type: "number", Description: "Number of context lines before and after each match (for grep, default 0)"},
		},
		Required: []string{"action"},
	},
	Handler: fileHandler,
}

func init() {
	register(FileTool)
}

func fileHandler(args map[string]any) (CallToolResult, error) {
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
	case "find":
		return fileFind(args)
	case "stat":
		return fileStat(args)
	}
	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: "unknown action '" + action + "', expected one of: [list, read, write, delete, rename, copy, grep, find, stat]"}},
		IsError: true,
	}, nil
}

func resolvePath(rel string) (string, error) {
	rel = filepath.Clean(strings.ReplaceAll(rel, "/", string(os.PathSeparator)))
	abs := filepath.Join(util.WorkspaceDir, rel)
	if !gulu.File.IsSubPath(util.WorkspaceDir, abs) {
		return "", fmt.Errorf("path escapes workspace: %s", rel)
	}
	// 拒绝加密笔记本目录：MCP 文件工具不能读写加密 box 下的文件（防止密文泄漏或明文破坏加密格式）
	if boxID, encrypted := rejectEncryptedPath(abs); encrypted {
		return "", fmt.Errorf("path belongs to encrypted notebook [%s]: %s", boxID, rel)
	}
	// 防止 symlink 逃逸工作区：解析符号链接后再次检查
	if resolved := util.ResolveLongestExistingParent(abs); resolved != abs && !gulu.File.IsSubPath(util.WorkspaceDir, resolved) {
		return "", fmt.Errorf("symlink escapes workspace: %s", rel)
	}
	// 禁止访问配置文件 conf/conf.json（含 accessAuthCode/api.token/cookieKey 等明文凭据），
	// 对齐 HTTP 文件 API 的既定黑名单（见 kernel/api/file.go 的 refuseToAccess）。
	confPath := filepath.Join(util.ConfDir, "conf.json")
	if abs == confPath {
		return "", fmt.Errorf("access to conf.json is forbidden")
	}
	return abs, nil
}

// rejectEncryptedPath 检查路径是否属于加密笔记本（含 symlink 绕过），返回 boxID 和是否为加密 box。
func rejectEncryptedPath(absPath string) (boxID string, encrypted bool) {
	boxID = model.EncryptedRawPathBoxID(absPath)
	return boxID, boxID != ""
}

func fileList(args map[string]any) (CallToolResult, error) {
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

	max := resolveLimit(args, 200)
	total := len(entries)
	if max > 0 && max < total {
		entries = entries[:max]
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Directory: %s (%d entries)\n\n", p, total))
	for _, e := range entries {
		info, _ := e.Info()
		size := ""
		if info != nil {
			size = fmt.Sprintf("%d", info.Size())
		}
		sb.WriteString(fmt.Sprintf("- %s [%s] %s\n", e.Name(), typeLabel(e.IsDir()), size))
	}

	if max > 0 && max < total {
		sb.WriteString(fmt.Sprintf("\n...output limited to %d of %d entries. Use limit parameter to adjust.", max, total))
	}

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

func getFloat64Arg(args map[string]any, key string) float64 {
	if v, ok := args[key]; ok {
		if f, ok := v.(float64); ok {
			return f
		}
	}
	return 0
}

func resolveLimit(args map[string]any, defaultLimit int) int {
	limit := int(getFloat64Arg(args, "limit"))
	if limit <= 0 {
		return defaultLimit
	}
	return limit
}

func fileRead(args map[string]any) (CallToolResult, error) {
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
		limit = 200
	}

	lines := strings.Split(string(data), "\n")
	total := len(lines)

	if offset < 0 {
		offset = max(total+offset, 0)
	} else {
		offset--
		if offset < 0 {
			offset = 0
		}
	}

	end := total
	if limit > 0 {
		end = min(offset+limit, total)
	}

	if offset >= total {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("(file has %d lines, offset out of range)", total)}}, IsError: true}, nil
	}

	result := strings.Join(lines[offset:end], "\n")
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: result}}}, nil
}

func fileWrite(args map[string]any) (CallToolResult, error) {
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

func fileDelete(args map[string]any) (CallToolResult, error) {
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

func fileRename(args map[string]any) (CallToolResult, error) {
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

func fileCopy(args map[string]any) (CallToolResult, error) {
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

func fileGrep(args map[string]any) (CallToolResult, error) {
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
	ctx := int(getFloat64Arg(args, "context"))
	max := resolveLimit(args, 200)

	results, err := gulu.File.Grep(abs, include, pattern, ctx, max)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "grep failed: " + err.Error()}}, IsError: true}, nil
	}

	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("Found %d lines:\n\n", len(results)))
	for _, r := range results {
		rel, relErr := filepath.Rel(util.WorkspaceDir, r.File)
		if relErr != nil {
			rel = r.File
		}
		sep := ":"
		if r.Context {
			sep = "-:"
		}
		sb.WriteString(fmt.Sprintf("%s:%d%s %s\n", rel, r.Line, sep, r.Text))
	}

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

func fileFind(args map[string]any) (CallToolResult, error) {
	p, _ := args["path"].(string)
	if p == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "path is required"}}, IsError: true}, nil
	}

	abs, err := resolvePath(p)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: err.Error()}}, IsError: true}, nil
	}

	include, _ := args["include"].(string)
	max := resolveLimit(args, 200)

	var results []string
	total := 0
	err = filepath.WalkDir(abs, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			name := d.Name()
			if name == ".git" || name == ".svn" || name == ".hg" || strings.HasPrefix(name, ".") {
				return filepath.SkipDir
			}
			return nil
		}
		if !d.Type().IsRegular() {
			return nil
		}
		if include != "" && !matchGlob(d.Name(), include) {
			return nil
		}

		total++
		if max <= 0 || len(results) < max {
			rel, relErr := filepath.Rel(util.WorkspaceDir, path)
			if relErr != nil {
				rel = path
			}
			results = append(results, rel)
		}
		if max > 0 && total >= max {
			return filepath.SkipAll
		}
		return nil
	})

	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "find failed: " + err.Error()}}, IsError: true}, nil
	}

	var sb strings.Builder
	if max > 0 && max < total {
		sb.WriteString(fmt.Sprintf("Found %d files (showing first %d):\n\n", total, max))
	} else {
		sb.WriteString(fmt.Sprintf("Found %d files:\n\n", len(results)))
	}
	for _, r := range results {
		sb.WriteString(r + "\n")
	}
	if max > 0 && max < total {
		sb.WriteString(fmt.Sprintf("\n...output limited to %d of %d files. Use limit parameter to adjust.", max, total))
	}

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: sb.String()}}}, nil
}

func matchGlob(filename, pattern string) bool {
	patterns := expandGlobBrace(pattern)
	for _, p := range patterns {
		if matched, _ := filepath.Match(p, filename); matched {
			return true
		}
	}
	return false
}

func expandGlobBrace(pattern string) []string {
	i := strings.Index(pattern, "{")
	if i < 0 {
		return []string{pattern}
	}

	j := strings.Index(pattern[i:], "}")
	if j < 0 {
		return []string{pattern}
	}
	j += i

	prefix := pattern[:i]
	body := pattern[i+1 : j]
	suffix := pattern[j+1:]

	var result []string
	for opt := range strings.SplitSeq(body, ",") {
		result = append(result, expandGlobBrace(prefix+strings.TrimSpace(opt)+suffix)...)
	}
	return result
}

func fileStat(args map[string]any) (CallToolResult, error) {
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

	return CallToolResult{Content: []ContentItem{{Type: "text", Text: fmt.Sprintf(
		"Path: %s\nSize: %d\nIsDir: %v\nModTime: %s",
		p, info.Size(), info.IsDir(), info.ModTime().Format("2006-01-02 15:04:05"),
	)}}}, nil
}
