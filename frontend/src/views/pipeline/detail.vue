<template>
  <section class="page" data-module="pipeline-detail">
    <header class="page-head">
      <div>
        <h2>管线详情</h2>
        <p class="page-desc">
          <RouterLink class="link" to="/pipeline">返回管线登记列表</RouterLink>
        </p>
      </div>
    </header>

    <div v-if="loadState === 'error'" class="banner banner-error">
      <span>{{ loadError }}，详情仍展示上次加载结果</span>
      <button class="btn small" type="button" @click="load">重试加载</button>
    </div>

    <div v-if="detail" class="detail-wrap">
      <div v-if="isStopped" class="banner banner-warn">
        该管线已于 {{ detail.pipeline['停用日期'] || '—' }} 停用：当前仅支持查看。新的巡检任务、缺陷登记与缺陷流转都会被拦截，
        下方历史巡检与历史缺陷记录仍然保留。
      </div>
      <div v-else class="banner banner-info">管线处于「{{ detail.pipeline.status }}」，可执行状态流转。</div>

      <article class="detail-card">
        <header class="detail-card-head">
          <h3>{{ detail.pipeline['管线编号'] }}</h3>
          <span :class="['status-tag', isStopped ? 'tag-stopped' : 'tag-active']">{{ detail.pipeline.status }}</span>
        </header>
        <dl class="detail-grid">
          <div v-for="field in infoFields" :key="field" class="detail-item">
            <dt>{{ field }}</dt>
            <dd>{{ detail.pipeline[field] || '—' }}</dd>
          </div>
        </dl>
        <div class="detail-actions">
          <template v-for="action in availableActions" :key="action">
            <button
              class="btn"
              :class="{ danger: action === '停用管线' }"
              type="button"
              :disabled="busyAction === action"
              @click="submitAction(action)"
            >
              {{ busyAction === action ? '提交中…' : action }}
            </button>
          </template>
          <span v-if="isStopped" class="muted-text">停用后不能重新启用或继续流转，仅保留查看能力</span>
        </div>
        <p v-if="actionFeedback" :class="['action-feedback', actionFeedback.ok ? 'success' : actionFeedback.code === 'CONFLICT' ? 'conflict' : 'error']">
          {{ actionFeedback.message }}
          <button v-if="actionFeedback.code === 'CONFLICT'" class="link" type="button" @click="load">
            查看最新状态后重试
          </button>
        </p>
      </article>

      <div class="detail-sections">
        <section class="detail-card">
          <h4>历史巡检任务（{{ detail.inspections.length }}）</h4>
          <table class="data-table">
            <thead>
              <tr><th>任务编号</th><th>巡检区域</th><th>巡检人员</th><th>巡检日期</th><th>状态</th></tr>
            </thead>
            <tbody>
              <tr v-for="item in detail.inspections" :key="String(item.id)">
                <td>{{ item['任务编号'] }}</td>
                <td>{{ item['巡检区域'] }}</td>
                <td>{{ item['巡检人员'] }}</td>
                <td>{{ item['巡检日期'] }}</td>
                <td>{{ item.status }}</td>
              </tr>
              <tr v-if="!detail.inspections.length">
                <td colspan="5" class="empty-state">该管线下暂无巡检任务历史</td>
              </tr>
            </tbody>
          </table>
          <p class="table-note">停用管线下不能分配新任务；任务的执行操作请到
            <RouterLink class="link" to="/inspection">巡检任务工作台</RouterLink>处理。
          </p>
        </section>

        <section class="detail-card">
          <h4>历史缺陷记录（{{ detail.defects.length }}）</h4>
          <table class="data-table">
            <thead>
              <tr><th>缺陷编号</th><th>缺陷类型</th><th>发现位置</th><th>严重等级</th><th>发现日期</th><th>状态</th></tr>
            </thead>
            <tbody>
              <tr v-for="item in detail.defects" :key="String(item.id)">
                <td>{{ item['缺陷编号'] }}</td>
                <td>{{ item['缺陷类型'] }}</td>
                <td>{{ item['发现位置'] }}</td>
                <td>{{ item['严重等级'] }}</td>
                <td>{{ item['发现日期'] }}</td>
                <td>{{ item.status }}</td>
              </tr>
              <tr v-if="!detail.defects.length">
                <td colspan="6" class="empty-state">该管线下暂无缺陷记录历史</td>
              </tr>
            </tbody>
          </table>
          <p class="table-note">停用管线下的历史缺陷仅可查看，不能再确认、修复或忽略。</p>
        </section>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'

import { commitAction, fetchPipelineDetail, type PipelineDetail } from '@/api/core-service'
import { ServiceError } from '@/api/chaos'
import { watchExternalChanges } from '@/data/local-store'
import type { ActionResult } from '@/data/types'

const route = useRoute()
const infoFields = ["管线类型", "起点位置", "终点位置", "管径规格", "管材类型", "敷设深度", "投运日期", "停用日期"]

const detail = ref<PipelineDetail | null>(null)
const loadState = ref<'idle' | 'loading' | 'success' | 'error'>('idle')
const loadError = ref('')
const busyAction = ref('')
const actionFeedback = ref<ActionResult | null>(null)

const isStopped = computed(() => detail.value?.pipeline.status === '已停用')

const availableActions = computed(() => {
  if (!detail.value || isStopped.value) return []
  return ['提交建档', '发起复核', '停用管线']
})

async function load() {
  loadState.value = 'loading'
  loadError.value = ''
  try {
    detail.value = await fetchPipelineDetail(Number(route.params.id))
    loadState.value = 'success'
  } catch (error) {
    // 失败保留上次详情，只提示重试，绝不把已有详情清空成「无记录」。
    loadError.value = error instanceof ServiceError ? error.message : '管线详情读取失败'
    loadState.value = 'error'
  }
}

async function submitAction(action: string) {
  if (!detail.value) return
  busyAction.value = action
  actionFeedback.value = null
  let result: ActionResult
  try {
    result = await commitAction('pipeline', Number(detail.value.pipeline.id), action, Number(detail.value.pipeline.rev ?? 1))
  } catch (error) {
    actionFeedback.value = {
      ok: false,
      message: error instanceof ServiceError ? error.message : '提交失败，管线状态未改动',
    }
    busyAction.value = ''
    return
  }
  busyAction.value = ''
  if (result.ok) {
    actionFeedback.value = { ok: true, message: result.message }
    await load()
    return
  }
  if (result.code === 'CONFLICT' && result.current) {
    // 另一值班人先落库（例如先停用）：本页状态对齐到库，操作人可继续按最新情况处理。
    detail.value = { ...detail.value, pipeline: result.current }
  }
  actionFeedback.value = result
}

let stopWatch: (() => void) | null = null
onMounted(async () => {
  await load()
  stopWatch = watchExternalChanges(() => {
    void load()
  })
})
onUnmounted(() => stopWatch?.())
</script>
