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

package oidcprovider

import (
	"errors"
	"strings"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/siyuan-note/siyuan/kernel/conf"
)

func NewCasdoor(cfg *conf.OIDCProviderConf) (Provider, error) {
	issuerURL := strings.TrimSpace(cfg.IssuerURL)
	if issuerURL == "" {
		return nil, errors.New("Casdoor issuerURL is required")
	}

	clientID := strings.TrimSpace(cfg.ClientID)
	if clientID == "" {
		return nil, errors.New("Casdoor clientID is required")
	}

	clientSecret := strings.TrimSpace(cfg.ClientSecret)
	if clientSecret == "" {
		return nil, errors.New("Casdoor clientSecret is required")
	}

	redirectURL := formatRedirectURL(cfg.RedirectURL)
	if redirectURL == "" {
		return nil, errors.New("Casdoor redirectURL is required")
	}

	scopes := cfg.Scopes
	if len(scopes) == 0 {
		scopes = []string{"openid", "email", "profile"}
	}

	p := &BaseOIDC{
		IDStr:           "casdoor",
		ProviderLabel:   "Login with Casdoor",
		IssuerURLStr:    issuerURL,
		ClientIDStr:     clientID,
		ClientSecretStr: clientSecret,
		RedirectURLStr:  redirectURL,
		ScopesList:      scopes,
	}

	p.Normalizer = func(raw map[string]any, idToken *oidc.IDToken) (*OIDCClaims, error) {
		claims := &OIDCClaims{
			Provider:          "casdoor",
			Subject:           idToken.Subject,
			Issuer:            idToken.Issuer,
			Audience:          idToken.Audience,
			Email:             claimString(raw, OIDCClaimEmail),
			EmailVerified:     claimBool(raw, OIDCClaimEmailVerified),
			PreferredUsername: claimString(raw, OIDCClaimPreferredUsername),
			Name:              claimString(raw, OIDCClaimName),
		}
		return claims, nil
	}

	return p, nil
}
