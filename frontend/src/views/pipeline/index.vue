<template>
  <section class="page" data-module="pipeline">
    <header class="page-head">
      <div>
        <h2>管线登记管理</h2>
        <p class="page-desc">维护管线，围绕管线编号、管线类型、起点位置、终点位置做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记管线</button>
        <button class="btn" type="button" @click="exportRows">导出管线登记清单</button>
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
            <template v-if="!isDisabled(row)">
              <button
                v-for="action in actions"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </template>
            <span v-else class="view-only">已停用 · 仅可查看</span>
          </td>
        </tr>
        <tr v-if="!rows.length && !loadError">
          <td :colspan="columns.length + 2" class="empty-state">
            {{ hasActiveFilters ? '没有符合筛选条件的管线登记记录，可调整条件后重新查询' : '暂无管线登记数据，可先登记管线' }}
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条管线登记记录</span>
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

const meta = moduleMeta('pipeline')
const columns = ["管线编号", "管线类型", "起点位置", "终点位置", "管径规格", "管材类型", "敷设深度", "投运日期"]
const actions = ["提交建档", "发起复核", "停用管线"]
const statuses = ["待建档", "已建档", "待复核", "已停用"]
const stats = [{"label": "管线总长", "value": 0}, {"label": "待复核管线", "value": 0}, {"label": "已停用管线", "value": 0}]

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

function isDisabled(row: EntryRow) {
  return String(row.status) === '已停用'
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  actionError.value = '管线登记入口尚未接入审批流'
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
    loadError.value = error instanceof Error ? error.message : '管线登记列表读取失败'
  }
}

onMounted(reload)
</script>
