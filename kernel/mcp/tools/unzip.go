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
	"archive/zip"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/siyuan-note/siyuan/kernel/util"

	"github.com/88250/gulu"
	"golang.org/x/text/encoding/simplifiedchinese"
)

// UnzipTool 提供工作区内 zip 文件解压能力。
// zipPath 和 destPath 均为工作区相对路径，通过 resolvePath 校验防逃逸；解压时对每个成员的最终
// 输出路径再做一次授权，防止成员覆盖敏感文件。
// 解压是写操作，自动触发 UI 确认和仓库快照（不在 safeActions 中）。
var UnzipTool = &Tool{
	Name:        "unzip",
	Description: "Extract a zip archive within the workspace. Provide the workspace-relative path to the zip file and the destination directory (also workspace-relative). The destination will be created if it does not exist.",
	InputSchema: ToolSchema{
		Type: "object",
		Properties: map[string]Property{
			"zipPath": {
				Type:        "string",
				Description: "Workspace-relative path to the .zip file to extract.",
			},
			"destPath": {
				Type:        "string",
				Description: "Workspace-relative destination directory to extract into.",
			},
		},
		Required: []string{"zipPath", "destPath"},
	},
	Handler: unzipHandler,
}

func init() {
	register(UnzipTool)
}

func unzipHandler(args map[string]any) (CallToolResult, error) {
	zipPath, _ := args["zipPath"].(string)
	destPath, _ := args["destPath"].(string)
	if zipPath == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "zipPath is required"}}, IsError: true}, nil
	}
	if destPath == "" {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "destPath is required"}}, IsError: true}, nil
	}

	// 解析并校验路径在工作区内（防逃逸），复用 file 工具的 resolvePath。
	zipAbs, err := resolvePath(zipPath)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "invalid zipPath: " + err.Error()}}, IsError: true}, nil
	}
	destAbs, err := resolvePath(destPath)
	if err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "invalid destPath: " + err.Error()}}, IsError: true}, nil
	}

	// 检查 zip 文件存在。
	if !gulu.File.IsExist(zipAbs) {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "zip file not found: " + zipPath}}, IsError: true}, nil
	}

	// 解压（与 /api/archive/unzip 一致：先校验全部条目的最终路径，再从同一个归档句柄解压）。
	// 不能直接使用 gulu.Zip.Unzip：它只做词法包含检查，无法对每个成员做授权，成员可以覆盖敏感文件。
	if err := extractGuardedArchive(zipAbs, destAbs); err != nil {
		return CallToolResult{Content: []ContentItem{{Type: "text", Text: "unzip failed: " + err.Error()}}, IsError: true}, nil
	}

	return CallToolResult{
		Content: []ContentItem{{Type: "text", Text: fmt.Sprintf("Extracted %s to %s", zipPath, destPath)}},
	}, nil
}

// extractGuardedArchive 校验归档全部条目后再从同一句柄解压：拒绝非本地路径名、路径穿越和符号链接条目，
// 并对每个最终输出路径做授权，防止成员覆盖受保护文件（例如成员 conf.json 解压到 conf 目录）。
func extractGuardedArchive(zipAbs, destAbs string) error {
	reader, err := zip.OpenReader(zipAbs)
	if err != nil {
		return err
	}
	defer reader.Close()

	// 成员名与其最终输出路径成对保存，两次遍历使用同一份判定输入
	type archiveMember struct {
		name string
		path string
	}
	members := make([]archiveMember, len(reader.File))
	for i, entry := range reader.File {
		name := entry.Name
		if !utf8.ValidString(name) {
			// 与 Gulu 一致地解码 GB18030 条目名，避免解码前后的名称不一致导致校验被绕过
			if name, err = simplifiedchinese.GB18030.NewDecoder().String(name); err != nil {
				return err
			}
		}
		name = strings.ReplaceAll(name, "\\", "/")
		if !filepath.IsLocal(filepath.FromSlash(name)) || entry.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("invalid archive entry [%s]", name)
		}
		members[i] = archiveMember{name: name, path: filepath.Join(destAbs, filepath.FromSlash(name))}
		if err = authorizeArchiveEntry(destAbs, members[i].path, members[i].name); err != nil {
			return err
		}
	}
	for i, entry := range reader.File {
		// 解压前再次授权，不复用预检阶段的判定结果
		if err = authorizeArchiveEntry(destAbs, members[i].path, members[i].name); err != nil {
			return err
		}
		if err = extractArchiveEntry(entry, members[i].path); err != nil {
			return err
		}
	}
	return nil
}

// authorizeArchiveEntry 校验归档成员的最终输出路径：必须位于目标目录内（含符号链接解析后），
// 且通过最终路径授权（工作区包含、加密笔记本、symlink 逃逸、敏感文件黑名单）。
func authorizeArchiveEntry(destAbs, entryAbs, display string) error {
	rel, err := filepath.Rel(destAbs, entryAbs)
	if err != nil || !filepath.IsLocal(rel) {
		return fmt.Errorf("archive entry escapes destination [%s]", display)
	}
	resolved := util.ResolveLongestExistingParent(entryAbs)
	resolvedDest := util.ResolveLongestExistingParent(destAbs)
	if rel, err = filepath.Rel(resolvedDest, resolved); err != nil || !filepath.IsLocal(rel) {
		return fmt.Errorf("archive entry resolves outside destination [%s]", display)
	}
	return authorizePath(entryAbs, display)
}

func extractArchiveEntry(entry *zip.File, destination string) error {
	if entry.FileInfo().IsDir() {
		return os.MkdirAll(destination, 0755)
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0755); err != nil {
		return err
	}
	source, err := entry.Open()
	if err != nil {
		return err
	}
	defer source.Close()
	target, err := os.Create(destination)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(target, source)
	closeErr := target.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Chtimes(destination, entry.Modified, entry.Modified)
}
