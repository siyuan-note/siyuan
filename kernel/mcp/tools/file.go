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
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/siyuan-note/siyuan/kernel/model"
	"github.com/siyuan-note/siyuan/kernel/util"

	"github.com/88250/gulu"
)

var FileTool = &Tool{
	Name:        "file",
	Description: "Workspace file operations (paths relative to workspace; debugging/log reading and approved plugin development only — never use for workspace data). Actions: list, read, write, edit, delete, rename, copy, grep, find, stat. read defaults to legacy plain text/200 lines; withMetadata=true returns bounded JSON with whole-file SHA256, UTF-8 byte range, truncation and nextOffsetByte. Continue with byteOffset and the same expectedRevision; only startByte=0/endByte=totalBytes/truncated=false is a complete read. edit requires expectedRevision and unique nonempty oldText/newText anchors against the original file; conflicts reject the entire edit. write may opt into ifAbsent=true or expectedRevision for safe conditional writes (including empty data); parent directories must exist. Safe text operations reject links, binary/non-UTF-8 and files above 8 MiB. Approved managed plugin sources always require safe conditions and trusted workflow context; copy/directory mutation is unavailable there.",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"action":           {Type: "string", Description: "Operation", Enum: []string{"list", "read", "write", "edit", "delete", "rename", "copy", "grep", "find", "stat"}},
			"path":             {Type: "string", Description: "Relative path within workspace (for list, read, write, edit, delete, grep, find, stat)"},
			"data":             {Type: "string", Description: "File content (for write)"},
			"offset":           {Type: "number", Description: "Line number to start reading from (for read, 1-based). Negative means N lines from the end. Default: 0 (read from beginning)."},
			"limit":            {Type: "number", Description: "Maximum lines/files/entries to return (for read, list, find, grep). Default: 200 lines when offset and limit are both 0 for read, 200 for list/find/grep. Use 0 or negative for unlimited."},
			"old":              {Type: "string", Description: "Source path (for rename)"},
			"new":              {Type: "string", Description: "Destination path (for rename)"},
			"src":              {Type: "string", Description: "Source path (for copy)"},
			"dst":              {Type: "string", Description: "Destination path (for copy)"},
			"pattern":          {Type: "string", Description: "Regex pattern to search for (for grep)"},
			"include":          {Type: "string", Description: "File glob pattern to filter files (for grep, find; e.g. \"*.go\", \"*.{ts,tsx}\")"},
			"context":          {Type: "number", Description: "Number of context lines before and after each match (for grep, default 0)"},
			"withMetadata":     {Type: "boolean", Description: "Opt-in bounded JSON read with complete file revision and exact UTF-8 byte range"},
			"byteOffset":       {Type: "integer", Description: "UTF-8 byte boundary for a metadata read; cannot combine with offset"},
			"lineLimit":        {Type: "integer", Description: "Optional metadata read line limit; default 200, nonpositive for unlimited subject to JSON budget"},
			"expectedRevision": {Type: "string", Description: "Raw whole-file SHA256 from metadata read; required for edit and managed replace/delete/rename"},
			"ifAbsent":         {Type: "boolean", Description: "Conditional write: create only if no target exists; mutually exclusive with expectedRevision"},
			"dryRun":           {Type: "boolean", Description: "Preview an edit without applying it; still requires normal write permissions"},
			"edits": {Type: "array", Description: "1 to 128 exact replacements against the original file", Items: &Property{Type: "object", Properties: map[string]Property{
				"oldText": {Type: "string", Description: "Nonempty anchor occurring exactly once"},
				"newText": {Type: "string", Description: "Replacement text; may be empty"},
			}, Required: []string{"oldText", "newText"}}},
		},
		Required: []string{"action"},
	},
	EffectScope: EffectScopeLocal,
	ActionEffects: map[string]ToolEffects{
		"list": {LocalRead: true}, "read": {LocalRead: true}, "grep": {LocalRead: true}, "find": {LocalRead: true}, "stat": {LocalRead: true},
		"write": {LocalRead: true, LocalWrite: true}, "edit": {LocalRead: true, LocalWrite: true},
		"delete": {LocalRead: true, LocalWrite: true}, "rename": {LocalRead: true, LocalWrite: true}, "copy": {LocalRead: true, LocalWrite: true},
	},
	Handler:        fileHandler,
	ContextHandler: fileContextHandler,
}

func init() {
	register(FileTool)
}

