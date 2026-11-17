<template>
  <section class="page" data-module="review">
    <header class="page-head">
      <div>
        <h2>异常复核清单</h2>
        <p class="page-desc">
          归并标签规则命中与检测器结果，生成异常标签待复核清单；每个异常对象只公开一个待复核结论，行动标签与异常检测两个业务面共用同一份命中结果。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="regenerate">重新归并生成清单</button>
        <button class="btn" type="button" @click="exportRows">导出复核清单</button>
        <button class="btn ghost" type="button" @click="resetWorkspace">恢复示例数据</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <div class="review-toolbar">
      <form class="filter-bar" @submit.prevent="reload">
        <label class="filter-item">
          <span>异常对象 / 复核编号 / 异常行为</span>
          <input v-model="keyword" placeholder="按关键字联查命中结果" />
        </label>
        <button class="btn" type="submit">查询</button>
        <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
      </form>
      <div class="boundary-switch">
        <span class="switch-label">版本冲突仲裁边界</span>
        <label
          v-for="option in boundaryOptions"
          :key="option.value"
          class="switch-option"
          :class="{ active: boundary === option.value }"
        >
          <input v-model="boundary" type="radio" name="boundary" :value="option.value" @change="reload" />
          {{ option.label }}
        </label>
      </div>
    </div>

    <div class="simulate-bar">
      <span class="switch-label">标签异常联动入口（跨模块数据流）：</span>
      <button class="btn" type="button" @click="submitNewHit">提交 ABO-0004 命中（ACTI-0003）</button>
      <button class="btn" type="button" @click="submitDuplicateHit">重复提交同一请求</button>
      <button class="btn" type="button" @click="submitConflictHit">对 ABO-0001 再提同端规则命中（归属冲突）</button>
      <span v-if="feedback" class="simulate-feedback" :class="{ 'error-text': !feedbackOk }">{{ feedback }}</span>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>联查</th>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="row in rows" :key="String(row.id)">
          <tr>
            <td>
              <button class="link" type="button" @click="toggleDetail(String(row.id))">
                {{ expanded === String(row.id) ? '收起' : '命中详情' }}
              </button>
            </td>
            <td v-for="column in columns" :key="column">{{ display(row, column) }}</td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button
                v-for="action in actions"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </td>
          </tr>
          <tr v-if="expanded === String(row.id)" class="detail-row">
            <td :colspan="columns.length + 3">
              <div class="hit-detail">
                <p class="detail-title">
                  异常对象 {{ row['异常对象'] }} 的命中来源（{{ sourceList(row).length }} 份证据，跨两端联查同一命中）
                </p>
                <table class="data-table inner-table">
                  <thead>
                    <tr>
                      <th>来源类型</th>
                      <th>来源编号</th>
                      <th>来源名称</th>
                      <th>请求编号</th>
                      <th>规则生效时间</th>
                      <th>异常检测时间</th>
                      <th>归属说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr v-for="source in sourceList(row)" :key="source.requestCode">
                      <td>{{ sourceTypeLabel(source.sourceType) }}</td>
                      <td>{{ source.sourceCode }}</td>
                      <td>{{ source.sourceName }}</td>
                      <td>{{ source.requestCode }}</td>
                      <td>{{ source.ruleEffectiveTime || '—' }}</td>
                      <td>{{ source.detectedTime || '—' }}</td>
                      <td :class="{ 'error-text': source.conflicted }">
                        {{ source.conflicted ? source.note : source.note || '正常归并' }}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </td>
          </tr>
        </template>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无异常复核数据，可先归并生成待复核清单</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条异常标签待复核项 · 证据池请求 {{ evidenceCount }} 条</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  FIELD_SOURCES,
  boundaryLabel,
  generateReviewList,
  listReviewRows,
  resetReviewWorkspace,
  reviewStats,
  submitReviewHit,
  reviewSources,
} from '@/api/review-service'
import { downloadEntries, runAction as applyAction } from '@/api/local-service'
import { listEvidencePool } from '@/data/local-store'
import type { EntryRow, ReviewHitInput, ReviewSource } from '@/data/types'

