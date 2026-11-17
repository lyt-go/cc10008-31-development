<template>
  <section class="page" data-module="action">
    <header class="page-head">
      <div>
        <h2>行动标签管理</h2>
        <p class="page-desc">管理用户行为标签规则，根据事件组合和频率条件自动打标。规则命中结果与异常复核清单共用同一份数据。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记标签规则</button>
        <button class="btn" type="button" @click="exportRows">导出行动标签清单</button>
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
      <span class="legend-item linkage-legend">标签异常联动入口：复核清单 {{ reviewCount }} 条（按规则生效时间排列）</span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>标签异常联动</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="row in rows" :key="String(row.id)">
          <tr>
            <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
            <td>{{ row.status }}</td>
            <td>
              <template v-if="linkedHit(row)">
                <button class="link" type="button" @click="toggleDetail(String(row.id))">
                  {{ expanded === String(row.id) ? '收起命中' : '查看同一命中' }}
                </button>
              </template>
              <span v-else class="muted-text">暂无联动命中</span>
            </td>
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
                <template v-if="linkedHit(row)">
                  <p class="detail-title">
                    标签命中读取复核清单的同一结果：{{ linkedHit(row)?.['复核编号'] }} ·
                    异常对象 {{ linkedHit(row)?.['异常对象'] }} ·
                    结论「{{ linkedHit(row)?.['待复核结论'] }}」
                  </p>
                  <table class="data-table inner-table">
                    <thead>
                      <tr>
                        <th>来源类型</th>
                        <th>来源编号</th>
                        <th>请求编号</th>
                        <th>规则生效时间</th>
                        <th>异常检测时间</th>
                        <th>归属说明</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="source in hitSources(row)" :key="source.requestCode">
                        <td>{{ sourceTypeLabel(source.sourceType) }}</td>
                        <td>{{ source.sourceCode }}</td>
                        <td>{{ source.requestCode }}</td>
                        <td>{{ source.ruleEffectiveTime || '—' }}</td>
                        <td>{{ source.detectedTime || '—' }}</td>
                        <td :class="{ 'error-text': source.conflicted }">
                          {{ source.conflicted ? source.note : source.note || '正常归并' }}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </template>
                <p v-else class="muted-text">该标签规则在复核清单中没有命中结果。</p>
              </div>
            </td>
          </tr>
        </template>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无行动标签数据，可先登记标签规则</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条行动标签记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  findHitBySource,
  listReviewRows,
  reviewSources,
} from '@/api/review-service'
import type { EntryRow, ReviewSource } from '@/data/types'

const meta = moduleMeta('action')
const columns = ["规则编号", "标签名称", "标签类别", "触发事件组", "频率条件", "统计周期", "标签等级", "生效业务线"]
const actions = ["提交规则评审", "生效规则", "停用规则"]
const statuses = ["草稿", "规则评审中", "已生效", "已停用"]
const stats = [{"label": "标签规则总数", "value": 0}, {"label": "已生效规则", "value": 0}, {"label": "评审中规则", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const expanded = ref('')
const reviewRows = ref<EntryRow[]>([])
const reviewCount = computed(() => reviewRows.value.length)

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function linkedHit(row: EntryRow): EntryRow | undefined {
  // 标签规则命中与复核清单联查同一份命中结果：按规则编号定位复核项。
  return findHitBySource('tag_rule', String(row['规则编号']))
}

function hitSources(row: EntryRow): ReviewSource[] {
  const hit = linkedHit(row)
  return hit ? reviewSources(hit) : []
}

function sourceTypeLabel(type: ReviewSource['sourceType']): string {
  return type === 'tag_rule' ? '标签规则命中' : '检测器结果'
}

function toggleDetail(id: string) {
  expanded.value = expanded.value === id ? '' : id
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '标签规则登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    // 标签侧的复核清单同样取自新生成的异常标签待复核清单，按规则生效时间排列。
    reviewRows.value = listReviewRows('rule_time')
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '行动标签列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.linkage-legend {
  background: #e8f0fe;
  color: #1f6feb;
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

.muted-text {
  color: var(--muted);
  font-size: 12px;
}
</style>
