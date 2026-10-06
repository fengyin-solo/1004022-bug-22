<template>
  <section class="page" data-module="defect">
    <header class="page-head">
      <div>
        <h2>缺陷记录管理</h2>
        <p class="page-desc">围绕缺陷编号、所属管线、缺陷类型、发现位置做确认与闭环。停用管线上的缺陷仅可查看，不能再流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="dialogOpen = true">登记缺陷记录</button>
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
            <span v-if="isBlockedRow(row)" class="tag-stopped-inline">所属管线已停用</span>
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
                「{{ action }}」不可用：所属管线已停用，缺陷仅可查看，历史记录仍保留
              </span>
            </template>
          </td>
        </tr>
        <tr v-if="loadState === 'success' && !rows.length">
          <td :colspan="columns.length + 2" class="empty-state">
            {{ hasActiveFilters
              ? '没有符合当前筛选条件的缺陷记录，可调整条件或重置后再查（这不是无数据）'
              : '暂无缺陷记录数据，可先登记缺陷记录' }}
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <template v-if="loadState === 'success'">
        {{ hasActiveFilters ? `筛选命中 ${total} 条（清空条件可查看全部 ${allRows.length} 条）` : `共 ${total} 条缺陷记录` }}
      </template>
      <span v-else-if="loadState === 'loading'">正在读取最新数据，当前为上次结果…</span>
      <span v-else-if="loadState === 'error'" class="error-text">读取失败，当前展示的是上次成功结果，可重试</span>
      <span v-else>准备加载…</span>
    </footer>

    <CreateRecordDialog
      :open="dialogOpen"
      module-key="defect"
      title="登记缺陷记录"
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

const meta = moduleMeta('defect')
const columns = ["缺陷编号", "所属管线", "缺陷类型", "发现位置", "严重等级", "发现日期", "缺陷描述", "记录状态"]
const filterFields = ["缺陷编号", "所属管线", "缺陷类型"]
const statuses = ["待确认", "已确认", "已修复", "已忽略"]
// 停用管线上的缺陷只读：确认、修复、忽略全部拦截并说明原因。
const actions = ["确认缺陷", "标记修复", "忽略缺陷"]

const dialogOpen = ref(false)
const dialogFields: DialogField[] = [
  { key: '所属管线', label: '所属管线', type: 'select' },
  { key: '缺陷类型', label: '缺陷类型', placeholder: '如：接口渗漏、管壁腐蚀' },
  { key: '发现位置', label: '发现位置' },
  {
    key: '严重等级',
    label: '严重等级',
    type: 'select',
    options: [
      { value: '一般', label: '一般' },
      { value: '较重', label: '较重' },
      { value: '严重', label: '严重' },
      { value: '危急', label: '危急' },
    ],
  },
  { key: '发现日期', label: '发现日期', placeholder: 'YYYY-MM-DD' },
  { key: '缺陷描述', label: '缺陷描述' },
]
const emptyForm: Record<string, string> = {
  所属管线: '',
  缺陷类型: '',
  发现位置: '',
  严重等级: '',
  发现日期: '',
  缺陷描述: '',
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
    { label: '待确认缺陷', value: all.filter((row) => row.status === '待确认').length },
    { label: '已修复缺陷', value: all.filter((row) => row.status === '已修复').length },
    {
      label: '严重缺陷',
      value: all.filter((row) => ['严重', '危急'].includes(String(row['严重等级'] ?? ''))).length,
    },
  ],
})

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
  return stoppedCodes.value.has(String(row['所属管线'] ?? ''))
}

function isActionAllowed(row: EntryRow, _action: string): boolean {
  // 停用管线只读：任何缺陷流转动作都不允许。
  return !isBlockedRow(row)
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
