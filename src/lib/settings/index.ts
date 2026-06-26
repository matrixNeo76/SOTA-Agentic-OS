/**
 * Settings module — public API (C6).
 *
 * Import from '@/lib/settings' — never reach into store.ts directly so we
 * can refactor the cache implementation without touching call sites.
 */

export {
  SETTING_DEFS,
  getSetting,
  getAllSettings,
  setSetting,
  deleteSetting,
  reloadCache,
  getCachedSetting,
  getCachedBool,
  getCachedNumber,
  getCachedArray,
  isCacheLoaded,
  __resetCacheForTests,
} from './store'

export type {
  SettingSource,
  SettingDef,
  SettingValue,
  SetResult,
} from './store'
