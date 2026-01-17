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
	"fmt"
	"strings"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/siyuan-note/siyuan/kernel/conf"
)

const oidcMicrosoftIssuerFormat = "https://login.microsoftonline.com/%s/v2.0"

func NewMicrosoft(cfg *conf.OIDCProviderConf) (Provider, error) {
	clientID := strings.TrimSpace(cfg.ClientID)
	if "" == clientID {
		return nil, errors.New("Microsoft clientID is required")
	}

	clientSecret := strings.TrimSpace(cfg.ClientSecret)
	if "" == clientSecret {
		return nil, errors.New("Microsoft clientSecret is required")
	}

	redirectURL := formatRedirectURL(cfg.RedirectURL)
	if "" != redirectURL {
		// Microsoft small quirk:
		// for http, microsoft only accepts "http://localhost:port/..."
		if after, ok := strings.CutPrefix(redirectURL, "http://127.0.0.1"); ok {
			redirectURL = "http://localhost" + after
		}
	} else {
		return nil, errors.New("Microsoft redirectURL is required")
	}

	/*
		Microsoft Entra ID 的 OIDC 账号类型说明：

		微软在 Portal 创建应用时支持 4 种 signInAudience / Supported account types：

		1. Accounts in this organizational directory only (Default Directory - Single tenant)
		   仅允许当前 Entra tenant 内的账号登录，issuer 与 discovery URL 稳定，
		   是最符合 OpenID Connect 规范的模式。

		2. Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant)
		   允许任意组织租户账号登录。

		3. Multitenant and personal Microsoft accounts (e.g. Skype, Xbox)
		   同时支持组织账号与个人微软账号（MSA）。

		4. Personal Microsoft accounts only
		   仅允许 MSA 个人账号登录。

		设计取舍：

		- 对个人用户和小团队来说，第 1 种已经足够：
		  大多数用户的部署场景只需要在用户指定的Tenant内的账号登录即可，
		  无需开放给任意组织或个人账号登录。

		- 微软的多租户做法和 go-oidc 不一样，实现有复杂度：
		  具体来说，微软在多租户 endpoint 里返回的issuer URL是 https://login.microsoftonline.com/{tenantid}/v2.0 即是动态的，
		  然而 go-oidc 要求 issuer URL 必须和 discovery document 里的一致，会引发校验失败。

		因此当前仅实现第 1 种 Single tenant 方案；
		如日后确有真实的多租户需求，再实现。
	*/
	tenant := strings.TrimSpace(cfg.Tenant)
	if "" == tenant {
		return nil, errors.New("Microsoft tenant is required")
	}
	issuerURL := fmt.Sprintf(oidcMicrosoftIssuerFormat, tenant)

	scopes := cfg.Scopes
	if len(scopes) == 0 {
		scopes = []string{"openid", "email", "profile"}
	}

	label := strings.TrimSpace(cfg.ProviderLabel)
	if label == "" {
		label = "Login with Microsoft"
	}

	p := &BaseOIDC{
		IDStr:           "microsoft",
		ProviderLabel:   label,
		IssuerURLStr:    issuerURL,
		ClientIDStr:     clientID,
		ClientSecretStr: clientSecret,
		RedirectURLStr:  redirectURL,
		ScopesList:      scopes,
	}

	p.Normalizer = func(raw map[string]any, idToken *oidc.IDToken) (*OIDCClaims, error) {
		claims := &OIDCClaims{
			Provider:          "microsoft",
			Subject:           idToken.Subject,
			Issuer:            idToken.Issuer,
			Audience:          idToken.Audience,
			Email:             claimString(raw, OIDCClaimEmail),
			EmailVerified:     claimBool(raw, OIDCClaimEmailVerified),
			PreferredUsername: claimString(raw, OIDCClaimPreferredUsername),
			Name:              claimString(raw, OIDCClaimName),
			TenantID:          claimString(raw, OIDCClaimTenantID),
		}
		return claims, nil
	}

	return p, nil
}
