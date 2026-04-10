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
	"io/fs"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
)

var (
	SSL       = false
	UserAgent = "SiYuan/" + Ver

	// invisibleCharsReplacer 用于 NormalizeEndpoint：去除复制粘贴易带入的零宽字符。
	invisibleCharsReplacer = strings.NewReplacer(
		"\u200b", "", // 零宽空格 ZWSP
		"\u200c", "", // 零宽不连字 ZWNJ
		"\u200d", "", // 零宽连字 ZWJ
	)
)

func TrimSpaceInPath(p string) string {
	parts := strings.Split(p, "/")
	for i, part := range parts {
		parts[i] = strings.TrimSpace(part)
	}
	return strings.Join(parts, "/")
}

func GetTreeID(treePath string) string {
	if strings.Contains(treePath, "\\") {
		return strings.TrimSuffix(filepath.Base(treePath), ".sy")
	}
	return strings.TrimSuffix(path.Base(treePath), ".sy")
}

func ShortPathForBootingDisplay(p string) string {
	if 25 > len(p) {
		return p
	}
	p = strings.TrimSuffix(p, ".sy")
	p = path.Base(p)
	return p
}

var LocalIPs []string

func GetServerAddrs() (ret []string) {
	if ContainerAndroid != Container && ContainerHarmony != Container {
		ret = GetPrivateIPv4s()
	} else {
		// Android/鸿蒙上用不了 net.InterfaceAddrs() https://github.com/golang/go/issues/40569，所以前面使用启动内核传入的参数 localIPs
		ret = LocalIPs
	}

	ret = append(ret, LocalHost)
	ret = gulu.Str.RemoveDuplicatedElem(ret)

	for i := range ret {
		ret[i] = "http://" + ret[i] + ":" + ServerPort
	}
	return
}

func isRunningInDockerContainer() bool {
	if _, runInContainer := os.LookupEnv("RUN_IN_CONTAINER"); runInContainer {
		return true
	}
	if _, err := os.Stat("/.dockerenv"); err == nil {
		return true
	}
	return false
}

func IsRelativePath(dest string) bool {
	if 1 > len(dest) {
		return true
	}

	if '/' == dest[0] {
		return false
	}

	// 检查特定协议前缀
	lowerDest := strings.ToLower(dest)
	if strings.HasPrefix(lowerDest, "mailto:") ||
		strings.HasPrefix(lowerDest, "tel:") ||
		strings.HasPrefix(lowerDest, "sms:") {
		return false
	}
	return !strings.Contains(dest, ":/") && !strings.Contains(dest, ":\\")
}

func TimeFromID(id string) (ret string) {
	if 14 > len(id) {
		logging.LogWarnf("invalid id [%s], stack [\n%s]", id, logging.ShortStack())
		return time.Now().Format("20060102150405")
	}
	ret = id[:14]
	return
}

func GetChildDocDepth(treeAbsPath string) (ret int) {
	dir := strings.TrimSuffix(treeAbsPath, ".sy")
	if !gulu.File.IsDir(dir) {
		return
	}

	baseDepth := strings.Count(filepath.ToSlash(treeAbsPath), "/")
	depth := 1
	filelock.Walk(dir, func(path string, d fs.DirEntry, err error) error {
		p := filepath.ToSlash(path)
		currentDepth := strings.Count(p, "/")
		if depth < currentDepth {
			depth = currentDepth
		}
		return nil
	})
	ret = depth - baseDepth
	return
}

func NormalizeConcurrentReqs(concurrentReqs int, provider int) int {
	switch provider {
	case 0: // SiYuan
		switch {
		case concurrentReqs < 1:
			concurrentReqs = 8
		case concurrentReqs > 16:
			concurrentReqs = 16
		default:
		}
	case 2: // S3
		switch {
		case concurrentReqs < 1:
			concurrentReqs = 8
		case concurrentReqs > 16:
			concurrentReqs = 16
		default:
		}
	case 3: // WebDAV
		switch {
		case concurrentReqs < 1:
			concurrentReqs = 1
		case concurrentReqs > 16:
			concurrentReqs = 16
		default:
		}
	case 4: // Local File System
		switch {
		case concurrentReqs < 1:
			concurrentReqs = 16
		case concurrentReqs > 1024:
			concurrentReqs = 1024
		default:
		}
	}
	return concurrentReqs
}

func NormalizeTimeout(timeout int) int {
	if 7 > timeout {
		if 1 > timeout {
			return 60
		}
		return 7
	}
	if 300 < timeout {
		return 300
	}
	return timeout
}

