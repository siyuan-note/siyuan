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
		loaded:        false,
		changed:       false,
		lock:          sync.Mutex{},
		books:         sync.Map{},
		booksMetaData: []*carddav.AddressBook{},
	}
)

func AddressBookPath2DirectoryPath(addressBookPath string) string {
	return filepath.Join(util.DataDir, "storage", strings.TrimPrefix(addressBookPath, "/"))
}

func AddressBooksMetaDataFilePath() string {
	return filepath.Join(util.DataDir, "storage", strings.TrimPrefix(CardDavAddressBooksMetaDataFilePath, "/"))
}

type Contacts struct {
	loaded        bool
	changed       bool
	lock          sync.Mutex // load & save
	books         sync.Map   // Path -> *AddressBook
	booksMetaData []*carddav.AddressBook
}

// load all contacts
func (c *Contacts) load() error {
	c.books.Clear()
	addressBooksMetaDataFilePath := AddressBooksMetaDataFilePath()
	metaData, err := os.ReadFile(addressBooksMetaDataFilePath)
	if os.IsNotExist(err) {
		// create meta data file
		if err = os.MkdirAll(CardDavDefaultAddressBookPath, 0755); err != nil {
			logging.LogErrorf("make dir [%s] failed: %s", CardDavDefaultAddressBookPath, err)
			return err
		}

		c.booksMetaData = []*carddav.AddressBook{&defaultAddressBook}
		if err := c.saveAddressBooksMetaData(); err != nil {
			return err
		}
	} else {
		// load meta data file
		c.booksMetaData = []*carddav.AddressBook{}
		if err = gulu.JSON.UnmarshalJSON(metaData, &c.booksMetaData); err != nil {
			logging.LogErrorf("unmarshal address books meta data failed: %s", err)
			return err
		}

		wg := &sync.WaitGroup{}
		wg.Add(len(c.booksMetaData))
		for _, addressBookMetaData := range c.booksMetaData {
			addressBook := &AddressBook{
				Changed:       false,
				DirectoryPath: AddressBookPath2DirectoryPath(addressBookMetaData.Path),
				MetaData:      addressBookMetaData,
				Addresses:     sync.Map{},
			}
			c.books.Store(addressBookMetaData.Path, addressBook)
			go func() {
				defer wg.Done()
				addressBook.load()
			}()
		}
		wg.Wait()
	}

	c.loaded = true
	c.changed = false
	return nil
}

// save all contacts
func (c *Contacts) save(force bool) error {
	if force || c.changed {
		// save address books meta data
		if err := c.saveAddressBooksMetaData(); err != nil {
			return err
		}

		// save all address to *.vbf files
		wg := &sync.WaitGroup{}
		c.books.Range(func(path any, book any) bool {
			wg.Add(1)
			go func() {
				defer wg.Done()
				// path_ := path.(string)
				book_ := book.(*AddressBook)
				book_.save(force)
			}()
			return true
		})
		wg.Wait()
		c.changed = false
	}
	return nil
}

// save all contacts
func (c *Contacts) saveAddressBooksMetaData() error {
	data, err := gulu.JSON.MarshalIndentJSON(c.booksMetaData, "", "  ")
	if err != nil {
		logging.LogErrorf("marshal address books meta data failed: %s", err)
		return err
	}

	filePath := AddressBooksMetaDataFilePath()
	if err := os.WriteFile(filePath, data, 0755); err != nil {
		logging.LogErrorf("write file [%s] failed: %s", filePath, err)
		return err
	}

	return nil
}

func (c *Contacts) Load() error {
	c.lock.Lock()
	defer c.lock.Unlock()

	if !c.loaded {
		return c.load()
	}
	return nil
}

func (c *Contacts) ListAddressBooks() (addressBooks []carddav.AddressBook, err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	for _, addressBook := range contacts.booksMetaData {
		addressBooks = append(addressBooks, *addressBook)
	}
	return
}

func (c *Contacts) GetAddressBook(path string) (addressBook *carddav.AddressBook, err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	if book, ok := contacts.books.Load(path); ok {
		addressBook = book.(*AddressBook).MetaData
	}
	return
}

func (c *Contacts) CreateAddressBook(addressBookMetaData *carddav.AddressBook) (err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	var addressBook *AddressBook

	// update map
	if value, ok := c.books.Load(addressBookMetaData.Path); ok {
		// update map item
		addressBook = value.(*AddressBook)
		addressBook.MetaData = addressBookMetaData
	} else {
		// insert map item
		addressBook = &AddressBook{
			Changed:       false,
			DirectoryPath: AddressBookPath2DirectoryPath(addressBookMetaData.Path),
			MetaData:      addressBookMetaData,
			Addresses:     sync.Map{},
		}
		c.books.Store(addressBookMetaData.Path, addressBook)
	}

	var index = -1
	for i, item := range c.booksMetaData {
		if item.Path == addressBookMetaData.Path {
			index = i
			break
		}
	}

	if index >= 0 {
		// update list
		c.booksMetaData[index] = addressBookMetaData
	} else {
		// insert list
		c.booksMetaData = append(c.booksMetaData, addressBookMetaData)
	}

	// create address book directory
	if err = os.MkdirAll(addressBook.DirectoryPath, 0755); err != nil {
		logging.LogErrorf("create directory [%s] failed: %s", addressBook, err)
		return
	}

	// save meta data
	if err = c.saveAddressBooksMetaData(); err != nil {
		return
	}

	return
}

