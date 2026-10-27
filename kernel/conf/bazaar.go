// SiYuan - https://github.com/siyuan-note/siyuan
// Copyright (c) 2020-present, b3log.org
// SPDX-License-Identifier: AGPL-3.0-or-later

package conf

type Bazaar struct {
	Trust         bool `json:"trust"`
	PetalDisabled bool `json:"petalDisabled"`
}

func NewBazaar() *Bazaar {
	return &Bazaar{
		Trust:         false,
		PetalDisabled: false,
	}
}
