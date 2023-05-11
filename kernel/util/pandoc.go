// SiYuan - Build Your Eternal Digital Garden
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
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/88250/gulu"
	"github.com/siyuan-note/logging"
)

func Pandoc(from, to, o, content string) (ret string, err error) {
	if "" == from || "" == to || "md" == to {
		ret = content
		return
	}

	args := []string{
		"--from", from,
		"--to", to,
	}

	if "" != o {
		args = append(args, "-o", o)
	}

	pandoc := exec.Command(PandocBinPath, args...)
	gulu.CmdAttr(pandoc)
	pandoc.Stdin = bytes.NewBufferString(content)
	output, err := pandoc.CombinedOutput()
	if nil != err {
		return
	}
	ret = string(output)
	return
}

var (
	PandocBinPath string // Pandoc 可执行文件路径
)

func initPandoc() {
	if ContainerStd != Container {
		return
	}

	pandocDir := filepath.Join(TempDir, "pandoc")
	if gulu.OS.IsWindows() {
		PandocBinPath = filepath.Join(pandocDir, "bin", "pandoc.exe")
	} else if gulu.OS.IsDarwin() || gulu.OS.IsLinux() {
		PandocBinPath = filepath.Join(pandocDir, "bin", "pandoc")
	}
	pandocVer := getPandocVer(PandocBinPath)
	if "" != pandocVer {
		logging.LogInfof("built-in pandoc [ver=%s, bin=%s]", pandocVer, PandocBinPath)
		return
	}

	pandocZip := filepath.Join(WorkingDir, "pandoc.zip")
	if "dev" == Mode || !gulu.File.IsExist(pandocZip) {
		if gulu.OS.IsWindows() {
			pandocZip = filepath.Join(WorkingDir, "pandoc/pandoc-windows-amd64.zip")
		} else if gulu.OS.IsDarwin() {
			pandocZip = filepath.Join(WorkingDir, "pandoc/pandoc-darwin-amd64.zip")
		} else if gulu.OS.IsLinux() {
			pandocZip = filepath.Join(WorkingDir, "pandoc/pandoc-linux-amd64.zip")
		}
	}
	if err := gulu.Zip.Unzip(pandocZip, pandocDir); nil != err {
		logging.LogErrorf("unzip pandoc failed: %s", err)
		return
	}

	if gulu.OS.IsDarwin() || gulu.OS.IsLinux() {
		exec.Command("chmod", "+x", PandocBinPath).CombinedOutput()
	}
	pandocVer = getPandocVer(PandocBinPath)
	logging.LogInfof("initialized built-in pandoc [ver=%s, bin=%s]", pandocVer, PandocBinPath)
}

func getPandocVer(binPath string) (ret string) {
	if "" == binPath {
		return
	}

	cmd := exec.Command(binPath, "--version")
	gulu.CmdAttr(cmd)
	data, err := cmd.CombinedOutput()
	if nil == err && strings.HasPrefix(string(data), "pandoc") {
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

	cmd := exec.Command(binPath, "--version")
	gulu.CmdAttr(cmd)
	data, err := cmd.CombinedOutput()
	if nil == err && strings.HasPrefix(string(data), "pandoc") {
		return true
	}
	return false
}