func fileHandler(args map[string]any) (CallToolResult, error) {
	return fileContextHandler(context.Background(), args)
}

func fileContextHandler(ctx context.Context, args map[string]any) (CallToolResult, error) {
	if err := ctx.Err(); err != nil {
		return fileSafeError(err)
	}
	action, _ := args["action"].(string)
	if dryRun, _ := args["dryRun"].(bool); dryRun && action != "edit" {
		return fileSafeError(fileInvalid("invalid_argument", "dryRun is supported only for edit"))
	}
	for _, key := range []string{"path", "old", "new", "src", "dst"} {
		if p, ok := args[key].(string); ok && p != "" && util.IsPluginProjectPath(filepath.Join(util.WorkspaceDir, filepath.FromSlash(p))) {
			return fileManaged(ctx, args)
		}
	}
	switch action {
	case "list":
		return fileList(args)
	case "read":
		return fileRead(args)
	case "write":
		if fileConditionalWrite(args) {
			return fileMutate(ctx, args)
		}
		return fileWrite(args)
	case "edit":
		return fileMutate(ctx, args)
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
		Content: []ContentItem{{Type: "text", Text: "unknown action '" + action + "', expected one of: [list, read, write, edit, delete, rename, copy, grep, find, stat]"}},
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
	if util.IsPluginDevelopmentRawPathForbidden(abs, true) {
		return fmt.Errorf("raw modification of managed plugin or agent state paths is forbidden: %s", abs)
	}
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
	if util.IsPluginDevelopmentRawPathForbidden(src, true) || util.IsPluginDevelopmentRawPathForbidden(dst, true) {
		return fmt.Errorf("raw copy of managed plugin or agent state paths is forbidden")
	}
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
	if metadata, _ := args["withMetadata"].(bool); metadata {
		return fileReadMetadata(args)
	}
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

	return fileLegacyReadContent(args, data)
}

func fileLegacyReadContent(args map[string]any, data []byte) (CallToolResult, error) {
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
	if fileConditionalWrite(args) {
		return fileMutate(context.Background(), args)
	}
	p, _ := args["path"].(string)
	dataStr, _ := args["data"].(string)
	if p == "" || dataStr == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "path and data are required"}}, IsError: true}, nil
	}
	abs, err := resolvePath(p)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: err.Error()}}, IsError: true}, nil
	}
	if util.IsPluginDevelopmentRawWriteForbidden(abs) {
		return fileSafeError(fileInvalid("invalid_path", "raw write to a managed plugin or delivery path is forbidden"))
	}
	if err := os.MkdirAll(filepath.Dir(abs), 0755); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "mkdir failed: " + err.Error()}}, IsError: true}, nil
	}
	if err := os.WriteFile(abs, []byte(dataStr), 0644); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "write file failed: " + err.Error()}}, IsError: true}, nil
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: "file written: " + p}}}, nil
}

const fileJSONBudget = 32000

type fileReadPage struct {
	Path           string `json:"path"`
	Revision       string `json:"revision"`
	TotalBytes     int    `json:"totalBytes"`
	TotalLines     int    `json:"totalLines"`
	StartByte      int    `json:"startByte"`
	EndByte        int    `json:"endByte"`
	Content        string `json:"content"`
	Truncated      bool   `json:"truncated"`
	NextOffsetByte *int   `json:"nextOffsetByte"`
	Encoding       string `json:"encoding"`
	Newline        string `json:"newline"`
}

func fileSafeError(err error) (CallToolResult, error) {
	var failure *util.TextFileError
	if !errors.As(err, &failure) {
		failure = &util.TextFileError{Code: "write_failed", Message: err.Error()}
		for _, code := range []string{"revision_conflict", "invalid_path", "unsupported_encoding", "too_large", "backup_failed", "result_unknown"} {
			if strings.HasPrefix(err.Error(), code+":") {
				failure.Code = code
				failure.Message = strings.TrimSpace(strings.TrimPrefix(err.Error(), code+":"))
				break
			}
		}
		if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			failure.Code = "cancelled"
		} else if errors.Is(err, os.ErrNotExist) {
			failure.Code = "invalid_path"
		}
	}
	// 系统错误可能包含输入路径；复制后限制错误文本，避免共享输出截断器破坏错误 JSON 或修改调用方对象。
	copy := *failure
	failure = &copy
	if len(failure.Message) > 4000 {
		end := 4000
		for end > 0 && !utf8.RuneStart(failure.Message[end]) {
			end--
		}
		failure.Message = failure.Message[:end] + "..."
	}
	encoded, _ := json.Marshal(failure)
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: string(encoded)}}, StructuredContent: failure, StructuredContentSet: true, IsError: true, ExecutionUnknown: failure.Code == "result_unknown"}, nil
}