func NormalizeEndpoint(endpoint string) string {
	endpoint = invisibleCharsReplacer.Replace(endpoint)
	endpoint = strings.TrimSpace(endpoint)
	if "" == endpoint {
		return ""
	}
	endpoint = strings.Replace(endpoint, "http://http(s)://", "https://", 1)
	endpoint = strings.Replace(endpoint, "http(s)://", "https://", 1)
	if !strings.HasPrefix(endpoint, "http://") && !strings.HasPrefix(endpoint, "https://") {
		endpoint = "http://" + endpoint
	}
	if idx := strings.Index(endpoint, "://"); 0 <= idx {
		head := endpoint[:idx+len("://")]
		tail := endpoint[idx+len("://"):]
		for strings.Contains(tail, "//") {
			tail = strings.ReplaceAll(tail, "//", "/")
		}
		endpoint = head + tail
	}
	endpoint = strings.TrimSpace(endpoint)
	if !strings.HasSuffix(endpoint, "/") {
		endpoint = endpoint + "/"
	}
	return endpoint
}

func NormalizeLocalPath(endpoint string) string {
	endpoint = strings.TrimSpace(endpoint)
	if "" == endpoint {
		return ""
	}
	endpoint = filepath.ToSlash(filepath.Clean(endpoint))
	if !strings.HasSuffix(endpoint, "/") {
		endpoint = endpoint + "/"
	}
	return endpoint
}

func FilterMoveDocFromPaths(fromPaths []string, toPath string) (ret []string) {
	tmp := FilterSelfChildDocs(fromPaths)
	for _, fromPath := range tmp {
		fromDir := strings.TrimSuffix(fromPath, ".sy")
		if strings.HasPrefix(toPath, fromDir) {
			continue
		}
		ret = append(ret, fromPath)
	}
	return
}

func FilterSelfChildDocs(paths []string) (ret []string) {
	sort.Slice(paths, func(i, j int) bool { return strings.Count(paths[i], "/") < strings.Count(paths[j], "/") })

	dirs := map[string]string{}
	for _, fromPath := range paths {
		dir := strings.TrimSuffix(fromPath, ".sy")
		existParent := false
		for d := range dirs {
			if strings.HasPrefix(fromPath, d) {
				existParent = true
				break
			}
		}
		if existParent {
			continue
		}
		dirs[dir] = fromPath
		ret = append(ret, fromPath)
	}
	return
}

// FileURLToLocalPath 将 file:// URL 转为本地文件路径。
func FileURLToLocalPath(fileURL string) string {
	if len(fileURL) < 7 || strings.ToLower(fileURL[:7]) != "file://" {
		return ""
	}
	p := fileURL[7:]
	if gulu.OS.IsWindows() && strings.Contains(p, ":") {
		// Windows 支持 file:// 后跟多个斜杠 https://github.com/siyuan-note/siyuan/issues/11885
		p = strings.TrimLeft(p, "/")
	}
	if strings.Contains(p, "?") {
		// 去除查询参数 https://github.com/siyuan-note/siyuan/issues/13600
		p = p[:strings.Index(p, "?")]
	}
	if unescaped, err := url.PathUnescape(p); err == nil && unescaped != p {
		// `Convert network images/assets to local` supports URL-encoded local file names https://github.com/siyuan-note/siyuan/issues/9929
		p = unescaped
	}
	return p
}

func IsAssetLinkDest(dest []byte, includeServePath bool) bool {
	return bytes.HasPrefix(dest, []byte("assets/")) ||
		(includeServePath && (bytes.HasPrefix(dest, []byte("emojis/")) ||
			bytes.HasPrefix(dest, []byte("plugins/")) ||
			bytes.HasPrefix(dest, []byte("public/")) ||
			bytes.HasPrefix(dest, []byte("widgets/"))))
}

var (
	SiYuanAssetsImage = []string{".apng", ".ico", ".cur", ".jpg", ".jpe", ".jpeg", ".jfif", ".pjp", ".pjpeg", ".png", ".gif", ".webp", ".bmp", ".svg", ".avif"}
	SiYuanAssetsAudio = []string{".mp3", ".wav", ".ogg", ".m4a", ".flac"}
	SiYuanAssetsVideo = []string{".mov", ".weba", ".mkv", ".mp4", ".webm"}
)

// IsPossiblyImage 模糊判断指定文件链接是否可能是图片。
func IsPossiblyImage(assetPath string) bool {
	ext := strings.ToLower(filepath.Ext(assetPath))
	if "" != ext {
		return gulu.Str.Contains(ext, SiYuanAssetsImage)
	}

	if strings.HasPrefix(assetPath, "https://") || strings.HasPrefix(assetPath, "http://") {
		// 网络图片链接不一定有扩展名
		return true
	}

	if filePath := FileURLToLocalPath(assetPath); filePath != "" {
		m, ok := GetMimeTypeByPath(filePath)
		if !ok {
			return false
		}
		return gulu.Str.Contains(m.Extension(), SiYuanAssetsImage)
	}

	if IsAssetLinkDest([]byte(assetPath), true) {
		filePath := filepath.Join(DataDir, assetPath)
		m, ok := GetMimeTypeByPath(filePath)
		if !ok {
			return false
		}
		return gulu.Str.Contains(m.Extension(), SiYuanAssetsImage)
	}
	return false
}

