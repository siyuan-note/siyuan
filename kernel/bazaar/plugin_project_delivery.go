package bazaar

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/siyuan-note/siyuan/kernel/util"
)

// IsPluginProjectDeliveryPath 识别宿主固定命名的导出副本；安装仍解析到受保护的权威制品。
func IsPluginProjectDeliveryPath(abs string) bool {
	return util.NormalizeAndResolve(filepath.Dir(abs)) == util.NormalizeAndResolve(filepath.Join(util.TempDir, "export")) && strings.HasPrefix(filepath.Base(abs), "plugin-project-") && strings.HasSuffix(abs, ".zip")
}

// 导出副本通过既有 /export 下载入口交付；不移动或开放宿主制品目录。
func publishPluginProjectDelivery(grant *util.PluginDevelopmentGrant, artifact *util.PluginProjectArtifact, archive []byte) error {
	root, err := util.OpenPluginProjectDirectory(filepath.Join(util.TempDir, "export"), true)
	if err != nil {
		return err
	}
	defer root.Close()
	name := "plugin-project-" + grant.TaskID + "-" + artifact.PackageHash + ".zip"
	if info, statErr := root.Lstat(name); statErr == nil {
		if !util.PluginProjectRegularFile(info) {
			return errors.New("invalid_path: delivery copy is linked or special")
		}
		file, openErr := util.OpenFileNoFollow(root, name)
		if openErr != nil {
			return openErr
		}
		actual, statErr := file.Stat()
		if statErr != nil || !os.SameFile(info, actual) {
			file.Close()
			return errors.New("revision_conflict: delivery copy identity changed")
		}
		if openErr = util.CheckSingleLinkRegularFile(file); openErr != nil {
			file.Close()
			return openErr
		}
		data, readErr := io.ReadAll(io.LimitReader(file, MaxLocalPackageArchiveSize+1))
		file.Close()
		if readErr != nil || util.PluginProjectDigest(data) != artifact.PackageHash {
			return errors.New("revision_conflict: existing delivery copy changed")
		}
	} else {
		if !errors.Is(statErr, os.ErrNotExist) {
			return statErr
		}
		tmp := "." + name + ".tmp"
		file, writeErr := root.OpenFile(tmp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if writeErr != nil {
			return writeErr
		}
		defer root.Remove(tmp)
		_, writeErr = file.Write(archive)
		if writeErr == nil {
			writeErr = file.Sync()
		}
		closeErr := file.Close()
		if writeErr != nil {
			return writeErr
		}
		if closeErr != nil {
			return closeErr
		}
		if err = root.Rename(tmp, name); err != nil {
			return err
		}
	}
	rel, err := filepath.Rel(util.WorkspaceDir, filepath.Join(util.TempDir, "export", name))
	if err != nil {
		return err
	}
	artifact.DeliveryPath = filepath.ToSlash(rel)
	artifact.DownloadURL = "/export/" + name
	return nil
}
