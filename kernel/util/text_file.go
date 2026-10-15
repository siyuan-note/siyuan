// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
// Licensed under the GNU Affero General Public License, version 3 or later.

package util

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"sort"
	"strings"
	"unicode/utf8"
)

const MaxTextFileBytes = 8 * 1024 * 1024

// TextFileError 说明目标是否可能已变化；result_unknown 必须先读取目标核实，不能直接重试修改。
type TextFileError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Written bool   `json:"written"`
}

func (e *TextFileError) Error() string { return e.Code + ": " + e.Message }

func textFileError(code, message string) error {
	return &TextFileError{Code: code, Message: message}
}

func textFileBeforeCommitError(err error) error {
	var failure *TextFileError
	if errors.As(err, &failure) {
		return failure
	}
	for _, code := range []string{"revision_conflict", "invalid_path", "unsupported_encoding", "too_large", "backup_failed", "result_unknown"} {
		if strings.HasPrefix(err.Error(), code+":") {
			return textFileError(code, strings.TrimSpace(strings.TrimPrefix(err.Error(), code+":")))
		}
	}
	return textFileError("backup_failed", err.Error())
}

func TextFileRevision(content []byte) string { return fmt.Sprintf("%x", sha256.Sum256(content)) }

// CheckSingleLinkRegularFile 在 Windows 上从文件句柄读取链接数，因为 FileInfo.Sys 不提供该字段。
// 无法确定链接数时拒绝操作。
func CheckSingleLinkRegularFile(file *os.File) error {
	info, err := file.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return textFileError("invalid_path", "target must be a regular file")
	}
	return textFileSingleLink(file, info)
}

// OpenFileNoFollow 不跟随最后一个路径分量的链接；Unix 使用非阻塞打开，避免路径被换成 FIFO 后挂起。
// 调用方必须验证全部父目录，并在读取前检查返回句柄的类型、文件身份及链接数。
func OpenFileNoFollow(root *os.Root, name string) (*os.File, error) {
	return openTextFileRead(root, name)
}

// ValidateTextFilePath 拒绝非规范路径，避免将目录穿越、Windows 别名或其他分隔符静默转换为目标路径。
func ValidateTextFilePath(p string) error {
	if p == "." || validateManagedSkillPath(p) != nil {
		return textFileError("invalid_path", "expected a canonical relative file path")
	}
	return nil
}

func ValidateTextFileContent(content string) error {
	if err := validateManagedSkillSource(content); err != nil {
		if errors.Is(err, ErrSkillTooLarge) {
			return textFileError("too_large", "text files must be at most 8 MiB")
		}
		return textFileError("unsupported_encoding", "only UTF-8 text without binary control characters is supported")
	}
	return nil
}

// openTextFileParent 逐层固定已有目录的句柄，拒绝路径中的链接和特殊文件；调用方负责关闭返回值。
func openTextFileParent(root *os.Root, p string) (*os.Root, string, error) {
	if err := ValidateTextFilePath(p); err != nil {
		return nil, "", err
	}
	current, err := root.OpenRoot(".")
	if err != nil {
		return nil, "", err
	}
	parts := strings.Split(p, "/")
	for _, part := range parts[:len(parts)-1] {
		info, statErr := current.Lstat(part)
		if statErr != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			current.Close()
			return nil, "", textFileError("invalid_path", "parent must be an existing regular directory")
		}
		next, openErr := current.OpenRoot(part)
		current.Close()
		if openErr != nil {
			return nil, "", openErr
		}
		opened, statErr := next.Stat(".")
		if statErr != nil || !os.SameFile(info, opened) {
			next.Close()
			return nil, "", textFileError("invalid_path", "parent changed while opening")
		}
		current = next
	}
	return current, parts[len(parts)-1], nil
}

func readTextFileAt(parent *os.Root, name string) (string, os.FileInfo, error) {
	return readRegularFileAt(parent, name, true)
}

