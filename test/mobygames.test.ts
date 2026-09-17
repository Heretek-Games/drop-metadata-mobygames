import test from "node:test";
import assert from "node:assert/strict";
import { MockPluginContext } from "@droposs/plugin-sdk";
import Plugin, {
  mapGameDetails,
  mapSearchResults,
  resolveApiKey,
  type MobyGamesConfig,
} from "../src/index.js";

const SEARCH_FIXTURE = {
  games: [
    {
      game_id: 1234,
      title: "Hollow Knight",
      description: "A challenging 2D action adventure.",
      moby_url: "https://www.mobygames.com/game/hollow-knight",
      official_url: null,
      moby_score: 4.3,
      genres: [
        { genre_id: 1, genre_name: "Action" },
        { genre_id: 2, genre_name: "Adventure" },
      ],
      platforms: [
        { platform_id: 3, platform_name: "Windows", first_release_date: "2017-02-24" },
      ],
      sample_cover: { image: "https://www.mobygames.com/images/covers/l/1-hollow-knight.jpg" },
      sample_screenshots: [
        { image: "https://www.mobygames.com/images/shots/l/1-hollow-knight.jpg", caption: "City" },
      ],
    },
  ],
};

const DETAIL_FIXTURE = {
  game_id: 1234,
  title: "Hollow Knight",
  description: "Forge your own path in Hollow Knight!",
  moby_url: "https://www.mobygames.com/game/hollow-knight",
  official_url: "https://hollowknight.com",
  moby_score: 4.3,
  genres: [
    { genre_id: 1, genre_name: "Action" },
    { genre_id: 2, genre_name: "Adventure" },
  ],
  platforms: [
    { platform_id: 3, platform_name: "Windows", first_release_date: "2017-02-24" },
    { platform_id: 211, platform_name: "Nintendo Switch", first_release_date: "2018-06-12" },
  ],
  sample_cover: { image: "https://www.mobygames.com/images/covers/l/1-hollow-knight.jpg" },
  sample_screenshots: [
    { image: "https://www.mobygames.com/images/shots/l/1-hollow-knight.jpg", caption: "City" },
    { image: "https://www.mobygames.com/images/shots/l/2-hollow-knight.jpg", caption: "Boss" },
  ],
};

const PLATFORM_FIXTURE = {
  game_id: 1234,
  platform_id: 3,
  platform_name: "Windows",
  releases: [
    {
      release_date: "2017-02-24",
      companies: [
        { company_id: 8547, company_name: "Team Cherry", role: "Developed by" },
        { company_id: 8547, company_name: "Team Cherry", role: "Published by" },
        { company_id: 9000, company_name: "Indie Fund", role: "Additional Funding" },
      ],
    },
  ],
};

interface FetchCall {
  url: string;
}

