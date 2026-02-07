/**
 * Eager Auth Resolution
 * 
 * Pre-resolves authentication before tasks are enqueued to avoid
 * blocking the queue with auth resolution work.
 * 
 * Features:
 * - LRU cache with TTL for resolved auth
 * - Background refresh before expiry
 * - Parallel resolution for multiple providers
 */

import { createSubsystemLogger } from "../logging/subsystem.js";
import type { OpenClawConfig } from "../config/config.js";
import {
  ensureAuthProfileStore,
  resolveAuthProfileOrder,
  isProfileInCooldown,
  type AuthProfileStore,
} from "./auth-profiles.js";
import { resolveApiKeyForProvider, type ResolvedProviderAuth } from "./model-auth.js";
import { normalizeProviderId } from "./model-selection.js";

const log = createSubsystemLogger("auth-preload");

// Cache entry with TTL
type CacheEntry = {
  auth: ResolvedProviderAuth;
  provider: string;
  profileId?: string;
  resolvedAt: number;
  expiresAt: number;
};

// Cache configuration
const AUTH_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const AUTH_CACHE_REFRESH_AHEAD_MS = 60 * 1000; // Refresh 1 minute before expiry
const AUTH_CACHE_MAX_SIZE = 50;

// LRU cache
const authCache = new Map<string, CacheEntry>();
const cacheAccessOrder: string[] = [];

// Background refresh tracking
const refreshInProgress = new Set<string>();

function buildCacheKey(provider: string, profileId?: string): string {
  const normalizedProvider = normalizeProviderId(provider);
  return profileId ? `${normalizedProvider}:${profileId}` : normalizedProvider;
}

function evictOldest() {
  while (authCache.size >= AUTH_CACHE_MAX_SIZE && cacheAccessOrder.length > 0) {
    const oldest = cacheAccessOrder.shift();
    if (oldest) {
      authCache.delete(oldest);
      log.debug(`evicted auth cache entry: ${oldest}`);
    }
  }
}

function touchCacheEntry(key: string) {
  const idx = cacheAccessOrder.indexOf(key);
  if (idx > -1) {
    cacheAccessOrder.splice(idx, 1);
  }
  cacheAccessOrder.push(key);
}

function setCacheEntry(key: string, entry: CacheEntry) {
  evictOldest();
  authCache.set(key, entry);
  touchCacheEntry(key);
}

function getCacheEntry(key: string): CacheEntry | undefined {
  const entry = authCache.get(key);
  if (entry) {
    touchCacheEntry(key);
  }
  return entry;
}

/**
 * Get cached auth if valid and not expired.
 */
function getCachedAuth(provider: string, profileId?: string): ResolvedProviderAuth | undefined {
  const key = buildCacheKey(provider, profileId);
  const entry = getCacheEntry(key);
  
  if (!entry) {
    return undefined;
  }
  
  const now = Date.now();
  
  // Expired
  if (now >= entry.expiresAt) {
    authCache.delete(key);
    return undefined;
  }
  
  // Schedule background refresh if approaching expiry
  if (now >= entry.expiresAt - AUTH_CACHE_REFRESH_AHEAD_MS) {
    scheduleBackgroundRefresh(provider, profileId);
  }
  
  return entry.auth;
}

/**
 * Schedule a background refresh for auth that's about to expire.
 */
function scheduleBackgroundRefresh(
  provider: string,
  profileId?: string,
  cfg?: OpenClawConfig,
  agentDir?: string,
) {
  const key = buildCacheKey(provider, profileId);
  
  if (refreshInProgress.has(key)) {
    return; // Already refreshing
  }
  
  refreshInProgress.add(key);
  
  // Refresh in background (don't await)
  void (async () => {
    try {
      await preloadAuth({ provider, profileId, cfg, agentDir, force: true });
      log.debug(`background refresh completed: ${key}`);
    } catch (err) {
      log.debug(`background refresh failed: ${key} error=${err}`);
    } finally {
      refreshInProgress.delete(key);
    }
  })();
}

export type PreloadAuthParams = {
  provider: string;
  profileId?: string;
  cfg?: OpenClawConfig;
  agentDir?: string;
  /** Force refresh even if cached */
  force?: boolean;
};

/**
 * Pre-resolve auth for a provider/profile.
 * Returns cached result if available, otherwise resolves and caches.
 */
