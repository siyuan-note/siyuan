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

package model

import (
	"context"

	"github.com/emersion/go-vcard"
	"github.com/emersion/go-webdav/carddav"
)

const (
	// REF: https://developers.google.com/people/carddav#resources
	CardDavPrincipalPath   = "/carddav"
	CardDavHomeSetPath     = CardDavPrincipalPath + "/contacts"
	CardDavAddressBookPath = CardDavHomeSetPath + "/default"
)

type CardDavBackend struct{}

func (b *CardDavBackend) CurrentUserPrincipal(ctx context.Context) (string, error) {
	return CardDavPrincipalPath, nil
}

func (b *CardDavBackend) AddressbookHomeSetPath(ctx context.Context) (string, error) {
	return CardDavHomeSetPath, nil
}

func (b *CardDavBackend) AddressBook(ctx context.Context) (*carddav.AddressBook, error) {
	return &carddav.AddressBook{
		Path:        CardDavAddressBookPath,
		Name:        "SiYuan",
		Description: "SiYuan default contacts",
	}, nil
}

func (b *CardDavBackend) GetAddressObject(ctx context.Context, path string, req *carddav.AddressDataRequest) (addressObject *carddav.AddressObject, err error) {
	// TODO
	return
}

func (b *CardDavBackend) ListAddressObjects(ctx context.Context, req *carddav.AddressDataRequest) (addressObjects []carddav.AddressObject, err error) {
	// TODO
	return
}

func (b *CardDavBackend) QueryAddressObjects(ctx context.Context, query *carddav.AddressBookQuery) (addressObjects []carddav.AddressObject, err error) {
	// TODO
	return
}

func (b *CardDavBackend) PutAddressObject(ctx context.Context, path string, card vcard.Card, opts *carddav.PutAddressObjectOptions) (loc string, err error) {
	// TODO
	return
}

func (b *CardDavBackend) DeleteAddressObject(ctx context.Context, path string) (err error) {
	// TODO
	return
}