func fileInvalid(code, message string) error {
	return &util.TextFileError{Code: code, Message: message}
}

func fileJSONResult(value any) (CallToolResult, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return fileSafeError(err)
	}
	if len(encoded) >= fileJSONBudget {
		return fileSafeError(fileInvalid("too_large", "serialized result exceeds safe response budget"))
	}
	return CallToolResult{Content: []ContentItem{{Type: "text", Text: string(encoded)}}, StructuredContent: value, StructuredContentSet: true}, nil
}

func fileIntegerArg(args map[string]any, key string, fallback int) (int, error) {
	value, exists := args[key]
	if !exists {
		return fallback, nil
	}
	var number float64
	switch n := value.(type) {
	case float64:
		number = n
	case int:
		return n, nil
	case json.Number:
		var err error
		number, err = n.Float64()
		if err != nil {
			return 0, fileInvalid("invalid_argument", key+" must be an integer")
		}
	default:
		return 0, fileInvalid("invalid_argument", key+" must be an integer")
	}
	if math.IsNaN(number) || math.IsInf(number, 0) || math.Trunc(number) != number || number > MaxSafeFileInteger || number < -MaxSafeFileInteger {
		return 0, fileInvalid("invalid_argument", key+" must be a bounded integer")
	}
	return int(number), nil
}

const MaxSafeFileInteger = 1 << 30

func fileReadMetadata(args map[string]any) (CallToolResult, error) {
	p, _ := args["path"].(string)
	if err := util.ValidateTextFilePath(p); err != nil {
		return fileSafeError(err)
	}
	if _, err := resolvePath(p); err != nil {
		return fileSafeError(fileInvalid("invalid_path", err.Error()))
	}
	root, err := os.OpenRoot(util.WorkspaceDir)
	if err != nil {
		return fileSafeError(err)
	}
	defer root.Close()
	content, err := util.ReadTextFile(root, p)
	if err != nil {
		return fileSafeError(err)
	}
	return fileMetadataContent(args, content)
}

func fileMetadataContent(args map[string]any, content string) (CallToolResult, error) {
	if _, exists := args["offset"]; exists {
		return fileSafeError(fileInvalid("invalid_argument", "metadata reads cannot use legacy offset; use byteOffset"))
	}
	revision := util.TextFileRevision([]byte(content))
	if expected, exists := args["expectedRevision"]; exists && expected != revision {
		return fileSafeError(fileInvalid("revision_conflict", "file changed; restart the read with its current revision"))
	}
	offset, err := fileIntegerArg(args, "byteOffset", 0)
	if err != nil {
		return fileSafeError(err)
	}
	if offset < 0 || offset > len(content) || offset < len(content) && !utf8.RuneStart(content[offset]) {
		return fileSafeError(fileInvalid("invalid_argument", "byteOffset must be a UTF-8 boundary within the file"))
	}
	limit, err := fileIntegerArg(args, "limit", 200)
	if err == nil {
		limit, err = fileIntegerArg(args, "lineLimit", limit)
	}
	if err != nil {
		return fileSafeError(err)
	}
	p, _ := args["path"].(string)
	page := fileReadPage{Path: p, Revision: revision, TotalBytes: len(content), TotalLines: strings.Count(content, "\n") + 1, StartByte: offset, Encoding: "UTF-8", Newline: fileNewline(content)}
	end := len(content)
	if limit > 0 {
		cursor := offset
		for lines := 0; lines < limit; lines++ {
			index := strings.IndexByte(content[cursor:], '\n')
			if index < 0 {
				cursor = len(content)
				break
			}
			cursor += index + 1
		}
		end = cursor
	}
	setEnd := func(value int) {
		page.EndByte = value
		page.Content = content[offset:value]
		page.Truncated = offset != 0 || value != len(content)
		page.NextOffsetByte = nil
		if value < len(content) {
			next := value
			page.NextOffsetByte = &next
		}
	}
	// 按转义后的实际 JSON 计算预算；以字节长度保守约束共享截断器的 40,000 字符上限。
	low, high := offset, min(end, offset+fileJSONBudget)
	best := offset
	for low <= high {
		candidate := low + (high-low)/2
		for candidate > offset && candidate < len(content) && !utf8.RuneStart(content[candidate]) {
			candidate--
		}
		setEnd(candidate)
		encoded, _ := json.Marshal(page)
		if len(encoded) < fileJSONBudget {
			best = candidate
			low = candidate + 1
			for low < len(content) && !utf8.RuneStart(content[low]) {
				low++
			}
		} else {
			high = candidate - 1
		}
	}
	setEnd(best)
	if best == offset && offset < len(content) {
		return fileSafeError(fileInvalid("too_large", "metadata leaves no room for content"))
	}
	return fileJSONResult(page)
}

