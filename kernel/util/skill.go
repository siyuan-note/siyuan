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
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"github.com/88250/gulu"
	"github.com/siyuan-note/filelock"
	"github.com/siyuan-note/httpclient"
	"github.com/siyuan-note/logging"
)

type SkillInfo struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

func SkillsDir() string {
	return filepath.Join(DataDir, "storage", "ai", "agent", "skills")
}

func DiscoverSkills() []SkillInfo {
	dir := SkillsDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}

	var skills []SkillInfo
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		skillDir := e.Name()
		skillMdPath := filepath.Join(dir, skillDir, "SKILL.md")
		b, err := filelock.ReadFile(skillMdPath)
		if err != nil {
			continue
		}
		fm, body := parseSkillFrontmatter(string(b))
		name := fm["name"]
		if name == "" {
			name = skillDir
		}
		desc := fm["description"]
		if desc == "" {
			desc = firstLine(body)
		}
		skills = append(skills, SkillInfo{
			Name:        name,
			Description: desc,
		})
	}
	return skills
}

func LoadSkillContent(name string) string {
	dir := SkillsDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		skillMdPath := filepath.Join(dir, e.Name(), "SKILL.md")
		b, err := filelock.ReadFile(skillMdPath)
		if err != nil {
			continue
		}
		fm, body := parseSkillFrontmatter(string(b))
		skillName := fm["name"]
		if skillName == "" {
			skillName = e.Name()
		}
		if strings.EqualFold(skillName, name) || strings.EqualFold(e.Name(), name) {
			return body
		}
	}
	return ""
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

func ReadSkill(name string) (string, error) {
	if err := validateSkillName(name); err != nil {
		return "", err
	}
	skillMdPath := filepath.Join(SkillsDir(), name, "SKILL.md")
	b, err := filelock.ReadFile(skillMdPath)
	if err != nil {
		return "", fmt.Errorf("skill not found: %s", name)
	}
	return string(b), nil
}

func SaveSkill(name, content string) error {
	if err := validateSkillName(name); err != nil {
		return err
	}
	dir := SkillsDir()
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	skillDir := filepath.Join(dir, name)
	if err := os.MkdirAll(skillDir, 0755); err != nil {
		return err
	}
	skillMdPath := filepath.Join(skillDir, "SKILL.md")
	return filelock.WriteFile(skillMdPath, []byte(content))
}

func RemoveSkill(name string) error {
	if err := validateSkillName(name); err != nil {
		return err
	}
	skillDir := filepath.Join(SkillsDir(), name)
	if _, err := os.Stat(skillDir); os.IsNotExist(err) {
		return fmt.Errorf("skill not found: %s", name)
	}
	return os.RemoveAll(skillDir)
}

func RenameSkill(oldName, newName string) error {
	if err := validateSkillName(oldName); err != nil {
		return err
	}
	if err := validateSkillName(newName); err != nil {
		return err
	}
	dir := SkillsDir()
	oldDir := filepath.Join(dir, oldName)
	newDir := filepath.Join(dir, newName)
	if _, err := os.Stat(oldDir); os.IsNotExist(err) {
		return fmt.Errorf("skill not found: %s", oldName)
	}
	if _, err := os.Stat(newDir); err == nil {
		return fmt.Errorf("skill already exists: %s", newName)
	}
	return os.Rename(oldDir, newDir)
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
	downloadURL string // 实际 GET 的地址
	isZip       bool   // 是否按 zip 解压处理（codeload / release zip / Content-Type 判定为 zip）
	branch      string // codeload 分支，空表示无需回退；main 失败回退 master
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

	data, contentType, err := downloadSkillSource(src)
	if err != nil {
		return nil, err
	}

	// 按内容类型或来源判定处理方式
	isZip := src.isZip || strings.HasPrefix(contentType, "application/zip") ||
		strings.HasPrefix(contentType, "application/x-zip-compressed")

	if isZip {
		return installFromZip(data)
	}

	// 文本：当作单个 SKILL.md
	if strings.HasPrefix(contentType, "text/") || strings.HasPrefix(strings.TrimSpace(string(data)), "---") {
		return installFromSingleSkillMD(data)
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
		// 直接 GET 单个 SKILL.md（或其它文本文件）
		return normalizedSkillSource{downloadURL: u.String()}, nil
	default:
		// 其它直链（release zip、自建站点等）：直接 GET，是否 zip 交由 Content-Type 判定
		return normalizedSkillSource{downloadURL: u.String()}, nil
	}
}

// codeloadSource 构造 codeload zip 下载源，branch 用于 main→master 回退
func codeloadSource(ownerRepo, branch string) normalizedSkillSource {
	return normalizedSkillSource{
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
			return normalizedSkillSource{
				downloadURL: "https://raw.githubusercontent.com/" + ownerRepo + "/" + branch + "/" + rawPath,
			}, nil
		}
		return codeloadSource(ownerRepo, branch), nil
	}

	// commit/<sha>
	if len(parts) >= 4 && parts[2] == "commit" {
		sha := parts[3]
		return normalizedSkillSource{
			downloadURL: "https://codeload.github.com/" + ownerRepo + "/zip/" + sha,
			isZip:       true,
		}, nil
	}

	// 纯仓库地址：默认 main，失败回退 master
	return codeloadSource(ownerRepo, "main"), nil
}

// downloadSkillSource 下载 skill 源，返回字节、Content-Type
func downloadSkillSource(src normalizedSkillSource) (data []byte, contentType string, err error) {
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
		return data, contentType, nil
	}
	return nil, "", err
}

// fetchBytes 执行带大小限制的 GET
func fetchBytes(rawURL string) (data []byte, contentType string, err error) {
	resp, err := httpclient.NewBrowserRequest().Get(rawURL)
	if err != nil {
		return nil, "", errors.New("download failed: " + err.Error())
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return nil, "", fmt.Errorf("download failed: HTTP %d", resp.StatusCode)
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

// installFromZip 解压 zip 并安装其中的 skill
func installFromZip(data []byte) (*InstallSkillResult, error) {
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

	skillDirs := findSkillDirs(unzipDir)
	if len(skillDirs) == 0 {
		return nil, errors.New("no SKILL.md found in the archive")
	}
	return installSkillDirs(skillDirs, unzipDir)
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
func installSkillDirs(relDirs []string, root string) (*InstallSkillResult, error) {
	result := &InstallSkillResult{}
	for _, rel := range relDirs {
		srcDir := filepath.Join(root, rel)
		if !gulu.File.IsSubPath(root, srcDir) {
			continue
		}
		skillMdPath := filepath.Join(srcDir, "SKILL.md")
		b, err := filelock.ReadFile(skillMdPath)
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
		// 覆盖式安装：先清旧目录
		if gulu.File.IsExist(destDir) {
			os.RemoveAll(destDir)
		}
		if err := filelock.Copy(srcDir, destDir); err != nil {
			return nil, fmt.Errorf("install skill %s failed: %s", name, err)
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
func installFromSingleSkillMD(data []byte) (*InstallSkillResult, error) {
	content := string(data)
	fm, body := parseSkillFrontmatter(content)
	name := fm["name"]
	if name == "" {
		return nil, errors.New("SKILL.md frontmatter missing 'name' field")
	}
	if err := validateSkillName(name); err != nil {
		return nil, err
	}
	if err := SaveSkill(name, content); err != nil {
		return nil, err
	}
	return &InstallSkillResult{
		Names:        []string{name},
		Descriptions: []string{firstLine(body)},
	}, nil
}
