package model

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/siyuan-note/dejavu"
	"github.com/siyuan-note/dejavu/entity"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// setupSyncMergePluginTest 为同步合并分类测试准备隔离的数据目录与配置。
func setupSyncMergePluginTest(t *testing.T) {
	t.Helper()
	root := t.TempDir()

	origData, origTemp, origLog, origRepo, origHistory, origConf :=
		util.DataDir, util.TempDir, util.LogPath, util.RepoDir, util.HistoryDir, Conf
	t.Cleanup(func() {
		util.DataDir, util.TempDir, util.LogPath, util.RepoDir, util.HistoryDir, Conf =
			origData, origTemp, origLog, origRepo, origHistory, origConf
		logging.SetLogPath(origLog)
	})

	util.DataDir = filepath.Join(root, "data")
	util.TempDir = filepath.Join(root, "temp")
	util.LogPath = filepath.Join(util.TempDir, "siyuan.log")
	util.RepoDir = filepath.Join(root, "repo")
	util.HistoryDir = filepath.Join(root, "history")
	if err := os.MkdirAll(util.DataDir, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(util.TempDir, 0755); err != nil {
		t.Fatal(err)
	}

	Conf = NewAppConf()
	Conf.System = conf.NewSystem()
	Conf.Sync = conf.NewSync()
	Conf.NotebookCrypto = conf.NewNotebookCrypto()

	logging.SetLogPath(util.LogPath)
}

func writePluginFile(t *testing.T, plugin, name, content string) {
	t.Helper()
	path := filepath.Join(util.DataDir, "plugins", plugin, name)
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatal(err)
	}
}

// lastReloadPluginsLog 返回最近一条 reload plugins 分类日志行。
func lastReloadPluginsLog(t *testing.T) string {
	t.Helper()
	data, err := os.ReadFile(util.LogPath)
	if err != nil {
		t.Fatal(err)
	}
	var line string
	for _, l := range strings.Split(string(data), "\n") {
		if strings.Contains(l, "reload plugins, uninstalls=") {
			line = strings.TrimSpace(l)
		}
	}
	if line == "" {
		t.Fatal("未找到 reload plugins 日志")
	}
	return line
}

// TestSyncMergePluginFileRenameKeepsPluginAsReload 插件目录内文件改名（旧名删除、新名新增）
// 应判为更新重载，而不是卸载。
func TestSyncMergePluginFileRenameKeepsPluginAsReload(t *testing.T) {
	setupSyncMergePluginTest(t)
	const plugin = "demo-plugin"
	writePluginFile(t, plugin, "plugin.json", `{"name":"demo-plugin"}`)
	writePluginFile(t, plugin, "README.zh-CN.md", "doc")

	mergeResult := &dejavu.MergeResult{
		Removes: []*entity.File{{Path: "/plugins/" + plugin + "/README_zh_CN.md"}},
		Upserts: []*entity.File{{Path: "/plugins/" + plugin + "/README.zh-CN.md"}},
	}
	processSyncMergeResult(true, false, mergeResult, &dejavu.TrafficStat{}, "a", 0)

	line := lastReloadPluginsLog(t)
	t.Logf("分类结果：%s", line)
	if !strings.Contains(line, "uninstalls=[]") {
		t.Fatalf("文件改名不应触发卸载：%s", line)
	}
	if !strings.Contains(line, "reloads=["+plugin+"]") {
		t.Fatalf("文件改名应触发重载：%s", line)
	}
}

// TestSyncMergePluginRemovedDirTriggersUninstall 插件目录整体消失应判为卸载。
func TestSyncMergePluginRemovedDirTriggersUninstall(t *testing.T) {
	setupSyncMergePluginTest(t)
	const plugin = "gone-plugin"

	mergeResult := &dejavu.MergeResult{
		Removes: []*entity.File{{Path: "/plugins/" + plugin + "/plugin.json"}},
	}
	processSyncMergeResult(true, false, mergeResult, &dejavu.TrafficStat{}, "a", 0)

	line := lastReloadPluginsLog(t)
	t.Logf("分类结果：%s", line)
	if !strings.Contains(line, "uninstalls=["+plugin+"]") {
		t.Fatalf("插件目录消失应触发卸载：%s", line)
	}
}

func TestSyncMergePluginOnlyDSStoreTriggersUninstall(t *testing.T) {
	setupSyncMergePluginTest(t)
	const plugin = "only-dsstore-plugin"
	writePluginFile(t, plugin, ".DS_Store", "")
	mergeResult := &dejavu.MergeResult{
		Removes: []*entity.File{{Path: "/plugins/" + plugin + "/plugin.json"}},
	}
	processSyncMergeResult(true, false, mergeResult, &dejavu.TrafficStat{}, "a", 0)
	line := lastReloadPluginsLog(t)
	if !strings.Contains(line, "uninstalls=["+plugin+"]") {
		t.Fatalf("metadata-only plugin must be uninstalled: %s", line)
	}
	if _, err := os.Stat(filepath.Join(util.DataDir, "plugins", plugin)); !os.IsNotExist(err) {
		t.Fatalf("metadata-only plugin directory must be removed: %v", err)
	}
}

func TestSyncMergeRemovedPetalStillTriggersUninstall(t *testing.T) {
	setupSyncMergePluginTest(t)
	const plugin = "removed-petal-plugin"
	writePluginFile(t, plugin, "plugin.json", "{}")
	mergeResult := &dejavu.MergeResult{
		Removes:      []*entity.File{{Path: "/plugins/" + plugin + "/README.md"}},
		RemovePetals: []string{plugin},
	}
	processSyncMergeResult(true, false, mergeResult, &dejavu.TrafficStat{}, "a", 0)
	line := lastReloadPluginsLog(t)
	if !strings.Contains(line, "uninstalls=["+plugin+"]") {
		t.Fatalf("explicit petal removal must trigger uninstall: %s", line)
	}
}
