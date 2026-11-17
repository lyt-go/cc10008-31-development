import { SEED_REVIEW_EVIDENCE_POOL, SEED_ROWS } from '@/data/seed'
import {
  FIELD_SOURCES,
  REVIEW_CONCLUSION_PENDING,
  findReviewRowBySource,
  mergeReviewHits,
  orderReviewRows,
  reviewSources,
} from '@/api/review-merge'
import {
  generateReviewList,
  listReviewRows,
  resetReviewWorkspace,
  submitReviewHit,
} from '@/api/review-service'

let failures = 0
function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`PASS  ${name}`)
  } else {
    failures += 1
    console.error(`FAIL  ${name} ${detail}`)
  }
}

// ---- A. 种子复核清单：ACTI-0003 与 ANOM-0003 核对同一命中，只有一条且保留两个来源 ----
const seedReview = SEED_ROWS.review
const sharedHit = seedReview.filter((row) =>
  reviewSources(row).some((s) => s.sourceCode === 'ACTI-0003') &&
  reviewSources(row).some((s) => s.sourceCode === 'ANOM-0003'),
)
check('ACTI-0003 与 ANOM-0003 只形成一条待复核项', sharedHit.length === 1, `实际 ${sharedHit.length} 条`)
check(
  '该条保留两个来源（标签规则 + 检测器）',
  sharedHit.length === 1 && reviewSources(sharedHit[0]).length === 2,
)
check(
  '两个来源请求编号均在证据中',
  sharedHit.length === 1 &&
    reviewSources(sharedHit[0]).map((s) => s.requestCode).sort().join(',') === 'REQ-D-0003,REQ-T-0003',
)
check('种子复核清单共 3 条', seedReview.length === 3, `实际 ${seedReview.length} 条`)
check(
  '每个异常对象只公开一个待复核结论',
  seedReview.every((row) => row['待复核结论'] === REVIEW_CONCLUSION_PENDING),
)

// ---- B. 从空清单归并整个证据池：去重、冲突、双端归并 ----
const report = mergeReviewHits(SEED_REVIEW_EVIDENCE_POOL, [])
check('归并新建 4 个异常对象的待复核项', report.created === 4, `实际 ${report.created}`)
check('并入 2 次（双端归并 1 + 同端冲突 1）', report.merged === 2, `实际 ${report.merged}`)
check('归属冲突 1 次且证据保留', report.conflicted === 1, `实际 ${report.conflicted}`)
check('重复提交请求被拒绝 1 次', report.duplicated === 1 && report.rejectedRequests[0] === 'REQ-T-0099')

const abo1 = report.rows.filter((r) => r['异常对象'] === 'ABO-0001')
check('ABO-0001 只有一份待复核项', abo1.length === 1)
check(
  'ABO-0001 同时挂 ACTI-0003 与 ANOM-0003 两个来源',
  abo1[0] && reviewSources(abo1[0]).map((s) => s.sourceCode).sort().join(',') === 'ACTI-0003,ANOM-0003',
)

const abo2 = report.rows.filter((r) => r['异常对象'] === 'ABO-0002')
const conflictSource = abo2[0] ? reviewSources(abo2[0]).find((s) => s.requestCode === 'REQ-T-0012') : undefined
check('同端第二条请求标记归属冲突', Boolean(conflictSource?.conflicted))
check('归属冲突带说明文字', Boolean(conflictSource?.note.includes('归属冲突')))
check('归属冲突请求的检测证据仍保留在同一项', abo2.length === 1 && reviewSources(abo2[0]).length === 2)

const allRequestCodes = report.rows.flatMap((r) => reviewSources(r).map((s) => s.requestCode))
check(
  '重复请求 REQ-T-0099 只写入一次',
  allRequestCodes.filter((code) => code === 'REQ-T-0099').length === 1,
)
check('归并后每个异常对象仍只有一个结论', report.rows.every((r) => r['待复核结论'] === REVIEW_CONCLUSION_PENDING))

// ---- C. 幂等：再次归并同一证据池，全部按重复拒绝，不产生新行 ----
const second = mergeReviewHits(SEED_REVIEW_EVIDENCE_POOL, report.rows)
check('二次归并不新建任何待复核项', second.created === 0)
check('二次归并 7 个请求全部重复拒绝', second.duplicated === 7, `实际 ${second.duplicated}`)
check('清单行数不变', second.rows.length === report.rows.length)

