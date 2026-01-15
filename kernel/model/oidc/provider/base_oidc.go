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

package provider

import (
	"context"
	"errors"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/siyuan-note/logging"
	"golang.org/x/oauth2"
)

type ClaimNormalizer func(raw map[string]any, idToken *oidc.IDToken) (*OIDCClaims, error)

type BaseOIDC struct {
	IDStr        string
	ProviderName string
	IssuerURLStr string
	ClientIDStr  string
	ClientSecretStr string
	RedirectURLStr  string
	ScopesList   []string
	Normalizer   ClaimNormalizer
}

func (p *BaseOIDC) ID() string {
	return p.IDStr
}

func (p *BaseOIDC) Label() string {
	if "" != p.ProviderName {
		return p.ProviderName
	}
	return "Login with OIDC"
}

func (p *BaseOIDC) AuthURL(state, nonce string) string {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	oauthConfig, _, err := p.discover(ctx)
	if err != nil {
		logging.LogErrorf("oidc discovery failed: %s", err)
		return ""
	}

	return oauthConfig.AuthCodeURL(state, oidc.Nonce(nonce))
}

func (p *BaseOIDC) HandleCallback(ctx context.Context, code, nonce string) (*OIDCClaims, error) {
	oauthConfig, oidcProvider, err := p.discover(ctx)
	if err != nil {
		return nil, err
	}

	token, err := oauthConfig.Exchange(ctx, code)
	if err != nil {
		return nil, err
	}

	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok || "" == rawIDToken {
		return nil, errors.New("oidc id_token missing")
	}

	verifier := oidcProvider.Verifier(&oidc.Config{ClientID: p.ClientIDStr})
	idToken, err := verifier.Verify(ctx, rawIDToken)
	if err != nil {
		return nil, err
	}

	if "" != nonce && idToken.Nonce != nonce {
		return nil, errors.New("oidc nonce mismatch")
	}

	rawClaims := map[string]any{}
	if err = idToken.Claims(&rawClaims); err != nil {
		return nil, err
	}

	if p.Normalizer != nil {
		return p.Normalizer(rawClaims, idToken)
	}

	return DefaultNormalizeClaims(rawClaims, idToken)
}

func (p *BaseOIDC) discover(ctx context.Context) (*oauth2.Config, *oidc.Provider, error) {
	oidcProvider, err := oidc.NewProvider(ctx, p.IssuerURLStr)
	if err != nil {
		return nil, nil, err
	}

	oauthConfig := &oauth2.Config{
		ClientID:     p.ClientIDStr,
		ClientSecret: p.ClientSecretStr,
		Endpoint:     oidcProvider.Endpoint(),
		RedirectURL:  p.RedirectURLStr,
		Scopes:       p.ScopesList,
	}
	return oauthConfig, oidcProvider, nil
}

func DefaultNormalizeClaims(raw map[string]any, idToken *oidc.IDToken) (*OIDCClaims, error) {
	claims := &OIDCClaims{
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
