/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

/** 一份命中来源证据：标签规则命中 或 检测器结果，同一异常对象可挂多份。 */
export type ReviewSource = {
  /** 来源类型：标签规则命中 / 检测器结果。 */
  sourceType: 'tag_rule' | 'detector'
  /** 来源编号：行动标签规则编号（ACTI-xxxx）或检测器编号（ANOM-xxxx）。 */
  sourceCode: string
  /** 来源名称，便于页面直接展示。 */
  sourceName: string
  /** 提交这一命中的请求编号，重复提交按它判定。 */
  requestCode: string
  /** 规则生效时间（标签规则来源用）。 */
  ruleEffectiveTime: string
  /** 异常检测时间（检测器来源用）。 */
  detectedTime: string
  /** 归属是否被并入了既有待复核项（归属冲突时为 true，证据仍保留）。 */
  conflicted: boolean
  /** 冲突或拒绝说明，无冲突为空串。 */
  note: string
}

/** 待归并复核的原始命中请求，由两个业务面（行动标签 / 异常检测）共用的跨模块数据流写入。 */
export type ReviewHitInput = {
  requestCode: string
  anomalyObject: string
  anomalyBehavior: string
  sourceType: 'tag_rule' | 'detector'
  sourceCode: string
  sourceName: string
  ruleEffectiveTime: string
  detectedTime: string
  evidence: string
}

/** 一次归并提交的处理结果。 */
export type ReviewSubmitResult = {
  ok: boolean
  message: string
  /** 本次请求落在的异常对象（被拒绝时也给出，方便联查）。 */
  anomalyObject: string
  /** 归属冲突：同一异常对象已有同端来源，本请求并入既有项并保留证据。 */
  conflicted: boolean
  /** 重复提交：请求编号已登记，整单拒绝、不写入清单。 */
  duplicated: boolean
}

/** 归并生成的整份复核清单与处理报告。 */
export type ReviewMergeReport = {
  rows: EntryRow[]
  created: number
  merged: number
  conflicted: number
  duplicated: number
  rejectedRequests: string[]
  conflictRequests: string[]
  message: string
}

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean | ReviewSource[]
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
