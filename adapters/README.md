# Debug Adapter Installation

debug-run doesn't bundle debug adapters - they need to be installed separately.

## .NET (netcoredbg)

```bash
# Ubuntu/Debian
apt install netcoredbg

# macOS
brew install netcoredbg

# Windows (scoop)
scoop install netcoredbg

# Manual download
# https://github.com/Samsung/netcoredbg/releases
```

## Python (debugpy)

```bash
pip install debugpy
```

## Node.js

Node.js debugging uses the built-in `--inspect` protocol - no additional installation needed.

## C/C++/Rust (LLDB)

```bash
# macOS (included with Xcode)
xcode-select --install

# Ubuntu/Debian
apt install lldb

# Or use codelldb from VS Code extensions
```

## Verifying Installation

```bash
# .NET
netcoredbg --version

# Python
python -c "import debugpy; print(debugpy.__version__)"

# Node.js
node --version  # v18+ recommended

# LLDB
lldb --version
```
