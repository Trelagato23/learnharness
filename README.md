<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/lh_banner_dark.png">
    <source media="(prefers-color-scheme: light)" srcset="docs/assets/lh_banner_light.png">
    <img src="docs/assets/lh_banner_light.png" alt="LearnHarness" width="640">
  </picture>
</p>

<p align="center"><strong>An agent harness for learning.</strong></p>

<p align="center">
  <a href="https://learnharness.ai">Download</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#self-hosting-on-a-homelab--phone">Self-hosting</a> ·
  <a href="docs/development.md">Documentation</a> ·
  <a href="https://github.com/amosblomqvist/learnharness/issues">Issues</a>
</p>

LearnHarness uses AI agents to plan and teach lessons from your current understanding to your goal. It builds a detailed picture of what you understand and how you reason. That picture is updated as you learn.

Instead of just giving you an explanation, it uses your answers and thinking to decide what you need next. Teaching builds understanding one reasoning step at a time. Practice makes it usable. A persistent knowledge graph carries it across sessions.

![LearnHarness teaching session](docs/assets/teaching-session.png)

## How it works

1. **Measure.** Before teaching, the agent finds where your understanding ends on each part the lesson depends on. Your answers, confidence, and thinking show it where to start.
2. **Plan.** It works out a dependency map from that starting point to your goal. You can see the plan, and the lesson adapts when your understanding turns out different.
3. **Teach.** Each step builds on something you already understand. You predict, get an explanation, and check your understanding. Confusions are repaired before anything is built on them. The aim is for the goal to feel obviously true, not merely familiar.
4. **Practice.** Separate sessions pose varied problems that require the right knowledge to come to mind without being named first. Problems and hints adapt to your reasoning.

**Think out loud.** The thinking fields let you explain your reasoning, uncertainties, and reactions in your own words. This is how the agent gets a detailed picture rather than just a record of right and wrong answers. You can type or use dictation.

The agent can also research questions in the background, create visual explanations, and build interactive demonstrations.

## Knowledge that carries forward

What you are taught accumulates as propositions and reasoning chains: individual claims and the premises that lead to them. The graph shows this structure, with links back to the source sessions. You can also import notes.

Future teaching sessions can read the graph instead of starting from scratch. Practice sessions can draw their material from it. It stores the ideas and their connections, not ratings of your ability.

![LearnHarness knowledge graph](docs/assets/knowledge-graph.png)

## Download and get started

**[Download from learnharness.ai](https://learnharness.ai)** · [GitHub Releases](https://github.com/amosblomqvist/learnharness/releases)

- **macOS (Apple Silicon):** signed and notarized DMG. Drag the app to Applications.
- **Windows (x64):** run the installer. It is currently unsigned; Windows may show an “unknown publisher” or SmartScreen warning.
- **Linux (x64):** make the AppImage executable and open it, or install the Debian/Ubuntu `.deb`.

Add your provider API key and choose your models, then start a session with what you want to understand. LearnHarness supports 30+ provider options, including OpenAI, Anthropic, Google, DeepSeek, and OpenRouter. Optional dictation and web search use separate service keys.

All three platforms support in-app updates.

## Your keys, your data

- **Your keys and models.** No LearnHarness subscription or markup. You pay your providers for usage; a live cost meter shows model costs.
- **Local storage.** Your chats, graph, settings, and API keys live on your machine. Learning records are plain files you can inspect.
- **External services.** Models run through your configured providers. Model requests send the context needed for the task; web research and dictation also contact external services. Local storage does not mean offline processing.
- **Inspectable behavior.** System prompts are visible and editable. The app is open source under the AGPL-3.0 license.

## Development and support

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # deterministic, no LLM, no network
```

See the [development guide](docs/development.md), [architecture](docs/architecture.md), and [desktop release guide](docs/desktop-release.md).

Questions, bug reports, and feature requests: [GitHub Issues](https://github.com/amosblomqvist/learnharness/issues).

## Self-hosting on a homelab / phone

This runs the same Next.js server the desktop app wraps, without Electron. It listens on `0.0.0.0` so a phone on the LAN or a Tailscale network can open it. Set `LH_PASSWORD` before binding anything that is not loopback — the process exits if you do not. With the password set, every page and `/api/*` route requires a login. The session cookie is `HttpOnly` and `SameSite=Lax`. It is marked `Secure` when the request is HTTPS (`x-forwarded-proto: https`, or an `https:` URL). On plain HTTP (a typical LAN) leave `LH_COOKIE_SECURE` unset so the browser will store the cookie; put Tailscale Serve or another TLS proxy in front and set `LH_COOKIE_SECURE=1` if you want the cookie marked Secure.

Chats, the graph, settings, and provider API keys live under `LH_DATA_DIR` (default `./data` for the script below, `/data` in Docker). Keys are written to `LH_AUTH_FILE` (default `$LH_DATA_DIR/auth.json`). Node.js 22 or newer.

### Bare metal (Arch or Debian)

From a checkout:

```bash
npm ci
npm run build
node scripts/build-server.mjs

export LH_PASSWORD='choose-a-long-password'
export LH_DATA_DIR="$HOME/learnharness-data"
export PORT=3000
# optional: export LH_SESSION_SECRET='separate-hmac-key'
# optional: export LH_SESSION_DAYS=30
npm run headless
```

`npm run headless` is `node scripts/serve-headless.mjs`. It binds `0.0.0.0:$PORT` unless you set `HOSTNAME`. Loopback without a password is allowed:

```bash
HOSTNAME=127.0.0.1 npm run headless
```

Open `http://<lan-or-tailscale-ip>:3000` on the phone, sign in, then use the browser menu **Add to Home screen** / **Install app**. The installed icon is a standalone window. A service worker caches the static shell only; API calls and live turns are never cached. If the screen locks mid-turn, the server keeps the turn running. Unlocking the phone reattaches to that stream instead of dropping it.

### systemd

Build into `/opt/learnharness` as above (`npm ci`, `npm run build`, `node scripts/build-server.mjs`). Then:

```bash
sudo useradd --system --home /var/lib/learnharness --create-home learnharness
sudo install -m 0600 /dev/null /etc/learnharness.env
sudo tee /etc/learnharness.env >/dev/null <<'EOF'
LH_PASSWORD=choose-a-long-password
EOF
sudo cp deploy/learnharness.service /etc/systemd/system/learnharness.service
# If node is not /usr/bin/node, edit ExecStart (`command -v node`).
sudo systemctl daemon-reload
sudo systemctl enable --now learnharness
```

The unit sets `HOSTNAME=0.0.0.0`, `PORT=3000`, `LH_DATA_DIR=/var/lib/learnharness`, and `LH_AUTH_FILE=/var/lib/learnharness/auth.json`. Logs: `journalctl -u learnharness -f`.

### Docker

```bash
export LH_PASSWORD='choose-a-long-password'
docker compose up -d --build
```

Compose publishes port `${PORT:-3000}` and stores data in the `lh-data` volume. Optional environment variables, same names as above: `LH_SESSION_SECRET`, `LH_COOKIE_SECURE`, `LH_SESSION_DAYS`.

PDF and SVG rendering work in the image. Interactive demos need a Chromium binary on the host or in the image and `CHROME_PATH` pointing at it; the default image does not download a browser.

The desktop Electron app is unchanged: it does not set `LH_PASSWORD` or `LH_HEADLESS`, and it still binds `127.0.0.1`.

## License

[AGPL-3.0](LICENSE)

The app is free and open forever. If we ever charge for anything, it will be for convenience — managed keys, hosting — never for features you can run locally.