func IsDisplayableAsset(p string) bool {
	ext := strings.ToLower(filepath.Ext(p))
	if "" == ext {
		return false
	}
	if gulu.Str.Contains(ext, SiYuanAssetsImage) {
		return true
	}
	if gulu.Str.Contains(ext, SiYuanAssetsAudio) {
		return true
	}
	if gulu.Str.Contains(ext, SiYuanAssetsVideo) {
		return true
	}
	return false
}

func GetAbsPathInWorkspace(relPath string) (string, error) {
	absPath := filepath.Join(WorkspaceDir, relPath)
	absPath = filepath.Clean(absPath)
	if WorkspaceDir == absPath {
		return absPath, nil
	}

	if gulu.File.IsSubPath(WorkspaceDir, absPath) {
		return absPath, nil
	}
	return "", os.ErrPermission
}

func IsAbsPathInWorkspace(absPath string) bool {
	return gulu.File.IsSubPath(WorkspaceDir, absPath)
}

// IsWorkspaceDir 判断指定目录是否是工作空间目录。
func IsWorkspaceDir(dir string) bool {
	conf := filepath.Join(dir, "conf", "conf.json")
	data, err := os.ReadFile(conf)
	if nil != err {
		return false
	}
	return strings.Contains(string(data), "kernelVersion")
}

// IsPartitionRootPath checks if the given path is a partition root path.
func IsPartitionRootPath(path string) bool {
	if path == "" {
		return false
	}

	// Clean the path to remove any trailing slashes
	cleanPath := filepath.Clean(path)

	// Check if the path is the root path based on the operating system
	if runtime.GOOS == "windows" {
		// On Windows, root paths are like "C:\", "D:\", etc.
		return len(cleanPath) == 3 && cleanPath[1] == ':' && cleanPath[2] == '\\'
	}

	// On Unix-like systems, the root path is "/"
	return cleanPath == "/"
}

// IsSensitivePath 对传入路径做统一的敏感性检测。
func IsSensitivePath(p string) bool {
	if p == "" {
		return false
	}
	toCheckPathLower := filepath.Clean(strings.ToLower(p))
	toCheckNameLower := filepath.Base(toCheckPathLower)

	// 敏感目录前缀（UNIX 风格）
	prefixes := []string{
		"/.",
		"/etc",
		"/root",
		"/var",
		"/proc",
		"/sys",
		"/run",
		"/bin",
		"/boot",
		"/dev",
		"/lib",
		"/srv",
		"/tmp",
		"/usr",
		"/opt",
		"/sbin",
	}
	for _, pre := range prefixes {
		if strings.HasPrefix(toCheckPathLower, pre) {
			return true
		}
	}

	// Windows 常见敏感目录（小写比较）
	winPrefixes := []string{
		`c:\windows\system32`,
		`c:\windows\system`,
	}
	for _, wp := range winPrefixes {
		if strings.HasPrefix(toCheckPathLower, strings.ToLower(wp)) {
			return true
		}
	}

	// Windows 开始启动菜单路径（小写比较）
	startMenuPrefixes := []string{
		strings.ToLower(filepath.Join(os.Getenv("APPDATA"), "Microsoft", "Windows", "Start Menu")),
		strings.ToLower(filepath.Join(os.Getenv("ProgramData"), "Microsoft", "Windows", "Start Menu")),
	}
	for _, sp := range startMenuPrefixes {
		if strings.HasPrefix(toCheckPathLower, sp) {
			return true
		}
	}

	// 工作空间/conf 目录（小写比较）
	workspaceConfPrefix := strings.ToLower(filepath.Join(WorkspaceDir, "conf"))
	if strings.HasPrefix(toCheckPathLower, workspaceConfPrefix) {
		return true
	}

	// 用户家目录下的敏感目录（小写比较）
	homePrefixes := []string{
		strings.ToLower(filepath.Join(HomeDir, ".ssh")),
		strings.ToLower(filepath.Join(HomeDir, ".config")),
		strings.ToLower(filepath.Join(HomeDir, ".bashrc")),
		strings.ToLower(filepath.Join(HomeDir, ".zshrc")),
		strings.ToLower(filepath.Join(HomeDir, ".profile")),
	}
	for _, hp := range homePrefixes {
		if strings.HasPrefix(toCheckPathLower, hp) {
			return true
		}
	}

	// 特定的文件名（小写比较）
	namePrefixes := []string{
		strings.ToLower("credentials"),
		strings.ToLower("id_"),
	}
	for _, np := range namePrefixes {
		if strings.HasPrefix(toCheckNameLower, np) {
			return true
		}
	}
	return false
}