export async function preloadAuth(params: PreloadAuthParams): Promise<ResolvedProviderAuth> {
  const { provider, profileId, cfg, agentDir, force } = params;
  const key = buildCacheKey(provider, profileId);
  
  // Check cache first (unless forcing refresh)
  if (!force) {
    const cached = getCachedAuth(provider, profileId);
    if (cached) {
      log.debug(`auth cache hit: ${key}`);
      return cached;
    }
  }
  
  log.debug(`auth cache miss: ${key} (resolving)`);
  
  // Resolve auth
  const auth = await resolveApiKeyForProvider({
    provider,
    cfg,
    profileId,
    agentDir,
  });
  
  // Cache the result
  const now = Date.now();
  setCacheEntry(key, {
    auth,
    provider,
    profileId,
    resolvedAt: now,
    expiresAt: now + AUTH_CACHE_TTL_MS,
  });
  
  log.debug(`auth cached: ${key} source=${auth.source}`);
  
  return auth;
}

/**
 * Pre-resolve auth for multiple providers in parallel.
 */
export async function preloadAuthBatch(
  providers: Array<{ provider: string; profileId?: string }>,
  cfg?: OpenClawConfig,
  agentDir?: string,
): Promise<Map<string, ResolvedProviderAuth>> {
  const results = new Map<string, ResolvedProviderAuth>();
  
  await Promise.all(
    providers.map(async ({ provider, profileId }) => {
      try {
        const auth = await preloadAuth({ provider, profileId, cfg, agentDir });
        results.set(buildCacheKey(provider, profileId), auth);
      } catch {
        // Skip failed resolutions
      }
    })
  );
  
  return results;
}

/**
 * Pre-resolve auth for all configured providers.
 * Call this at gateway startup for warm cache.
 */
export async function warmAuthCache(cfg: OpenClawConfig, agentDir?: string): Promise<void> {
  const providers = cfg.models?.providers ?? {};
  const providerList = Object.keys(providers).map((p) => ({ provider: p }));
  
  if (providerList.length === 0) {
    return;
  }
  
  log.info(`warming auth cache for ${providerList.length} providers`);
  const start = Date.now();
  
  await preloadAuthBatch(providerList, cfg, agentDir);
  
  log.info(`auth cache warmed in ${Date.now() - start}ms`);
}

/**
 * Find the best available auth profile for a provider.
 * Skips profiles in cooldown.
 */
export async function findAvailableAuth(params: {
  provider: string;
  cfg?: OpenClawConfig;
  agentDir?: string;
  preferredProfile?: string;
}): Promise<ResolvedProviderAuth | null> {
  const { provider, cfg, agentDir, preferredProfile } = params;
  const store = ensureAuthProfileStore(agentDir, { allowKeychainPrompt: false });
  
  const order = resolveAuthProfileOrder({
    cfg,
    store,
    provider,
    preferredProfile,
  });
  
  // Try each profile in order, skipping those in cooldown
  for (const profileId of order) {
    if (isProfileInCooldown(store, profileId)) {
      log.debug(`skipping profile in cooldown: ${profileId}`);
      continue;
    }
    
    try {
      const auth = await preloadAuth({ provider, profileId, cfg, agentDir });
      return auth;
    } catch {
      // Try next profile
    }
  }
  
  // Try without specific profile
  try {
    return await preloadAuth({ provider, cfg, agentDir });
  } catch {
    return null;
  }
}

/**
 * Invalidate cached auth for a provider/profile.
 * Call this when auth fails (e.g., 401 response).
 */
export function invalidateAuth(provider: string, profileId?: string): void {
  const key = buildCacheKey(provider, profileId);
  const deleted = authCache.delete(key);
  if (deleted) {
    log.debug(`invalidated auth cache: ${key}`);
  }
}

/**
 * Clear all cached auth.
 */
export function clearAuthCache(): void {
  authCache.clear();
  cacheAccessOrder.length = 0;
  refreshInProgress.clear();
  log.debug("auth cache cleared");
}

/**
 * Get cache statistics for monitoring.
 */
export function getAuthCacheStats(): {
  size: number;
  maxSize: number;
  refreshing: number;
} {
  return {
    size: authCache.size,
    maxSize: AUTH_CACHE_MAX_SIZE,
    refreshing: refreshInProgress.size,
  };
}
