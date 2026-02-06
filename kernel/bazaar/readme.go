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
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	textUnicode "golang.org/x/text/encoding/unicode"
	"golang.org/x/text/transform"
)

// getReadmeFileCandidates 根据包的 readme 配置返回去重的按优先级排序的 README 候选文件名列表：当前语言首选、default、README.md
func getReadmeFileCandidates(readme LocaleStrings) []string {
	preferred := GetPreferredLocaleString(readme, "README.md")
	defaultName := "README.md"
	if v := strings.TrimSpace(readme["default"]); v != "" {
		defaultName = v
	}
	return gulu.Str.RemoveDuplicatedElem([]string{preferred, defaultName, "README.md"})
}

// GetPackageOnlineREADME 获取集市包的在线 README
func GetPackageOnlineREADME(ctx context.Context, repoURL, repoHash, pkgType string) (ret string) {
	repoURLHash := repoURL + "@" + repoHash
	url := strings.TrimPrefix(repoURLHash, "https://github.com/")
	repo := getStageRepoByURL(ctx, pkgType, url)
	if nil == repo || nil == repo.Package {
		return
	}

	candidates := getReadmeFileCandidates(repo.Package.Readme)
	var data []byte
	var loadErr error
	var errMsgs []string
	for _, name := range candidates {
		data, loadErr = downloadBazaarFile(repoURLHash+"/"+name, false)
		if loadErr == nil {
			break
		}
		errMsgs = append(errMsgs, fmt.Sprintf("Load bazaar package's README(%s) failed: %s", name, loadErr.Error()))
	}
	if loadErr != nil {
		ret = strings.Join(errMsgs, "<br>")
		return
	}

	// 解码 UTF-16 BOM
	if 2 < len(data) {
		var decoded []byte
		var err error
		if 0xFF == data[0] && 0xFE == data[1] {
			decoded, _, err = transform.Bytes(textUnicode.UTF16(textUnicode.LittleEndian, textUnicode.ExpectBOM).NewDecoder(), data)
		} else if 0xFE == data[0] && 0xFF == data[1] {
			decoded, _, err = transform.Bytes(textUnicode.UTF16(textUnicode.BigEndian, textUnicode.ExpectBOM).NewDecoder(), data)
		}
		if decoded != nil && err == nil {
			data = decoded
		}
	}

	ret = renderOnlineREADME(repoURL, data)
	return
}

// getPackageLocalREADME 获取集市包的本地 README
func getPackageLocalREADME(installPath, basePath string, readme LocaleStrings) (ret string) {
	candidates := getReadmeFileCandidates(readme)
	var errMsgs []string
	for _, name := range candidates {
		readmeData, readErr := os.ReadFile(filepath.Join(installPath, name))
		if readErr == nil {
			ret = renderLocalREADME(basePath, readmeData)
			return
		}
		logging.LogWarnf("read installed %s failed: %s", name, readErr)
		errMsgs = append(errMsgs, fmt.Sprintf("File [%s] not found", name))
	}
	ret = strings.Join(errMsgs, "<br>")
	return
}

// renderOnlineREADME 渲染在线 README Markdown 为 HTML
func renderOnlineREADME(repoURL string, mdData []byte) (ret string) {
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
func renderLocalREADME(basePath string, mdData []byte) (ret string) {
	luteEngine := lute.New()
	luteEngine.SetSoftBreak2HardBreak(false)
	luteEngine.SetCodeSyntaxHighlight(false)
	linkBase := basePath
	luteEngine.SetLinkBase(linkBase)
	ret = luteEngine.Md2HTML(string(mdData))
	ret = util.LinkTarget(ret, linkBase)
	return
}