function createFetchStub(fixtures: Array<{ match: string; body: unknown; status?: number }>): {
  calls: FetchCall[];
  fetch: (input: string | URL, init?: RequestInit) => Promise<Response>;
} {
  const calls: FetchCall[] = [];
  const fetch = async (input: string | URL): Promise<Response> => {
    const url = String(input);
    calls.push({ url });
    const fixture = fixtures.find((entry) => url.includes(entry.match));
    if (!fixture) {
      return new Response("not found", { status: 404 });
    }
    return new Response(JSON.stringify(fixture.body), {
      status: fixture.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, fetch };
}

async function createProviderContext(
  fixtures: Array<{ match: string; body: unknown; status?: number }>,
  config?: MobyGamesConfig,
): Promise<{ ctx: MockPluginContext; calls: FetchCall[]; messages: string[] }> {
  const ctx = new MockPluginContext("drop-metadata-mobygames", ["metadata:provider", "storage", "network"]);
  const messages: string[] = [];
  ctx.logger = {
    info: (message: string) => messages.push(message),
    warn: () => {},
    error: () => {},
    debug: () => {},
  };
  const stub = createFetchStub(fixtures);
  (ctx as { fetch: typeof stub.fetch }).fetch = stub.fetch;
  if (config) {
    await ctx.storage.set("config", config);
  }
  await new Plugin().init(ctx);
  return { ctx, calls: stub.calls, messages };
}

test("drop-metadata-mobygames registers a metadata provider", async () => {
  const { ctx } = await createProviderContext([]);
  assert.equal(ctx.metadataProviders.size, 1);
  assert.equal(ctx.metadataProviders.get("mobygames")?.name, "MobyGames");
});

test("drop-metadata-mobygames resolves the API key from storage before env", () => {
  const env = { MOBYGAMES_API_KEY: "env-key" } as NodeJS.ProcessEnv;
  assert.equal(resolveApiKey({ apiKey: "stored-key" }, env), "stored-key");
  assert.equal(resolveApiKey({}, env), "env-key");
  assert.equal(resolveApiKey(null, {} as NodeJS.ProcessEnv), undefined);
});

test("drop-metadata-mobygames maps a /games payload", () => {
  const results = mapSearchResults(SEARCH_FIXTURE);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, "1234");
  assert.equal(results[0].title, "Hollow Knight");
  assert.equal(results[0].releaseYear, 2017);
  assert.equal(
    results[0].coverUrl,
    "https://www.mobygames.com/images/covers/l/1-hollow-knight.jpg",
  );
  assert.equal(results[0].description, "A challenging 2D action adventure.");
  assert.equal(results[0].provider, "mobygames");
});

test("drop-metadata-mobygames searches with the api_key query parameter", async () => {
  const { ctx, calls } = await createProviderContext(
    [{ match: "/games?", body: SEARCH_FIXTURE }],
    { apiKey: "stored-key" },
  );
  const results = await ctx.metadataProviders.get("mobygames")?.search("hollow knight");
  assert.equal(results?.length, 1);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, "/v1/games");
  assert.equal(url.searchParams.get("title"), "hollow knight");
  assert.equal(url.searchParams.get("format"), "normal");
  assert.equal(url.searchParams.get("limit"), "20");
  assert.equal(url.searchParams.get("api_key"), "stored-key");
});

test("drop-metadata-mobygames maps game details with platform companies", async () => {
  const { ctx, calls } = await createProviderContext(
    [
      { match: "/games/1234/platforms/3", body: PLATFORM_FIXTURE },
      { match: "/games/1234?", body: DETAIL_FIXTURE },
    ],
    { apiKey: "stored-key" },
  );
  const details = await ctx.metadataProviders.get("mobygames")?.getDetails("1234");
  assert.ok(details);
  assert.equal(details.title, "Hollow Knight");
  assert.equal(details.releaseYear, 2017);
  assert.equal(
    details.coverUrl,
    "https://www.mobygames.com/images/covers/l/1-hollow-knight.jpg",
  );
  assert.deepEqual(details.screenshots, [
    "https://www.mobygames.com/images/shots/l/1-hollow-knight.jpg",
    "https://www.mobygames.com/images/shots/l/2-hollow-knight.jpg",
  ]);
  assert.deepEqual(details.genres, ["Action", "Adventure"]);
  assert.deepEqual(details.developers, ["Team Cherry"]);
  assert.deepEqual(details.publishers, ["Team Cherry"]);
  assert.deepEqual(details.metadata?.platforms, ["Windows", "Nintendo Switch"]);
  assert.equal(details.metadata?.score, 4.3);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].url.includes("/games/1234/platforms/3"));
  assert.ok(calls[1].url.includes("api_key=stored-key"));
});

test("drop-metadata-mobygames keeps base details when platform credits fail", async () => {
  const { ctx } = await createProviderContext(
    [{ match: "/games/1234?", body: DETAIL_FIXTURE }],
    { apiKey: "stored-key" },
  );
  const details = await ctx.metadataProviders.get("mobygames")?.getDetails("1234");
  assert.ok(details);
  assert.equal(details.title, "Hollow Knight");
  assert.equal(details.developers, undefined);
  assert.equal(details.publishers, undefined);
});

test("drop-metadata-mobygames detail mapper returns null for empty payloads", () => {
  assert.equal(mapGameDetails(undefined), null);
  assert.equal(mapGameDetails({}), null);
});

test("drop-metadata-mobygames throws when no API key is configured", async () => {
  const { ctx } = await createProviderContext([]);
  await assert.rejects(
    () => ctx.metadataProviders.get("mobygames")?.search("hollow") ?? Promise.resolve([]),
    /MobyGames API key is not configured/,
  );
});

test("drop-metadata-mobygames never logs the API key", async () => {
  const { messages } = await createProviderContext([], { apiKey: "super-secret-key" });
  assert.deepEqual(messages, ["MobyGames metadata provider registered (API key configured)"]);
  assert.ok(messages.every((message) => !message.includes("super-secret-key")));
});
