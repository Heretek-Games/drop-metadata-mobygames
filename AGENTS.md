# AGENTS.md — drop-metadata-mobygames

MobyGames metadata provider plugin for Drop (#208).

## Toolchain

- Node >= 22, npm 10+
- `npm ci`, `npm run build`, `npm test`, `npm run typecheck`

## Contract

Built on [`@droposs/plugin-sdk`](https://github.com/Heretek-Games/drop-plugin-sdk)
(plugin API v2). The SDK is consumed from the public npm registry
(`@droposs/plugin-sdk@^0.4.0`), so fresh clones and CI installs need no sibling
checkout.

## Configuration

The MobyGames API key is read from plugin storage (`ctx.storage`, key `config`,
field `apiKey`) and falls back to the `MOBYGAMES_API_KEY` environment variable.
The upstream v1 API requires the key as the `api_key` query parameter; keys are
never logged.

## Upstream API

- `GET https://api.mobygames.com/v1/games?title={query}&format=normal`
- `GET https://api.mobygames.com/v1/games/{gameId}`
- `GET https://api.mobygames.com/v1/games/{gameId}/platforms/{platformId}` for
  release credits used to derive developers/publishers
