// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/88250/gulu"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/logging"
)

type SkillInfo struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type UserSkillInfo struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Enabled     bool   `json:"enabled"`
	Shadowed    bool   `json:"shadowed"`
}

type skillRecord struct {
	Info    SkillInfo
	DirName string
	Root    string
	Content string
	Body    string
}

// SkillLoadResult 描述技能正文激活或单个资源读取的结果。
type SkillLoadResult struct {
	Name               string
	Source             string
	ID                 string
	Version            string
	Digest             string
	Content            string
	ResourcePath       string
	Resources          []string
	ResourcesTruncated bool
	SkillDir           string
}

const (
	maxSkillResourceEntries       = 200
	maxSkillResourceVisited       = 2000
	maxSkillResourceManifestBytes = 64 * 1024
	maxSkillResourceBytes         = 64 * 1024
)

func SkillsDir() string {
	return filepath.Join(DataDir, "storage", "ai", "agent", "skills")
}

func UserSkillsDir() string {
	return filepath.Join(HomeDir, ".agents", "skills")
}

func readSkillRecords(root string) []skillRecord {
	entries, err := os.ReadDir(root)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			logging.LogWarnf("read skill directory [%s] failed: %s", root, err)
		}
		return nil
	}

	var records []skillRecord
	for _, e := range entries {
		isDir := e.IsDir()
		if !isDir && IsSymlink(e) {
			if info, statErr := os.Stat(filepath.Join(root, e.Name())); statErr == nil {
				isDir = info.IsDir()
			}
		}
		if !isDir {
			continue
		}
		dirName := e.Name()
		skillMdPath := filepath.Join(root, dirName, "SKILL.md")
		b, err := readSkillSource(skillMdPath)
		if err != nil {
			if !errors.Is(err, os.ErrNotExist) {
				logging.LogWarnf("read SKILL.md [%s] failed: %s", skillMdPath, err)
			}
			continue
		}
		content := string(b)
		fm, body := parseSkillFrontmatter(content)
		name := fm["name"]
		if name == "" {
			name = dirName
		}
		desc := fm["description"]
		if desc == "" {
			desc = firstLine(body)
		}
		records = append(records, skillRecord{
			Info: SkillInfo{
				Name:        name,
				Description: desc,
			},
			DirName: dirName,
			Root:    root,
			Content: content,
			Body:    body,
		})
	}
	return records
}

func readSkillSource(path string) ([]byte, error) {
	filelock.Lock(path)
	defer filelock.Unlock(path)
	// 技能源文件不可读时交由调用方处理，避免可选技能导致内核退出。
	return os.ReadFile(path)
}

func skillKey(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
}

func skillAliases(record skillRecord) []string {
	aliases := []string{skillKey(record.Info.Name)}
	dirName := skillKey(record.DirName)
	if dirName != aliases[0] {
		aliases = append(aliases, dirName)
	}
	return aliases
}

func hasClaimedSkillAlias(record skillRecord, claimed map[string]struct{}) bool {
	for _, alias := range skillAliases(record) {
		if _, ok := claimed[alias]; ok {
			return true
		}
	}
	return false
}

func claimSkillAliases(record skillRecord, claimed map[string]struct{}) {
	for _, alias := range skillAliases(record) {
		claimed[alias] = struct{}{}
	}
}

func enabledUserSkillSet(enabledUserSkills []string) map[string]struct{} {
	ret := make(map[string]struct{}, len(enabledUserSkills))
	for _, id := range enabledUserSkills {
		if key := skillKey(id); key != "" {
			ret[key] = struct{}{}
		}
	}
	return ret
}

func resolveSkillRecords(enabledUserSkills []string) []skillRecord {
	claimed := map[string]struct{}{}
	var resolved []skillRecord
	appendRecord := func(record skillRecord) {
		if hasClaimedSkillAlias(record, claimed) {
			return
		}
		claimSkillAliases(record, claimed)
		resolved = append(resolved, record)
	}
	for _, record := range readSkillRecords(SkillsDir()) {
		appendRecord(record)
	}
	enabled := enabledUserSkillSet(enabledUserSkills)
	for _, record := range readSkillRecords(UserSkillsDir()) {
		if _, ok := enabled[skillKey(record.DirName)]; ok {
			appendRecord(record)
		}
	}
	return resolved
}

