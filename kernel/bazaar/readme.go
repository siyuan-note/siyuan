// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package bazaar

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"sync"

	"github.com/88250/gulu"
	"github.com/88250/lute"
	"github.com/88250/lute/ast"
	"github.com/88250/lute/parse"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
	nethtml "golang.org/x/net/html"
	"golang.org/x/net/html/atom"
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
	candidates := gulu.Str.RemoveDuplicatedElem([]string{preferred, defaultName, "README.md"})
	ret := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		if normalized, ok := normalizePackageRelativePath(candidate); ok {
			ret = append(ret, normalized)
		}
	}
	return gulu.Str.RemoveDuplicatedElem(ret)
}

func normalizePackageRelativePath(value string) (string, bool) {
	if value == "" || strings.ContainsAny(value, `\:`) || strings.HasPrefix(value, "/") {
		return "", false
	}
	value = path.Clean(value)
	if value == "." || value == ".." || strings.HasPrefix(value, "../") {
		return "", false
	}
	return value, true
}

func escapePackageRelativeURLPath(value string) string {
	parts := strings.Split(value, "/")
	for i, part := range parts {
		parts[i] = url.PathEscape(part)
	}
	return strings.Join(parts, "/")
}

func packageRemoteRootURL(repoURL, repoRef string, allowUnversioned bool) string {
	repoURL, normalizedRef := normalizeGitHubPackageSource(repoURL, repoRef)
	if repoURL == "" || (repoRef != "" && normalizedRef == "") || (!allowUnversioned && normalizedRef == "") {
		return ""
	}
	ownerRepo := strings.TrimPrefix(repoURL, "https://github.com/")
	ret := "https://cdn.jsdelivr.net/gh/" + ownerRepo
	if normalizedRef != "" {
		ret += "@" + url.PathEscape(normalizedRef)
	}
	return ret + "/"
}

func packageURLAtPath(rootURL, relativePath, rawQuery, fragment string) string {
	ret := rootURL + escapePackageRelativeURLPath(relativePath)
	if rawQuery != "" {
		ret += "?" + rawQuery
	}
	if fragment != "" {
		ret += "#" + (&url.URL{Fragment: fragment}).EscapedFragment()
	}
	return ret
}