// ---- D. 仲裁边界两种排法：同一份清单，排列不同，结论唯一 ----
const byRule = orderReviewRows(seedReview, 'rule_time').map((r) => r['复核编号'])
const byDetect = orderReviewRows(seedReview, 'detect_time').map((r) => r['复核编号'])
check('按规则生效时间排列顺序正确', byRule.join(',') === 'AREV-0002,AREV-0001,AREV-0003', byRule.join(','))
check('按异常检测时间排列顺序正确', byDetect.join(',') === 'AREV-0001,AREV-0003,AREV-0002', byDetect.join(','))
check('两种排法底层是同一份清单（行数一致）', byRule.length === byDetect.length && byRule.length === 3)

// ---- E. 两端联查：按来源编号找到的是同一条命中 ----
const fromRule = findReviewRowBySource(seedReview, 'tag_rule', 'ACTI-0003')
const fromDetector = findReviewRowBySource(seedReview, 'detector', 'ANOM-0003')
check('两端联查命中同一条复核项', Boolean(fromRule && fromDetector && fromRule.id === fromDetector.id))
check('联查返回项保留联动来源字段', Boolean(fromRule && Array.isArray(fromRule[FIELD_SOURCES])))

// ---- F. 服务层（带 localStorage 桩）：单条提交的拒绝/冲突/入池 ----
const memory = new Map<string, string>()
;(globalThis as Record<string, unknown>).window = {
  localStorage: {
    getItem: (k: string) => (memory.has(k) ? memory.get(k)! : null),
    setItem: (k: string, v: string) => void memory.set(k, v),
    removeItem: (k: string) => void memory.delete(k),
  },
}
resetReviewWorkspace()
const before = listReviewRows().length
const first = submitReviewHit({
  requestCode: 'REQ-T-0099',
  anomalyObject: 'ABO-0004',
  anomalyBehavior: '优惠券批量领取的薅羊毛行为',
  sourceType: 'tag_rule',
  sourceCode: 'ACTI-0003',
  sourceName: '行动标签样例3',
  ruleEffectiveTime: '2026-10-18 09:00',
  detectedTime: '',
  evidence: '演示证据',
})
const secondSubmit = submitReviewHit({
  requestCode: 'REQ-T-0099',
  anomalyObject: 'ABO-0004',
  anomalyBehavior: '优惠券批量领取的薅羊毛行为',
  sourceType: 'tag_rule',
  sourceCode: 'ACTI-0003',
  sourceName: '行动标签样例3',
  ruleEffectiveTime: '2026-10-18 09:00',
  detectedTime: '',
  evidence: '演示证据（重复）',
})
check('首次提交成功并新增一条待复核项', first.ok && listReviewRows().length === before + 1)
check('重复提交被拒绝且不重复写入', !secondSubmit.ok && secondSubmit.duplicated)
check('拒绝后清单仍只有一条 ABO-0004', listReviewRows().filter((r) => r['异常对象'] === 'ABO-0004').length === 1)

const conflict = submitReviewHit({
  requestCode: 'REQ-T-777001',
  anomalyObject: 'ABO-0001',
  anomalyBehavior: '支付页短时连续重试触发的异常下单行为',
  sourceType: 'tag_rule',
  sourceCode: 'ACTI-0002',
  sourceName: '行动标签样例2',
  ruleEffectiveTime: '2026-10-16 10:00',
  detectedTime: '',
  evidence: '冲突演示证据',
})
const abo1After = listReviewRows().filter((r) => r['异常对象'] === 'ABO-0001')
check('同端再命中返回归属冲突说明', conflict.ok && conflict.conflicted)
check('归属冲突不另立项', abo1After.length === 1)
check('归属冲突证据并入保留', reviewSources(abo1After[0]).some((s) => s.requestCode === 'REQ-T-777001' && s.conflicted))

// ---- G. 重新归并生成清单幂等 ----
const beforeRegen = listReviewRows().length
const gen = generateReviewList()
check('重新归并不产生重复行（行数不变）', listReviewRows().length === beforeRegen)
check('归并报告包含重复拒绝统计', gen.duplicated >= 1)

console.log(failures === 0 ? '\n全部验收用例通过' : `\n${failures} 条用例失败`)
process.exit(failures === 0 ? 0 : 1)