func DiscoverSkills(enabledUserSkills []string) []SkillInfo {
	records := resolveSkillRecords(enabledUserSkills)
	skills := make([]SkillInfo, 0, len(records))
	for _, record := range records {
		skills = append(skills, record.Info)
	}
	return skills
}

func DiscoverUserSkills(enabledUserSkills []string) []UserSkillInfo {
	claimed := map[string]struct{}{}
	for _, record := range readSkillRecords(SkillsDir()) {
		if !hasClaimedSkillAlias(record, claimed) {
			claimSkillAliases(record, claimed)
		}
	}

	enabled := enabledUserSkillSet(enabledUserSkills)
	var skills []UserSkillInfo
	for _, record := range readSkillRecords(UserSkillsDir()) {
		_, isEnabled := enabled[skillKey(record.DirName)]
		shadowed := hasClaimedSkillAlias(record, claimed)
		skills = append(skills, UserSkillInfo{
			ID:          record.DirName,
			Name:        record.Info.Name,
			Description: record.Info.Description,
			Enabled:     isEnabled,
			Shadowed:    shadowed,
		})
		if isEnabled && !shadowed {
			claimSkillAliases(record, claimed)
		}
	}
	return skills
}

func findSkillRecord(records []skillRecord, name string) (skillRecord, bool) {
	key := skillKey(name)
	for _, record := range records {
		if slices.Contains(skillAliases(record), key) {
			return record, true
		}
	}
	return skillRecord{}, false
}

// LoadSkill 按技能名加载正文，或按“技能名/相对路径”加载单个文本资源。
func LoadSkill(locator string, enabledUserSkills []string) (*SkillLoadResult, error) {
	name, resource := splitSkillLocator(locator)
	record, ok := findSkillRecord(resolveSkillRecords(enabledUserSkills), name)
	if !ok {
		return nil, fmt.Errorf("skill not found: %s", name)
	}

	skillDir := filepath.Join(record.Root, record.DirName)
	result := &SkillLoadResult{
		Name:     name,
		Content:  record.Body,
		SkillDir: skillDir,
	}
	if resource == "" {
		result.Resources, result.ResourcesTruncated = listSkillResources(skillDir)
		return result, nil
	}

	resource, err := normalizeSkillResourcePath(resource)
	if err != nil {
		return nil, err
	}
	if resource == "SKILL.md" {
		result.Resources, result.ResourcesTruncated = listSkillResources(skillDir)
		return result, nil
	}

	content, err := readSkillResource(skillDir, name, resource)
	if err != nil {
		return nil, err
	}
	result.Content = content
	result.ResourcePath = resource
	return result, nil
}