func readmeDirectoryURL(rootURL, readmePath string) string {
	dir := path.Dir(readmePath)
	if dir == "." {
		return strings.TrimSuffix(rootURL, "/")
	}
	return strings.TrimSuffix(rootURL, "/") + "/" + escapePackageRelativeURLPath(dir)
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
	var readmePath string
	for _, name := range candidates {
		data, loadErr = downloadBazaarFile(repoURLHash+"/"+escapePackageRelativeURLPath(name), false)
		if loadErr == nil {
			readmePath = name
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

	remoteRoot := packageRemoteRootURL(repoURL, repo.RepoRef, true)
	linkBase := readmeDirectoryURL(remoteRoot, readmePath)
	ret = renderPackageREADMEWithImageResolver(linkBase, data, func(src string) string {
		return resolvePackageREADMEImage(src, "", "", remoteRoot, readmePath, 0)
	})
	return
}

// installedReadmeCacheEntry 保存已安装包 README 的渲染结果，按 README 文件的大小与修改时间校验。
type installedReadmeCacheEntry struct {
	readmePath string
	stamp      installedManifestStamp
	html       string
}

const (
	installedReadmeCacheEntryLimit = 64
	installedReadmeCacheByteLimit  = 8 << 20
)

var installedReadmeCache = struct {
	mu      sync.Mutex
	entries map[string]installedReadmeCacheEntry
	keys    []string // 按写入顺序淘汰
	bytes   int
}{entries: map[string]installedReadmeCacheEntry{}}

var installedReadmeRenderer = renderPackageREADMEWithImageResolver // 渲染入口，便于测试替换

// installedReadmeCacheKey 汇总影响渲染结果的输入：目录、链接前缀、图片来源、版本与语言。
func installedReadmeCacheKey(installPath, localRootURL, repoURL, repoRef string, cacheVersion int64) string {
	return installPath + "\x00" + localRootURL + "\x00" + repoURL + "\x00" + repoRef + "\x00" +
		strconv.FormatInt(cacheVersion, 10) + "\x00" + util.Lang
}

func lookupInstalledPackageReadme(key, readmePath string) (string, bool) {
	installedReadmeCache.mu.Lock()
	entry, ok := installedReadmeCache.entries[key]
	installedReadmeCache.mu.Unlock()
	// 文件校验放在锁外，避免文件系统调用阻塞其他调用方
	if !ok || entry.readmePath != readmePath || !manifestStampMatches(readmePath, entry.stamp) {
		return "", false
	}
	return entry.html, true
}

func storeInstalledPackageReadme(key, readmePath string, stamp installedManifestStamp, html string) {
	if 0 == len(html) || installedReadmeCacheByteLimit < len(html) {
		return
	}
	installedReadmeCache.mu.Lock()
	defer installedReadmeCache.mu.Unlock()
	deleteInstalledReadmeCacheEntryLocked(key)
	installedReadmeCache.entries[key] = installedReadmeCacheEntry{readmePath: readmePath, stamp: stamp, html: html}
	installedReadmeCache.keys = append(installedReadmeCache.keys, key)
	installedReadmeCache.bytes += len(html)
	for installedReadmeCacheEntryLimit < len(installedReadmeCache.keys) ||
		(installedReadmeCacheByteLimit < installedReadmeCache.bytes && 1 < len(installedReadmeCache.keys)) {
		oldest := installedReadmeCache.keys[0]
		installedReadmeCache.keys = installedReadmeCache.keys[1:]
		deleteInstalledReadmeCacheEntryLocked(oldest)
	}
}

func deleteInstalledReadmeCacheEntryLocked(key string) {
	entry, ok := installedReadmeCache.entries[key]
	if !ok {
		return
	}
	installedReadmeCache.bytes -= len(entry.html)
	delete(installedReadmeCache.entries, key)
	for i, cachedKey := range installedReadmeCache.keys {
		if cachedKey == key {
			installedReadmeCache.keys = append(installedReadmeCache.keys[:i], installedReadmeCache.keys[i+1:]...)
			break
		}
	}
}

// installedReadmeCacheInstallPath 取出缓存键前缀中的安装目录。
func installedReadmeCacheInstallPath(key string) string {
	if i := strings.IndexByte(key, 0); 0 <= i {
		return key[:i]
	}
	return key
}

// InvalidateInstalledPackageReadmeCache 丢弃指定安装目录的 README 渲染结果。
func InvalidateInstalledPackageReadmeCache(installPath string) {
	prefix := installPath + "\x00"
	installedReadmeCache.mu.Lock()
	defer installedReadmeCache.mu.Unlock()
	for key := range installedReadmeCache.entries {
		if strings.HasPrefix(key, prefix) {
			deleteInstalledReadmeCacheEntryLocked(key)
		}
	}
}

func retainInstalledPackageReadmeCache(basePath string, installPaths []string) {
	keep := make(map[string]struct{}, len(installPaths))
	for _, installPath := range installPaths {
		keep[installPath] = struct{}{}
	}
	installedReadmeCache.mu.Lock()
	defer installedReadmeCache.mu.Unlock()
	for key := range installedReadmeCache.entries {
		installPath := installedReadmeCacheInstallPath(key)
		if filepath.Dir(installPath) != basePath {
			continue
		}
		if _, ok := keep[installPath]; !ok {
			deleteInstalledReadmeCacheEntryLocked(key)
		}
	}
}

func readInstalledPackageReadme(readmePath string) (data []byte, info os.FileInfo, err error) {
	file, err := os.Open(readmePath)
	if err != nil {
		return
	}
	defer file.Close()

	// 使用读取内容的文件句柄取属性，避免文件被替换时混用两个版本。
	info, _ = file.Stat()
	data, err = io.ReadAll(file)
	return
}

func getInstalledPackageREADME(installPath, localRootURL, repoURL, repoRef string, cacheVersion int64,
	readme LocaleStrings) (ret string) {
	cacheKey := installedReadmeCacheKey(installPath, localRootURL, repoURL, repoRef, cacheVersion)
	candidates := getReadmeFileCandidates(readme)
	var errMsgs []string
	for _, name := range candidates {
		readmePath := filepath.Join(installPath, name)
		if cached, ok := lookupInstalledPackageReadme(cacheKey, readmePath); ok {
			return cached
		}
		readmeData, info, readErr := readInstalledPackageReadme(readmePath)
		if readErr == nil {
			remoteRoot := packageRemoteRootURL(repoURL, repoRef, false)
			linkBase := readmeDirectoryURL(localRootURL, name)
			ret = installedReadmeRenderer(linkBase, readmeData, func(src string) string {
				return resolvePackageREADMEImage(src, installPath, localRootURL, remoteRoot, name, cacheVersion)
			})
			if info != nil {
				storeInstalledPackageReadme(cacheKey, readmePath,
					installedManifestStamp{size: info.Size(), modTime: info.ModTime().UnixNano()}, ret)
			}
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
	return renderPackageREADMEWithImageResolver(linkBase, mdData, nil)
}

func renderPackageREADMEWithImageResolver(linkBase string, mdData []byte, resolveImage func(string) string) (ret string) {
	mdData = bytes.Clone(bytes.TrimPrefix(mdData, []byte("\xef\xbb\xbf"))) // 移除文件开头的 BOM 并隔离解析缓冲区
	luteEngine := lute.New()
	luteEngine.SetCallout(true)
	luteEngine.SetSanitize(true)
	luteEngine.SetSoftBreak2HardBreak(false)
	luteEngine.SetCodeSyntaxHighlight(false)
	luteEngine.SetLinkBase(linkBase)

	tree := parse.Parse("", mdData, luteEngine.ParseOptions)
	normalizeNodesIAL(tree)
	rewritePackageREADMEImages(tree, resolveImage)
	ret = luteEngine.Tree2HTML(tree, luteEngine.RenderOptions, luteEngine.ParseOptions)
	ret = util.ConvertIframeToLink(ret)
	ret = util.LinkTarget(ret, linkBase)
	return
}

func resolvePackageREADMEImage(src, installPath, localRootURL, remoteRootURL, readmePath string,
	cacheVersion int64) string {
	parsed, err := url.Parse(src)
	if err != nil || src == "" || parsed.IsAbs() || parsed.Host != "" || strings.HasPrefix(src, "/") ||
		strings.HasPrefix(src, "#") {
		return src
	}
	resolvedPath, ok := normalizePackageRelativePath(path.Join(path.Dir(readmePath), parsed.Path))
	if !ok {
		return "/"
	}

	useLocal := remoteRootURL == ""
	if installPath != "" {
		info, statErr := os.Stat(filepath.Join(installPath, filepath.FromSlash(resolvedPath)))
		useLocal = statErr == nil && info.Mode().IsRegular()
	}
	if !useLocal && remoteRootURL != "" {
		return packageURLAtPath(remoteRootURL, resolvedPath, parsed.RawQuery, parsed.Fragment)
	}

	rawQuery := parsed.RawQuery
	if cacheVersion > 0 {
		if rawQuery != "" {
			rawQuery += "&"
		}
		rawQuery += "v=" + strconv.FormatInt(cacheVersion, 10)
	}
	return packageURLAtPath(localRootURL, resolvedPath, rawQuery, parsed.Fragment)
}

func rewritePackageREADMEImages(tree *parse.Tree, resolveImage func(string) string) {
	if tree == nil || tree.Root == nil || resolveImage == nil {
		return
	}
	ast.Walk(tree.Root, func(n *ast.Node, entering bool) ast.WalkStatus {
		if !entering {
			return ast.WalkContinue
		}
		switch n.Type {
		case ast.NodeImage:
			if dest := n.ChildByType(ast.NodeLinkDest); dest != nil {
				dest.Tokens = []byte(resolveImage(string(dest.Tokens)))
			}
		case ast.NodeHTMLBlock, ast.NodeInlineHTML:
			n.Tokens = rewriteHTMLImageSources(n.Tokens, resolveImage)
		}
		return ast.WalkContinue
	})
}

func rewriteHTMLImageSources(tokens []byte, resolveImage func(string) string) []byte {
	if !bytes.Contains(bytes.ToLower(tokens), []byte("<img")) {
		return tokens
	}
	contextNode := &nethtml.Node{Type: nethtml.ElementNode, Data: "div", DataAtom: atom.Div}
	nodes, err := nethtml.ParseFragment(bytes.NewReader(tokens), contextNode)
	if err != nil {
		return tokens
	}
	changed := false
	var rewrite func(*nethtml.Node)
	rewrite = func(node *nethtml.Node) {
		if node.Type == nethtml.ElementNode && node.DataAtom == atom.Img {
			for i, attr := range node.Attr {
				if strings.EqualFold(attr.Key, "src") {
					resolved := resolveImage(attr.Val)
					if resolved != attr.Val {
						node.Attr[i].Val = resolved
						changed = true
					}
				}
			}
		}
		for child := node.FirstChild; child != nil; child = child.NextSibling {
			rewrite(child)
		}
	}
	for _, node := range nodes {
		rewrite(node)
	}
	if !changed {
		return tokens
	}
	var buf bytes.Buffer
	for _, node := range nodes {
		if renderErr := nethtml.Render(&buf, node); renderErr != nil {
			return tokens
		}
	}
	return buf.Bytes()
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
		for item := range strings.FieldsSeq(attr[1]) {
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
