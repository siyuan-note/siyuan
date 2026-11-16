// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package bazaar

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/siyuan-note/siyuan/kernel/util"
)

var pluginProjectArchiveName = regexp.MustCompile(`^[0-9a-f]{64}\.zip$`)

func expiredPluginProjectArtifacts(entries []os.FileInfo, current string) []os.FileInfo {
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].ModTime().Equal(entries[j].ModTime()) {
			return entries[i].Name() < entries[j].Name()
		}
		return entries[i].ModTime().Before(entries[j].ModTime())
	})
	var stored int64
	for _, entry := range entries {
		stored += entry.Size()
	}
	count := len(entries)
	var expired []os.FileInfo
	for _, entry := range entries {
		if count <= 8 && stored <= 256*1024*1024 {
			break
		}
		if entry.Name() == current {
			continue
		}
		expired = append(expired, entry)
		count--
		stored -= entry.Size()
	}
	return expired
}

// 新归档及就绪元数据保存后才回收；失败的发布不会消耗已有恢复材料。
// 仅处理本任务内容寻址归档及对应导出副本，源码、检查点和未知文件均保留。
func prunePluginProjectArtifacts(grant *util.PluginDevelopmentGrant, root *os.Root, current string) error {
	directory, err := root.Open(".")
	if err != nil {
		return err
	}
	entries, err := directory.Readdir(-1)
	directory.Close()
	if err != nil {
		return err
	}
	var archives []os.FileInfo
	for _, entry := range entries {
		if pluginProjectArchiveName.MatchString(entry.Name()) {
			archives = append(archives, entry)
		}
	}
	expired := expiredPluginProjectArtifacts(archives, current)
	if len(expired) == 0 {
		return nil
	}
	delivery, err := util.OpenPluginProjectDirectory(filepath.Join(util.TempDir, "export"), false)
	if err != nil {
		return err
	}
	defer delivery.Close()
	for _, entry := range expired {
		hash := strings.TrimSuffix(entry.Name(), ".zip")
		if err = verifyObsoletePluginProjectArchive(root, entry.Name(), hash); err != nil {
			return err
		}
		name := "plugin-project-" + grant.TaskID + "-" + entry.Name()
		if _, err = delivery.Lstat(name); err == nil {
			if err = verifyObsoletePluginProjectArchive(delivery, name, hash); err != nil {
				return err
			}
			if err = delivery.Remove(name); err != nil {
				return err
			}
		} else if !errors.Is(err, os.ErrNotExist) {
			return err
		}
		if err = root.Remove(entry.Name()); err != nil {
			return err
		}
	}
	return nil
}

func verifyObsoletePluginProjectArchive(root *os.Root, name, hash string) error {
	before, err := root.Lstat(name)
	if err != nil {
		return err
	}
	if !util.PluginProjectRegularFile(before) {
		return errors.New("obsolete archive is linked or special")
	}
	file, err := util.OpenFileNoFollow(root, name)
	if err != nil {
		return err
	}
	defer file.Close()
	if err = util.CheckSingleLinkRegularFile(file); err != nil {
		return err
	}
	actual, err := file.Stat()
	if err != nil || !os.SameFile(before, actual) {
		return errors.New("obsolete archive identity changed")
	}
	digest := sha256.New()
	size, err := io.Copy(digest, io.LimitReader(file, MaxLocalPackageArchiveSize+1))
	if err != nil || size > MaxLocalPackageArchiveSize || hex.EncodeToString(digest.Sum(nil)) != hash {
		return errors.New("obsolete archive content changed")
	}
	after, err := root.Lstat(name)
	if err != nil || !os.SameFile(actual, after) || after.Size() != size || !after.ModTime().Equal(actual.ModTime()) {
		return errors.New("obsolete archive changed during cleanup")
	}
	return nil
}
