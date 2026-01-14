package runner

import (
	"runtime"
	"testing"
)

func TestResolveShell(t *testing.T) {
	tests := []struct {
		name       string
		shell      string
		scriptPath string
		wantBin    string
		wantArgs   []string
	}{
		{
			name:       "Bash",
			shell:      "bash",
			scriptPath: "/tmp/script.sh",
			wantBin:    "bash",
			wantArgs:   []string{"--noprofile", "--norc", "-e", "/tmp/script.sh"},
		},
		{
			name:       "PowerShell",
			shell:      "powershell",
			scriptPath: "c:\\temp\\script.ps1",
			wantBin:    "powershell",
			wantArgs:   []string{"-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", "c:\\temp\\script.ps1"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			bin, args := resolveShell(tt.shell, tt.scriptPath)
			if bin != tt.wantBin {
				t.Errorf("resolveShell() bin = %v, want %v", bin, tt.wantBin)
			}
			if len(args) != len(tt.wantArgs) {
				t.Errorf("resolveShell() args count = %v, want %v", len(args), len(tt.wantArgs))
			}
			for i, arg := range args {
				if arg != tt.wantArgs[i] {
					t.Errorf("resolveShell() arg[%d] = %v, want %v", i, arg, tt.wantArgs[i])
				}
			}
		})
	}
}

func TestResolveShellPython(t *testing.T) {
	scriptPath := "script.py"
	bin, args := resolveShell("python", scriptPath)

	expectedBin := "python3"
	if runtime.GOOS == "windows" {
		expectedBin = "python"
	}

	if bin != expectedBin {
		t.Errorf("Expected python bin %s, got %s", expectedBin, bin)
	}
	if len(args) != 1 || args[0] != scriptPath {
		t.Errorf("Expected args [%s], got %v", scriptPath, args)
	}
}
