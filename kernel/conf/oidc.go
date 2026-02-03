// SiYuan - Refactor your thinking
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

package conf

type OIDC struct {
	Provider     string                       `json:"provider"`
	Providers    map[string]*OIDCProviderConf `json:"providers"`
	Filters      map[string][]string          `json:"filters"`
	ProviderHash string                       `json:"providerHash"`
	FilterHash   string                       `json:"filterHash"`
}

type OIDCProviderConf struct {
	ClientID      string            `json:"clientID"`
	ClientSecret  string            `json:"clientSecret"`
	PKCE          bool              `json:"pkce"`
	RedirectURL   string            `json:"redirectURL"`
	IssuerURL     string            `json:"issuerURL"`
	Scopes        []string          `json:"scopes"`
	Tenant        string            `json:"tenant"`
	ProviderLabel string            `json:"providerLabel"`
	ClaimMap      map[string]string `json:"claimMap"`
}

func NewOIDC() *OIDC {
	return &OIDC{
		Provider: "",
		Providers: map[string]*OIDCProviderConf{
			"custom":    {},
			"google":    {},
			"microsoft": {},
			"github":    {},
		},
		Filters: map[string][]string{},
	}
}
