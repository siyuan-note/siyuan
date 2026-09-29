package tools

import (
	"encoding/json"
	"errors"
	"sort"

	"github.com/siyuan-note/siyuan/kernel/bazaar"
)

type bazaarListOptions struct {
	Offset  int   `json:"offset"`
	Limit   int   `json:"limit"`
	Enabled *bool `json:"enabled"`
}

func bazaarListOptionsFromArgs(args map[string]any) (bazaarListOptions, error) {
	options := bazaarListOptions{Limit: 20}
	data, err := json.Marshal(args)
	if err != nil {
		return options, err
	}
	if err = json.Unmarshal(data, &options); err != nil {
		return options, err
	}
	if options.Offset < 0 || options.Limit < 1 || options.Limit > 50 {
		return options, errors.New("offset must be non-negative and limit must be between 1 and 50")
	}
	return options, nil
}

// bazaarPackageSummary 只保留选包、判断状态与固定更新目标所需的字段；README 通过独立动作读取。
type bazaarPackageSummary struct {
	PkgType               string `json:"pkgType"`
	Name                  string `json:"name"`
	DisplayName           string `json:"displayName"`
	Version               string `json:"version"`
	InstalledVersion      string `json:"installedVersion,omitempty"`
	Author                string `json:"author,omitempty"`
	RepoURL               string `json:"repoURL,omitempty"`
	RepoHash              string `json:"repoHash,omitempty"`
	Enabled               *bool  `json:"enabled,omitempty"`
	Installed             bool   `json:"installed"`
	Outdated              bool   `json:"outdated"`
	Current               bool   `json:"current,omitempty"`
	InstalledIncompatible *bool  `json:"installedIncompatible,omitempty"`
	BazaarIncompatible    *bool  `json:"bazaarIncompatible,omitempty"`
	MinAppVersion         string `json:"minAppVersion,omitempty"`
	DisallowInstall       bool   `json:"disallowInstall,omitempty"`
	DisallowUpdate        bool   `json:"disallowUpdate,omitempty"`
	InvalidReason         string `json:"invalidReason,omitempty"`
	InstallTime           int64  `json:"installTime,omitempty"`
	UpdateTime            int64  `json:"updateTime,omitempty"`
	Updated               string `json:"updated,omitempty"`
}

func summarizeBazaarPackage(pkgType string, pkg *bazaar.Package, installed bool) bazaarPackageSummary {
	result := bazaarPackageSummary{
		PkgType: pkgType, Name: pkg.Name, DisplayName: pkg.PreferredName, Version: pkg.Version,
		Author: pkg.Author, RepoURL: pkg.RepoURL, RepoHash: pkg.RepoHash,
		Installed: installed || pkg.Installed, Outdated: pkg.Outdated, Current: pkg.Current,
		InstalledIncompatible: pkg.InstalledIncompatible, BazaarIncompatible: pkg.BazaarIncompatible,
		MinAppVersion: pkg.MinAppVersion, DisallowInstall: pkg.DisallowInstall, DisallowUpdate: pkg.DisallowUpdate,
		InvalidReason: pkg.InvalidReason, InstallTime: pkg.InstallTime, UpdateTime: pkg.UpdateTime, Updated: pkg.Updated,
	}
	if result.DisplayName == "" {
		result.DisplayName = pkg.Name
	}
	if pkgType == "plugins" && installed {
		// 缺少启用记录时明确输出 false；异常原因独立保留。
		result.Enabled = new(pkg.Enabled != nil && *pkg.Enabled)
	}
	return result
}

type bazaarPage struct {
	Packages []bazaarPackageSummary `json:"packages"`
	Total    int                    `json:"total"`
	Offset   int                    `json:"offset"`
	Limit    int                    `json:"limit"`
	HasMore  bool                   `json:"hasMore"`
}

func bazaarPackagePage(packages []bazaarPackageSummary, options bazaarListOptions) bazaarPage {
	filtered := make([]bazaarPackageSummary, 0, len(packages))
	for _, pkg := range packages {
		if options.Enabled != nil && (pkg.Enabled == nil || *pkg.Enabled != *options.Enabled) {
			continue
		}
		filtered = append(filtered, pkg)
	}
	// 所有类型共用稳定顺序，分页前过滤，避免返回重复项或遗漏符合条件的包。
	sort.Slice(filtered, func(i, j int) bool {
		if filtered[i].PkgType != filtered[j].PkgType {
			return filtered[i].PkgType < filtered[j].PkgType
		}
		return filtered[i].Name < filtered[j].Name
	})
	start := min(options.Offset, len(filtered))
	end := start + min(options.Limit, len(filtered)-start)
	return bazaarPage{
		Packages: filtered[start:end], Total: len(filtered), Offset: options.Offset,
		Limit: options.Limit, HasMore: end < len(filtered),
	}
}
