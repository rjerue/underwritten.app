# Vite+ Monorepo Starter

A starter for creating a Vite+ monorepo.

## MCP

This repo now includes a local MCP bridge for `underwritten.app`.

- Package: `apps/mcp`
- Shared protocol types: `apps/mcp/src/contract.ts`
- Architecture and setup: [`apps/mcp/README.md`](./apps/mcp/README.md)

## Development

- Check everything is ready:

```bash
vp run ready
```

- Run the workspace tests:

```bash
vp run test -r
```

- Install the Playwright browser for the website e2e suite:

```bash
vp run website#test:e2e:install
```

- Run the website integration tests:

```bash
vp run test:e2e
```

- Run the website integration tests in headed mode:

```bash
vp run test:e2e:headed
```

- Run the website integration tests with the Playwright UI:

```bash
vp run test:e2e:ui
```

- Build the monorepo:

```bash
vp run build -r
```

- Run the development server:

```bash
vp run dev
```
