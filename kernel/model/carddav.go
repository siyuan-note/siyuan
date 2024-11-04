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
		Loaded:        false,
		Changed:       false,
		Lock:          sync.Mutex{},
		Books:         sync.Map{},
		BooksMetaData: []*carddav.AddressBook{},
	}
)

type Contacts struct {
	Loaded        bool
	Changed       bool
	Lock          sync.Mutex // load & save
	Books         sync.Map   // Path -> *AddressBook
	BooksMetaData []*carddav.AddressBook
}

// reload all contacts
func (c *Contacts) reload() error {
	c.Lock.Lock()
	defer c.Lock.Unlock()

	c.Books.Clear()
	addressBooksMetaDataFilePath := filepath.Join(util.DataDir, "storage", strings.TrimPrefix(CardDavAddressBooksMetaDataFilePath, "/"))
	metaData, err := os.ReadFile(addressBooksMetaDataFilePath)
	if os.IsNotExist(err) {
		// create meta data file
		if err = os.MkdirAll(CardDavDefaultAddressBookPath, 0755); err != nil {
			logging.LogErrorf("make dir [%s] failed: %s", CardDavDefaultAddressBookPath, err)
			return err
		}

		c.BooksMetaData = []*carddav.AddressBook{&defaultAddressBook}
		data, err := gulu.JSON.MarshalIndentJSON(c.BooksMetaData, "", "  ")
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
		c.BooksMetaData = []*carddav.AddressBook{}
		if err = gulu.JSON.UnmarshalJSON(metaData, &c.BooksMetaData); err != nil {
			logging.LogErrorf("unmarshal address books meta data failed: %s", err)
			return err
		}

		wg := &sync.WaitGroup{}
		wg.Add(len(c.BooksMetaData))
		for _, addressBookMetaData := range c.BooksMetaData {
			addressBook := &AddressBook{
				Changed:   false,
				MetaData:  addressBookMetaData,
				Addresses: sync.Map{},
			}
			c.Books.Store(addressBookMetaData.Path, addressBook)
			go addressBook.load(wg)
		}
		wg.Wait()
	}
	c.Loaded = true
	c.Changed = false
	return nil
}

type AddressBook struct {
	Changed   bool
	MetaData  *carddav.AddressBook
	Addresses sync.Map // id -> *AddressObject
}

// load an address book from multiple *.vcf files
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

						// load data
						address := &AddressObject{
							FilePath: addressFilePath,
							BookPath: b.MetaData.Path,
						}
						if err := address.load(); err != nil {
							return
						}

						id := path.Base(filename)
						b.Addresses.Store(id, address)
					}()
				}
			}
		}
	}
}

// save an address book to multiple *.vcf files
func (b *AddressBook) save(force bool, wg *sync.WaitGroup) {
	defer wg.Done()

	b.Addresses.Range(func(id any, address any) bool {
		// id_ := id.(string)
		address_ := address.(*AddressObject)
		address_.save(force)
		return true
	})
}

type AddressObject struct {
	Changed  bool
	FilePath string
	BookPath string
	Data     *carddav.AddressObject
}

// load an address from *.vcf file
func (o *AddressObject) load() error {
	// get file info
	addressFileInfo, err := os.Stat(o.FilePath)
	if err != nil {
		logging.LogErrorf("get file [%s] info failed: %s", o.FilePath, err)
		return err
	}

	// read file
	addressData, err := os.ReadFile(o.FilePath)
	if err != nil {
		logging.LogErrorf("read file [%s] failed: %s", o.FilePath, err)
		return err
	}

	// decode file
	reader := bytes.NewReader(addressData)
	decoder := vcard.NewDecoder(reader)
	card, err := decoder.Decode()
	if err != nil {
		logging.LogErrorf("decode file [%s] failed: %s", o.FilePath, err)
		return err
	}

	// load data
	o.Changed = false
	o.Data = &carddav.AddressObject{
		Path:          o.BookPath + "/" + addressFileInfo.Name(),
		ModTime:       addressFileInfo.ModTime(),
		ContentLength: addressFileInfo.Size(),
		ETag:          fmt.Sprintf("%x-%x", addressFileInfo.ModTime(), addressFileInfo.Size()),
		Card:          card,
	}
	return nil
}

// save an address to *.vcf file
func (o *AddressObject) save(force bool) error {
	if force || o.Changed {
		var addressData bytes.Buffer

		// encode data
		encoder := vcard.NewEncoder(&addressData)
		if err := encoder.Encode(o.Data.Card); err != nil {
			logging.LogErrorf("encode card [%s] failed: %s", o.Data.Path, err)
			return err
		}

		// write file
		if err := os.WriteFile(o.FilePath, addressData.Bytes(), 0755); err != nil {
			logging.LogErrorf("write file [%s] failed: %s", o.FilePath, err)
			return err
		}

		// update file info
		addressFileInfo, err := os.Stat(o.FilePath)
		if err != nil {
			logging.LogErrorf("get file [%s] info failed: %s", o.FilePath, err)
			return err
		}

		o.Data.Path = o.BookPath + "/" + addressFileInfo.Name()
		o.Data.ModTime = addressFileInfo.ModTime()
		o.Data.ContentLength = addressFileInfo.Size()
		o.Data.ETag = fmt.Sprintf("%x-%x", addressFileInfo.ModTime(), addressFileInfo.Size())

		o.Changed = false
	}
	return nil
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
