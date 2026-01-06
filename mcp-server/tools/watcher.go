package tools

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
)

// Watcher monitors directories for changes to tool files.
type Watcher struct {
	watcher *fsnotify.Watcher
	dirs    []string
}

// NewWatcher creates a new Watcher for the specified directories.
func NewWatcher(dirs []string) (*Watcher, error) {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}

	return &Watcher{
		watcher: w,
		dirs:    dirs,
	}, nil
}

// Start begins monitoring the directories. The onChange callback is invoked
// when a tool file (YAML/YML) is created or modified.
// It runs largely in the background but this method spawns the event loop goroutine.
func (w *Watcher) Start(onChange func(path string)) {
	// Add watchers recursively
	for _, dir := range w.dirs {
		// Ensure dir exists before walking
		if _, err := os.Stat(dir); os.IsNotExist(err) {
			continue
		}

		filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
			if err != nil {
				return nil
			}
			if info.IsDir() {
				// Hide hidden dirs like .git but allow .addi
				if strings.HasPrefix(filepath.Base(path), ".") && filepath.Base(path) != ".addi" && !strings.Contains(path, ".addi") {
					// Check if it's .addi itself or children.
					// Logic: skip .git, .vscode etc.
					// But we want to watch .addi/public
					if filepath.Base(path) == ".git" {
						return filepath.SkipDir
					}
				}
				w.watcher.Add(path)
			}
			return nil
		})
	}

	go func() {
		var (
			// Simple debouncing
			mu    sync.Mutex
			timer *time.Timer
		)

		for {
			select {
			case event, ok := <-w.watcher.Events:
				if !ok {
					return
				}

				// Handle new directories
				if event.Op&fsnotify.Create == fsnotify.Create {
					fi, err := os.Stat(event.Name)
					if err == nil && fi.IsDir() {
						w.watcher.Add(event.Name)
					}
				}

				if event.Op&fsnotify.Write == fsnotify.Write || event.Op&fsnotify.Create == fsnotify.Create {
					ext := strings.ToLower(filepath.Ext(event.Name))
					if ext == ".yaml" || ext == ".yml" {
						// Debounce
						mu.Lock()
						if timer != nil {
							timer.Stop()
						}
						path := event.Name
						timer = time.AfterFunc(200*time.Millisecond, func() {
							onChange(path)
						})
						mu.Unlock()
					}
				}
			case err, ok := <-w.watcher.Errors:
				if !ok {
					return
				}
				fmt.Fprintf(os.Stderr, "Watcher error: %v\n", err)
			}
		}
	}()
}

// Close stops the watcher and releases resources.
func (w *Watcher) Close() {
	w.watcher.Close()
}
