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

package bazaar

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/88250/lute"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	textUnicode "golang.org/x/text/encoding/unicode"
	"golang.org/x/text/transform"
)

// GetOnlinePackageREADME 获取集市包的在线 README
func GetOnlinePackageREADME(repoURL, repoHash, pkgType string) (ret string) {
	repoURLHash := repoURL + "@" + repoHash

	var stageIndex *StageIndex
	if val, found := cachedStageIndex.Get(pkgType); found {
		stageIndex = val.(*StageIndex)
	}
	if nil == stageIndex {
		return
	}

	url := strings.TrimPrefix(repoURLHash, "https://github.com/")
	var repo *StageRepo
	for _, r := range stageIndex.Repos {
		if r.URL == url {
			repo = r
			break
		}
	}
	if nil == repo || nil == repo.Package {
		return
	}

	readme := getPreferredReadme(repo.Package.Readme)

	data, err := downloadBazaarFile(repoURLHash+"/"+readme, false)
	if err != nil {
		ret = fmt.Sprintf("Load bazaar package's preferred README(%s) failed: %s", readme, err.Error())
		// 回退到 Default README
		var defaultReadme string
		if len(repo.Package.Readme) > 0 {
			defaultReadme = repo.Package.Readme["default"]
		}
		if "" == strings.TrimSpace(defaultReadme) {
			defaultReadme = "README.md"
		}
		if readme != defaultReadme {
			data, err = downloadBazaarFile(repoURLHash+"/"+defaultReadme, false)
			if err != nil {
				ret += fmt.Sprintf("<br>Load bazaar package's default README(%s) failed: %s", defaultReadme, err.Error())
			}
		}
		// 回退到 README.md
		if err != nil && readme != "README.md" && defaultReadme != "README.md" {
			data, err = downloadBazaarFile(repoURLHash+"/README.md", false)
			if err != nil {
				ret += fmt.Sprintf("<br>Load bazaar package's README.md failed: %s", err.Error())
				return
			}
		} else if err != nil {
			return
		}
	}

	if 2 < len(data) {
		if 255 == data[0] && 254 == data[1] {
			data, _, err = transform.Bytes(textUnicode.UTF16(textUnicode.LittleEndian, textUnicode.ExpectBOM).NewDecoder(), data)
		} else if 254 == data[0] && 255 == data[1] {
			data, _, err = transform.Bytes(textUnicode.UTF16(textUnicode.BigEndian, textUnicode.ExpectBOM).NewDecoder(), data)
		}
	}

	ret, err = renderOnlineREADME(repoURL, data)
	return
}

// getLocalPackageREADME 获取集市包的本地 README
func getLocalPackageREADME(installPath, basePath string, readme LocaleStrings) (ret string) {
	readmeFilename := getPreferredReadme(readme)
	readmeData, readErr := os.ReadFile(filepath.Join(installPath, readmeFilename))
	if nil == readErr {
		ret, _ = renderLocalREADME(basePath, readmeData)
		return
	}

	logging.LogWarnf("read installed %s failed: %s", readmeFilename, readErr)
	ret = fmt.Sprintf("File %s not found", readmeFilename)
	// 回退到 Default README
	var defaultReadme string
	if len(readme) > 0 {
		defaultReadme = strings.TrimSpace(readme["default"])
	}
	if "" == defaultReadme {
		defaultReadme = "README.md"
	}
	if readmeFilename != defaultReadme {
		readmeData, readErr = os.ReadFile(filepath.Join(installPath, defaultReadme))
		if nil == readErr {
			ret, _ = renderLocalREADME(basePath, readmeData)
			return
		}
		logging.LogWarnf("read installed %s failed: %s", defaultReadme, readErr)
		ret += fmt.Sprintf("<br>File %s not found", defaultReadme)
	}
	// 回退到 README.md
	if nil != readErr && readmeFilename != "README.md" && defaultReadme != "README.md" {
		readmeData, readErr = os.ReadFile(filepath.Join(installPath, "README.md"))
		if nil == readErr {
			ret, _ = renderLocalREADME(basePath, readmeData)
			return
		}
		logging.LogWarnf("read installed README.md failed: %s", readErr)
		ret += "<br>File README.md not found"
	}
	return
}

// renderOnlineREADME 渲染在线 README Markdown 为 HTML
func renderOnlineREADME(repoURL string, mdData []byte) (ret string, err error) {
	luteEngine := lute.New()
	luteEngine.SetSoftBreak2HardBreak(false)
	luteEngine.SetCodeSyntaxHighlight(false)
	linkBase := "https://cdn.jsdelivr.net/gh/" + strings.TrimPrefix(repoURL, "https://github.com/")
	luteEngine.SetLinkBase(linkBase)
	ret = luteEngine.Md2HTML(string(mdData))
	ret = util.LinkTarget(ret, linkBase)
	return
}

// renderLocalREADME 渲染本地 README Markdown 为 HTML
func renderLocalREADME(basePath string, mdData []byte) (ret string, err error) {
	luteEngine := lute.New()
	luteEngine.SetSoftBreak2HardBreak(false)
	luteEngine.SetCodeSyntaxHighlight(false)
	linkBase := basePath
	luteEngine.SetLinkBase(linkBase)
	ret = luteEngine.Md2HTML(string(mdData))
	ret = util.LinkTarget(ret, linkBase)
	return
}