const MODULE_KEY = 'review'
const columns = [
  '复核编号',
  '异常对象',
  '异常行为',
  '标签规则编号',
  '检测器编号',
  '规则生效时间',
  '异常检测时间',
  '仲裁边界',
  '待复核结论',
  '归属冲突标记',
  '证据保留',
]
const actions = ['确认异常', '标记误报', '归档复核']
const statuses = ['待复核', '已确认异常', '误报关闭', '已归档']
const boundaryOptions = [
  { value: 'rule_time' as const, label: '规则生效时间（复核清单排法）' },
  { value: 'detect_time' as const, label: '异常检测时间（异常来源排法）' },
]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const keyword = ref('')
const boundary = ref<'rule_time' | 'detect_time'>('rule_time')
const expanded = ref('')
const feedback = ref('')
const feedbackOk = ref(true)
const evidenceCount = ref(0)
const stats = ref(reviewStats())

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function sourceList(row: EntryRow): ReviewSource[] {
  return reviewSources(row)
}

function sourceTypeLabel(type: ReviewSource['sourceType']): string {
  return type === 'tag_rule' ? '标签规则命中' : '检测器结果'
}

function display(row: EntryRow, column: string): string | number | boolean {
  if (column === '仲裁边界') {
    return boundaryLabel(boundary.value)
  }
  const value = row[column]
  if (Array.isArray(value)) {
    return value.length
  }
  return value ?? '—'
}

function resetFilters() {
  keyword.value = ''
  reload()
}

function toggleDetail(id: string) {
  expanded.value = expanded.value === id ? '' : id
}

function exportRows() {
  downloadEntries(MODULE_KEY)
}

function regenerate() {
  const report = generateReviewList()
  feedback.value = report.message
  feedbackOk.value = true
  reload()
}

function resetWorkspace() {
  resetReviewWorkspace()
  feedback.value = '复核清单与证据池已恢复为示例数据'
  feedbackOk.value = true
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(MODULE_KEY, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function baseHit(): ReviewHitInput {
  return {
    requestCode: 'REQ-T-0099',
    anomalyObject: 'ABO-0004',
    anomalyBehavior: '优惠券批量领取的薅羊毛行为',
    sourceType: 'tag_rule',
    sourceCode: 'ACTI-0003',
    sourceName: '行动标签样例3',
    ruleEffectiveTime: '2026-10-18 09:00',
    detectedTime: '',
    evidence: '标签规则 ACTI-0003 命中：同一用户秒级连领 12 张同档优惠券',
  }
}

function submitNewHit() {
  const result = submitReviewHit(baseHit())
  feedback.value = result.message
  feedbackOk.value = result.ok
  reload()
}

function submitDuplicateHit() {
  const result = submitReviewHit(baseHit())
  feedback.value = result.message
  feedbackOk.value = result.ok
  reload()
}

function submitConflictHit() {
  const input: ReviewHitInput = {
    requestCode: `REQ-T-${Date.now().toString().slice(-6)}`,
    anomalyObject: 'ABO-0001',
    anomalyBehavior: '支付页短时连续重试触发的异常下单行为',
    sourceType: 'tag_rule',
    sourceCode: 'ACTI-0002',
    sourceName: '行动标签样例2',
    ruleEffectiveTime: '2026-10-16 10:00',
    detectedTime: '',
    evidence: '标签规则 ACTI-0002 对同一支付异常再次命中，归属冲突演示证据',
  }
  const result = submitReviewHit(input)
  feedback.value = result.message
  feedbackOk.value = result.ok
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const ordered: EntryRow[] = listReviewRows(boundary.value).map((row) => ({
      ...row,
      [FIELD_SOURCES]: reviewSources(row),
      '仲裁边界': boundaryLabel(boundary.value),
    }))
    const keywordValue = keyword.value.trim()
    // 复核编号 / 异常对象 / 异常行为做 OR 联查，命中结果与异常检测侧读的是同一份清单。
    rows.value = keywordValue
      ? ordered.filter((row) =>
          ['复核编号', '异常对象', '异常行为'].some((field) =>
            String(row[field] ?? '').includes(keywordValue),
          ),
        )
      : ordered
    total.value = rows.value.length
    stats.value = reviewStats()
    evidenceCount.value = listEvidencePool().length
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '异常复核清单读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.review-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.boundary-switch,
.simulate-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 13px;
}

.simulate-bar {
  margin-bottom: 12px;
}

.switch-label {
  color: var(--muted);
  font-size: 12px;
}

.switch-option {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 3px 10px;
  cursor: pointer;
}

.switch-option.active {
  border-color: var(--brand);
  color: var(--brand);
}

.simulate-feedback {
  font-size: 12px;
}

.detail-row td {
  background: #f8fafc;
}

.hit-detail {
  padding: 4px 0;
}

.detail-title {
  margin: 0 0 8px;
  font-size: 13px;
  color: var(--muted);
}

.inner-table th,
.inner-table td {
  font-size: 12px;
}
</style>
