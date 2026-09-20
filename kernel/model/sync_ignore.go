package model

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	ignore "github.com/sabhiram/go-gitignore"
	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const syncIgnoreRulePath = ".siyuan/syncignore"

type syncMissingDirectory struct{ name string }

func (d syncMissingDirectory) Name() string       { return d.name }
func (d syncMissingDirectory) Size() int64        { return 0 }
func (d syncMissingDirectory) Mode() os.FileMode  { return os.ModeDir }
func (d syncMissingDirectory) ModTime() time.Time { return time.Time{} }
func (d syncMissingDirectory) IsDir() bool        { return true }
func (d syncMissingDirectory) Sys() any           { return nil }

type syncIgnoreStamp struct {
	path     string
	size     int64
	modified time.Time
	mode     os.FileMode
}

var syncIgnoreCache struct {
	sync.Mutex
	stamps  []syncIgnoreStamp
	lines   []string
	matcher *ignore.GitIgnore
}

func syncIgnoreStamps() (ret []syncIgnoreStamp, valid bool) {
	paths := []string{filepath.Join(util.DataDir, syncIgnoreRulePath), filepath.Join(util.WorkingDir, "guide")}
	for _, id := range userGuideIDs {
		paths = append(paths, filepath.Join(util.WorkingDir, "guide", id, "storage", "av"))
	}
	valid = true
	for _, path := range paths {
		stamp := syncIgnoreStamp{path: path}
		info, err := os.Stat(path)
		if err == nil {
			stamp.size, stamp.modified, stamp.mode = info.Size(), info.ModTime(), info.Mode()
		} else if !os.IsNotExist(err) {
			valid = false
		}
		ret = append(ret, stamp)
	}
	return
}

func getSyncIgnoreRules() ([]string, *ignore.GitIgnore, error) {
	syncIgnoreCache.Lock()
	defer syncIgnoreCache.Unlock()
	stamps, valid := syncIgnoreStamps()
	if valid && syncIgnoreCache.matcher != nil && slices.Equal(stamps, syncIgnoreCache.stamps) {
		return slices.Clone(syncIgnoreCache.lines), syncIgnoreCache.matcher, nil
	}
	lines, err := loadSyncIgnoreLines()
	if err != nil {
		syncIgnoreCache.matcher = nil
		return nil, nil, err
	}
	matcher := ignore.CompileIgnoreLines(lines...)
	// 读取期间发生变化时不缓存，下一次调用重新读取规则。
	after, afterValid := syncIgnoreStamps()
	if valid && afterValid && slices.Equal(stamps, after) {
		syncIgnoreCache.lines, syncIgnoreCache.matcher, syncIgnoreCache.stamps = slices.Clone(lines), matcher, after
	} else {
		syncIgnoreCache.matcher = nil
	}
	return lines, matcher, nil
}

func getSyncIgnoreLines() ([]string, error) {
	lines, _, err := getSyncIgnoreRules()
	return lines, err
}

func invalidateSyncIgnoreRules(absPaths ...string) {
	var resolved []string
	for _, absPath := range absPaths {
		resolved = append(resolved, util.ResolveLongestExistingParent(absPath))
	}
	invalidateResolvedSyncIgnoreRules(util.ResolveLongestExistingParent(util.DataDir), resolved...)
}

func invalidateResolvedSyncIgnoreRules(dataDir string, absPaths ...string) {
	rulePath := filepath.Join(dataDir, syncIgnoreRulePath)
	for _, absPath := range absPaths {
		if _, contains := dataRelativePath(absPath, rulePath); contains {
			syncIgnoreCache.Lock()
			syncIgnoreCache.matcher = nil
			syncIgnoreCache.Unlock()
			return
		}
	}
}

// syncPathFilter 统一索引、签出与同步计划的文件系统及应用层忽略判定。
func syncPathFilter(dataDir string, info os.FileInfo, absPath string) (bool, error) {
	rel, ok := dataRelativePath(dataDir, absPath)
	if !ok {
		return true, nil
	}
	if ignored, err := dejavu.IgnorePath(info, absPath, rel, syncIgnoreRulePath, ".siyuan"); ignored || err != nil {
		return ignored, err
	}
	parts := strings.Split(strings.TrimPrefix(filepath.ToSlash(rel), "/"), "/")
	if len(parts) >= 2 && (parts[0] == "themes" || parts[0] == "icons") {
		if stat, err := os.Lstat(filepath.Join(dataDir, parts[0], parts[1])); err == nil && stat.Mode()&os.ModeSymlink != 0 {
			return true, nil
		}
	}
	if len(parts) >= 2 && ((parts[0] == "themes" && isBuiltInTheme(parts[1])) ||
		(parts[0] == "icons" && isBuiltInIcon(parts[1]))) {
		if info != nil && info.IsDir() {
			return true, filepath.SkipDir
		}
		return true, nil
	}
	if info != nil && info.IsDir() {
		if info.Name() == "filesys_status_check" {
			return true, filepath.SkipDir
		}
		return true, nil
	}
	for _, name := range []string{"local.json", "recent-doc.json", "ref-used.json"} {
		if rel == "/storage/"+name {
			return true, nil
		}
		// 保留已发布版本对嵌套路径的排除，避免历史签出删除原本被忽略的文件。
		if strings.HasSuffix(rel, "data/storage/"+name) {
			return true, nil
		}
	}
	return false, nil
}