func fileNewline(content string) string {
	crlf := strings.Count(content, "\r\n")
	lf := strings.Count(content, "\n") - crlf
	cr := strings.Count(content, "\r") - crlf
	kinds, label := 0, "none"
	for name, count := range map[string]int{"CRLF": crlf, "LF": lf, "CR": cr} {
		if count > 0 {
			kinds++
			label = name
		}
	}
	if kinds > 1 {
		return "mixed"
	}
	return label
}

func fileConditionalWrite(args map[string]any) bool {
	_, revision := args["expectedRevision"]
	_, absent := args["ifAbsent"]
	return revision || absent
}

func fileMutationRequest(args map[string]any) (util.TextFileMutation, error) {
	request := util.TextFileMutation{}
	request.ExpectedRevision, _ = args["expectedRevision"].(string)
	request.IfAbsent, _ = args["ifAbsent"].(bool)
	request.DryRun, _ = args["dryRun"].(bool)
	action, _ := args["action"].(string)
	if action == "edit" {
		raw, ok := args["edits"].([]any)
		if !ok || len(raw) == 0 || len(raw) > 128 {
			return request, fileInvalid("invalid_edit", "edits must contain 1 to 128 replacements")
		}
		request.Edits = make([]util.TextEdit, len(raw))
		for i, item := range raw {
			edit, ok := item.(map[string]any)
			if !ok {
				return request, fileInvalid("invalid_edit", "each edit must be an oldText/newText object")
			}
			oldText, oldOK := edit["oldText"].(string)
			newText, newOK := edit["newText"].(string)
			if !oldOK || !newOK || oldText == "" {
				return request, fileInvalid("invalid_edit", "oldText must be nonempty and newText must be present")
			}
			request.Edits[i] = util.TextEdit{OldText: oldText, NewText: newText}
		}
	} else if action == "write" || action == "" {
		var ok bool
		request.Content, ok = args["data"].(string)
		if !ok {
			return request, fileInvalid("invalid_argument", "data must be present and a string (empty is allowed)")
		}
	}
	return request, nil
}

func fileMutationResult(result util.TextFileMutationResult) (CallToolResult, error) {
	for {
		encoded, _ := json.Marshal(result)
		if len(encoded) < fileJSONBudget {
			return fileJSONResult(result)
		}
		if len(result.Diff) == 0 {
			return fileSafeError(fileInvalid("too_large", "edit result exceeds response budget"))
		}
		end := len(result.Diff) / 2
		for end > 0 && !utf8.RuneStart(result.Diff[end]) {
			end--
		}
		result.Diff = result.Diff[:end]
		result.DiffTruncated = true
	}
}

func fileMutate(ctx context.Context, args map[string]any) (CallToolResult, error) {
	p, _ := args["path"].(string)
	if err := util.ValidateTextFilePath(p); err != nil {
		return fileSafeError(err)
	}
	abs, err := resolvePath(p)
	if err != nil {
		return fileSafeError(fileInvalid("invalid_path", err.Error()))
	}
	if util.IsPluginDevelopmentRawWriteForbidden(abs) {
		return fileSafeError(fileInvalid("invalid_path", "raw write to a managed plugin or delivery path is forbidden"))
	}
	request, err := fileMutationRequest(args)
	if err != nil {
		return fileSafeError(err)
	}
	root, err := os.OpenRoot(util.WorkspaceDir)
	if err != nil {
		return fileSafeError(err)
	}
	defer root.Close()
	request.Validate = func() error {
		abs, err := resolvePath(p)
		if err != nil {
			return err
		}
		if util.IsPluginDevelopmentRawWriteForbidden(abs) {
			return fileInvalid("invalid_path", "raw write to a managed plugin or delivery path is forbidden")
		}
		return nil
	}
	result, err := util.MutateTextFile(ctx, root, p, request)
	if err != nil {
		return fileSafeError(err)
	}
	return fileMutationResult(result)
}

