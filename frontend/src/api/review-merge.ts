import type { EntryRow, ReviewHitInput, ReviewMergeReport, ReviewSource } from '@/data/types'

// 异常复核领域的固定值：模块键、初始状态、对外唯一结论都集中在这里，页面和服务层共用。
export const REVIEW_MODULE_KEY = 'review'
export const REVIEW_STATUS_PENDING = '待复核'
export const REVIEW_STATUS_CONFIRMED = '已确认异常'
export const REVIEW_STATUS_FALSE = '误报关闭'
export const REVIEW_STATUS_ARCHIVED = '已归档'
export const REVIEW_CONCLUSION_PENDING = '待人工复核'
export const REVIEW_BOUNDARY_RULE = '规则生效时间'
export const REVIEW_BOUNDARY_DETECT = '异常检测时间'

export type ArbitrationBoundary = 'rule_time' | 'detect_time'

const FIELD_OBJECT = '异常对象'
const FIELD_BEHAVIOR = '异常行为'
const FIELD_REVIEW_CODE = '复核编号'
const FIELD_RULE_CODE = '标签规则编号'
const FIELD_DETECTOR_CODE = '检测器编号'
const FIELD_RULE_TIME = '规则生效时间'
const FIELD_DETECT_TIME = '异常检测时间'
const FIELD_BOUNDARY = '仲裁边界'
const FIELD_CONCLUSION = '待复核结论'
const FIELD_CONFLICT = '归属冲突标记'
const FIELD_EVIDENCE = '证据保留'
export const FIELD_SOURCES = '命中来源'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function sourceLabel(sourceType: ReviewSource['sourceType']): string {
  return sourceType === 'tag_rule' ? '标签规则命中' : '检测器结果'
}

/** 收集清单里已经登记过的请求编号：同一请求第二次提交直接拒绝。 */
export function registeredRequestCodes(rows: EntryRow[]): Set<string> {
  const seen = new Set<string>()
  for (const row of rows) {
    const sources = row[FIELD_SOURCES]
    if (Array.isArray(sources)) {
      for (const source of sources as ReviewSource[]) {
        seen.add(source.requestCode)
      }
    }
  }
  return seen
}

function sourcesOf(row: EntryRow): ReviewSource[] {
  const sources = row[FIELD_SOURCES]
  return Array.isArray(sources) ? (sources as ReviewSource[]) : []
}

function refreshRow(row: EntryRow): void {
  const sources = sourcesOf(row)
  const tagSources = sources.filter((item) => item.sourceType === 'tag_rule')
  const detectorSources = sources.filter((item) => item.sourceType === 'detector')
  row[FIELD_RULE_CODE] = tagSources.length ? tagSources.map((item) => item.sourceCode).join('、') : '—'
  row[FIELD_DETECTOR_CODE] = detectorSources.length ? detectorSources.map((item) => item.sourceCode).join('、') : '—'
  const ruleTimes = tagSources.map((item) => item.ruleEffectiveTime).filter(Boolean).sort()
  const detectTimes = detectorSources.map((item) => item.detectedTime).filter(Boolean).sort()
  row[FIELD_RULE_TIME] = ruleTimes.length ? ruleTimes[0] : '—'
  row[FIELD_DETECT_TIME] = detectTimes.length ? detectTimes[0] : '—'
  row[FIELD_CONFLICT] = sources.some((item) => item.conflicted) ? '是' : '否'
  row[FIELD_EVIDENCE] = sources
    .map((item) => `${sourceLabel(item.sourceType)}:${item.sourceCode}/${item.requestCode}`)
    .join('；')
  // 共同边界：每个异常对象在清单里只公开一个待复核结论，不因来源叠加而分裂。
  row[FIELD_CONCLUSION] = REVIEW_CONCLUSION_PENDING
}

function buildRow(id: number, reviewCode: string, input: ReviewHitInput, source: ReviewSource): EntryRow {
  const row: EntryRow = {
    id,
    status: REVIEW_STATUS_PENDING,
    pending: true,
    abnormal: true,
    [FIELD_REVIEW_CODE]: reviewCode,
    [FIELD_OBJECT]: input.anomalyObject,
    [FIELD_BEHAVIOR]: input.anomalyBehavior,
    [FIELD_RULE_CODE]: '—',
    [FIELD_DETECTOR_CODE]: '—',
    [FIELD_RULE_TIME]: '—',
    [FIELD_DETECT_TIME]: '—',
    [FIELD_BOUNDARY]: REVIEW_BOUNDARY_RULE,
    [FIELD_CONCLUSION]: REVIEW_CONCLUSION_PENDING,
    [FIELD_CONFLICT]: '否',
    [FIELD_EVIDENCE]: '',
    [FIELD_SOURCES]: [source],
  }
  refreshRow(row)
  return row
}

