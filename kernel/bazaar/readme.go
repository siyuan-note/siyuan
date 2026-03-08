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
	"bytes"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	textUnicode "golang.org/x/text/encoding/unicode"
	"golang.org/x/text/transform"
)

// getReadmeFileCandidates 根据包的 README 配置返回去重的按优先级排序的 README 候选文件名列表：当前语言首选、default、README.md。
func getReadmeFileCandidates(readme LocaleStrings) []string {
	preferred := GetPreferredLocaleString(readme, "README.md")
	defaultName := "README.md"
	if v := strings.TrimSpace(readme["default"]); v != "" {
		defaultName = v
	}
	return gulu.Str.RemoveDuplicatedElem([]string{preferred, defaultName, "README.md"})
}

// GetBazaarPackageREADME 获取集市包的在线 README。
func GetBazaarPackageREADME(ctx context.Context, repoURL, repoHash, pkgType string) (ret string) {
	repoURLHash := repoURL + "@" + repoHash
	url := strings.TrimPrefix(repoURLHash, "https://github.com/")
	repo := getStageRepoByURL(ctx, pkgType, url)
	if repo == nil || repo.Package == nil {
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
	if len(data) > 2 {
		var decoded []byte
		var err error
		if data[0] == 0xFF && data[1] == 0xFE {
			decoded, _, err = transform.Bytes(textUnicode.UTF16(textUnicode.LittleEndian, textUnicode.ExpectBOM).NewDecoder(), data)
		} else if data[0] == 0xFE && data[1] == 0xFF {
			decoded, _, err = transform.Bytes(textUnicode.UTF16(textUnicode.BigEndian, textUnicode.ExpectBOM).NewDecoder(), data)
		}
		if decoded != nil && err == nil {
			data = decoded
		}
	}

	linkBase := "https://cdn.jsdelivr.net/gh/" + strings.TrimPrefix(repoURL, "https://github.com/")
	ret = renderPackageREADME(linkBase, data)
	return
}

// getInstalledPackageREADME 获取集市包的本地 README。
func getInstalledPackageREADME(installPath, linkBase string, readme LocaleStrings) (ret string) {
	candidates := getReadmeFileCandidates(readme)
	var errMsgs []string
	for _, name := range candidates {
		readmeData, readErr := os.ReadFile(filepath.Join(installPath, name))
		if readErr == nil {
			ret = renderPackageREADME(linkBase, readmeData)
			return
		}
		logging.LogWarnf("read installed %s failed: %s", name, readErr)
		errMsgs = append(errMsgs, fmt.Sprintf("File [%s] not found", name))
	}
	ret = strings.Join(errMsgs, "<br>")
	return
}

// renderPackageREADME 渲染 README Markdown 为 HTML。
func renderPackageREADME(linkBase string, mdData []byte) (ret string) {
	mdData = bytes.TrimPrefix(mdData, []byte("\xef\xbb\xbf")) // 移除文件开头的 BOM
	luteEngine := lute.New()
	luteEngine.SetSoftBreak2HardBreak(false)
	luteEngine.SetCodeSyntaxHighlight(false)
	luteEngine.SetLinkBase(linkBase)

	tree := parse.Parse("", mdData, luteEngine.ParseOptions)
	normalizeNodesIAL(tree)
	ret = luteEngine.Tree2HTML(tree, luteEngine.RenderOptions, luteEngine.ParseOptions)
	ret = util.LinkTarget(ret, linkBase)
	return
}

func normalizeNodesIAL(tree *parse.Tree) {
	if tree == nil || tree.Root == nil {
		return
	}

	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		if n.Type == ast.NodeCodeBlock {
			// 代码块添加 code-block 类名以修正样式。
			n.KramdownIAL = addClassToKramdownIAL(n.KramdownIAL, "code-block")
		}
		return ast.WalkContinue
	})
}

func addClassToKramdownIAL(ial [][]string, class string) [][]string {
	for i, attr := range ial {
		if len(attr) < 2 || attr[0] != "class" {
			continue
		}
		for _, item := range strings.Fields(attr[1]) {
			if item == class {
				return ial
			}
		}
		attr[1] = strings.TrimSpace(attr[1] + " " + class)
		ial[i] = attr
		return ial
	}
	return append(ial, []string{"class", class})
}