func readRegularFileAt(parent *os.Root, name string, textOnly bool) (string, os.FileInfo, error) {
	info, err := parent.Lstat(name)
	if err != nil {
		return "", nil, err
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
		return "", nil, textFileError("invalid_path", "target must be a regular unlinked file")
	}
	file, err := openTextFileRead(parent, name)
	if err != nil {
		return "", nil, err
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil {
		return "", nil, err
	}
	if !opened.Mode().IsRegular() || !os.SameFile(info, opened) {
		return "", nil, textFileError("invalid_path", "target changed while opening")
	}
	if err = textFileSingleLink(file, opened); err != nil {
		return "", nil, err
	}
	limit := int64(MaxTextFileBytes)
	if !textOnly {
		limit = PluginProjectMaxFileBytes
	}
	if opened.Size() > limit {
		return "", nil, textFileError("too_large", fmt.Sprintf("file must be at most %d bytes", limit))
	}
	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return "", nil, err
	}
	content := string(data)
	if int64(len(content)) > limit {
		return "", nil, textFileError("too_large", fmt.Sprintf("file must be at most %d bytes", limit))
	}
	if textOnly {
		if err = ValidateTextFileContent(content); err != nil {
			return "", nil, err
		}
	}
	return content, opened, nil
}

func ReadTextFile(root *os.Root, p string) (string, error) {
	parent, name, err := openTextFileParent(root, p)
	if err != nil {
		return "", err
	}
	defer parent.Close()
	content, _, err := readTextFileAt(parent, name)
	return content, err
}

type TextEdit struct {
	OldText string `json:"oldText"`
	NewText string `json:"newText"`
}

type TextEditRange struct {
	Index     int `json:"index"`
	StartByte int `json:"startByte"`
	EndByte   int `json:"endByte"`
}

// ApplyTextEdits 在同一份原始字节内容中定位全部锚点；重叠出现也视为不唯一，例如「aaa」中的「aa」。
func ApplyTextEdits(original string, edits []TextEdit) (string, []TextEditRange, error) {
	if len(edits) == 0 || len(edits) > 128 {
		return "", nil, textFileError("invalid_edit", "edits must contain 1 to 128 replacements")
	}
	ranges := make([]TextEditRange, 0, len(edits))
	for i, edit := range edits {
		if edit.OldText == "" {
			return "", nil, textFileError("invalid_edit", "oldText must not be empty")
		}
		if !utf8.ValidString(edit.OldText) || !utf8.ValidString(edit.NewText) {
			return "", nil, textFileError("unsupported_encoding", "edits must contain UTF-8 text")
		}
		start := strings.Index(original, edit.OldText)
		if start < 0 {
			return "", nil, textFileError("no_match", fmt.Sprintf("edit %d anchor was not found", i))
		}
		if strings.Contains(original[start+1:], edit.OldText) {
			return "", nil, textFileError("ambiguous_match", fmt.Sprintf("edit %d anchor is not unique", i))
		}
		ranges = append(ranges, TextEditRange{Index: i, StartByte: start, EndByte: start + len(edit.OldText)})
	}
	sort.Slice(ranges, func(i, j int) bool { return ranges[i].StartByte < ranges[j].StartByte })
	for i := 1; i < len(ranges); i++ {
		if ranges[i].StartByte < ranges[i-1].EndByte {
			return "", nil, textFileError("overlapping_edit", "edit ranges overlap in the original file")
		}
	}
	size := len(original)
	for _, edit := range edits {
		size += len(edit.NewText) - len(edit.OldText)
	}
	if size > MaxTextFileBytes {
		return "", nil, textFileError("too_large", "edited text must be at most 8 MiB")
	}
	var out strings.Builder
	out.Grow(size)
	previous := 0
	for _, r := range ranges {
		out.WriteString(original[previous:r.StartByte])
		out.WriteString(edits[r.Index].NewText)
		previous = r.EndByte
	}
	out.WriteString(original[previous:])
	content := out.String()
	if err := ValidateTextFileContent(content); err != nil {
		return "", nil, err
	}
	return content, ranges, nil
}

type TextFileMutation struct {
	Content          string
	Edits            []TextEdit // nil 表示条件写入，非 nil 表示增量编辑
	ExpectedRevision string
	IfAbsent         bool
	DryRun           bool
	// Validate 在提交前重新检查宿主持有的当前授权。
	Validate     func() error
	BeforeCommit func(oldRevision, newRevision string, temporaryPaths ...string) error
	AfterCommit  func() error
}

