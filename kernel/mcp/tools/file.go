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
	"bufio"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
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
	if err := authorizePath(abs, rel); err != nil {
		return "", err
	}
	return abs, nil
}

// authorizePath 校验单个最终路径是否允许访问，display 仅用于错误信息：顶层调用传工作区相对路径，
// 递归遍历、目录拷贝和压缩包解压传最终路径本身。
func authorizePath(abs, display string) error {
	if !gulu.File.IsSubPath(util.WorkspaceDir, abs) {
		return fmt.Errorf("path escapes workspace: %s", display)
	}
	// 拒绝加密笔记本目录：MCP 文件工具不能读写加密 box 下的文件（防止密文泄漏或明文破坏加密格式）
	if boxID, encrypted := rejectEncryptedPath(abs); encrypted {
		return fmt.Errorf("path belongs to encrypted notebook [%s]: %s", boxID, display)
	}
	// 防止 symlink 逃逸工作区：解析符号链接后再次检查
	if resolved := util.ResolveLongestExistingParent(abs); resolved != abs && !gulu.File.IsSubPath(util.WorkspaceDir, resolved) {
		return fmt.Errorf("symlink escapes workspace: %s", display)
	}
	// 禁止访问敏感文件（conf/conf.json、data/snippets/conf.json、data/templates、data/.siyuan/publishAccess.json），
	// 与 HTTP 文件 API 共用同一黑名单（见 kernel/util/path_guard.go 的 IsForbiddenAbsPath）
	if util.IsForbiddenAbsPath(abs) {
		return fmt.Errorf("access to sensitive workspace file is forbidden: %s", display)
	}
	return nil
}

// authorizeFinalPath 对即将打开或创建的最终路径做授权。resolvePath 只覆盖调用方给出的路径，
// 容器路径合法不代表其后代合法：递归遍历、复制、解压、删除、重命名都必须对每一个后代路径再次调用本函数。
func authorizeFinalPath(abs string) error {
	return authorizePath(abs, abs)
}

// authorizeSubtree 校验路径及其全部后代，任一后代被拒绝即整体拒绝。删除和重命名是目录级操作，
// 只校验目录本身会让受保护的后代被删除或搬出黑名单范围（例如 file.delete("conf")）。
// 使用 Lstat：删除和重命名不会跟随符号链接，与 os.RemoveAll、os.Rename 的语义保持一致。
func authorizeSubtree(abs string) error {
	if err := authorizeFinalPath(abs); err != nil {
		return err
	}
	info, err := os.Lstat(abs)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if !info.IsDir() {
		return nil
	}
	entries, err := os.ReadDir(abs)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if err = authorizeSubtree(filepath.Join(abs, entry.Name())); err != nil {
			return err
		}
	}
	return nil
}