function nextReviewCode(rows: EntryRow[]): string {
  const maxId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0)
  return `AREV-${String(maxId + 1).padStart(4, '0')}`
}

/**
 * 把待处理的标签规则命中与检测器结果归并成异常标签待复核清单。
 * - 同一请求编号重复提交：整单拒绝，不写入清单。
 * - 同一异常对象：只保留一份待复核项；同端（同 sourceType）再来一单记归属冲突，证据并入保留；
 *   两端各来一单则归并为双来源的同一项。
 * 纯函数，不碰 localStorage，页面与脚本共用同一份归并规则。
 */
export function mergeReviewHits(inputs: ReviewHitInput[], existingRows: EntryRow[]): ReviewMergeReport {
  const rows = clone(existingRows)
  const rowsByObject = new Map<string, EntryRow>()
  for (const row of rows) {
    rowsByObject.set(String(row[FIELD_OBJECT]), row)
  }
  const seenRequests = registeredRequestCodes(rows)
  const rejectedRequests: string[] = []
  const conflictRequests: string[] = []
  let created = 0
  let merged = 0
  let conflicted = 0
  let duplicated = 0

  for (const input of inputs) {
    if (seenRequests.has(input.requestCode)) {
      duplicated += 1
      rejectedRequests.push(input.requestCode)
      continue
    }
    const source: ReviewSource = {
      sourceType: input.sourceType,
      sourceCode: input.sourceCode,
      sourceName: input.sourceName,
      requestCode: input.requestCode,
      ruleEffectiveTime: input.ruleEffectiveTime,
      detectedTime: input.detectedTime,
      conflicted: false,
      note: '',
    }
    const row = rowsByObject.get(input.anomalyObject)
    if (!row) {
      const reviewRow = buildRow(rows.length + 1, nextReviewCode(rows), input, source)
      rows.push(reviewRow)
      rowsByObject.set(input.anomalyObject, reviewRow)
      created += 1
    } else {
      const sameSide = sourcesOf(row).some((item) => item.sourceType === input.sourceType)
      if (sameSide) {
        source.conflicted = true
        source.note = `归属冲突：${sourceLabel(input.sourceType)}已归属该异常对象的待复核项，请求${input.requestCode}不另立项，检测证据并入保留`
        conflicted += 1
        conflictRequests.push(input.requestCode)
      } else {
        source.note = `双端归并：与既有${sourceLabel(input.sourceType === 'tag_rule' ? 'detector' : 'tag_rule')}来源合并为同一待复核项`
      }
      sourcesOf(row).push(source)
      refreshRow(row)
      merged += 1
    }
    seenRequests.add(input.requestCode)
  }

  const message =
    `归并完成：新建待复核项 ${created} 条，并入既有项 ${merged} 条，` +
    `归属冲突 ${conflicted} 条（证据保留），重复拒绝 ${duplicated} 条`
  return { rows, created, merged, conflicted, duplicated, rejectedRequests, conflictRequests, message }
}

/**
 * 版本冲突仲裁边界的两种排法，底层都是同一份清单（每个异常对象只有一条）：
 * - rule_time：按规则生效时间排列，供异常复核清单使用；
 * - detect_time：按异常检测时间排列，供异常检测侧的异常来源清单使用。
 */
export function orderReviewRows(rows: EntryRow[], boundary: ArbitrationBoundary): EntryRow[] {
  const field = boundary === 'rule_time' ? FIELD_RULE_TIME : FIELD_DETECT_TIME
  return [...rows].sort((a, b) => {
    const left = String(a[field] ?? '')
    const right = String(b[field] ?? '')
    if (left === right) {
      return String(a[FIELD_REVIEW_CODE] ?? '').localeCompare(String(b[FIELD_REVIEW_CODE] ?? ''))
    }
    if (left === '—' || left === '') return 1
    if (right === '—' || right === '') return -1
    return left.localeCompare(right)
  })
}

/** 两个业务面共用的联查入口：按来源类型 + 来源编号找同一份命中结果。 */
export function findReviewRowBySource(
  rows: EntryRow[],
  sourceType: ReviewSource['sourceType'],
  sourceCode: string,
): EntryRow | undefined {
  return rows.find((row) =>
    sourcesOf(row).some((source) => source.sourceType === sourceType && source.sourceCode === sourceCode),
  )
}

export function reviewSources(row: EntryRow): ReviewSource[] {
  return sourcesOf(row)
}