type TextFileMutationResult struct {
	OldRevision   string          `json:"oldRevision"`
	NewRevision   string          `json:"newRevision"`
	Ranges        []TextEditRange `json:"ranges,omitempty"`
	DryRun        bool            `json:"dryRun"`
	Diff          string          `json:"diff,omitempty"`
	DiffTruncated bool            `json:"diffTruncated"`
}

// 串行化遵守本协议的操作，包括竞争新建；这不提供针对任意外部编辑器的操作系统级比较交换保证。
var textFileMutationGate = make(chan struct{}, 1)

func lockTextFileMutation(ctx context.Context) (func(), error) {
	select {
	case textFileMutationGate <- struct{}{}:
		if err := ctx.Err(); err != nil {
			<-textFileMutationGate
			return nil, err
		}
		return func() { <-textFileMutationGate }, nil
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

type textFileIO struct {
	write  func(*os.File, string) (int, error)
	sync   func(*os.File) error
	close  func(*os.File) error
	rename func(*os.Root, string, string) error
	link   func(*os.Root, string, string) error
	remove func(*os.Root, string) error
}

func defaultTextFileIO() textFileIO {
	return textFileIO{write: (*os.File).WriteString, sync: (*os.File).Sync, close: (*os.File).Close, rename: (*os.Root).Rename, link: (*os.Root).Link, remove: (*os.Root).Remove}
}

func MutateTextFile(ctx context.Context, root *os.Root, p string, request TextFileMutation) (TextFileMutationResult, error) {
	return mutateTextFile(ctx, root, p, request, defaultTextFileIO())
}

// 每次调用独立传入文件操作，使测试能确定性模拟磁盘故障，无需修改全局钩子或耗尽真实磁盘。
func mutateTextFile(ctx context.Context, root *os.Root, p string, request TextFileMutation, operations textFileIO) (ret TextFileMutationResult, err error) {
	unlock, err := lockTextFileMutation(ctx)
	if err != nil {
		return ret, err
	}
	defer unlock()
	if request.IfAbsent == (request.ExpectedRevision != "") || (request.IfAbsent && request.Edits != nil) {
		return ret, textFileError("revision_conflict", "provide exactly one of ifAbsent=true or expectedRevision; edits require expectedRevision")
	}
	parent, name, err := openTextFileParent(root, p)
	if err != nil {
		return ret, err
	}
	defer parent.Close()
	var original string
	mode := os.FileMode(0644)
	var originalInfo os.FileInfo
	if request.IfAbsent {
		if _, statErr := parent.Lstat(name); !errors.Is(statErr, os.ErrNotExist) {
			return ret, textFileError("revision_conflict", "new file must not exist")
		}
	} else {
		original, originalInfo, err = readTextFileAt(parent, name)
		if err != nil {
			return ret, err
		}
		ret.OldRevision = TextFileRevision([]byte(original))
		if ret.OldRevision != request.ExpectedRevision {
			return ret, textFileError("revision_conflict", "file changed; read it again before writing")
		}
		mode = originalInfo.Mode().Perm()
	}
	content := request.Content
	if request.Edits != nil {
		content, ret.Ranges, err = ApplyTextEdits(original, request.Edits)
		if err != nil {
			return ret, err
		}
		ret.Diff, ret.DiffTruncated = textEditDiff(request.Edits, ret.Ranges)
	}
	if err = ValidateTextFileContent(content); err != nil {
		return ret, err
	}
	ret.NewRevision = TextFileRevision([]byte(content))
	ret.DryRun = request.DryRun
	if err = ctx.Err(); err != nil {
		return ret, err
	}
	if request.Validate != nil {
		if err = request.Validate(); err != nil {
			return ret, err
		}
	}
	if request.DryRun {
		return ret, nil
	}
	var random [16]byte
	if _, err = rand.Read(random[:]); err != nil {
		return ret, err
	}
	temporary := fmt.Sprintf(".text-file-%x", random)
	// 创建前记录宿主生成的精确临时路径，恢复时验证其预期摘要，不按文件名前缀宽泛忽略文件。
	if request.BeforeCommit != nil {
		if err = request.BeforeCommit(ret.OldRevision, ret.NewRevision, path.Join(path.Dir(p), temporary)); err != nil {
			return ret, textFileBeforeCommitError(err)
		}
	}
	file, err := parent.OpenFile(temporary, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return ret, textFileError("write_failed", err.Error())
	}
	defer parent.Remove(temporary)
	if err = file.Chmod(mode); err == nil {
		var written int
		written, err = operations.write(file, content)
		if err == nil && written != len(content) {
			err = io.ErrShortWrite
		}
	}
	if err == nil {
		err = operations.sync(file)
	}
	closeErr := operations.close(file)
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return ret, textFileError("write_failed", err.Error())
	}
	// 固定父目录句柄，防止中间目录被替换后改变写入目标；同时拒绝父目录在打开后被移动的情况。
	if err = sameTextFileParent(root, p, parent); err != nil {
		return ret, err
	}
	if err = checkTextFileRevision(parent, name, request.IfAbsent, request.ExpectedRevision, originalInfo); err != nil {
		return ret, err
	}
	if err = ctx.Err(); err != nil {
		return ret, err
	}
	if request.Validate != nil {
		if err = request.Validate(); err != nil {
			return ret, err
		}
	}
	if err = sameTextFileParent(root, p, parent); err != nil {
		return ret, err
	}
	if err = checkTextFileRevision(parent, name, request.IfAbsent, request.ExpectedRevision, originalInfo); err != nil {
		return ret, err
	}
	if err = ctx.Err(); err != nil {
		return ret, err
	}
	if request.IfAbsent {
		// 通过链接发布可防止覆盖外部并发新建的目标；回读验证前移除临时名称。
		err = operations.link(parent, temporary, name)
		if err == nil {
			err = operations.remove(parent, temporary)
			if err != nil {
				return ret, &TextFileError{Code: "result_unknown", Message: err.Error(), Written: true}
			}
		}
	} else {
		err = operations.rename(parent, temporary, name)
	}
	if err != nil {
		return ret, textFileError("write_failed", err.Error())
	}
	actual, _, readErr := readTextFileAt(parent, name)
	if readErr != nil || TextFileRevision([]byte(actual)) != ret.NewRevision {
		return ret, &TextFileError{Code: "result_unknown", Message: "replacement completed but readback did not match; inspect before retrying", Written: true}
	}
	if request.AfterCommit != nil {
		if err = request.AfterCommit(); err != nil {
			return ret, &TextFileError{Code: "result_unknown", Message: "replacement completed but project journal update failed: " + err.Error(), Written: true}
		}
	}
	return ret, nil
}

func sameTextFileParent(root *os.Root, p string, parent *os.Root) error {
	current, _, err := openTextFileParent(root, p)
	if err != nil {
		return err
	}
	defer current.Close()
	first, err := parent.Stat(".")
	if err != nil {
		return err
	}
	second, err := current.Stat(".")
	if err != nil || !os.SameFile(first, second) {
		return textFileError("invalid_path", "parent changed during write")
	}
	return nil
}

func checkTextFileRevision(parent *os.Root, name string, absent bool, revision string, originalInfo os.FileInfo) error {
	if absent {
		if _, err := parent.Lstat(name); !errors.Is(err, os.ErrNotExist) {
			return textFileError("revision_conflict", "new file appeared during write")
		}
		return nil
	}
	content, info, err := readTextFileAt(parent, name)
	if err != nil {
		return err
	}
	if !os.SameFile(originalInfo, info) || info.Mode().Perm() != originalInfo.Mode().Perm() || TextFileRevision([]byte(content)) != revision {
		return textFileError("revision_conflict", "file changed during write")
	}
	return nil
}

func textEditDiff(edits []TextEdit, ranges []TextEditRange) (string, bool) {
	const limit = 12000
	var out strings.Builder
	for _, r := range ranges {
		edit := edits[r.Index]
		hunk := fmt.Sprintf("@@ bytes %d:%d @@\n-%s\n+%s\n", r.StartByte, r.EndByte, edit.OldText, edit.NewText)
		remaining := limit - out.Len()
		if len(hunk) > remaining {
			for remaining > 0 && !utf8.RuneStart(hunk[remaining]) {
				remaining--
			}
			out.WriteString(hunk[:remaining])
			return out.String(), true
		}
		out.WriteString(hunk)
	}
	return out.String(), false
}

// MutateTextFileName 支持带版本条件的文件删除（target 为空）和重命名（目标不得存在），也可移动二进制资源。
// 重命名前后两个名称都必须写入日志；项目锁和目标复核保护协议内写入，不承诺对外部写入的原子比较交换。
func MutateTextFileName(ctx context.Context, root *os.Root, p, target string, request TextFileMutation) (ret TextFileMutationResult, err error) {
	unlock, err := lockTextFileMutation(ctx)
	if err != nil {
		return ret, err
	}
	defer unlock()
	if request.ExpectedRevision == "" {
		return ret, textFileError("revision_conflict", "expectedRevision is required")
	}
	parent, name, err := openTextFileParent(root, p)
	if err != nil {
		return ret, err
	}
	defer parent.Close()
	original, originalInfo, err := readRegularFileAt(parent, name, false)
	if err != nil {
		return ret, err
	}
	ret.OldRevision = TextFileRevision([]byte(original))
	ret.NewRevision = "missing"
	if ret.OldRevision != request.ExpectedRevision {
		return ret, textFileError("revision_conflict", "file changed; read it again before modifying")
	}
	var destination *os.Root
	var newName string
	if target != "" {
		destination, newName, err = openTextFileParent(root, target)
		if err != nil {
			return ret, err
		}
		defer destination.Close()
		if _, statErr := destination.Lstat(newName); !errors.Is(statErr, os.ErrNotExist) {
			return ret, textFileError("revision_conflict", "rename destination must not exist")
		}
		ret.NewRevision = ret.OldRevision
	}
	validate := func() error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if request.Validate != nil {
			if err := request.Validate(); err != nil {
				return err
			}
		}
		if err := sameTextFileParent(root, p, parent); err != nil {
			return err
		}
		current, info, err := readRegularFileAt(parent, name, false)
		if err != nil {
			return err
		}
		if !os.SameFile(originalInfo, info) || TextFileRevision([]byte(current)) != ret.OldRevision {
			return textFileError("revision_conflict", "file changed during operation")
		}
		if destination != nil {
			if err := sameTextFileParent(root, target, destination); err != nil {
				return err
			}
			if _, err := destination.Lstat(newName); !errors.Is(err, os.ErrNotExist) {
				return textFileError("revision_conflict", "rename destination appeared during operation")
			}
		}
		return nil
	}
	if err = validate(); err != nil {
		return ret, err
	}
	if request.BeforeCommit != nil {
		if err = request.BeforeCommit(ret.OldRevision, ret.NewRevision); err != nil {
			return ret, textFileBeforeCommitError(err)
		}
	}
	if err = validate(); err != nil {
		return ret, err
	}
	if err = ctx.Err(); err != nil {
		return ret, err
	}
	if destination != nil {
		err = root.Rename(p, target)
	} else {
		err = parent.Remove(name)
	}
	if err != nil {
		return ret, textFileError("write_failed", err.Error())
	}
	if destination != nil {
		actual, _, readErr := readRegularFileAt(destination, newName, false)
		if readErr != nil || TextFileRevision([]byte(actual)) != ret.NewRevision {
			return ret, &TextFileError{Code: "result_unknown", Message: "rename completed but readback failed; inspect before retrying", Written: true}
		}
	} else if _, statErr := parent.Lstat(name); !errors.Is(statErr, os.ErrNotExist) {
		return ret, &TextFileError{Code: "result_unknown", Message: "delete completed but absence could not be verified", Written: true}
	}
	if request.AfterCommit != nil {
		if err = request.AfterCommit(); err != nil {
			return ret, &TextFileError{Code: "result_unknown", Message: "operation completed but project journal update failed: " + err.Error(), Written: true}
		}
	}
	return ret, nil
}
