import {
  listEvidencePool,
  listRows,
  resetEvidencePool,
  resetRows,
  saveEvidencePool,
  saveRows,
} from '@/data/local-store'
import {
  FIELD_SOURCES,
  REVIEW_BOUNDARY_DETECT,
  REVIEW_BOUNDARY_RULE,
  REVIEW_MODULE_KEY,
  registeredRequestCodes,
  reviewSources,
  mergeReviewHits,
  orderReviewRows,
  findReviewRowBySource,
} from '@/api/review-merge'
import type {
  EntryRow,
  ReviewHitInput,
  ReviewSource,
  ReviewSubmitResult,
} from '@/data/types'

const FIELD_OBJECT = '异常对象'
const FIELD_BOUNDARY = '仲裁边界'

export { reviewSources, FIELD_SOURCES, REVIEW_MODULE_KEY }

function reviewRows(): EntryRow[] {
  return listRows(REVIEW_MODULE_KEY)
}

function persistReviewRows(rows: EntryRow[]): void {
  saveRows(REVIEW_MODULE_KEY, rows)
}

/** 异常复核清单：从新生成的异常标签待复核清单取数，默认按规则生效时间排列。 */
export function listReviewRows(boundary: 'rule_time' | 'detect_time' = 'rule_time'): EntryRow[] {
  return orderReviewRows(reviewRows(), boundary)
}

/** 异常检测侧的异常来源清单：同一份清单，按异常检测时间排列。 */
export function listAnomalySourceRows(): EntryRow[] {
  return orderReviewRows(reviewRows(), 'detect_time')
}

export function boundaryLabel(boundary: 'rule_time' | 'detect_time'): string {
  return boundary === 'rule_time' ? REVIEW_BOUNDARY_RULE : REVIEW_BOUNDARY_DETECT
}

/** 检测详情读取同一命中结果：按来源编号联查复核清单里的那一条。 */
export function findHitBySource(
  sourceType: ReviewSource['sourceType'],
  sourceCode: string,
): EntryRow | undefined {
  return findReviewRowBySource(reviewRows(), sourceType, sourceCode)
}

/**
 * 单条命中请求提交（两个业务面在标签异常联动入口共用）。
 * - 请求编号已登记：重复提交，整单拒绝，不写入清单；
 * - 同一异常对象已有同端来源：归属冲突，不另立项，证据并入既有项并带冲突说明；
 * - 同一异常对象只有对端来源：双端归并成同一条，两个来源都保留；
 * - 新异常对象：新建一份待复核项。
 */
export function submitReviewHit(input: ReviewHitInput): ReviewSubmitResult {
  const rows = reviewRows()
  const seen = registeredRequestCodes(rows)
  if (seen.has(input.requestCode)) {
    return {
      ok: false,
      message: `请求 ${input.requestCode} 已登记过同一命中，按重复提交拒绝，复核清单不重复写入`,
      anomalyObject: input.anomalyObject,
      conflicted: false,
      duplicated: true,
    }
  }
  const existing = rows.find((row) => String(row[FIELD_OBJECT]) === input.anomalyObject)
  let conflicted = false
  if (existing) {
    const sameSide = reviewSources(existing).some((source) => source.sourceType === input.sourceType)
    conflicted = sameSide
  }
  const report = mergeReviewHits([input], rows)
  persistReviewRows(report.rows)
  // 原始请求同样只入池一次：重复请求在上面已被拒绝，不会走到这里。
  const pool = listEvidencePool()
  if (!pool.some((item) => item.requestCode === input.requestCode)) {
    saveEvidencePool([...pool, input])
  }
  if (conflicted) {
    return {
      ok: true,
      message: `异常对象 ${input.anomalyObject} 已存在同端待复核项，本请求按归属冲突处理：不另立项，检测证据已并入并保留`,
      anomalyObject: input.anomalyObject,
      conflicted: true,
      duplicated: false,
    }
  }
  return {
    ok: true,
    message: existing
      ? `命中已并入异常对象 ${input.anomalyObject} 的既有待复核项，双端来源合并保留`
      : `已为异常对象 ${input.anomalyObject} 生成待复核项`,
    anomalyObject: input.anomalyObject,
    conflicted: false,
    duplicated: false,
  }
}

/**
 * 把整个原始命中请求池归并生成一份新的异常标签待复核清单。
 * 幂等：清单已覆盖的请求会被重复拒绝；清单已是最新时不产生重复行，仍只有一份清单。
 */
export function generateReviewList(): {
  ok: boolean
  message: string
  created: number
  merged: number
  conflicted: number
  duplicated: number
} {
  const report = mergeReviewHits(listEvidencePool(), reviewRows())
  persistReviewRows(report.rows)
  return {
    ok: true,
    message: report.message,
    created: report.created,
    merged: report.merged,
    conflicted: report.conflicted,
    duplicated: report.duplicated,
  }
}

export function resetReviewWorkspace(): EntryRow[] {
  resetEvidencePool()
  return resetRows(REVIEW_MODULE_KEY)
}

export function reviewStats(): { label: string; value: number }[] {
  const rows = reviewRows()
  return [
    { label: '复核清单总数', value: rows.length },
    { label: '待复核项', value: rows.filter((row) => row.pending).length },
    {
      label: '归属冲突项',
      value: rows.filter((row) => reviewSources(row).some((source) => source.conflicted)).length,
    },
  ]
}

export { FIELD_OBJECT, FIELD_BOUNDARY }
