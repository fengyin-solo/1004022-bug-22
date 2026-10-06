<template>
  <div class="app-shell">
    <aside class="app-side">
      <h1 class="app-title">城市地下管网巡检养护管理系统</h1>
      <nav class="nav-list">
        <RouterLink v-for="item in navItems" :key="item.path" :to="item.path" class="nav-item">
          {{ item.label }}
        </RouterLink>
      </nav>
    </aside>
    <main class="app-main">
      <header class="app-head">
        <span class="head-desc">面向城市地下管线登记建档、巡检任务、缺陷记录、外出维修、修复验收与设施档案全流程的地下管网巡检养护管理平台。</span>
        <span class="head-tools">
          <label class="chaos-switch">
            <input type="checkbox" :checked="chaosEnabled" @change="onToggleChaos" />
            <span>故障演练（模拟网络失败，验证保留与重试）</span>
          </label>
          <span class="head-user">当前值班：{{ store.operator }} · {{ store.shiftLabel }}</span>
        </span>
      </header>
      <RouterView />
    </main>
  </div>
</template>

<script setup lang="ts">
import { chaosEnabled, toggleChaos } from '@/api/chaos'
import { useSessionStore } from '@/stores/session'

const store = useSessionStore()

function onToggleChaos(event: Event) {
  toggleChaos((event.target as HTMLInputElement).checked)
}

const navItems = [{ label: "运营概览", path: "/" }, { label: "管线登记", path: "/pipeline" }, { label: "巡检任务", path: "/inspection" }, { label: "缺陷记录", path: "/defect" }, { label: "外出维修", path: "/out_repair" }, { label: "维修验收", path: "/repair_accept" }, { label: "管道检测", path: "/pipe_detect" }, { label: "井盖设施", path: "/manhole" }, { label: "泵站运行", path: "/pump_station" }, { label: "排水管网", path: "/drain_network" }, { label: "水质监测", path: "/water_quality" }, { label: "流量监测", path: "/flow_monitor" }, { label: "应急事件", path: "/emergency" }, { label: "漏水检测", path: "/leak_detect" }, { label: "非开挖修复", path: "/trenchless" }, { label: "管道清洗", path: "/pipe_cleaning" }, { label: "设施档案", path: "/facility_archive" }, { label: "监测设备", path: "/monitor_device" }, { label: "施工队伍", path: "/contractor" }]
</script>
