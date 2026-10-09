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
	"io/fs"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
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

func NormalizeTemplatePath(p string) string {
	p = TrimSpaceInPath(p)
	if "" == p {
		return ""
	}
	if !strings.HasSuffix(p, ".md") {
		p += ".md"
	}
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	return p
}

func GetTreeID(treePath string) string {
	base := path.Base(strings.ReplaceAll(treePath, "\\", "/"))
	return strings.TrimSuffix(base, ".sy")
}

func ShortPathForBootingDisplay(p string) string {
	if 25 > len(p) {
		return p
	}
	p = strings.TrimSuffix(p, ".sy")
	p = path.Base(p)
	return p
}

var (
	localIPsMu sync.RWMutex
	localIPs   []string
)

func SetLocalIPs(addresses []string) {
	localIPsMu.Lock()
	localIPs = append([]string(nil), addresses...)
	localIPsMu.Unlock()
}

func GetLocalIPs() []string {
	localIPsMu.RLock()
	defer localIPsMu.RUnlock()
	return append([]string(nil), localIPs...)
}

func GetServerAddrs() (ret []string) {
	if ContainerAndroid != Container && ContainerHarmony != Container {
		ret = GetPrivateIPv4s()
	} else {
		// Android/鸿蒙上用不了 net.InterfaceAddrs() https://github.com/golang/go/issues/40569，所以前面使用启动内核传入的参数 localIPs
		ret = GetLocalIPs()
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

// NodeIDByTime 根据指定时间生成符合块 ID 格式的字符串，算法与 ast.NewNodeID() 一致，
// 仅时间源不同：用于让历史输入（如移动端速记暂存文件名时间戳）回填为块 ID。
func NodeIDByTime(t time.Time) string {
	return t.Format("20060102150405") + "-" + RandString(7)
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
	selected := map[string]struct{}{}
	for _, fromPath := range paths {
		selected[fromPath] = struct{}{}
	}

	added := map[string]struct{}{}
	for _, fromPath := range paths {
		if _, ok := added[fromPath]; ok {
			continue
		}
		existParent := false
		for parentDir := path.Dir(fromPath); "/" != parentDir && "." != parentDir; parentDir = path.Dir(parentDir) {
			if _, ok := selected[parentDir+".sy"]; ok {
				existParent = true
				break
			}
		}
		if existParent {
			continue
		}
		ret = append(ret, fromPath)
		added[fromPath] = struct{}{}
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
	SiYuanAssetsImage = []string{".apng", ".ico", ".cur", ".jpg", ".jpe", ".jpeg", ".jfif", ".pjp", ".pjpeg", ".png", ".gif", ".webp", ".bmp", ".svg", ".avif", ".heic", ".heif"}
	SiYuanAssetsAudio = []string{".mp3", ".wav", ".ogg", ".m4a", ".aac", ".flac"}
	SiYuanAssetsVideo = []string{".mov", ".weba", ".mkv", ".mp4", ".webm"}
)

// IsPossiblyImage 模糊判断指定文件链接是否可能是图片。
func IsPossiblyImage(assetPath string) bool {
	extensionPath := assetPath
	if index := strings.IndexAny(extensionPath, "?#"); index >= 0 {
		extensionPath = extensionPath[:index]
	}
	ext := strings.ToLower(filepath.Ext(extensionPath))
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
//
// 为防止通过符号链接绕过黑名单，对工作空间外的路径会额外解析符号链接后再检查一次：这是
// globalCopyFiles 等接受工作空间外绝对路径的接口的攻击面。工作空间内的路径不解析符号链接，
// 一是因为工作空间内文件（如 assets 中指向外部目录的符号链接）可能合法地指向工作空间外，
// 对其解析后执行系统目录前缀检查会误伤；二是避免在高 QPS 的伺服热路径上引入额外的 stat 开销。
// 目标尚未创建时解析最长已存在的父目录，避免别名下的新文件绕过敏感目录检查。
func IsSensitivePath(p string) bool {
	if p == "" {
		return false
	}
	if IsPluginDevelopmentRawPathForbidden(p, false) {
		return true
	}
	if isSensitivePath(p, false) {
		return true
	}
	// 仅对工作空间外的路径解析符号链接，防止用符号链接绕过黑名单指向敏感目标。
	// 归属判断与后续黑名单匹配都使用归一化后的形式，避免命名空间别名被当作工作空间外的路径。
	if gulu.File.IsSubPath(WorkspaceDir, resolveNamespaceAlias(p)) {
		return false
	}
	resolved := ResolveLongestExistingParent(p)
	if resolved != p {
		if isSensitivePath(resolved, false) {
			return true
		}
	}
	return false
}

// IsSensitiveHTMLAssetPath 允许剪贴板引用用户文档及系统临时文件，仍检查凭据、工作空间私有目录和符号链接目标。
func IsSensitiveHTMLAssetPath(p string) bool {
	if p == "" {
		return false
	}
	if IsPluginDevelopmentRawPathForbidden(p, false) {
		return true
	}
	return isSensitivePath(p, true) || isSensitivePath(ResolveLongestExistingParent(p), true)
}

// resolveNamespaceAlias 把 Windows 路径命名空间别名归一化为常规 Win32 路径，供黑名单匹配与工作空间归属判断使用。
//
// 扩展长度前缀 `\\?\`（含 `\\?\UNC\`）与设备命名空间前缀 `\\.\` 经 filepath.Clean 后原样保留，
// 既无法命中按前缀比较的黑名单，也会被文件系统归属判断当作工作空间外的路径，从而绕过敏感路径保护。
// 本机管理共享（`\\localhost\<盘符>$\...` 或 `\\<本机主机名>\<盘符>$\...`）指向本地卷，同样归一化为盘符路径。
func resolveNamespaceAlias(p string) string {
	if runtime.GOOS != "windows" || p == "" {
		return p
	}

	// 仅剥离 `\\?\` 与 `\\.\` 前缀，保留其后的 `UNC\` 标记，以便下面还原 UNC 根路径
	for _, prefix := range []string{`\\?\`, `\\.\`} {
		if strings.HasPrefix(p, prefix) {
			p = p[len(prefix):]
			break
		}
	}
	if strings.HasPrefix(p, `UNC\`) {
		p = `\\` + p[len(`UNC\`):]
	}

	cleaned := filepath.Clean(p)
	if strings.HasPrefix(cleaned, `\\`) {
		// 仅当主机名是本机且共享名就是盘符时才等价于本地卷，其余 UNC 路径一律按常规路径匹配黑名单
		if drive, prefixLen := localAdminShareDrive(cleaned); drive != "" {
			// 用盘符替换主机名与共享名（形如 `\\主机名\D$`），其余路径保持原样
			rest := cleaned[2+prefixLen:]
			if !strings.HasPrefix(rest, `\`) {
				rest = `\` + rest
			}
			return drive + rest
		}
	}
	return cleaned
}

// localAdminShareDrive 判断 UNC 路径是否指向本机管理共享，是则返回对应的盘符与「主机名\共享名」的长度，否则返回空串。
func localAdminShareDrive(p string) (drive string, prefixLen int) {
	rest := p[2:]
	sep := strings.Index(rest, `\`)
	if sep < 0 {
		return "", 0
	}

	host := rest[:sep]
	rest = rest[sep+1:]
	shareSep := strings.Index(rest, `\`)
	share := rest
	if 0 <= shareSep {
		share = rest[:shareSep]
	}
	if len(share) != 2 || share[1] != '$' || !isASCIILetter(share[0]) {
		return "", 0
	}

	if !strings.EqualFold(host, "localhost") {
		hostname, err := os.Hostname()
		if err != nil || "" == hostname || !strings.EqualFold(host, hostname) {
			return "", 0
		}
	}
	return strings.ToUpper(share[:1]) + ":", sep + 1 + len(share)
}

func isASCIILetter(b byte) bool {
	return 'a' <= b && b <= 'z' || 'A' <= b && b <= 'Z'
}

func isHTMLAssetUserPath(p string) bool {
	for _, root := range []string{os.TempDir(), HomeDir, systemHomeDir} {
		if root == "" {
			continue
		}
		if gulu.File.IsSubPath(root, p) || gulu.File.IsSubPath(ResolveLongestExistingParent(root), p) {
			return true
		}
	}
	return false
}

// sensitiveHomeDotEntries 是家目录下默认敏感的凭据条目，按名称前缀匹配。
// .env 使用前缀匹配，以覆盖 .env.local、.env.production 等派生文件。
var sensitiveHomeDotEntries = []string{
	".env",
	".ssh", ".config", ".bashrc", ".zshrc", ".profile", ".git-credentials", ".netrc", ".pgpass",
	".kube", ".docker", ".gnupg", ".aws", ".azure", ".npmrc", ".pypirc",
}

// sensitiveHomeEntry 是家目录下的敏感条目，按名称前缀匹配。
type sensitiveHomeEntry struct {
	name string
	// exemptSystemTemp 表示该条目放行系统临时目录：Windows 的 AppData\Local 下即系统临时目录，
	// 而剪贴板及 HTML 粘贴的本地资源允许取自该目录。
	exemptSystemTemp bool
}

// platformSensitiveHomeEntries 是家目录下按平台附加的敏感条目：macOS 的用户资源库包含钥匙串等凭据，
// Windows 的漫游与本地应用数据包含各类 CLI 与桌面应用的凭据。
var platformSensitiveHomeEntries = map[string][]sensitiveHomeEntry{
	"darwin":  {{name: "Library"}},
	"windows": {{name: filepath.Join("AppData", "Roaming")}, {name: filepath.Join("AppData", "Local"), exemptSystemTemp: true}},
}

// isSystemTempPath 判断小写路径是否位于系统临时目录中。
func isSystemTempPath(lowerPath string) bool {
	for _, root := range []string{os.TempDir(), SystemTempDir} {
		if root == "" {
			continue
		}
		root = strings.ToLower(filepath.Clean(root))
		if lowerPath == root || strings.HasPrefix(lowerPath, root+string(filepath.Separator)) {
			return true
		}
	}
	return false
}

// isSensitivePath 执行敏感性黑名单匹配，必要时解析工作空间路径，但不解析目标路径。
func isSensitivePath(p string, htmlAsset bool) bool {
	p = resolveNamespaceAlias(p)
	toCheckPathLower := filepath.Clean(strings.ToLower(p))
	toCheckNameLower := filepath.Base(toCheckPathLower)
	workspaceDir := WorkspaceDir
	inWorkspace := gulu.File.IsSubPath(workspaceDir, p)
	if !inWorkspace && workspaceDir != "" {
		// 静态资源使用解析后的真实路径，工作空间也需采用相同形式判断归属及 conf、temp 目录。
		// 仅解析工作空间根目录，不能将指向外部敏感文件的资源符号链接视为工作空间内文件。
		if resolved, err := filepath.EvalSymlinks(workspaceDir); err == nil && gulu.File.IsSubPath(resolved, p) {
			workspaceDir = resolved
			inWorkspace = true
		}
	}

	// 工作空间和剪贴板引用的用户目录可位于系统目录中，但仍需检查配置、私有临时文件和凭据。
	// iOS 沙箱、macOS 临时目录及 Linux /var/home 均按各自目录边界判断。
	if !inWorkspace && !(htmlAsset && isHTMLAssetUserPath(p)) {
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
	}

	// 工作空间/conf 目录（小写比较）
	workspaceConfPrefix := strings.ToLower(filepath.Join(workspaceDir, "conf"))
	if strings.HasPrefix(toCheckPathLower, workspaceConfPrefix) {
		return true
	}

	// 只允许导出工作空间/temp/export 目录，不允许导出工作空间/temp 目录（小写比较）
	workspaceTempExportPrefix := strings.ToLower(filepath.Join(workspaceDir, "temp", "export"))
	workspaceTempPrefix := strings.ToLower(filepath.Join(workspaceDir, "temp"))
	if strings.HasPrefix(toCheckPathLower, workspaceTempPrefix) && !strings.HasPrefix(toCheckPathLower, workspaceTempExportPrefix) {
		return true
	}

	// 用户家目录下的敏感目录与凭据文件（小写比较）。
	// 覆盖常见凭据 dotfile、dotenv 配置文件与平台应用数据目录，防止接受工作空间外绝对路径的接口
	// 把内核用户家目录下的凭据复制进工作空间后外泄：Git push token、HTTP/API 凭据、Postgres 密码、
	// K8s/Docker/容器仓库配置、GPG 私钥环、云厂商 CLI 凭据、包管理器 token 等。
	homeDirs := []string{HomeDir}
	// 自定义配置主目录不能使系统用户主目录中的凭据失去保护。
	if homeDirOverridden && systemHomeDir != "" && systemHomeDir != HomeDir {
		homeDirs = append(homeDirs, systemHomeDir)
		if resolved, err := filepath.EvalSymlinks(systemHomeDir); err == nil && resolved != systemHomeDir {
			homeDirs = append(homeDirs, resolved)
		}
	}
	homeCheckPaths := []string{toCheckPathLower}
	if HomeDir != "" {
		// 主目录自身也可能是别名，工作空间规范路径必须同时匹配其真实目录中的敏感位置。
		if resolved, err := filepath.EvalSymlinks(HomeDir); err == nil && resolved != HomeDir {
			homeDirs = append(homeDirs, resolved)
		}
	}
	// 工作空间别名可能位于自定义主目录中，但指向系统主目录中的敏感位置。
	// 只映射工作空间根目录，保留对尚未创建的目标及工作空间内路径的检查。
	if inWorkspace && workspaceDir == WorkspaceDir {
		if resolved, err := filepath.EvalSymlinks(workspaceDir); err == nil && resolved != workspaceDir {
			if rel, err := filepath.Rel(workspaceDir, p); err == nil {
				homeCheckPaths = append(homeCheckPaths, strings.ToLower(filepath.Join(resolved, rel)))
			}
		}
	}
	for _, homeDir := range homeDirs {
		for _, name := range sensitiveHomeDotEntries {
			for _, checkPath := range homeCheckPaths {
				if strings.HasPrefix(checkPath, strings.ToLower(filepath.Join(homeDir, name))) {
					return true
				}
			}
		}
		for _, entry := range platformSensitiveHomeEntries[runtime.GOOS] {
			prefix := strings.ToLower(filepath.Join(homeDir, entry.name))
			for _, checkPath := range homeCheckPaths {
				if !strings.HasPrefix(checkPath, prefix) {
					continue
				}
				if entry.exemptSystemTemp && isSystemTempPath(checkPath) {
					continue
				}
				return true
			}
		}
	}

	// 特定的文件名前缀（小写比较）
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

// ResolveLongestExistingParent 解析 absPath 中最长已存在部分的 symlink，拼回剩余路径。
// 例如 absPath = /workspace/data/link/newdir/file，其中 /workspace/data/link 是指向
// /workspace/data/<encBoxID>/ 的 symlink，newdir/file 尚不存在：
// 返回 /workspace/data/<encBoxID>/newdir/file。
func ResolveLongestExistingParent(absPath string) string {
	cleaned := filepath.Clean(absPath)
	dir := cleaned
	for {
		if _, err := os.Lstat(dir); err == nil {
			break
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return cleaned
		}
		dir = parent
	}
	if dir == cleaned {
		if resolved, err := filepath.EvalSymlinks(cleaned); err == nil {
			return resolved
		}
		return cleaned
	}
	if dir == "/" || dir == "." {
		return cleaned
	}
	resolvedDir, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return cleaned
	}
	remaining := strings.TrimPrefix(cleaned, dir)
	return resolvedDir + remaining
}
