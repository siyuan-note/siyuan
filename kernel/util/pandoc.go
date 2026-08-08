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

package util

import (
	"bytes"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"

	"github.com/88250/gulu"
	"github.com/siyuan-note/logging"
)

var ErrPandocNotFound = errors.New("not found executable pandoc")

func ConvertPandoc(dir string, args ...string) (path string, err error) {
	pandocBinPath := GetPandocRuntime().BinPath
	if "" == pandocBinPath || ContainerStd != Container {
		err = ErrPandocNotFound
		return
	}

	pandoc := exec.Command(pandocBinPath, args...)
	gulu.CmdAttr(pandoc)
	path = filepath.Join("temp", "convert", "pandoc", dir)
	absPath := filepath.Join(WorkspaceDir, path)
	if err = os.MkdirAll(absPath, 0755); err != nil {
		logging.LogErrorf("mkdir [%s] failed: [%s]", absPath, err)
		return
	}
	pandoc.Dir = absPath
	output, err := pandoc.CombinedOutput()
	if err != nil {
		err = errors.Join(err, errors.New(string(output)))
		logging.LogErrorf("pandoc convert output failed: %s", err)
		return
	}
	path = "/" + filepath.ToSlash(path)
	return
}

func Pandoc(from, to, o, content string) (err error) {
	if "" == from || "" == to || "md" == to {
		if err = gulu.File.WriteFileSafer(o, []byte(content), 0644); err != nil {
			logging.LogErrorf("write export markdown file [%s] failed: %s", o, err)
		}
		return
	}

	pandocBinPath := GetPandocRuntime().BinPath
	if "" == pandocBinPath || ContainerStd != Container {
		err = ErrPandocNotFound
		return
	}

	dir := filepath.Join(WorkspaceDir, "temp", "convert", "pandoc", gulu.Rand.String(7))
	if err = os.MkdirAll(dir, 0755); err != nil {
		logging.LogErrorf("mkdir [%s] failed: [%s]", dir, err)
		return
	}
	tmpPath := filepath.Join(dir, gulu.Rand.String(7))
	if err = os.WriteFile(tmpPath, []byte(content), 0644); err != nil {
		logging.LogErrorf("write file failed: [%s]", err)
		return
	}

	args := []string{
		tmpPath,
		"--from", from,
		"--to", to,
		"--resource-path", filepath.Dir(o),
		"-s",
		"-o", o,
	}

	pandoc := exec.Command(pandocBinPath, args...)
	gulu.CmdAttr(pandoc)
	output, err := pandoc.CombinedOutput()
	if err != nil {
		logging.LogErrorf("pandoc convert output [%s], error [%s]", string(output), err)
		return
	}
	return
}

type PandocRuntime struct {
	BinPath         string
	TemplatePath    string
	ColorFilterPath string
}

var (
	activePandocRuntime PandocRuntime
	pandocInitMutex     sync.Mutex
)

func GetPandocRuntime() PandocRuntime {
	pandocInitMutex.Lock()
	defer pandocInitMutex.Unlock()
	return activePandocRuntime
}

func InitPandoc(customPandocBinPath string) {
	if ContainerStd != Container {
		return
	}

	pandocInitMutex.Lock()
	defer pandocInitMutex.Unlock()
	runtimeState := PandocRuntime{}
	defer func() {
		activePandocRuntime = runtimeState
	}()

	runtimeState.TemplatePath = filepath.Join(WorkingDir, "pandoc-resources", "pandoc-template.docx")
	if !gulu.File.IsExist(runtimeState.TemplatePath) {
		runtimeState.TemplatePath = filepath.Join(WorkingDir, "pandoc", "pandoc-resources", "pandoc-template.docx")
	}
	if !gulu.File.IsExist(runtimeState.TemplatePath) {
		logging.LogWarnf("pandoc template file [%s] not found", runtimeState.TemplatePath)
		runtimeState.TemplatePath = ""
	}

	runtimeState.ColorFilterPath = filepath.Join(WorkingDir, "pandoc-resources", "pandoc_color_filter.lua")
	if !gulu.File.IsExist(runtimeState.ColorFilterPath) {
		runtimeState.ColorFilterPath = filepath.Join(WorkingDir, "pandoc", "pandoc-resources", "pandoc_color_filter.lua")
	}
	if !gulu.File.IsExist(runtimeState.ColorFilterPath) {
		logging.LogWarnf("pandoc color filter file [%s] not found", runtimeState.ColorFilterPath)
		runtimeState.ColorFilterPath = ""
	}

	tempPandocDir := filepath.Join(TempDir, "pandoc")
	installedPandocBinPath := pandocBinPath(filepath.Join(WorkingDir, "pandoc"))
	installedPandocVer := getPandocVer(installedPandocBinPath)

	customPandocBinPath = strings.TrimSpace(customPandocBinPath)
	if "" != customPandocBinPath && !isPathWithin(tempPandocDir, customPandocBinPath) {
		if pandocVer := getPandocVer(customPandocBinPath); "" != pandocVer {
			runtimeState.BinPath = customPandocBinPath
			logging.LogInfof("custom pandoc [ver=%s, bin=%s]", pandocVer, runtimeState.BinPath)
			removeLegacyPandocDir(tempPandocDir)
			return
		}
	}

	if "" != installedPandocVer {
		runtimeState.BinPath = installedPandocBinPath
		logging.LogInfof("built-in pandoc [ver=%s, bin=%s]", installedPandocVer, runtimeState.BinPath)
		removeLegacyPandocDir(tempPandocDir)
		return
	}

	removeLegacyPandocDir(tempPandocDir)
	logging.LogErrorf("built-in pandoc executable [%s] is unavailable", installedPandocBinPath)
}