func splitSkillLocator(locator string) (name, resource string) {
	locator = strings.TrimSpace(strings.ReplaceAll(locator, `\`, "/"))
	name, resource, _ = strings.Cut(locator, "/")
	return
}

func normalizeSkillResourcePath(resource string) (string, error) {
	resource = strings.ReplaceAll(resource, `\`, "/")
	cleaned := path.Clean(resource)
	native := filepath.FromSlash(cleaned)
	if cleaned == "." || path.IsAbs(cleaned) || cleaned == ".." || strings.HasPrefix(cleaned, "../") ||
		filepath.IsAbs(native) || filepath.VolumeName(native) != "" || hasWindowsDrivePrefix(cleaned) {
		return "", fmt.Errorf("invalid skill resource path: %s", resource)
	}
	return cleaned, nil
}

func hasWindowsDrivePrefix(resource string) bool {
	if len(resource) < 2 || resource[1] != ':' {
		return false
	}
	drive := resource[0]
	return 'a' <= drive && drive <= 'z' || 'A' <= drive && drive <= 'Z'
}

func listSkillResources(skillDir string) (resources []string, truncated bool) {
	realRoot, err := ResolveRealPath(skillDir)
	if err != nil {
		return nil, false
	}

	visited, manifestBytes := 0, 0
	err = filepath.WalkDir(realRoot, func(current string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if current == realRoot {
			return nil
		}
		visited++
		if visited > maxSkillResourceVisited {
			truncated = true
			return filepath.SkipAll
		}
		if entry.IsDir() {
			switch entry.Name() {
			case ".git", ".svn", ".hg", ".venv", "node_modules":
				return filepath.SkipDir
			}
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 || !entry.Type().IsRegular() {
			return nil
		}

		rel, relErr := filepath.Rel(realRoot, current)
		if relErr != nil {
			return relErr
		}
		rel = filepath.ToSlash(rel)
		if rel == "SKILL.md" {
			return nil
		}
		if len(resources) == maxSkillResourceEntries || manifestBytes+len(rel) > maxSkillResourceManifestBytes {
			truncated = true
			return filepath.SkipAll
		}
		resources = append(resources, rel)
		manifestBytes += len(rel)
		return nil
	})
	if err != nil {
		truncated = true
	}
	sort.Strings(resources)
	return resources, truncated
}

func readSkillResource(skillDir, skillName, resource string) (string, error) {
	realRoot, err := ResolveRealPath(skillDir)
	if err != nil {
		return "", fmt.Errorf("skill not found: %s", skillName)
	}

	target := filepath.Join(realRoot, filepath.FromSlash(resource))
	realTarget, err := ResolveRealPath(target)
	if err != nil {
		return "", fmt.Errorf("skill resource not found: %s/%s", skillName, resource)
	}
	if realTarget != realRoot && !gulu.File.IsSubPath(realRoot, realTarget) {
		return "", fmt.Errorf("skill resource escapes skill directory: %s", resource)
	}

	info, err := os.Stat(realTarget)
	if err != nil || !info.Mode().IsRegular() {
		return "", fmt.Errorf("skill resource is not a regular file: %s/%s", skillName, resource)
	}
	if info.Size() > maxSkillResourceBytes {
		return "", fmt.Errorf("skill resource exceeds the %d byte limit: %s/%s", maxSkillResourceBytes, skillName, resource)
	}

	file, err := os.Open(realTarget)
	if err != nil {
		return "", fmt.Errorf("skill resource not found: %s/%s", skillName, resource)
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxSkillResourceBytes+1))
	if err != nil {
		return "", fmt.Errorf("skill resource read failed: %s/%s", skillName, resource)
	}
	if len(data) > maxSkillResourceBytes {
		return "", fmt.Errorf("skill resource exceeds the %d byte limit: %s/%s", maxSkillResourceBytes, skillName, resource)
	}
	if !utf8.Valid(data) {
		return "", fmt.Errorf("skill resource is not valid UTF-8: %s/%s", skillName, resource)
	}
	return string(data), nil
}

func validateSkillName(name string) error {
	if name == "" || name == "." || name == ".." {
		return fmt.Errorf("invalid skill name: %s", name)
	}
	if strings.ContainsAny(name, `/\`) {
		return fmt.Errorf("invalid skill name: %s", name)
	}
	dir := SkillsDir()
	abs := filepath.Join(dir, name)
	if !gulu.File.IsSubPath(dir, abs) {
		return fmt.Errorf("invalid skill name: %s", name)
	}
	return nil
}

func ReadSkill(name string, enabledUserSkills []string) (string, error) {
	if err := validateSkillName(name); err != nil {
		return "", err
	}
	if record, ok := findSkillRecord(resolveSkillRecords(enabledUserSkills), name); ok {
		return record.Content, nil
	}
	return "", fmt.Errorf("skill not found: %s", name)
}

func SaveSkill(name, content string) error {
	skillManagementLock.Lock()
	defer skillManagementLock.Unlock()
	if err := validateSkillName(name); err != nil {
		return err
	}
	dir := SkillsDir()
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	skillDir := filepath.Join(dir, name)
	if _, err := os.Stat(filepath.Join(skillDir, "SKILL.md")); os.IsNotExist(err) {
		if _, _, err = prepareSkillInstallationChange(name); err != nil {
			return err
		}
	}
	if err := os.MkdirAll(skillDir, 0755); err != nil {
		return err
	}
	skillMdPath := filepath.Join(skillDir, "SKILL.md")
	return filelock.WriteFile(skillMdPath, []byte(content))
}

func RemoveSkill(name string) error {
	skillManagementLock.Lock()
	defer skillManagementLock.Unlock()
	if err := validateSkillName(name); err != nil {
		return err
	}
	record, ok := findSkillRecord(readSkillRecords(SkillsDir()), name)
	if !ok {
		if _, found := findSkillRecord(readSkillRecords(UserSkillsDir()), name); found {
			return fmt.Errorf("user skill is read-only: %s", name)
		}
		return fmt.Errorf("skill not found: %s", name)
	}
	skillDir := filepath.Join(record.Root, record.DirName)
	if _, _, err := prepareSkillInstallationChange(record.DirName); err != nil {
		return err
	}
	return os.RemoveAll(skillDir)
}

func RenameSkill(oldName, newName string) error {
	skillManagementLock.Lock()
	defer skillManagementLock.Unlock()
	if err := validateSkillName(oldName); err != nil {
		return err
	}
	if err := validateSkillName(newName); err != nil {
		return err
	}
	dir := SkillsDir()
	record, ok := findSkillRecord(readSkillRecords(dir), oldName)
	if !ok {
		if _, found := findSkillRecord(readSkillRecords(UserSkillsDir()), oldName); found {
			return fmt.Errorf("user skill is read-only: %s", oldName)
		}
		return fmt.Errorf("skill not found: %s", oldName)
	}
	oldDir := filepath.Join(dir, record.DirName)
	newDir := filepath.Join(dir, newName)
	if _, err := os.Stat(newDir); err == nil {
		return fmt.Errorf("skill already exists: %s", newName)
	}
	return renameSkillInstallation(record.DirName, newName, func() error { return os.Rename(oldDir, newDir) })
}

func parseSkillFrontmatter(text string) (fm map[string]string, body string) {
	fm = map[string]string{}
	text = strings.TrimSpace(text)
	if !strings.HasPrefix(text, "---") {
		return fm, text
	}
	end := strings.Index(text[3:], "\n---")
	if end < 0 {
		return fm, text
	}
	raw := text[3 : 3+end]
	body = strings.TrimSpace(text[3+end+4:])
	for line := range strings.SplitSeq(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.TrimSpace(parts[0])
		val := strings.TrimSpace(parts[1])
		if key == "name" || key == "description" {
			fm[key] = val
		}
	}
	return fm, body
}

func firstLine(text string) string {
	text = strings.TrimSpace(text)
	if text == "" {
		return ""
	}
	idx := strings.IndexAny(text, "\n\r")
	if idx > 0 {
		text = text[:idx]
	}
	runes := []rune(text)
	if len(runes) > 200 {
		text = string(runes[:200]) + "..."
	}
	return text
}

// InstallSkillResult 记录一次安装落地的 skill 列表
type InstallSkillResult struct {
	Names        []string `json:"names"`
	Descriptions []string `json:"descriptions"`
}

// skill 下载体上限（与 web_fetch 的文件下载上限一致）
const maxSkillDownloadBytes = 10 * 1024 * 1024

// ownerRepoPattern 匹配 owner/repo 简写，如 Tencent/WeChatReading
var ownerRepoPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*$`)

// skillsAddPattern 从 "npx skills add owner/repo ..." 这类命令里提取 owner/repo
var skillsAddPattern = regexp.MustCompile(`(?:^|\s)([A-Za-z0-9][A-Za-z0-9._-]*/[A-Za-z0-9][A-Za-z0-9._-]*)(?:\s|$)`)

// normalizedSkillSource 描述归一化后的下载源
type normalizedSkillSource struct {
	repository  string
	ref         string
	subdir      string
	downloadURL string // 实际 GET 的地址
	isZip       bool   // 是否按 zip 解压处理（codeload / release zip / Content-Type 判定为 zip）
	branch      string // codeload 分支，空表示无需回退；main 失败回退 master
	treeRepo    string // GitHub tree URL 的仓库
	treePath    string // 尚未拆分的引用/子目录，引用名可能包含 /
}

// InstallSkill 从 GitHub 仓库或直链下载并安装 skill 到 SkillsDir()。
// 支持的输入：owner/repo 简写、整条 "npx skills add owner/repo -g" 命令、
// 完整 GitHub 仓库/子目录/commit URL、raw SKILL.md 直链、release zip 直链。
func InstallSkill(rawURL string) (*InstallSkillResult, error) {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return nil, errors.New("skill source is required")
	}

	src, err := normalizeSkillURL(rawURL)
	if err != nil {
		return nil, err
	}

	var data []byte
	var contentType, subdir string
	if src.treeRepo != "" {
		data, contentType, subdir, err = downloadGitHubTreeSource(src, &src)
	} else {
		data, contentType, err = downloadSkillSource(src, &src)
	}
	if err != nil {
		return nil, err
	}

	// 按内容类型或来源判定处理方式
	isZip := src.isZip || strings.HasPrefix(contentType, "application/zip") ||
		strings.HasPrefix(contentType, "application/x-zip-compressed")

	if isZip {
		return installFromZip(data, subdir, installationSource(src, subdir))
	}

	// 文本：当作单个 SKILL.md
	if strings.HasPrefix(contentType, "text/") || strings.HasPrefix(strings.TrimSpace(string(data)), "---") {
		return installFromSingleSkillMD(data, installationSource(src, subdir))
	}

	return nil, fmt.Errorf("unsupported skill source (content-type: %s); expected a zip archive or a SKILL.md text file", contentType)
}

// normalizeSkillURL 把各种输入归一化为下载源
func normalizeSkillURL(raw string) (normalizedSkillSource, error) {
	raw = strings.TrimSpace(raw)

	// 1. 整条 "npx skills add owner/repo ..." 命令：提取 owner/repo
	if strings.Contains(raw, "skills add") || strings.Contains(raw, "skills@") {
		if m := skillsAddPattern.FindStringSubmatch(raw); len(m) == 2 {
			return codeloadSource(m[1], "main"), nil
		}
	}

	// 2. owner/repo 简写（无 scheme、无点、单个 /）
	if !strings.Contains(raw, "://") && !strings.Contains(raw, "//") && ownerRepoPattern.MatchString(raw) {
		return codeloadSource(raw, "main"), nil
	}

	// 3. 带 scheme 的 URL
	u, err := url.Parse(raw)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return normalizedSkillSource{}, fmt.Errorf("unrecognized skill source: %s", raw)
	}

	switch u.Host {
	case "github.com":
		return normalizeGitHubURL(u)
	case "raw.githubusercontent.com":
		// 直接 GET 单个 SKILL.md（或其他文本文件）
		src := normalizedSkillSource{downloadURL: u.String()}
		parts := strings.Split(strings.Trim(u.Path, "/"), "/")
		if len(parts) >= 4 {
			src.repository = "https://github.com/" + parts[0] + "/" + parts[1]
			if fullSkillCommit.MatchString(parts[2]) {
				src.ref = parts[2]
				src.subdir = path.Dir(strings.Join(parts[3:], "/"))
			}
		}
		return src, nil
	default:
		// 其他直链（release zip、自建站点等）：直接 GET，是否 zip 交由 Content-Type 判定
		return normalizedSkillSource{downloadURL: u.String()}, nil
	}
}