func fileManaged(ctx context.Context, args map[string]any) (result CallToolResult, resultErr error) {
	action, _ := args["action"].(string)
	if action != "read" && action != "write" && action != "edit" && action != "delete" && action != "rename" {
		return fileSafeError(fileInvalid("invalid_path", "managed sources support only read, conditional write/edit and file-only delete/rename"))
	}
	write := action != "read"
	err := util.WithPluginProjectSource(ctx, write, func(grant *util.PluginDevelopmentGrant, root *os.Root) error {
		key := "path"
		if action == "rename" {
			key = "old"
		}
		p, _ := args[key].(string)
		rel, err := fileManagedRelative(grant, p)
		if err != nil {
			return err
		}
		if action == "read" {
			content, err := util.ReadTextFile(root, rel)
			if err != nil {
				return err
			}
			if metadata, _ := args["withMetadata"].(bool); metadata {
				result, resultErr = fileMetadataContent(args, content)
			} else {
				result, resultErr = fileLegacyReadContent(args, []byte(content))
			}
			return resultErr
		}
		request, err := fileMutationRequest(args)
		if err != nil {
			return err
		}
		request.Validate = func() error {
			current, err := util.RequirePluginDevelopment(ctx, "write")
			if err != nil {
				return err
			}
			if current.TaskID != grant.TaskID || current.SessionID != grant.SessionID || current.PlanHash != grant.PlanHash || current.PlanVersion != grant.PlanVersion || current.SkillDigest != grant.SkillDigest || current.SourceRoot != grant.SourceRoot {
				return fileInvalid("revision_conflict", "approved plugin plan changed during operation")
			}
			_, err = fileManagedRelative(current, p)
			if err == nil && action == "rename" {
				newPath, _ := args["new"].(string)
				_, err = fileManagedRelative(current, newPath)
			}
			return err
		}
		target := ""
		if action == "rename" {
			newPath, _ := args["new"].(string)
			target, err = fileManagedRelative(grant, newPath)
			if err != nil {
				return err
			}
		}
		request.BeforeCommit = func(oldRevision, newRevision string, temporaryPaths ...string) error {
			if oldRevision == "" {
				oldRevision = "missing"
			}
			changes := map[string]util.PluginProjectMutation{rel: {OldRevision: oldRevision, NewRevision: newRevision}}
			if action == "rename" {
				changes[rel] = util.PluginProjectMutation{OldRevision: oldRevision, NewRevision: "missing"}
				changes[target] = util.PluginProjectMutation{OldRevision: "missing", NewRevision: newRevision}
			}
			return util.BeginPluginProjectMutations(grant, changes, temporaryPaths...)
		}
		request.AfterCommit = func() error {
			paths := []string{rel}
			if target != "" {
				paths = append(paths, target)
			}
			return util.FinishPluginProjectMutations(grant, paths)
		}
		var mutation util.TextFileMutationResult
		if action == "delete" || action == "rename" {
			mutation, err = util.MutateTextFileName(ctx, root, rel, target, request)
		} else {
			mutation, err = util.MutateTextFile(ctx, root, rel, request)
		}
		if err != nil {
			return err
		}
		result, resultErr = fileMutationResult(mutation)
		return resultErr
	})
	if err != nil {
		return fileSafeError(err)
	}
	return result, resultErr
}

func fileManagedRelative(grant *util.PluginDevelopmentGrant, p string) (string, error) {
	if err := util.ValidateTextFilePath(p); err != nil {
		return "", err
	}
	abs := filepath.Join(util.WorkspaceDir, filepath.FromSlash(p))
	if grant.SourceRoot == "" || filepath.Clean(grant.SourceRoot) != filepath.Join(util.PluginProjectRoot(grant.TaskID), "source") {
		return "", fileInvalid("invalid_path", "invalid host-owned source root")
	}
	rel, err := filepath.Rel(grant.SourceRoot, abs)
	if err != nil {
		return "", fileInvalid("invalid_path", "path is outside approved source")
	}
	rel = filepath.ToSlash(rel)
	if err = util.ValidateTextFilePath(rel); err != nil {
		return "", err
	}
	for _, allowed := range grant.AllowFiles {
		if rel == allowed {
			return rel, nil
		}
	}
	return "", fileInvalid("invalid_path", "file is outside the approved project allowlist")
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