// authorizeCopyTree 预检整棵复制树：源与目标的每一个最终路径都必须通过授权，任一被拒绝即整体拒绝。
// 这样可以同时避免把受保护的后代复制到普通路径后绕过读取限制，以及被拒绝时的部分复制。
// 使用 Stat：复制会跟随符号链接，与 copyPath 的语义保持一致。
func authorizeCopyTree(src, dst string) error {
	if err := authorizeFinalPath(src); err != nil {
		return err
	}
	if err := authorizeFinalPath(dst); err != nil {
		return err
	}
	info, err := os.Stat(src)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return nil
	}
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if err = authorizeCopyTree(filepath.Join(src, entry.Name()), filepath.Join(dst, entry.Name())); err != nil {
			return err
		}
	}
	return nil
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
	// 受保护的后代不出现在列表中，避免经允许目录枚举出敏感文件
	visible := make([]os.DirEntry, 0, len(entries))
	for _, entry := range entries {
		if authorizeFinalPath(filepath.Join(dir, entry.Name())) != nil {
			continue
		}
		visible = append(visible, entry)
	}
	entries = visible

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
	// 删除目录会连带删除全部后代，必须逐个授权，避免 file.delete("conf") 抹掉 conf/conf.json 与 TLS 密钥
	if err = authorizeSubtree(abs); err != nil {
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
	// 重命名目录会连带搬移全部后代，必须逐个授权，避免把受保护文件搬到黑名单范围之外
	if err = authorizeSubtree(oldAbs); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: err.Error()}}, IsError: true}, nil
	}
	if err = authorizeSubtree(newAbs); err != nil {
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
	// 复制目录会连带复制全部后代，先整树预检，避免受保护的后代被复制到普通路径后可直接读取
	if err = authorizeCopyTree(srcAbs, dstAbs); err != nil {
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

	results, err := grepGuarded(abs, include, pattern, ctx, max)
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

// grepGuarded 在 Gulu grep 语义（跳过隐藏目录、include 过滤、上下文行、结果上限）之上，
// 对每个即将打开的文件做最终路径授权：被拒绝的后代静默跳过，避免经允许目录递归读出敏感文件内容。
func grepGuarded(root, include, pattern string, context, maxResults int) ([]*gulu.GrepResult, error) {
	re, err := regexp.Compile(pattern)
	if err != nil {
		return nil, err
	}
	if maxResults <= 0 {
		maxResults = 64
	}

	var results []*gulu.GrepResult
	info, err := os.Stat(root)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		if err = authorizeFinalPath(root); err != nil {
			return nil, err
		}
		grepGuardedFile(root, re, context, &results, maxResults)
		return results, nil
	}

	err = filepath.WalkDir(root, func(path string, d os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return nil
		}
		if d.IsDir() {
			if skipTraversalDir(d.Name()) {
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
		if authorizeFinalPath(path) != nil {
			// 敏感、加密或逃逸工作区的后代直接跳过，不中断整次搜索也不返回其内容
			return nil
		}
		grepGuardedFile(path, re, context, &results, maxResults)
		return nil
	})
	if err != nil {
		return results, err
	}
	if len(results) > maxResults {
		results = results[:maxResults]
	}
	return results, nil
}

// grepGuardedFile 逐行匹配单个文件并收集上下文行，语义与 gulu 的 grep 保持一致。
func grepGuardedFile(path string, re *regexp.Regexp, context int, results *[]*gulu.GrepResult, maxResults int) {
	if len(*results) >= maxResults {
		return
	}

	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()

	type bufEntry struct {
		lineNum int
		text    string
	}

	beforeBuf := make([]bufEntry, 0, context+1)
	afterRemaining := 0

	flushBeforeBuf := func() {
		for _, e := range beforeBuf {
			if len(*results) >= maxResults {
				return
			}
			*results = append(*results, &gulu.GrepResult{File: path, Line: e.lineNum, Text: e.text, Context: true})
		}
		beforeBuf = beforeBuf[:0]
	}

	emit := func(lineNum int, text string, isContext bool) {
		if len(*results) >= maxResults {
			return
		}
		*results = append(*results, &gulu.GrepResult{File: path, Line: lineNum, Text: text, Context: isContext})
	}

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 1024*1024), 1024*1024)
	lineNum := 0
	for scanner.Scan() {
		if len(*results) >= maxResults {
			return
		}
		lineNum++
		line := scanner.Text()

		if re.MatchString(line) {
			flushBeforeBuf()
			emit(lineNum, line, false)
			afterRemaining = context
		} else if afterRemaining > 0 {
			emit(lineNum, line, true)
			afterRemaining--
		} else {
			beforeBuf = append(beforeBuf, bufEntry{lineNum, line})
			if len(beforeBuf) > context {
				copy(beforeBuf, beforeBuf[1:])
				beforeBuf = beforeBuf[:len(beforeBuf)-1]
			}
		}
	}
}

// skipTraversalDir 判断遍历时是否跳过该目录，与 Gulu 的隐藏目录跳过规则保持一致。
func skipTraversalDir(name string) bool {
	return name == ".git" || name == ".svn" || name == ".hg" || strings.HasPrefix(name, ".")
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
			if skipTraversalDir(d.Name()) {
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
		if authorizeFinalPath(path) != nil {
			// 受保护的后代不出现在结果中，避免经允许目录枚举出敏感文件
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
