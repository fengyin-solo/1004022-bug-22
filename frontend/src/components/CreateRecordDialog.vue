<template>
  <div v-if="open" class="modal-mask" @click.self="close">
    <div class="modal-card">
      <header class="modal-head">
        <h3>{{ title }}</h3>
        <button class="link" type="button" @click="close">关闭</button>
      </header>

      <p v-if="draftHasDraft" class="draft-tip">
        已从上次中断处恢复草稿，可继续填写或
        <button class="link" type="button" @click="discardDraft">放弃草稿</button>
      </p>

      <form class="draft-form" @submit.prevent="submit">
        <label v-for="field in fields" :key="field.key" class="draft-item">
          <span>{{ field.label }}</span>
          <select
            v-if="field.type === 'select'"
            v-model="form[field.key]"
            :disabled="submitting"
          >
            <option value="" disabled>请选择</option>
            <option
              v-for="option in field.options"
              :key="option.value"
              :value="option.value"
              :disabled="option.disabled"
            >
              {{ option.label }}
            </option>
          </select>
          <input
            v-else
            v-model="form[field.key]"
            :placeholder="field.placeholder ?? `请填写${field.label}`"
            :disabled="submitting"
          />
        </label>

        <p v-if="errorMessage" class="error-text form-error">{{ errorMessage }}</p>

        <footer class="modal-foot">
          <button class="btn" type="button" :disabled="submitting" @click="close">取消</button>
          <button class="btn primary" type="submit" :disabled="submitting">
            {{ submitting ? '提交中…' : '提交登记' }}
          </button>
        </footer>
      </form>
      <p class="modal-note">提交失败会保留已填内容，可直接重试；停用管线无法作为新记录的关联对象。</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'

import { createEntry, fetchPipelineOptions, type PipelineOption } from '@/api/core-service'
import { ServiceError } from '@/api/chaos'
import { useDraft } from '@/composables/useDraft'

export type DialogField = {
  key: string
  label: string
  type?: 'text' | 'select'
  placeholder?: string
  options?: { value: string; label: string; disabled?: boolean }[]
}

const props = defineProps<{
  open: boolean
  moduleKey: string
  title: string
  fields: DialogField[]
  emptyForm: Record<string, string>
}>()

const emit = defineEmits<{
  (event: 'close'): void
  (event: 'created', message: string): void
}>()

const form = reactive<Record<string, string>>({})
const submitting = ref(false)
const errorMessage = ref('')
const hasPipelineField = computed(() => props.fields.some((field) => field.type === 'select'))
const pipelineOptions = ref<PipelineOption[]>([])

const draft = useDraft(props.moduleKey, props.emptyForm)
const draftHasDraft = draft.hasDraft

function resetForm(saved?: Record<string, string>) {
  for (const key of Object.keys(props.emptyForm)) {
    form[key] = saved?.[key] ?? props.emptyForm[key] ?? ''
  }
}

async function loadOptions() {
  if (!hasPipelineField.value) return
  try {
    pipelineOptions.value = await fetchPipelineOptions()
  } catch {
    // 选项加载失败不致命：保留输入框式的降级体验，并允许提交时再由服务端拦截。
    pipelineOptions.value = []
  }
}

watch(
  () => props.open,
  async (open) => {
    if (!open) return
    errorMessage.value = ''
    const saved = draft.readDraft()
    resetForm(saved ?? undefined)
    await loadOptions()
  },
  { immediate: true },
)

watch(
  form,
  () => {
    // 输入即存：任何一步中断，下次打开都能接着填。
    draft.saveDraft({ ...form })
  },
  { deep: true },
)

function resolveField(field: DialogField): DialogField {
  if (field.type !== 'select') return field
  const options =
    pipelineOptions.value.length > 0
      ? pipelineOptions.value.map((item) => ({
          value: item.code,
          label: item.status === '已停用' ? `${item.code}（已停用，不可选）` : item.code,
          disabled: item.status === '已停用',
        }))
      : []
  return { ...field, options }
}

const fields = computed(() => props.fields.map((field) => resolveField(field)))

function validate(): string {
  for (const field of props.fields) {
    if (!String(form[field.key] ?? '').trim()) {
      return `请填写${field.label}`
    }
  }
  return ''
}

async function submit() {
  errorMessage.value = ''
  const invalid = validate()
  if (invalid) {
    errorMessage.value = invalid
    return
  }
  submitting.value = true
  try {
    const result = await createEntry(props.moduleKey, { ...form })
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    draft.clearDraft()
    emit('created', result.message)
    close()
  } catch (error) {
    errorMessage.value = error instanceof ServiceError ? error.message : '提交失败，草稿已保留，请重试'
  } finally {
    submitting.value = false
  }
}

function discardDraft() {
  draft.clearDraft()
  resetForm()
}

function close() {
  if (submitting.value) return
  emit('close')
}
</script>