// codeloadSource 构造 codeload zip 下载源，branch 用于 main→master 回退
func codeloadSource(ownerRepo, branch string) normalizedSkillSource {
	return normalizedSkillSource{
		repository:  "https://github.com/" + ownerRepo,
		ref:         branch,
		downloadURL: "https://codeload.github.com/" + ownerRepo + "/zip/refs/heads/" + branch,
		isZip:       true,
		branch:      branch,
	}
}

// normalizeGitHubURL 处理 github.com 的各种路径形态
func normalizeGitHubURL(u *url.URL) (normalizedSkillSource, error) {
	// /owner/repo/tree/<branch> 或 /owner/repo/tree/<branch>/<path>
	// /owner/repo/commit/<sha>
	// /owner/repo/releases/download/<tag>/<asset>
	// /owner/repo（默认分支）
	parts := strings.Split(strings.Trim(u.Path, "/"), "/")
	if len(parts) < 2 {
		return normalizedSkillSource{}, fmt.Errorf("invalid github URL: %s", u.String())
	}
	ownerRepo := parts[0] + "/" + parts[1]

	// releases/download/<tag>/<asset>
	if len(parts) >= 6 && parts[2] == "releases" && parts[3] == "download" {
		asset := parts[5]
		// 是否 zip 交由 Content-Type 最终判定，这里仅按 asset 后缀预判
		return normalizedSkillSource{downloadURL: u.String(), isZip: strings.HasSuffix(asset, ".zip")}, nil
	}

	// tree/<branch>[/path] 或 blob/<branch>/...
	if len(parts) >= 4 && (parts[2] == "tree" || parts[2] == "blob") {
		branch := parts[3]
		if parts[2] == "blob" {
			// blob 指向单个文件，走 raw
			rawPath := strings.Join(parts[4:], "/")
			src := normalizedSkillSource{
				downloadURL: "https://raw.githubusercontent.com/" + ownerRepo + "/" + branch + "/" + rawPath,
				repository:  "https://github.com/" + ownerRepo,
			}
			if fullSkillCommit.MatchString(branch) {
				src.ref, src.subdir = branch, path.Dir(rawPath)
			}
			return src, nil
		}
		treePath := strings.Join(parts[3:], "/")
		for _, part := range parts[3:] {
			if part == "" || part == "." || part == ".." || strings.ContainsAny(part, "\\:\x00") {
				return normalizedSkillSource{}, errors.New("invalid GitHub tree path")
			}
		}
		src := codeloadSource(ownerRepo, branch)
		src.treeRepo, src.treePath = ownerRepo, treePath
		return src, nil
	}

	// commit/<sha>
	if len(parts) >= 4 && parts[2] == "commit" {
		sha := parts[3]
		return normalizedSkillSource{
			downloadURL: "https://codeload.github.com/" + ownerRepo + "/zip/" + sha,
			repository:  "https://github.com/" + ownerRepo,
			ref:         sha,
			isZip:       true,
		}, nil
	}

	// 纯仓库地址：默认 main，失败回退 master
	return codeloadSource(ownerRepo, "main"), nil
}

