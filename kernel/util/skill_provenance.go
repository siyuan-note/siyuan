// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package util

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/88250/gulu"
)

type SkillInstallation struct {
	Name          string `json:"name"`
	URL           string `json:"url"`
	SourceScope   string `json:"sourceScope"`
	Repository    string `json:"repository,omitempty"`
	Ref           string `json:"ref,omitempty"`
	Subdirectory  string `json:"subdirectory,omitempty"`
	Commit        string `json:"commit,omitempty"`
	Digest        string `json:"digest"`
	InstalledAt   string `json:"installedAt"`
	SiYuanVersion string `json:"siyuanVersion"`
}

type SkillInstallationInfo struct {
	SkillInfo
	Installation *SkillInstallation `json:"installation"`
}

type skillInstallations struct {
	Version int                          `json:"version"`
	Skills  map[string]SkillInstallation `json:"skills"`
}

func skillInstallationsPath() string {
	return filepath.Join(DataDir, "storage", "ai", "agent", "skills.json")
}

func readSkillInstallations() (*skillInstallations, error) {
	ret := &skillInstallations{Version: 1, Skills: map[string]SkillInstallation{}}
	b, err := os.ReadFile(skillInstallationsPath())
	if errors.Is(err, os.ErrNotExist) {
		return ret, nil
	}
	if err != nil {
		return nil, err
	}
	ret = &skillInstallations{}
	if err = json.Unmarshal(b, ret); err != nil {
		return nil, err
	}
	if ret.Version != 1 || ret.Skills == nil {
		return nil, errors.New("invalid skill installation records")
	}
	return ret, nil
}

func writeSkillInstallations(records *skillInstallations) error {
	b, err := json.MarshalIndent(records, "", "  ")
	if err != nil {
		return err
	}
	return gulu.File.WriteFileSafer(skillInstallationsPath(), b, 0600)
}

// 安装摘要是历史内容标识，不在列举时扫描当前目录，也不代表内容可信。
func DiscoverSkillInstallations(enabledUserSkills []string) ([]SkillInstallationInfo, error) {
	skillManagementLock.Lock()
	defer skillManagementLock.Unlock()
	installations, err := readSkillInstallations()
	if err != nil {
		return nil, err
	}
	ret := []SkillInstallationInfo{}
	for _, record := range resolveSkillRecords(enabledUserSkills) {
		info := SkillInstallationInfo{SkillInfo: record.Info}
		if record.Root == SkillsDir() {
			if installation, ok := installations.Skills[record.DirName]; ok {
				info.Installation = &installation
			}
		}
		ret = append(ret, info)
	}
	return ret, nil
}

var fullSkillCommit = regexp.MustCompile(`^[a-fA-F0-9]{40}$`)

func installationSource(src normalizedSkillSource, subdir string) SkillInstallation {
	u, _ := url.Parse(src.downloadURL)
	if u == nil {
		return SkillInstallation{}
	}
	u.User, u.RawQuery, u.Fragment, u.RawFragment, u.ForceQuery = nil, "", "", "", false
	u.Scheme, u.Host = strings.ToLower(u.Scheme), strings.ToLower(u.Host)
	if subdir == "" {
		subdir = src.subdir
	}
	if subdir == "." {
		subdir = ""
	}
	ret := SkillInstallation{URL: u.String(), Repository: src.repository, Ref: src.ref, Subdirectory: subdir}
	if fullSkillCommit.MatchString(src.ref) && src.branch == "" {
		ret.Commit = strings.ToLower(src.ref)
	}
	return ret
}

// 长度前缀消除路径和内容拼接歧义，WalkDir 的字典序与时间戳无关。
func skillInstallationDigest(dir string) (string, error) {
	h := sha256.New()
	h.Write([]byte("siyuan-skill-directory-v1\x00"))
	err := filepath.WalkDir(dir, func(p string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return errors.New("skill installation contains a non-regular file")
		}
		rel, err := filepath.Rel(dir, p)
		if err != nil {
			return err
		}
		rel = filepath.ToSlash(rel)
		binary.Write(h, binary.BigEndian, uint64(len(rel)))
		h.Write([]byte(rel))
		binary.Write(h, binary.BigEndian, uint64(info.Size()))
		f, err := os.Open(p)
		if err != nil {
			return err
		}
		n, copyErr := io.Copy(h, f)
		closeErr := f.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
		if n != info.Size() {
			return errors.New("skill changed while recording installation")
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("sha256-v1:%x", h.Sum(nil)), nil
}

// 先清除旧绑定再修改目录；中断或失败最多丢失来源，不会把新内容归到旧安装。
func prepareSkillInstallationChange(name string, otherNames ...string) (*skillInstallations, *SkillInstallation, error) {
	records, err := readSkillInstallations()
	if err != nil {
		return nil, nil, err
	}
	var previous *SkillInstallation
	changed := false
	for _, key := range append([]string{name}, otherNames...) {
		if record, ok := records.Skills[key]; ok {
			if key == name {
				previous = &record
			}
			delete(records.Skills, key)
			changed = true
		}
	}
	if changed {
		if err = writeSkillInstallations(records); err != nil {
			return nil, nil, err
		}
	}
	return records, previous, nil
}

func recordSkillInstallation(records *skillInstallations, name string, source SkillInstallation) error {
	digest, err := skillInstallationDigest(filepath.Join(SkillsDir(), name))
	if err != nil {
		return err
	}
	source.Name, source.Digest = name, digest
	source.InstalledAt, source.SiYuanVersion = time.Now().UTC().Format(time.RFC3339Nano), Ver
	records.Skills[name] = source
	return writeSkillInstallations(records)
}

func renameSkillInstallation(oldName, newName string, rename func() error) error {
	records, previous, err := prepareSkillInstallationChange(oldName, newName)
	if err != nil {
		return err
	}
	if err = rename(); err != nil {
		return err
	}
	if previous == nil {
		return nil
	}
	previous.Name = newName
	records.Skills[newName] = *previous
	return writeSkillInstallations(records)
}
