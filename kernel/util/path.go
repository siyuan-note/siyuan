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
	"os"
	"path"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"github.com/88250/gulu"
	"github.com/gabriel-vasile/mimetype"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
)

var (
	SSL       = false
	UserAgent = "SiYuan/" + Ver
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

	for i, _ := range ret {
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
	endpoint = strings.TrimSpace(endpoint)
	if "" == endpoint {
		return ""
	}
	if !strings.HasPrefix(endpoint, "http://") && !strings.HasPrefix(endpoint, "https://") {
		endpoint = "http://" + endpoint
	}
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
		for d, _ := range dirs {
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

func IsAssetsImage(assetPath string) bool {
	ext := strings.ToLower(filepath.Ext(assetPath))
	if "" == ext {
		absPath := filepath.Join(DataDir, assetPath)
		f, err := filelock.OpenFile(absPath, os.O_RDONLY, 0644)
		if err != nil {
			logging.LogErrorf("open file [%s] failed: %s", absPath, err)
			return false
		}
		defer filelock.CloseFile(f)
		m, err := mimetype.DetectReader(f)
		if nil != err {
			logging.LogWarnf("detect file [%s] mimetype failed: %v", absPath, err)
			return false
		}

		ext = m.Extension()
	}
	return gulu.Str.Contains(ext, SiYuanAssetsImage)
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

	if IsSubPath(WorkspaceDir, absPath) {
		return absPath, nil
	}
	return "", os.ErrPermission
}

func IsAbsPathInWorkspace(absPath string) bool {
	return IsSubPath(WorkspaceDir, absPath)
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
	} else {
		// On Unix-like systems, the root path is "/"
		return cleanPath == "/"
	}
}

// IsSensitivePath 对传入路径做统一的敏感性检测。
func IsSensitivePath(p string) bool {
	if p == "" {
		return false
	}
	pp := filepath.Clean(strings.ToLower(p))

	// 精确敏感文件
	exact := []string{
		"/etc/passwd",
		"/etc/shadow",
		"/etc/gshadow",
		"/var/run/secrets/kubernetes.io/serviceaccount/token",
	}
	for _, e := range exact {
		if pp == e {
			return true
		}
	}

	// 敏感目录前缀（UNIX 风格）
	prefixes := []string{
		"/etc/ssh",
		"/root",
		"/etc/ssl",
		"/etc/letsencrypt",
		"/var/lib/docker",
		"/.gnupg",
		"/.ssh",
		"/.aws",
		"/.kube",
		"/.docker",
		"/.config/gcloud",
	}
	for _, pre := range prefixes {
		if strings.HasPrefix(pp, pre) {
			return true
		}
	}

	// Windows 常见敏感目录（小写比较）
	winPrefixes := []string{
		`c:\windows\system32`,
		`c:\windows\system`,
		`c:\users\`,
	}
	for _, wp := range winPrefixes {
		if strings.HasPrefix(pp, strings.ToLower(wp)) {
			return true
		}
	}

	// 文件名级别检查
	base := filepath.Base(pp)
	n := strings.ToLower(base)
	sensitiveNames := map[string]struct{}{
		".env":            {},
		".env.local":      {},
		".npmrc":          {},
		".netrc":          {},
		"id_rsa":          {},
		"id_dsa":          {},
		"id_ecdsa":        {},
		"id_ed25519":      {},
		"authorized_keys": {},
		"passwd":          {},
		"shadow":          {},
		"pgpass":          {},
		"hosts":           {},
		"credentials":     {}, // 如 aws credentials
		"config.json":     {}, // docker config.json 可能含 token
	}
	if _, ok := sensitiveNames[n]; ok {
		return true
	}
	// 支持 .env.* 之类的模式
	if n == ".env" || strings.HasPrefix(n, ".env.") {
		return true
	}

	// 扩展名级别检查
	ext := strings.ToLower(filepath.Ext(n))
	sensitiveExts := []string{
		".pem", ".key", ".p12", ".pfx", ".ppk", ".asc", ".gpg",
	}
	for _, se := range sensitiveExts {
		if ext == se {
			return true
		}
	}
	return false
}
