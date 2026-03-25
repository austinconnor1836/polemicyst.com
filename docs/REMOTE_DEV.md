# Remote Development Setup

Access your MacBook dev environment from your iPhone (or any device) using Tailscale + SSH.

## Architecture

| Use case              | Connection                      | Address                    | Works from     |
| --------------------- | ------------------------------- | -------------------------- | -------------- |
| **Termius SSH**       | Tailscale SSH                   | `100.117.217.74` (port 22) | Any network    |
| **Clipfire iOS app**  | Local HTTPS                     | `192.168.0.16:3000`        | Same WiFi only |
| **iOS Shortcuts SSH** | N/A (broken with Tailscale SSH) | Use Termius snippets       | —              |

## Prerequisites

- **Tailscale CLI** (not the GUI/cask): `brew install tailscale`
- **Tailscale iOS app** on your iPhone, logged into the same account
- **macOS Remote Login** enabled: System Settings → General → Sharing → Remote Login
- **Termius** (or similar SSH app) on iPhone

## Tailscale Daemon

We run the standalone `tailscaled` daemon instead of the macOS GUI app because the sandboxed GUI doesn't support Tailscale SSH.

### Start manually

```bash
sudo bash scripts/tailscale-start.sh
```

### Persistent service (survives reboot)

Install the launch daemon (one-time):

```bash
sudo cp /tmp/com.tailscale.standalone.plist /Library/LaunchDaemons/
sudo launchctl load /Library/LaunchDaemons/com.tailscale.standalone.plist
```

After a reboot, the daemon starts automatically. On first boot, authenticate once:

```bash
/opt/homebrew/bin/tailscale --socket=/tmp/tailscaled.sock up --ssh --accept-routes
```

After that, it reconnects automatically on every boot.

### Check status

```bash
/opt/homebrew/bin/tailscale --socket=/tmp/tailscaled.sock status
```

### Stop

```bash
sudo launchctl unload /Library/LaunchDaemons/com.tailscale.standalone.plist
```

## Connecting from iPhone

### Termius (SSH from anywhere)

1. Host: `100.117.217.74`
2. Port: `22`
3. Username: `austin`
4. No key or password needed (Tailscale SSH handles auth)

### Build & run Clipfire from Termius

Create a **Termius snippet** with:

```bash
bash /Users/austin/Developer/polemicyst/polemicyst.com/ios/scripts/xcode-run.sh
```

Run it from the saved host to build and deploy Clipfire to your connected iPhone.

### Clipfire iOS app (dev mode)

The Debug build connects to `https://192.168.0.16:3000` (configured in `ios/project.yml`).
This requires being on the same WiFi network as the MacBook.

## Troubleshooting

### "sandboxed GUI builds" error

The `tailscale` CLI is connecting to the macOS GUI system extension instead of the standalone daemon. Always use the explicit socket:

```bash
/opt/homebrew/bin/tailscale --socket=/tmp/tailscaled.sock <command>
```

### Can't reach Tailscale IP from iPhone

The standalone daemon with `--port=0` uses userspace networking which doesn't route incoming TCP. This is why the Clipfire app uses the local WiFi IP instead of the Tailscale IP.

### Stale build cache (Facebook SDK errors)

```bash
rm -rf /tmp/clipfire-device-build
```

Then rebuild.

## Device IPs (permanent)

| Device                | Tailscale IP     | Local IP       |
| --------------------- | ---------------- | -------------- |
| MacBook Pro (current) | `100.117.217.74` | `192.168.0.16` |
| iPhone 14             | `100.91.165.65`  | varies         |
