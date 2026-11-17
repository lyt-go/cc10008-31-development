<template>
  <section class="page" data-module="anomaly">
    <header class="page-head">
      <div>
        <h2>异常检测管理</h2>
        <p class="page-desc">配置行为异常检测器，识别突增突降、模式漂移和离群行为。检测器命中结果与异常复核清单共用同一份数据。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记检测器</button>
        <button class="btn" type="button" @click="exportRows">导出异常检测清单</button>
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
      <span class="legend-item linkage-legend">标签异常联动来源：{{ sourceRows.length }} 条（按异常检测时间排列）</span>
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
              <template v-if="hitMap[String(row['检测器编号'])]">
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
                    检测详情读取复核清单的同一命中：{{ linkedHit(row)?.['复核编号'] }} ·
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
                <p v-else class="muted-text">该检测器在复核清单中没有命中结果。</p>
              </div>
            </td>
          </tr>
        </template>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无异常检测数据，可先登记检测器</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条异常检测记录</span>
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
  listAnomalySourceRows,
  reviewSources,
} from '@/api/review-service'
import type { EntryRow, ReviewSource } from '@/data/types'

const meta = moduleMeta('anomaly')
const columns = ["检测器编号", "监控事件", "异常模式", "灵敏度", "最小支持量", "检测窗口分", "确认状态", "误报率"]
const actions = ["提交检测器评审", "启用检测", "停用检测"]
const statuses = ["草稿", "检测器评审中", "已启用", "已停用"]
const stats = [{"label": "检测器总数", "value": 0}, {"label": "已启用检测器", "value": 0}, {"label": "评审中检测器", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const expanded = ref('')
const sourceRows = ref<EntryRow[]>([])

// 检测器编号 -> 复核清单里的同一条命中结果（两个业务面共用的跨模块数据流）。
const hitMap = computed<Record<string, EntryRow>>(() => {
  const map: Record<string, EntryRow> = {}
  for (const reviewRow of sourceRows.value) {
    for (const source of reviewSources(reviewRow)) {
      if (source.sourceType === 'detector') {
        map[source.sourceCode] = reviewRow
      }
    }
  }
  return map
})

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function linkedHit(row: EntryRow): EntryRow | undefined {
  // 检测详情与复核清单联查的是同一份命中结果：按检测器编号直接定位复核项。
  return findHitBySource('detector', String(row['检测器编号']))
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
  errorMessage.value = '检测器登记入口尚未接入审批流'
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
    // 异常来源清单从新生成的异常标签待复核清单取得，按异常检测时间排列。
    sourceRows.value = listAnomalySourceRows()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '异常检测列表读取失败'
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
