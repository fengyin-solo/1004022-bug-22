<template>
  <section class="page" data-module="defect">
    <header class="page-head">
      <div>
        <h2>缺陷记录管理</h2>
        <p class="page-desc">维护缺陷记录，围绕缺陷编号、所属管线、缺陷类型、发现位置做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记缺陷记录</button>
        <button class="btn" type="button" @click="exportRows">导出缺陷记录清单</button>
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

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div v-if="loadError" class="error-banner" role="alert">
      <span>{{ loadError }}，已保留上次加载结果。</span>
      <button class="btn" type="button" @click="reload">重试</button>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
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
        <tr v-if="!rows.length && !loadError">
          <td :colspan="columns.length + 2" class="empty-state">
            {{ hasActiveFilters ? '没有符合筛选条件的缺陷记录，可调整条件后重新查询' : '暂无缺陷记录数据，可先登记缺陷记录' }}
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条缺陷记录记录</span>
      <span v-if="actionError" class="error-text">{{ actionError }}</span>
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
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('defect')
const columns = ["缺陷编号", "所属管线", "缺陷类型", "发现位置", "严重等级", "发现日期", "缺陷描述", "记录状态"]
const actions = ["确认缺陷", "标记修复", "忽略缺陷"]
const statuses = ["待确认", "已确认", "已修复", "已忽略"]
const stats = [{"label": "待确认缺陷", "value": 0}, {"label": "已修复缺陷", "value": 0}, {"label": "严重缺陷", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const actionError = ref('')
const loadError = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const hasActiveFilters = computed(() =>
  Object.values(filters.value).some((value) => value.trim() !== ''),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  actionError.value = '缺陷记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  actionError.value = ''
  const result = applyAction(meta.key, Number(row.id), action, Number(row.version ?? 0))
  if (!result.ok) {
    actionError.value = result.message
  }
  // 成功、被拦截或版本冲突都重新拉取：列表始终对齐落库状态，可继续处理。
  reload()
}

function reload() {
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    loadError.value = ''
  } catch (error) {
    // 保留上次结果，不把读取失败当成「没有记录」。
    loadError.value = error instanceof Error ? error.message : '缺陷记录列表读取失败'
  }
}

onMounted(reload)
</script>
