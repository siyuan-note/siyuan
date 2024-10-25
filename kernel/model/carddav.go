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
	"bytes"
	"context"
	"fmt"
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"

	"github.com/88250/gulu"
	"github.com/emersion/go-vcard"
	"github.com/emersion/go-webdav/carddav"
	"github.com/siyuan-note/logging"
	"github.com/siyuan-note/siyuan/kernel/util"
)

const (
	// REF: https://developers.google.com/people/carddav#resources
	CardDavPrefixPath        = "/carddav"
	CardDavRootPath          = CardDavPrefixPath + "/principals"      // 0 resourceTypeRoot
	CardDavUserPrincipalPath = CardDavRootPath + "/main"              // 1 resourceTypeUserPrincipal
	CardDavHomeSetPath       = CardDavUserPrincipalPath + "/contacts" // 2 resourceTypeAddressBookHomeSet

	CardDavDefaultAddressBookPath = CardDavHomeSetPath + "/default" // 3 resourceTypeAddressBook
	CardDavDefaultAddressBookName = "default"

	CardDavAddressBooksMetaDataFilePath = CardDavHomeSetPath + "/address-books.json"
)

var (
	defaultAddressBook = carddav.AddressBook{
		Path:        CardDavDefaultAddressBookPath,
		Name:        CardDavDefaultAddressBookName,
		Description: "Default address book",
		// MaxResourceSize: math.MaxInt32,
	}
	contacts = Contacts{
		M: sync.Map{},
	}
)

type Contacts struct {
	M sync.Map // Path -> *AddressBook
}

func (c *Contacts) reload() error {
	c.M.Clear()
	addressBooksMetaDataFilePath := filepath.Join(util.DataDir, "storage", strings.TrimPrefix(CardDavAddressBooksMetaDataFilePath, "/"))
	metaData, err := os.ReadFile(addressBooksMetaDataFilePath)
	if os.IsNotExist(err) {
		// create meta data file
		if err = os.MkdirAll(CardDavDefaultAddressBookPath, 0755); err != nil {
			logging.LogErrorf("make dir [%s] failed: %s", CardDavDefaultAddressBookPath, err)
			return err
		}

		addressBooksMetaData := []*carddav.AddressBook{&defaultAddressBook}
		data, err := gulu.JSON.MarshalIndentJSON(addressBooksMetaData, "", "  ")
		if err != nil {
			logging.LogErrorf("marshal address books meta data failed: %s", err)
			return err
		}

		if err := os.WriteFile(addressBooksMetaDataFilePath, data, 0755); err != nil {
			logging.LogErrorf("write file [%s] failed: %s", addressBooksMetaDataFilePath, err)
			return err
		}
	} else {
		// load meta data file
		addressBooksMetaData := []*carddav.AddressBook{}
		if err = gulu.JSON.UnmarshalJSON(metaData, &addressBooksMetaData); err != nil {
			logging.LogErrorf("unmarshal address books meta data failed: %s", err)
			return err
		}

		wg := &sync.WaitGroup{}
		wg.Add(len(addressBooksMetaData))
		for _, addressBookMetaData := range addressBooksMetaData {
			addressBook := &AddressBook{
				MetaData:  addressBookMetaData,
				Addresses: sync.Map{},
			}
			c.M.Store(addressBookMetaData.Path, addressBook)
			go addressBook.load(wg)
		}
		wg.Wait()
	}
	return nil
}

type AddressBook struct {
	MetaData  *carddav.AddressBook
	Addresses sync.Map // id -> *carddav.AddressObject
}

