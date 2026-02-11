---
name: agent-browser
description: Browse the web using agent-browser CLI for real browser automation. Use when you need to navigate websites, fill forms, click buttons, extract content, take screenshots, or interact with web pages that require JavaScript. Triggers on "browse", "open website", "fill form", "click on", "screenshot page", "scrape", or any task requiring real browser interaction.
---

# Agent Browser

CLI for browser automation optimized for AI agents. Uses refs from accessibility snapshots for precise element targeting.

## Install

```bash
npm install -g agent-browser
agent-browser install              # Install browser binaries
agent-browser install --with-deps  # Linux: also install system deps
```

## Core Workflow

1. **Open** a page
2. **Snapshot** to get element refs
3. **Interact** using refs (@e1, @e2, etc.)
4. **Repeat** as needed

```bash
agent-browser open example.com
agent-browser snapshot -i          # -i = interactive elements only
# Output: - link "More info" [ref=e1]
agent-browser click @e1
```

## Key Commands

### Navigation
```bash
agent-browser open <url>           # Navigate to URL
agent-browser back                 # Go back
agent-browser forward              # Go forward
agent-browser reload               # Reload page
agent-browser close                # Close browser
```

### Snapshots (AI-optimized)
```bash
agent-browser snapshot             # Full accessibility tree
agent-browser snapshot -i          # Interactive elements only (recommended)
agent-browser snapshot -c          # Compact (remove empty nodes)
agent-browser snapshot -d 3        # Limit depth
agent-browser snapshot -s "#main"  # Scope to selector
```

### Interactions
```bash
agent-browser click @e1            # Click element
agent-browser dblclick @e1         # Double-click
agent-browser type @e1 "text"      # Type into element
agent-browser fill @e1 "text"      # Clear and fill
agent-browser press Enter          # Press key
agent-browser press Control+a      # Key combo
agent-browser hover @e1            # Hover
agent-browser check @e1            # Check checkbox
agent-browser uncheck @e1          # Uncheck
agent-browser select @e1 "option"  # Select dropdown
agent-browser upload @e1 file.pdf  # Upload file
agent-browser scroll down 500      # Scroll (up/down/left/right)
agent-browser wait @e1             # Wait for element
agent-browser wait 2000            # Wait ms
```

### Get Information
```bash
agent-browser get text @e1         # Get text content
agent-browser get html @e1         # Get HTML
agent-browser get value @e1        # Get input value
agent-browser get attr href @e1    # Get attribute
agent-browser get title            # Page title
agent-browser get url              # Current URL
agent-browser get count "button"   # Count elements
```

### Check State
```bash
agent-browser is visible @e1
agent-browser is enabled @e1
agent-browser is checked @e1
```

### Screenshots & PDF
```bash
agent-browser screenshot           # Screenshot to stdout (base64)
agent-browser screenshot page.png  # Save to file
agent-browser screenshot -f out.png  # Full page
agent-browser pdf document.pdf     # Save as PDF
```

### JavaScript
```bash
agent-browser eval "document.title"
agent-browser eval "window.scrollTo(0, 999999)"
```

## Sessions

Isolated browser instances with separate cookies/auth:

```bash
agent-browser --session work open github.com
agent-browser --session personal open gmail.com
agent-browser session list         # List active sessions
```

Or via environment:
```bash
export AGENT_BROWSER_SESSION=work
```

## Persistent Profiles

Keep login state across runs:

```bash
agent-browser --profile ~/.browser/myapp open app.example.com
# Login once, profile saves cookies/localStorage
```

## Common Patterns

### Login Flow
```bash
agent-browser open https://app.example.com/login
agent-browser snapshot -i
agent-browser fill @e1 "user@example.com"    # email field
agent-browser fill @e2 "password123"          # password field
agent-browser click @e3                       # submit button
agent-browser wait 2000
agent-browser snapshot -i                     # verify logged in
```

### Search and Extract
```bash
agent-browser open https://google.com
agent-browser snapshot -i
agent-browser fill @e1 "search query"
agent-browser press Enter
agent-browser wait 2000
agent-browser snapshot -i
agent-browser get text @e5                    # get result text
```

### Form Filling
```bash
agent-browser open https://form.example.com
agent-browser snapshot -i
agent-browser fill @e1 "John Doe"             # name
agent-browser fill @e2 "john@example.com"     # email
agent-browser select @e3 "California"         # dropdown
agent-browser check @e4                       # checkbox
agent-browser click @e5                       # submit
```

### Screenshot Documentation
```bash
agent-browser open https://example.com
agent-browser wait 1000
agent-browser screenshot -f docs/homepage.png
agent-browser click @e1
agent-browser wait 500
agent-browser screenshot docs/after-click.png
```

## Options

| Flag | Description |
|------|-------------|
| `--session <name>` | Isolated session |
| `--profile <path>` | Persistent browser profile |
| `--headed` | Show browser window (not headless) |
| `--proxy <url>` | Proxy server |
| `--user-agent <ua>` | Custom User-Agent |
| `--json` | JSON output |
| `-f, --full` | Full page screenshot |

## Tips

1. **Always snapshot before interacting** — refs change between page loads
2. **Use `-i` for snapshots** — interactive elements only, fewer tokens
3. **Use sessions for parallel work** — each session is isolated
4. **Use profiles for persistent login** — saves auth state
5. **Wait after navigation** — pages need time to load
6. **Refs are ephemeral** — re-snapshot if page changes

## Troubleshooting

```bash
agent-browser console              # View console logs
agent-browser errors               # View page errors
agent-browser highlight @e1        # Visually highlight element (headed mode)
agent-browser --debug snapshot     # Debug output
```
