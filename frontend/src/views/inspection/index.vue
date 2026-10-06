<template>
  <section class="page" data-module="inspection">
    <header class="page-head">
      <div>
        <h2>巡检任务管理</h2>
        <p class="page-desc">围绕任务编号、关联管线、巡检人员、巡检日期做分配与执行。停用管线上不允许分配新任务。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="dialogOpen = true">登记巡检任务</button>
        <button class="btn" type="button" @click="exportRows">导出巡检任务清单</button>
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

    <div v-if="bannerMessage" class="banner banner-success">{{ bannerMessage }}</div>
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
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-disabled': isBlockedRow(row) }">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>
            {{ row.status }}
            <span v-if="isBlockedRow(row)" class="tag-stopped-inline">关联管线已停用</span>
          </td>
          <td class="row-actions cell-stack">
            <template v-for="action in actions" :key="action">
              <span v-if="isActionAllowed(row, action)" class="action-line">
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
                  <template v-if="feedback(row.id, action)!.type === 'conflict'">
                    <button class="link" type="button" @click="continueWithLatest(action, row)">
                      按最新结果重试
                    </button>
                  </template>
                </span>
              </span>
              <span v-else class="action-line muted-text">
                「{{ action }}」不可用：关联管线已停用，新派任务已被拦截
              </span>
            </template>
          </td>
        </tr>
        <tr v-if="loadState === 'success' && !rows.length">
          <td :colspan="columns.length + 2" class="empty-state">
            {{ hasActiveFilters
              ? '没有符合当前筛选条件的巡检任务，可调整条件或重置后再查（这不是无数据）'
              : '暂无巡检任务数据，可先登记巡检任务' }}
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <template v-if="loadState === 'success'">
        {{ hasActiveFilters ? `筛选命中 ${total} 条（清空条件可查看全部 ${allRows.length} 条）` : `共 ${total} 条巡检任务记录` }}
      </template>
      <span v-else-if="loadState === 'loading'">正在读取最新数据，当前为上次结果…</span>
      <span v-else-if="loadState === 'error'" class="error-text">读取失败，当前展示的是上次成功结果，可重试</span>
      <span v-else>准备加载…</span>
    </footer>

    <CreateRecordDialog
      :open="dialogOpen"
      module-key="inspection"
      title="登记巡检任务"
      :fields="dialogFields"
      :empty-form="emptyForm"
      @close="dialogOpen = false"
      @created="onCreated"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { downloadEntries, moduleMeta } from '@/api/local-service'
import { listStoppedPipelineCodes } from '@/api/core-service'
import { useModuleWorkbench } from '@/composables/useModuleWorkbench'
import CreateRecordDialog, { type DialogField } from '@/components/CreateRecordDialog.vue'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('inspection')
const columns = ["任务编号", "关联管线", "巡检区域", "巡检人员", "巡检日期", "巡检路线", "计划时长", "完成情况"]
const filterFields = ["任务编号", "关联管线", "巡检区域"]
const statuses = ["待分配", "已分配", "执行中", "已完成"]
// 每条任务仍列出全部流转入口，但「分配任务」对停用管线拦截并解释，执行中/已分配可继续走完。
const actions = ["分配任务", "开始巡检", "确认完成"]

const dialogOpen = ref(false)
const dialogFields: DialogField[] = [
  { key: '关联管线', label: '关联管线', type: 'select' },
  { key: '巡检区域', label: '巡检区域' },
  { key: '巡检人员', label: '巡检人员' },
  { key: '巡检日期', label: '巡检日期', placeholder: 'YYYY-MM-DD' },
  { key: '巡检路线', label: '巡检路线' },
  { key: '计划时长', label: '计划时长', placeholder: '如：4小时' },
]
const emptyForm: Record<string, string> = {
  关联管线: '',
  巡检区域: '',
  巡检人员: '',
  巡检日期: '',
  巡检路线: '',
  计划时长: '',
}
const bannerMessage = ref('')

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
    { label: '今日任务', value: all.length },
    { label: '待分配任务', value: all.filter((row) => row.status === '待分配').length },
    { label: '已完成任务', value: all.filter((row) => row.status === '已完成').length },
  ],
})

// 工作台每次成功刷新后 store 缓存都是最新：依赖 loadState/rows 重新求值即可。
const stoppedCodes = computed(() => {
  void loadState.value
  void rows.value
  return listStoppedPipelineCodes()
})

const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: allRows.value.filter((row) => String(row.status) === status).length,
  })),
)

function isBlockedRow(row: EntryRow): boolean {
  return stoppedCodes.value.has(String(row['关联管线'] ?? ''))
}

function isActionAllowed(row: EntryRow, action: string): boolean {
  // 只有「下达新派工」被停用管线拦截；已经开始的任务允许继续执行、完成。
  return !(action === '分配任务' && isBlockedRow(row))
}

async function onCreated(message: string) {
  dialogOpen.value = false
  await reload()
  bannerMessage.value = message
  window.setTimeout(() => (bannerMessage.value = ''), 2600)
}

function exportRows() {
  downloadEntries(meta.key)
}
</script>
