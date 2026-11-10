// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

type Bazaar struct {
	BatchUpdateExcluded  map[string]map[string]bool            `json:"batchUpdateExcluded"`
	Trust                bool                                  `json:"trust"`
	PetalDisabled        bool                                  `json:"petalDisabled"`
	CompatibilityFilters map[string]*BazaarCompatibilityFilter `json:"compatibilityFilters"`
}

type BazaarCompatibilityFilter struct {
	HideUnsupportedVersion   bool `json:"hideUnsupportedVersion"`
	HideIncompatiblePlatform bool `json:"hideIncompatiblePlatform"`
}

func NewBazaar() *Bazaar {
	return &Bazaar{
		BatchUpdateExcluded: map[string]map[string]bool{
			"plugins": {}, "themes": {}, "widgets": {}, "icons": {}, "templates": {},
		},
		Trust:         false,
		PetalDisabled: false,
		CompatibilityFilters: map[string]*BazaarCompatibilityFilter{
			"plugins": {}, "themes": {}, "widgets": {}, "icons": {}, "templates": {},
		},
	}
}
