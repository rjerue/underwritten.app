# Underwritten

Underwritten is a browser-first markdown editor with a companion MCP bridge. The web app owns the editor and workspace state. The published `underwritten-mcp` package lets external MCP clients connect to that live browser session through a local bridge process.

## Apps

- `apps/website`: the Underwritten web app and PWA
- `apps/cli`: the `underwritten` CLI for agent and terminal use
- `apps/mcp`: the published `underwritten-mcp` package

## Packages

- `packages/underwritten-bridge`: shared localhost bridge runtime
- `packages/underwritten-bridge-contract`: shared bridge protocol types and helpers

## Releasing

Releases are currently handled manually by updating the version numbers in `package.json` files and pushing to `main`. CI will automatically detect new versions and publish them to npm via OIDC.

To publish manually from your local machine (requires npm login):

```bash
vp run publish-packages
```

## Development

Install dependencies:

```bash
vp install
```

Run the website:

```bash
vp run website#dev
```

Run the MCP bridge from source in another terminal:

```bash
vp dlx tsx apps/mcp/src/cli.ts
```

## Validation

Run formatting, linting, and type checks:

```bash
vp check
```

Run unit tests:

```bash
vp test
```

Run end-to-end tests:

```bash
vp run test:e2e
```

Install Playwright browsers when needed:

```bash
vp run website#test:e2e:install
```

Build the monorepo:

```bash
vp run build -r
```

## License

MIT
