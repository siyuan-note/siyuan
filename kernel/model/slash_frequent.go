package model

import "github.com/siyuan-note/siyuan/kernel/conf"

// 将常用命令开关迁移到自定义方案，读取失败时保留未配置状态以便下次重试。
func migrateSlashFrequent(entryVisibility *conf.EntryVisibility, loadStorage func() (map[string]any, error)) error {
	const key = "editor.slash.menu.frequent"
	var profiles []*conf.EntryVisibilityProfile
	if nil == entryVisibility {
		return nil
	}
	for _, profile := range entryVisibility.Profiles {
		if nil == profile || "" == profile.ID || "" == profile.Name ||
			conf.EntryVisibilityProfileSimple == profile.ID || conf.EntryVisibilityProfileFull == profile.ID ||
			conf.EntryVisibilityProfileSimple == profile.Defaults || conf.EntryVisibilityProfileFull == profile.Defaults {
			continue
		}
		if _, exists := profile.Entries[key]; !exists {
			profiles = append(profiles, profile)
		}
	}
	if 0 == len(profiles) {
		return nil
	}
	storage, err := loadStorage()
	if nil != err {
		return err
	}
	enabled, configured := storage["local-slash-frequent-enabled"].(bool)
	for _, profile := range profiles {
		if nil == profile.Entries {
			profile.Entries = map[string]bool{}
		}
		profile.Entries[key] = !configured || enabled
	}
	return nil
}