func (b *AddressBook) load(wg *sync.WaitGroup) {
	defer wg.Done()
	addressBookPath := filepath.Join(util.DataDir, "storage", strings.TrimPrefix(b.MetaData.Path, "/"))
	entries, err := os.ReadDir(addressBookPath)
	if err != nil {
		logging.LogErrorf("read dir [%s] failed: %s", addressBookPath, err)
	} else {
		for _, entry := range entries {
			if !entry.IsDir() {
				filename := entry.Name()
				ext := path.Ext(filename)
				if ext == ".vcf" {
					wg.Add(1)
					go func() {
						defer wg.Done()

						addressFilePath := path.Join(addressBookPath, filename)

						addressFileInfo, err := entry.Info()
						if err != nil {
							logging.LogErrorf("get file [%s] info failed: %s", addressFilePath, err)
							return
						}

						// read file
						addressData, err := os.ReadFile(addressFilePath)
						if err != nil {
							logging.LogErrorf("read file [%s] failed: %s", addressFilePath, err)
							return
						}

						// decode file
						reader := bytes.NewReader(addressData)
						decoder := vcard.NewDecoder(reader)
						card, err := decoder.Decode()
						if err != nil {
							logging.LogErrorf("decode file [%s] failed: %s", addressFilePath, err)
							return
						}

						// load data
						address := &carddav.AddressObject{
							Path:          b.MetaData.Path + "/" + filename,
							ModTime:       addressFileInfo.ModTime(),
							ContentLength: addressFileInfo.Size(),
							ETag:          fmt.Sprintf("%x-%x", addressFileInfo.ModTime(), addressFileInfo.Size()),
							Card:          card,
						}

						id := path.Base(filename)
						b.Addresses.Store(id, address)
					}()
				}
			}
		}
	}
}

func (b *AddressBook) save(wg *sync.WaitGroup) {
	defer wg.Done()
	// TODO: save addresses data to files
}

type CardDavBackend struct{}

func (b *CardDavBackend) CurrentUserPrincipal(ctx context.Context) (string, error) {
	logging.LogInfof("CardDAV CurrentUserPrincipal")
	return CardDavUserPrincipalPath, nil
}

func (b *CardDavBackend) AddressBookHomeSetPath(ctx context.Context) (string, error) {
	logging.LogInfof("CardDAV AddressBookHomeSetPath")
	return CardDavHomeSetPath, nil
}

func (b *CardDavBackend) ListAddressBooks(ctx context.Context) (addressBooks []carddav.AddressBook, err error) {
	logging.LogInfof("CardDAV ListAddressBooks")
	// TODO
	return
}

func (b *CardDavBackend) GetAddressBook(ctx context.Context, path string) (addressBook *carddav.AddressBook, err error) {
	logging.LogInfof("CardDAV GetAddressBook")
	// TODO
	return
}

func (b *CardDavBackend) CreateAddressBook(ctx context.Context, addressBook *carddav.AddressBook) (err error) {
	logging.LogInfof("CardDAV CreateAddressBook")
	// TODO
	return
}

func (b *CardDavBackend) DeleteAddressBook(ctx context.Context, path string) (err error) {
	logging.LogInfof("CardDAV DeleteAddressBook")
	// TODO
	return
}

func (b *CardDavBackend) GetAddressObject(ctx context.Context, path string, req *carddav.AddressDataRequest) (addressObject *carddav.AddressObject, err error) {
	logging.LogInfof("CardDAV GetAddressObject: %s", path)
	// TODO
	return
}

func (b *CardDavBackend) ListAddressObjects(ctx context.Context, path string, req *carddav.AddressDataRequest) (addressObjects []carddav.AddressObject, err error) {
	logging.LogInfof("CardDAV ListAddressObjects")
	// TODO
	return
}

func (b *CardDavBackend) QueryAddressObjects(ctx context.Context, path string, query *carddav.AddressBookQuery) (addressObjects []carddav.AddressObject, err error) {
	logging.LogInfof("CardDAV QueryAddressObjects: %v", query)
	// TODO
	return
}

func (b *CardDavBackend) PutAddressObject(ctx context.Context, path string, card vcard.Card, opts *carddav.PutAddressObjectOptions) (addressObject *carddav.AddressObject, err error) {
	logging.LogInfof("CardDAV PutAddressObject: %s", path)
	// TODO
	return
}

func (b *CardDavBackend) DeleteAddressObject(ctx context.Context, path string) (err error) {
	logging.LogInfof("CardDAV DeleteAddressObject: %s", path)
	// TODO
	return
}
