// SiYuan - From thought to insight, with agents
// Copyright (c) 2020-present, b3log.org
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

package conf

import (
	"encoding/hex"
	"strings"

	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	OIDCProviderCustom    = "custom"
	OIDCProviderGoogle    = "google"
	OIDCProviderMicrosoft = "microsoft"
	OIDCProviderGitHub    = "github"

	OIDCClaimOperatorEquals   = "equals"
	OIDCClaimOperatorContains = "contains"
)

// OIDC 保存工作空间的 OpenID Connect 登录配置。
type OIDC struct {
	Enabled      bool             `json:"enabled"`
	Provider     string           `json:"provider"`
	IssuerURL    string           `json:"issuerURL"`
	ClientID     string           `json:"clientID"`
	ClientSecret string           `json:"clientSecret"`
	Scopes       []string         `json:"scopes"`
	RedirectURL  string           `json:"redirectURL"`
	AllowAll     bool             `json:"allowAll"`
	ClaimRules   []*OIDCClaimRule `json:"claimRules"`
}

// OIDCClaimRule 描述一条身份声明准入规则。同一规则的 Values 为或关系，不同规则之间为与关系。
type OIDCClaimRule struct {
	Claim    string   `json:"claim"`
	Operator string   `json:"operator"`
	Values   []string `json:"values"`
}

func NewOIDC() *OIDC {
	return &OIDC{
		Provider:   OIDCProviderCustom,
		Scopes:     []string{"openid", "profile", "email"},
		ClaimRules: []*OIDCClaimRule{},
	}
}

func (o *OIDC) Normalize() {
	if o == nil {
		return
	}
	o.Provider = strings.ToLower(strings.TrimSpace(o.Provider))
	o.IssuerURL = strings.TrimSpace(o.IssuerURL)
	o.ClientID = strings.TrimSpace(o.ClientID)
	o.RedirectURL = strings.TrimSpace(o.RedirectURL)
	if len(o.Scopes) == 0 {
		o.Scopes = []string{"openid", "profile", "email"}
	}
	for i, scope := range o.Scopes {
		o.Scopes[i] = strings.TrimSpace(scope)
	}
	for _, rule := range o.ClaimRules {
		if rule == nil {
			continue
		}
		rule.Claim = strings.TrimSpace(rule.Claim)
		rule.Operator = strings.ToLower(strings.TrimSpace(rule.Operator))
		for i, value := range rule.Values {
			rule.Values[i] = strings.TrimSpace(value)
		}
	}
}

func (o *OIDC) EncryptClientSecret() {
	if o == nil || o.ClientSecret == "" {
		return
	}
	o.ClientSecret = util.AESEncrypt(o.ClientSecret)
}

func (o *OIDC) DecryptClientSecret() {
	if o == nil || o.ClientSecret == "" {
		return
	}
	original := o.ClientSecret
	encrypted, err := hex.DecodeString(original)
	if err != nil || len(encrypted) == 0 || len(encrypted)%16 != 0 {
		return
	}
	defer func() {
		if recover() != nil {
			o.ClientSecret = original
		}
	}()
	decrypted := util.AESDecrypt(o.ClientSecret)
	if decrypted == nil {
		return
	}
	if plain, err := hex.DecodeString(string(decrypted)); err == nil {
		o.ClientSecret = string(plain)
	}
}
