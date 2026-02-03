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
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

type ClaimNormalizer func(raw map[string]any, idToken *oidc.IDToken) (*OIDCClaims, error)

type BaseOIDC struct {
	IDStr           string
	ProviderLabel   string
	IssuerURLStr    string
	ClientIDStr     string
	ClientSecretStr string
	RedirectURLStr  string
	ScopesList      []string
	PKCE            bool
	Normalizer      ClaimNormalizer
}

func (p *BaseOIDC) ID() string {
	return p.IDStr
}

func (p *BaseOIDC) Label() string {
	if "" != p.ProviderLabel {
		return p.ProviderLabel
	}
	return "Login with OIDC"
}

func (p *BaseOIDC) AuthURL(state, nonce string) (string, any, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	oauthConfig, _, err := p.discover(ctx)
	if err != nil {
		return "", nil, err
	}

	if p.PKCE {
		pkceState, err := newPKCEState()
		if err != nil {
			return "", nil, err
		}

		return oauthConfig.AuthCodeURL(
			state,
			oidc.Nonce(nonce),
			oauth2.SetAuthURLParam("code_challenge", pkceState.challenge),
			oauth2.SetAuthURLParam("code_challenge_method", "S256"),
		), pkceState, nil
	}

	return oauthConfig.AuthCodeURL(state, oidc.Nonce(nonce)), nil, nil
}

func (p *BaseOIDC) HandleCallback(ctx context.Context, code, nonce string, extra any) (*OIDCClaims, error) {
	oauthConfig, oidcProvider, err := p.discover(ctx)
	if err != nil {
		return nil, err
	}

	var token *oauth2.Token
	if p.PKCE {
		pkceState, ok := extra.(*pkceState)
		if !ok || pkceState == nil || pkceState.Verifier == "" {
			return nil, errors.New("oidc pkce verifier missing")
		}
		token, err = oauthConfig.Exchange(ctx, code, oauth2.SetAuthURLParam("code_verifier", pkceState.Verifier))
	} else {
		token, err = oauthConfig.Exchange(ctx, code)
	}
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

type pkceState struct {
	Verifier  string
	challenge string
}

func newPKCEState() (*pkceState, error) {
	entropy := make([]byte, 32)
	if _, err := rand.Read(entropy); err != nil {
		return nil, err
	}

	verifier := base64.RawURLEncoding.EncodeToString(entropy)
	sum := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(sum[:])

	return &pkceState{Verifier: verifier, challenge: challenge}, nil
}
