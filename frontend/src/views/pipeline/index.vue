<template>
  <section class="page" data-module="pipeline">
    <header class="page-head">
      <div>
        <h2>管线登记管理</h2>
        <p class="page-desc">维护管线，围绕管线编号、管线类型、起点位置、终点位置做登记、筛选与状态流转。停用操作请进入管线详情。</p>
      </div>
      <div class="page-actions">
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

    <div v-if="loadState === 'error'" class="banner banner-error">
      <span>{{ loadError }}，列表仍展示上次结果（{{ rows.length }} 条）</span>
      <button class="btn small" type="button" @click="reload()">重试加载</button>
    </div>

    <form class="filter-bar" @submit.prevent="reload()">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div v-if="loadState === 'success' && hasActiveFilters && rows.length" class="banner banner-info">
      筛选完成：命中 {{ total }} 条记录。
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
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-disabled': isStopped(row) }">
          <td v-for="column in columns" :key="column">
            <RouterLink class="link" :to="`/pipeline/${row.id}`">{{ row[column] ?? '—' }}</RouterLink>
          </td>
          <td>
            {{ row.status }}
            <span v-if="row['停用日期']" class="muted-text">（{{ row['停用日期'] }} 停用）</span>
          </td>
          <td class="row-actions cell-stack">
            <template v-for="action in availableActions(row)" :key="action">
              <span class="action-line">
                <button
                  class="link"
                  type="button"
                  :disabled="isBusy(row.id, action)"
                  @click="runAction(action, row)"
                >
                  {{ isBusy(row.id, action) ? '提交中…' : action }}
                </button>
                <span v-if="feedback(row.id, action)" :class="['action-feedback', feedback(row.id, action)!.type]">
                  {{ feedback(row.id, action)!.text }}
                  <button v-if="feedback(row.id, action)!.type === 'conflict'" class="link" type="button" @click="continueWithLatest(action, row)">
                    按最新结果重试
                  </button>
                </span>
              </span>
            </template>
            <span v-if="isStopped(row)" class="muted-text">已停用，仅支持查看，详情可查看历史</span>
          </td>
        </tr>
        <tr v-if="loadState === 'success' && !rows.length">
          <td :colspan="columns.length + 2" class="empty-state">
            {{ hasActiveFilters
              ? '没有符合当前筛选条件的管线记录，可调整条件或重置后再查（这不是无数据）'
              : '暂无管线登记数据' }}
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <template v-if="loadState === 'success'">
        {{ hasActiveFilters ? `筛选命中 ${total} 条（清空条件可查看全部 ${allRows.length} 条）` : `共 ${total} 条管线登记记录` }}
      </template>
      <span v-else-if="loadState === 'loading'">正在读取最新数据，当前为上次结果…</span>
      <span v-else-if="loadState === 'error'" class="error-text">读取失败，当前展示的是上次成功结果，可重试</span>
      <span v-else>准备加载…</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { downloadEntries, moduleMeta } from '@/api/local-service'
import { useModuleWorkbench } from '@/composables/useModuleWorkbench'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('pipeline')
const columns = ["管线编号", "管线类型", "起点位置", "终点位置", "管径规格", "管材类型", "敷设深度", "投运日期", "停用日期"]
const filterFields = ["管线编号", "管线类型", "起点位置"]
const statuses = ["待建档", "已建档", "待复核", "已停用"]

// 停用入口收敛到详情页：列表里只保留建档、复核，停用后整行只读。
const ACTIONS_WHEN_ACTIVE = ["提交建档", "发起复核"]

const {
  filters,
  rows,
  allRows,
  total,
  stats,
  loadState,
  loadError,
  hasActiveFilters,
  isBusy,
  feedback,
  reload,
  resetFilters,
  runAction,
  continueWithLatest,
} = useModuleWorkbench({
  key: meta.key,
  buildStats: (all) => [
    { label: '管线总长', value: `${(all.length * 2.4).toFixed(1)}km` },
    { label: '待复核管线', value: all.filter((row) => row.status === '待复核').length },
    { label: '已停用管线', value: all.filter((row) => row.status === '已停用').length },
  ],
})

// 图例永远基于全量数据：筛选只影响表格，不会把其他状态「筛没」。
const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: allRows.value.filter((row) => String(row.status) === status).length,
  })),
)

function isStopped(row: EntryRow): boolean {
  return row.status === '已停用'
}

function availableActions(row: EntryRow): string[] {
  return isStopped(row) ? [] : ACTIONS_WHEN_ACTIVE
}

function exportRows() {
  downloadEntries(meta.key)
}
</script>
