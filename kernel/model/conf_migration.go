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

package model

import (
	"bytes"
	"strings"

	"github.com/88250/gulu"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/conf"
	"github.com/siyuan-note/siyuan/kernel/util"
)

// confMigration 描述一次配置格式迁移。version 单调递增，配置的 confVersion 低于该值时才执行；
// apply 接收配置文件原始字节，返回是否修改了配置。
type confMigration struct {
	version int
	name    string
	apply   func(c *AppConf, raw []byte) (bool, error)
}

// confMigrations 按版本升序登记全部配置迁移。新增迁移只能追加在末尾并使用更大的版本号。
var confMigrations = []confMigration{
	{1, "ai", func(c *AppConf, raw []byte) (bool, error) {
		// 旧版人工智能配置使用 openAI 字段 https://github.com/siyuan-note/siyuan/issues/14591
		if !conf.NeedsAIMigration(raw) {
			return false, nil
		}
		c.AI.Store(conf.MigrateAI(raw))
		return true, nil
	}},
	{2, "entryVisibility", func(c *AppConf, raw []byte) (bool, error) {
		// 入口可见性引入前的已有工作空间按完整方案显示全部入口
		if bytes.Contains(raw, []byte(`"entryVisibility"`)) {
			return false, nil
		}
		if nil == c.Appearance.Load() {
			c.Appearance.Store(conf.NewAppearanceForContainer(util.IsMobileContainer()))
		}
		c.Appearance.Load().EntryVisibility = conf.NewEntryVisibility(conf.EntryVisibilityProfileFull)
		return true, nil
	}},
	{3, "slashFrequent", func(c *AppConf, raw []byte) (bool, error) {
		// 斜杠菜单常用项开关从本地存储迁移到自定义入口方案
		if nil == c.Appearance.Load() || nil == c.Appearance.Load().EntryVisibility {
			return false, nil
		}
		before, _ := gulu.JSON.MarshalJSON(c.Appearance.Load().EntryVisibility)
		if err := migrateSlashFrequent(c.Appearance.Load().EntryVisibility, getLocalStorageWithError); err != nil {
			return false, err
		}
		after, _ := gulu.JSON.MarshalJSON(c.Appearance.Load().EntryVisibility)
		return !bytes.Equal(before, after), nil
	}},
	{4, "docxTemplate", func(c *AppConf, raw []byte) (bool, error) {
		// Word 导出模板并入 Pandoc 参数
		if nil == c.Export.Load() {
			return false, nil
		}
		var legacy struct {
			Export struct {
				DocxTemplate string `json:"docxTemplate"`
			} `json:"export"`
		}
		if len(raw) > 0 {
			if err := gulu.JSON.UnmarshalJSON(raw, &legacy); err != nil {
				return false, err
			}
		}
		docxTemplate := util.RemoveInvalid(legacy.Export.DocxTemplate)
		if "" == docxTemplate {
			return false, nil
		}
		params := util.RemoveInvalid(c.Export.Load().PandocParams)
		if gulu.File.IsExist(docxTemplate) && !strings.Contains(params, "--reference-doc") && !util.ISMicrosoftStore {
			if !strings.HasPrefix(docxTemplate, "\"") {
				docxTemplate = "\"" + docxTemplate + "\""
			}
			params += " --reference-doc " + docxTemplate
			c.Export.Load().PandocParams = strings.TrimSpace(params)
		}
		return true, nil
	}},
	{5, "pandoc", func(c *AppConf, raw []byte) (bool, error) {
		// 移除指向临时目录的 Pandoc 路径和内置模板参数
		return migratePandocConfig(c.Export.Load()), nil
	}},
	{6, "exportBlockRefMode", func(c *AppConf, raw []byte) (bool, error) {
		return conf.MigrateExportBlockRefMode(c.Export.Load()), nil
	}},
}

// CurrentConfVersion 是本内核支持的最高配置版本。
var CurrentConfVersion = confMigrations[len(confMigrations)-1].version

// applyConfMigrations 执行配置版本之后登记的迁移并更新版本号，返回是否修改了配置。
// 配置版本高于本内核时视为由更新的内核写入：不执行迁移、不降低版本号，也不拒绝该配置。
func applyConfMigrations(c *AppConf, raw []byte) (changed bool) {
	if c.ConfVersion > CurrentConfVersion {
		logging.LogWarnf("conf version [%d] is newer than kernel supported version [%d], skip migrations", c.ConfVersion, CurrentConfVersion)
		return false
	}
	for _, migration := range confMigrations {
		if migration.version <= c.ConfVersion {
			continue
		}
		applied, err := migration.apply(c, raw)
		if err != nil {
			logging.LogWarnf("migrate conf [%s] failed, retry on next load: %s", migration.name, err)
			return changed
		}
		c.ConfVersion = migration.version
		changed = true
		if applied {
			logging.LogInfof("migrated conf [%s] to version [%d]", migration.name, migration.version)
		}
	}
	return
}

// ApplyImportedConfMigrations 对导入的配置执行与启动加载相同的迁移。
func ApplyImportedConfMigrations(c *AppConf, raw []byte) {
	applyConfMigrations(c, raw)
}
