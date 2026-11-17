import { SEED_REVIEW_EVIDENCE_POOL, SEED_ROWS } from './seed'
import type { EntryRow, ReviewHitInput } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'behavior-event-trace-hub:entries'
// 标签异常联动入口共用的原始命中请求池：两个业务面的命中都先入池，再归并进复核清单。
const EVIDENCE_KEY = 'behavior-event-trace-hub:review-evidence'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    // 兼容老存档：新版本新增的模块（如异常复核清单）在旧 localStorage 里不存在，
    // 用示例数据补齐，而不是让新页面打开是空表。
    for (const key of Object.keys(fallback)) {
      if (!parsed[key]) {
        parsed[key] = fallback[key]
      }
    }
    return parsed
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  if (key === 'review') {
    resetEvidencePool()
  }
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}

function readEvidencePool(): ReviewHitInput[] {
  const fallback = clone(SEED_REVIEW_EVIDENCE_POOL)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(EVIDENCE_KEY)
  if (!raw) {
    window.localStorage.setItem(EVIDENCE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    return JSON.parse(raw) as ReviewHitInput[]
  } catch {
    window.localStorage.setItem(EVIDENCE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let evidenceCache: ReviewHitInput[] | null = null

export function listEvidencePool(): ReviewHitInput[] {
  if (evidenceCache === null) {
    evidenceCache = readEvidencePool()
  }
  return evidenceCache
}

export function saveEvidencePool(items: ReviewHitInput[]): void {
  evidenceCache = items
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(EVIDENCE_KEY, JSON.stringify(items))
  }
}

export function resetEvidencePool(): ReviewHitInput[] {
  const items = clone(SEED_REVIEW_EVIDENCE_POOL)
  saveEvidencePool(items)
  return items
}

export function evidenceStorageKey(): string {
  return EVIDENCE_KEY
}