// downloadGitHubTreeSource 从最长引用前缀开始尝试，兼容含 / 的分支、标签和提交。
// 只有不存在的引用（404）才缩短前缀；其他下载错误不能改变安装范围。
func downloadGitHubTreeSource(src normalizedSkillSource, resolved ...*normalizedSkillSource) ([]byte, string, string, error) {
	parts := strings.Split(src.treePath, "/")
	for end := len(parts); end > 0; end-- {
		candidate := normalizedSkillSource{
			repository:  "https://github.com/" + src.treeRepo,
			ref:         strings.Join(parts[:end], "/"),
			downloadURL: "https://codeload.github.com/" + src.treeRepo + "/zip/" + url.PathEscape(strings.Join(parts[:end], "/")),
			isZip:       true,
		}
		data, contentType, err := downloadSkillSource(candidate)
		if err == nil {
			if len(resolved) > 0 {
				*resolved[0] = candidate
			}
			return data, contentType, strings.Join(parts[end:], "/"), nil
		}
		var statusErr *skillDownloadStatusError
		if !errors.As(err, &statusErr) || statusErr.status != http.StatusNotFound {
			return nil, "", "", err
		}
	}
	return nil, "", "", errors.New("GitHub tree reference not found")
}

type skillDownloadStatusError struct {
	status int
}