func (c *Contacts) DeleteAddressBook(path string) (err error) {
	c.lock.Lock()
	defer c.lock.Unlock()

	var addressBook *AddressBook

	// delete map item
	if value, loaded := c.books.LoadAndDelete(path); loaded {
		addressBook = value.(*AddressBook)
	}

	// delete list item
	for i, item := range c.booksMetaData {
		if item.Path == path {
			c.booksMetaData = append(c.booksMetaData[:i], c.booksMetaData[i+1:]...)
			break
		}
	}

	// remove address book directory
	if err = os.RemoveAll(addressBook.DirectoryPath); err != nil {
		logging.LogErrorf("remove directory [%s] failed: %s", addressBook, err)
		return
	}

	// save meta data
	if err = c.saveAddressBooksMetaData(); err != nil {
		return
	}

	return nil
}

type AddressBook struct {
	Changed       bool
	DirectoryPath string
	MetaData      *carddav.AddressBook
	Addresses     sync.Map // id -> *AddressObject
}

// load an address book from multiple *.vcf files
func (b *AddressBook) load() error {
	entries, err := os.ReadDir(b.DirectoryPath)
	if err != nil {
		logging.LogErrorf("read dir [%s] failed: %s", b.DirectoryPath, err)
		return err
	}

	wg := &sync.WaitGroup{}
	for _, entry := range entries {
		if !entry.IsDir() {
			filename := entry.Name()
			ext := path.Ext(filename)
			if ext == ".vcf" {
				wg.Add(1)
				go func() {
					defer wg.Done()

					addressFilePath := path.Join(b.DirectoryPath, filename)

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
	wg.Wait()
	return nil
}

// save an address book to multiple *.vcf files
func (b *AddressBook) save(force bool) error {
	if force || b.Changed {
		// create directory
		if err := os.MkdirAll(b.DirectoryPath, 0755); err != nil {
			logging.LogErrorf("create directory [%s] failed: %s", b.DirectoryPath, err)
			return err
		}

		wg := &sync.WaitGroup{}
		b.Addresses.Range(func(id any, address any) bool {
			wg.Add(1)
			go func() {
				defer wg.Done()
				// id_ := id.(string)
				address_ := address.(*AddressObject)
				address_.save(force)
			}()
			return true
		})
		wg.Wait()
		b.Changed = false
	}

	return nil
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
	if err = contacts.Load(); err != nil {
		return
	}

	return contacts.ListAddressBooks()
}

func (b *CardDavBackend) GetAddressBook(ctx context.Context, path string) (addressBook *carddav.AddressBook, err error) {
	logging.LogInfof("CardDAV GetAddressBook")
	if err = contacts.Load(); err != nil {
		return
	}

	return contacts.GetAddressBook(path)
}

func (b *CardDavBackend) CreateAddressBook(ctx context.Context, addressBook *carddav.AddressBook) (err error) {
	logging.LogInfof("CardDAV CreateAddressBook")
	if err = contacts.Load(); err != nil {
		return
	}
	return contacts.CreateAddressBook(addressBook)
}

func (b *CardDavBackend) DeleteAddressBook(ctx context.Context, path string) (err error) {
	logging.LogInfof("CardDAV DeleteAddressBook")
	if err = contacts.Load(); err != nil {
		return
	}
	return contacts.DeleteAddressBook(path)
}

func (b *CardDavBackend) GetAddressObject(ctx context.Context, path string, req *carddav.AddressDataRequest) (addressObject *carddav.AddressObject, err error) {
	logging.LogInfof("CardDAV GetAddressObject: %s", path)
	if err = contacts.Load(); err != nil {
		return
	}

	// TODO
	return
}

func (b *CardDavBackend) ListAddressObjects(ctx context.Context, path string, req *carddav.AddressDataRequest) (addressObjects []carddav.AddressObject, err error) {
	logging.LogInfof("CardDAV ListAddressObjects")
	if err = contacts.Load(); err != nil {
		return
	}

	// TODO
	return
}

func (b *CardDavBackend) QueryAddressObjects(ctx context.Context, path string, query *carddav.AddressBookQuery) (addressObjects []carddav.AddressObject, err error) {
	logging.LogInfof("CardDAV QueryAddressObjects: %v", query)
	if err = contacts.Load(); err != nil {
		return
	}

	// TODO
	return
}

func (b *CardDavBackend) PutAddressObject(ctx context.Context, path string, card vcard.Card, opts *carddav.PutAddressObjectOptions) (addressObject *carddav.AddressObject, err error) {
	logging.LogInfof("CardDAV PutAddressObject: %s", path)
	if err = contacts.Load(); err != nil {
		return
	}

	// TODO
	return
}

func (b *CardDavBackend) DeleteAddressObject(ctx context.Context, path string) (err error) {
	logging.LogInfof("CardDAV DeleteAddressObject: %s", path)
	if err = contacts.Load(); err != nil {
		return
	}

	// TODO
	return
}