func pandocBinPath(pandocDir string) string {
	if gulu.OS.IsWindows() {
		if "amd64" == runtime.GOARCH {
			return filepath.Join(pandocDir, "bin", "pandoc.exe")
		}
	} else if gulu.OS.IsDarwin() {
		return filepath.Join(pandocDir, "bin", "pandoc")
	} else if gulu.OS.IsLinux() {
		return filepath.Join(pandocDir, "bin", "pandoc")
	}
	return ""
}

func isPathWithin(root, target string) bool {
	if "" == root || "" == target {
		return false
	}
	rel, err := filepath.Rel(filepath.Clean(root), filepath.Clean(target))
	if err != nil {
		return false
	}
	return "." == rel || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)))
}

func removeLegacyPandocDir(tempPandocDir string) {
	if !gulu.File.IsExist(tempPandocDir) {
		return
	}
	if err := os.RemoveAll(tempPandocDir); err != nil {
		logging.LogWarnf("remove legacy pandoc folder [%s] failed: %s", tempPandocDir, err)
		return
	}
	logging.LogInfof("removed legacy pandoc folder [%s]", tempPandocDir)
}

func getPandocVer(binPath string) (ret string) {
	if "" == binPath {
		return
	}

	cmd := exec.Command(binPath, "--version")
	gulu.CmdAttr(cmd)
	data, err := cmd.CombinedOutput()
	if err == nil && strings.HasPrefix(string(data), "pandoc") {
		parts := bytes.Split(data, []byte("\n"))
		if 0 < len(parts) {
			ret = strings.TrimPrefix(string(parts[0]), "pandoc")
			ret = strings.ReplaceAll(ret, ".exe", "")
			ret = strings.TrimSpace(ret)
		}
		return
	}
	return
}

func IsValidPandocBin(binPath string) bool {
	if "" == binPath {
		return false
	}

	// 解析符号链接
	if real, err := filepath.EvalSymlinks(binPath); err == nil {
		binPath = real
	}

	// 文件信息检查
	fi, err := os.Stat(binPath)
	if err != nil || fi.IsDir() || !fi.Mode().IsRegular() {
		return false
	}

	// 读取文件头判断是否为二进制并排除脚本（#!）
	f, err := os.Open(binPath)
	if err != nil {
		return false
	}
	defer f.Close()

	header := make([]byte, 16)
	n, _ := f.Read(header)
	header = header[:n]

	// 拒绝以 shebang 开头的脚本
	if bytes.HasPrefix(header, []byte("#!")) {
		return false
	}

	isBin := false
	// 常见二进制魔数：ELF, PE("MZ"), Mach-O (32/64, big/little), FAT
	if len(header) >= 4 {
		switch {
		case bytes.Equal(header[:4], []byte{0x7f, 'E', 'L', 'F'}):
			isBin = true // ELF
		// Mach-O / Mach-O swapped (32-bit)
		case bytes.Equal(header[:4], []byte{0xfe, 0xed, 0xfa, 0xce}), bytes.Equal(header[:4], []byte{0xce, 0xfa, 0xed, 0xfe}):
			isBin = true
		// Mach-O 64-bit / swapped
		case bytes.Equal(header[:4], []byte{0xfe, 0xed, 0xfa, 0xcf}), bytes.Equal(header[:4], []byte{0xcf, 0xfa, 0xed, 0xfe}):
			isBin = true
		// FAT / FAT swapped
		case bytes.Equal(header[:4], []byte{0xca, 0xfe, 0xba, 0xbe}), bytes.Equal(header[:4], []byte{0xbe, 0xba, 0xfe, 0xca}):
			isBin = true
		}
	}
	// PE only needs first 2 bytes "MZ"
	if !isBin && len(header) >= 2 && bytes.Equal(header[:2], []byte{'M', 'Z'}) {
		isBin = true
	}

	// Windows 上允许 .exe 文件（作为补充判断）
	if !isBin && gulu.OS.IsWindows() {
		ext := strings.ToLower(filepath.Ext(binPath))
		if ext == ".exe" {
			isBin = true
		}
	}

	if !isBin {
		logging.LogWarnf("file [%s] is not a valid binary executable", binPath)
		return false
	}

	cmd := exec.Command(binPath, "--version")
	gulu.CmdAttr(cmd)
	data, err := cmd.CombinedOutput()
	if err == nil && strings.HasPrefix(string(data), "pandoc") {
		return true
	}
	return false
}
