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

package util

import (
	"bytes"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/88250/gulu"
	"github.com/siyuan-note/eventbus"
	"github.com/siyuan-note/logging"
)

var ErrPandocNotFound = errors.New("not found executable pandoc")

func ConvertPandoc(dir string, args ...string) (path string, err error) {
	if "" == PandocBinPath || ContainerStd != Container {
		err = ErrPandocNotFound
		return
	}

	pandoc := exec.Command(PandocBinPath, args...)
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

	if "" == PandocBinPath || ContainerStd != Container {
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

	pandoc := exec.Command(PandocBinPath, args...)
	gulu.CmdAttr(pandoc)
	output, err := pandoc.CombinedOutput()
	if err != nil {
		logging.LogErrorf("pandoc convert output [%s], error [%s]", string(output), err)
		return
	}
	return
}

var (
	PandocBinPath string // Pandoc 可执行文件路径
)

func InitPandoc() {
	if ContainerStd != Container {
		return
	}

	pandocDir := filepath.Join(TempDir, "pandoc")

	if confPath := filepath.Join(ConfDir, "conf.json"); gulu.File.IsExist(confPath) {
		// Workspace built-in Pandoc is no longer initialized after customizing Pandoc path https://github.com/siyuan-note/siyuan/issues/8377
		if data, err := os.ReadFile(confPath); err == nil {
			conf := map[string]interface{}{}
			if err = gulu.JSON.UnmarshalJSON(data, &conf); err == nil && nil != conf["export"] {
				export := conf["export"].(map[string]interface{})
				if customPandocBinPath := export["pandocBin"].(string); !strings.HasPrefix(customPandocBinPath, pandocDir) {
					if pandocVer := getPandocVer(customPandocBinPath); "" != pandocVer {
						PandocBinPath = customPandocBinPath
						logging.LogInfof("custom pandoc [ver=%s, bin=%s]", pandocVer, PandocBinPath)
						return
					}
				}
			}
		}
	}

	defer eventbus.Publish(EvtConfPandocInitialized)

	if gulu.OS.IsWindows() {
		if "amd64" == runtime.GOARCH {
			PandocBinPath = filepath.Join(pandocDir, "bin", "pandoc.exe")
		}
	} else if gulu.OS.IsDarwin() {
		PandocBinPath = filepath.Join(pandocDir, "bin", "pandoc")
	} else if gulu.OS.IsLinux() {
		if "amd64" == runtime.GOARCH {
			PandocBinPath = filepath.Join(pandocDir, "bin", "pandoc")
		}
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

	if !gulu.File.IsExist(pandocZip) {
		PandocBinPath = ""
		logging.LogErrorf("pandoc zip [%s] not found", pandocZip)
		return
	}

	if err := gulu.Zip.Unzip(pandocZip, pandocDir); err != nil {
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

	cmd := exec.Command(binPath, "--version")
	gulu.CmdAttr(cmd)
	data, err := cmd.CombinedOutput()
	if err == nil && strings.HasPrefix(string(data), "pandoc") {
		return true
	}
	return false
}
