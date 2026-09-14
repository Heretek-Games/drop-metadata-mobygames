import type {
  MetadataDetails,
  MetadataProvider,
  MetadataSearchResult,
  PluginContext,
  ServerPlugin,
} from "@droposs/plugin-sdk";

export type HttpFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

const API_BASE = "https://api.mobygames.com/v1";
const API_KEY_ENV = "MOBYGAMES_API_KEY";
const CONFIG_KEY = "config";
const SEARCH_LIMIT = 20;

export interface MobyGamesConfig {
  apiKey?: string;
}

interface MobyGamesGenre {
  genre_id?: number;
  genre_name?: string;
}

export interface MobyGamesPlatformRelease {
  platform_id?: number;
  platform_name?: string;
  first_release_date?: string | null;
}

export interface MobyGamesCompany {
  company_id?: number;
  company_name?: string;
  role?: string;
}

export interface MobyGamesGame {
  game_id?: number;
  title?: string;
  description?: string;
  moby_url?: string;
  official_url?: string | null;
  moby_score?: number;
  genres?: MobyGamesGenre[];
  platforms?: MobyGamesPlatformRelease[];
  sample_cover?: { image?: string } | null;
  sample_screenshots?: Array<{ image?: string; caption?: string }>;
}

export interface MobyGamesPlatformDetail {
  releases?: Array<{ companies?: MobyGamesCompany[] }>;
}

function parseYear(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const match = /\d{4}/.exec(value);
  return match ? Number.parseInt(match[0], 10) : undefined;
}

function releaseYear(game: MobyGamesGame): number | undefined {
  const years = (game.platforms ?? [])
    .map((platform) => parseYear(platform.first_release_date))
    .filter((year): year is number => year !== undefined);
  return years.length > 0 ? Math.min(...years) : undefined;
}

function toSearchResult(game: MobyGamesGame): MetadataSearchResult | null {
  if (game?.game_id === undefined || !game.title) return null;
  return {
    id: String(game.game_id),
    title: game.title,
    releaseYear: releaseYear(game),
    coverUrl: game.sample_cover?.image,
    description: game.description,
    provider: "mobygames",
  };
}

export function mapSearchResults(payload: unknown): MetadataSearchResult[] {
  const games = (payload as { games?: MobyGamesGame[] } | undefined)?.games;
  if (!Array.isArray(games)) return [];
  return games
    .map((game) => toSearchResult(game))
    .filter((result): result is MetadataSearchResult => result !== null);
}

function collectCompanies(
  platform: MobyGamesPlatformDetail | undefined,
  predicate: (role: string) => boolean,
): string[] | undefined {
  const names = new Set<string>();
  for (const release of platform?.releases ?? []) {
    for (const company of release.companies ?? []) {
      if (company.company_name && company.role && predicate(company.role)) {
        names.add(company.company_name);
      }
    }
  }
  return names.size > 0 ? Array.from(names) : undefined;
}

export function mapGameDetails(
  payload: unknown,
  platform?: MobyGamesPlatformDetail,
): MetadataDetails | null {
  const game = payload as MobyGamesGame | undefined;
  if (!game?.game_id || !game.title) return null;

  return {
    id: String(game.game_id),
    title: game.title,
    releaseYear: releaseYear(game),
    coverUrl: game.sample_cover?.image,
    description: game.description,
    genres: (game.genres ?? [])
      .map((genre) => genre.genre_name)
      .filter((name): name is string => Boolean(name)),
    developers: collectCompanies(platform, (role) => /develop/i.test(role)),
    publishers: collectCompanies(platform, (role) => /publish/i.test(role)),
    screenshots: (game.sample_screenshots ?? [])
      .map((screenshot) => screenshot.image)
      .filter((url): url is string => Boolean(url)),
    provider: "mobygames",
    metadata: {
      platforms: (game.platforms ?? [])
        .map((entry) => entry.platform_name)
        .filter((name): name is string => Boolean(name)),
      mobyUrl: game.moby_url,
      officialUrl: game.official_url ?? undefined,
      score: game.moby_score,
    },
  };
}

export function resolveApiKey(
  config: MobyGamesConfig | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const stored = config?.apiKey?.trim();
  if (stored) return stored;
  const fromEnv = env[API_KEY_ENV]?.trim();
  return fromEnv || undefined;
}

export class MobyGamesProvider implements MetadataProvider {
  id = "mobygames";
  name = "MobyGames";

  constructor(
    private readonly apiKey: string | undefined,
    private readonly fetchFn: HttpFetch,
  ) {}

  async search(query: string): Promise<MetadataSearchResult[]> {
    if (!this.apiKey) throw new Error("MobyGames API key is not configured");
    const url = new URL(`${API_BASE}/games`);
    url.searchParams.set("title", query);
    url.searchParams.set("format", "normal");
    url.searchParams.set("limit", String(SEARCH_LIMIT));
    url.searchParams.set("api_key", this.apiKey);
    const payload = await this.request(url);
    return mapSearchResults(payload);
  }

  async getDetails(id: string): Promise<MetadataDetails | null> {
    if (!this.apiKey) throw new Error("MobyGames API key is not configured");
    const game = (await this.request(this.gameUrl(id))) as MobyGamesGame | undefined;
    if (!game?.game_id) return null;

    const platformId = game.platforms?.[0]?.platform_id;
    let platform: MobyGamesPlatformDetail | undefined;
    if (platformId !== undefined) {
      try {
        platform = (await this.request(this.platformUrl(game.game_id, platformId))) as
          | MobyGamesPlatformDetail
          | undefined;
      } catch {
        platform = undefined;
      }
    }

    return mapGameDetails(game, platform);
  }

  private gameUrl(id: string): URL {
    const url = new URL(`${API_BASE}/games/${encodeURIComponent(id)}`);
    url.searchParams.set("format", "normal");
    url.searchParams.set("api_key", this.apiKey ?? "");
    return url;
  }

  private platformUrl(gameId: number, platformId: number): URL {
    const url = new URL(`${API_BASE}/games/${gameId}/platforms/${platformId}`);
    url.searchParams.set("api_key", this.apiKey ?? "");
    return url;
  }

  private async request(url: URL): Promise<unknown> {
    const response = await this.fetchFn(url.toString(), {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`MobyGames request failed with status ${response.status}`);
    }
    return response.json();
  }
}

export default class MobyGamesPlugin implements ServerPlugin {
  metadata = {
    id: "drop-metadata-mobygames",
    name: "MobyGames",
    version: "0.1.0",
    apiVersion: 2,
    capabilities: ["metadata:provider" as const, "network" as const],
  };

  async init(ctx: PluginContext): Promise<void> {
    const config = await ctx.storage.get<MobyGamesConfig>(CONFIG_KEY);
    const apiKey = resolveApiKey(config);
    ctx.registerMetadataProvider(new MobyGamesProvider(apiKey, ctx.fetch.bind(ctx)));
    ctx.logger.info(
      `MobyGames metadata provider registered (API key ${apiKey ? "configured" : "not configured"})`,
    );
  }
}