func (err *skillDownloadStatusError) Error() string {
	return fmt.Sprintf("download failed: HTTP %d", err.status)
}

// downloadSkillSource 下载 skill 源，返回字节、Content-Type
func downloadSkillSource(src normalizedSkillSource, resolved ...*normalizedSkillSource) (data []byte, contentType string, err error) {
	u, perr := url.Parse(src.downloadURL)
	if perr != nil || u.Host == "" {
		return nil, "", fmt.Errorf("invalid download URL: %s", src.downloadURL)
	}
	if cerr := CheckHostSSRF(u.Hostname()); cerr != nil {
		return nil, "", cerr
	}

	data, contentType, err = fetchBytes(src.downloadURL)
	if err == nil {
		return data, contentType, nil
	}

	// codeload main 分支 404 时回退 master
	if src.isZip && src.branch == "main" {
		ownerRepo := strings.TrimPrefix(strings.TrimPrefix(src.downloadURL, "https://codeload.github.com/"), "http://codeload.github.com/")
		ownerRepo = strings.TrimSuffix(ownerRepo, "/zip/refs/heads/main")
		fallback := codeloadSource(ownerRepo, "master")
		data, contentType, ferr := fetchBytes(fallback.downloadURL)
		if ferr != nil {
			return nil, "", fmt.Errorf("download failed (tried main and master): %v", err)
		}
		if len(resolved) > 0 {
			*resolved[0] = fallback
		}
		return data, contentType, nil
	}
	return nil, "", err
}

// fetchBytes 执行带大小限制的 GET
func fetchBytes(rawURL string) (data []byte, contentType string, err error) {
	resp, err := skillDownloadHTTPClient().Get(rawURL)
	if err != nil {
		return nil, "", errors.New("download failed: " + err.Error())
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return nil, "", &skillDownloadStatusError{status: resp.StatusCode}
	}

	contentType = resp.Header.Get("Content-Type")
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxSkillDownloadBytes+1))
	if err != nil {
		return nil, "", errors.New("read body failed: " + err.Error())
	}
	if len(body) > maxSkillDownloadBytes {
		return nil, "", errors.New("skill source too large (limit 10MB)")
	}
	return body, contentType, nil
}

