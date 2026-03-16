# Underwritten

Underwritten is a browser-first markdown editor with a companion MCP bridge. The web app owns the editor and workspace state. The published `underwritten-mcp` package lets external MCP clients connect to that live browser session through a local bridge process.

## Apps

- `apps/website`: the Underwritten web app and PWA
- `apps/mcp`: the published `underwritten-mcp` package

The MCP package is documented in [`apps/mcp/README.md`](./apps/mcp/README.md).

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
