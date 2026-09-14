package model

import (
	"github.com/siyuan-note/siyuan/kernel/apicontract"
	"github.com/siyuan-note/siyuan/kernel/conf"
)

func SystemOIDCConfig(value apicontract.SystemOIDC) *conf.OIDC {
	result := &conf.OIDC{Enabled: value.Enabled, Provider: value.Provider, IssuerURL: value.IssuerURL, ClientID: value.ClientID, ClientSecret: value.ClientSecret, Scopes: value.Scopes, RedirectURL: value.RedirectURL, AllowAll: value.AllowAll}
	if value.ClaimRules != nil {
		result.ClaimRules = make([]*conf.OIDCClaimRule, len(value.ClaimRules))
		for i, rule := range value.ClaimRules {
			if rule != nil {
				result.ClaimRules[i] = &conf.OIDCClaimRule{Claim: rule.Claim, Operator: rule.Operator, Values: rule.Values}
			}
		}
	}
	return result
}
func SystemOIDCPayload(value *conf.OIDC) *apicontract.SystemOIDC {
	if value == nil {
		return nil
	}
	result := &apicontract.SystemOIDC{Enabled: value.Enabled, Provider: value.Provider, IssuerURL: value.IssuerURL, ClientID: value.ClientID, ClientSecret: value.ClientSecret, Scopes: value.Scopes, RedirectURL: value.RedirectURL, AllowAll: value.AllowAll}
	if value.ClaimRules != nil {
		result.ClaimRules = make([]*apicontract.SystemOIDCClaimRule, len(value.ClaimRules))
		for i, rule := range value.ClaimRules {
			if rule != nil {
				result.ClaimRules[i] = &apicontract.SystemOIDCClaimRule{Claim: rule.Claim, Operator: rule.Operator, Values: rule.Values}
			}
		}
	}
	return result
}