// skillDownloadHTTPClient 返回 skill 下载专用客户端：沿用 ssrfSafeClient 在拨号期固定已校验公网 IP 的行为，
// 并对每一跳重定向复查目标，避免安装来源把请求引向内网。
// https://github.com/siyuan-note/siyuan/security/advisories/GHSA-6pg3-pqxw-jm82
func skillDownloadHTTPClient() *http.Client {
	client := *ssrfSafeClient
	client.CheckRedirect = checkSkillDownloadRedirect
	return &client
}

// checkSkillDownloadRedirect 复查每一跳重定向：限制跳数与协议，并在发起请求前拦下内网目标。
// 连接层的拨号校验仍是最终防线，此处用于提前失败。
func checkSkillDownloadRedirect(req *http.Request, via []*http.Request) error {
	if len(via) >= 5 {
		return errors.New("too many redirects")
	}
	if scheme := req.URL.Scheme; scheme != "http" && scheme != "https" {
		return errors.New("redirect scheme is not allowed")
	}
	return CheckHostSSRF(req.URL.Hostname())
}

// installFromZip 解压 zip 并安装其中的 skill
func installFromZip(data []byte, subdir string, source ...SkillInstallation) (*InstallSkillResult, error) {
	tmpRoot := filepath.Join(TempDir, "ai", "skill-install", gulu.Rand.String(7))
	if err := os.MkdirAll(tmpRoot, 0755); err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmpRoot)

	zipPath := filepath.Join(tmpRoot, "src.zip")
	if err := os.WriteFile(zipPath, data, 0644); err != nil {
		return nil, err
	}
	unzipDir := filepath.Join(tmpRoot, "unzip")
	if err := os.MkdirAll(unzipDir, 0755); err != nil {
		return nil, err
	}
	// gulu.Zip.Unzip 已内置 zip-slip 路径穿越防护
	if err := gulu.Zip.Unzip(zipPath, unzipDir); err != nil {
		return nil, errors.New("unzip failed: " + err.Error())
	}

	searchRoot := unzipDir
	if subdir != "" {
		cleaned, err := normalizeSkillResourcePath(subdir)
		if err != nil {
			return nil, err
		}
		// GitHub codeload 归档恰有一层仓库包裹目录。
		entries, err := os.ReadDir(unzipDir)
		if err != nil || len(entries) != 1 || !entries[0].IsDir() {
			return nil, errors.New("invalid GitHub repository archive")
		}
		searchRoot = filepath.Join(unzipDir, entries[0].Name(), filepath.FromSlash(cleaned))
		info, err := os.Stat(searchRoot)
		if err != nil || !info.IsDir() {
			return nil, errors.New("GitHub tree directory not found in the archive")
		}
	}
	skillDirs := findSkillDirs(searchRoot)
	// 保留相对解压根的目录名，让无 name 的单技能目录仍可用目录名兜底。
	for i, dir := range skillDirs {
		rel, err := filepath.Rel(unzipDir, filepath.Join(searchRoot, dir))
		if err != nil {
			return nil, err
		}
		skillDirs[i] = rel
	}
	if len(skillDirs) == 0 {
		return nil, errors.New("no SKILL.md found in the archive")
	}
	return installSkillDirs(skillDirs, unzipDir, source...)
}

// findSkillDirs 在解压根下查找含 SKILL.md 的 skill 目录，返回相对 root 的路径。
// 递归下钻以兼容任意包裹层（codeload 会把仓库内容包在 <repo-name>/ 下），
// 但一旦某个目录被认定为 skill（直接含 SKILL.md）就停止下钻，避免误入 skill 内部的
// references/scripts 等子目录。识别的结构：
//   - SKILL.md 直接在 root（无包裹）
//   - <wrap>/SKILL.md（单层或多层包裹的单 skill）
//   - <wrap>/skills/<name>/SKILL.md（集合仓库，wrap 可有可无）
func findSkillDirs(root string) []string {
	if gulu.File.IsExist(filepath.Join(root, "SKILL.md")) {
		return []string{"."}
	}
	return findSkillDirsRecursive(root, root)
}

func findSkillDirsRecursive(dir, root string) []string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var result []string
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		// 跳过点目录与 VCS 元数据，避免无意义下钻
		name := e.Name()
		if name == ".git" || name == ".github" || name == ".idea" || name == "node_modules" {
			continue
		}
		sub := filepath.Join(dir, name)
		if gulu.File.IsExist(filepath.Join(sub, "SKILL.md")) {
			// 该目录是一个 skill，记录相对路径并停止下钻
			if rel, rerr := filepath.Rel(root, sub); rerr == nil {
				result = append(result, rel)
			}
		} else {
			// 继续下钻处理包裹层 / skills/ 容器
			result = append(result, findSkillDirsRecursive(sub, root)...)
		}
	}
	return result
}

// installSkillDirs 把若干相对 root 的 skill 目录落地到 SkillsDir()
func installSkillDirs(relDirs []string, root string, source ...SkillInstallation) (*InstallSkillResult, error) {
	skillManagementLock.Lock()
	defer skillManagementLock.Unlock()
	result := &InstallSkillResult{}
	for _, rel := range relDirs {
		srcDir := filepath.Join(root, rel)
		if !gulu.File.IsSubPath(root, srcDir) {
			continue
		}
		skillMdPath := filepath.Join(srcDir, "SKILL.md")
		b, err := readSkillSource(skillMdPath)
		if err != nil {
			logging.LogWarnf("read SKILL.md [%s] failed: %s", skillMdPath, err)
			continue
		}
		fm, body := parseSkillFrontmatter(string(b))
		name := fm["name"]
		if name == "" {
			// frontmatter 缺 name 字段：根目录场景无法用目录名兜底（root 是临时目录），
			// 直接跳过；子目录场景用目录名兜底
			if rel == "." {
				logging.LogWarnf("skip SKILL.md at archive root without 'name' frontmatter")
				continue
			}
			name = filepath.Base(rel)
		}
		if verr := validateSkillName(name); verr != nil {
			logging.LogWarnf("skip invalid skill name [%s]: %s", name, verr)
			continue
		}

		destDir := filepath.Join(SkillsDir(), name)
		if err := os.MkdirAll(SkillsDir(), 0755); err != nil {
			return nil, err
		}
		if _, err := skillInstallationDigest(srcDir); err != nil {
			return nil, err
		}
		records, _, err := prepareSkillInstallationChange(name)
		if err != nil {
			return nil, err
		}
		// 覆盖式安装：先清旧目录
		if gulu.File.IsExist(destDir) {
			if err := os.RemoveAll(destDir); err != nil {
				return nil, err
			}
		}
		if err := filelock.Copy(srcDir, destDir); err != nil {
			return nil, fmt.Errorf("install skill %s failed: %s", name, err)
		}
		if len(source) > 0 {
			source[0].SourceScope = "directory"
			if err := recordSkillInstallation(records, name, source[0]); err != nil {
				return nil, err
			}
		}
		result.Names = append(result.Names, name)
		desc := fm["description"]
		if desc == "" {
			desc = firstLine(body)
		}
		result.Descriptions = append(result.Descriptions, desc)
	}
	if len(result.Names) == 0 {
		return nil, errors.New("no valid skill installed")
	}
	return result, nil
}

// installFromSingleSkillMD 把单个 SKILL.md 文本内容落地为一个 skill
func installFromSingleSkillMD(data []byte, source ...SkillInstallation) (*InstallSkillResult, error) {
	skillManagementLock.Lock()
	defer skillManagementLock.Unlock()
	content := string(data)
	fm, body := parseSkillFrontmatter(content)
	name := fm["name"]
	if name == "" {
		return nil, errors.New("SKILL.md frontmatter missing 'name' field")
	}
	if err := validateSkillName(name); err != nil {
		return nil, err
	}
	dir := filepath.Join(SkillsDir(), name)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, err
	}
	records, _, err := prepareSkillInstallationChange(name)
	if err != nil {
		return nil, err
	}
	if err := filelock.WriteFile(filepath.Join(dir, "SKILL.md"), data); err != nil {
		return nil, err
	}
	if len(source) > 0 {
		source[0].SourceScope = "manifest-only"
		if err := recordSkillInstallation(records, name, source[0]); err != nil {
			return nil, err
		}
	}
	return &InstallSkillResult{
		Names:        []string{name},
		Descriptions: []string{firstLine(body)},
	}, nil
}
