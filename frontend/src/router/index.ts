import { createRouter, createWebHistory } from 'vue-router'

import Dashboard from '@/views/Dashboard.vue'
const Pipeline = () => import('@/views/pipeline/index.vue')
const PipelineDetail = () => import('@/views/pipeline/detail.vue')
const Inspection = () => import('@/views/inspection/index.vue')
const Defect = () => import('@/views/defect/index.vue')
const OutRepair = () => import('@/views/out_repair/index.vue')
const RepairAccept = () => import('@/views/repair_accept/index.vue')
const PipeDetect = () => import('@/views/pipe_detect/index.vue')
const Manhole = () => import('@/views/manhole/index.vue')
const PumpStation = () => import('@/views/pump_station/index.vue')
const DrainNetwork = () => import('@/views/drain_network/index.vue')
const WaterQuality = () => import('@/views/water_quality/index.vue')
const FlowMonitor = () => import('@/views/flow_monitor/index.vue')
const Emergency = () => import('@/views/emergency/index.vue')
const LeakDetect = () => import('@/views/leak_detect/index.vue')
const Trenchless = () => import('@/views/trenchless/index.vue')
const PipeCleaning = () => import('@/views/pipe_cleaning/index.vue')
const FacilityArchive = () => import('@/views/facility_archive/index.vue')
const MonitorDevice = () => import('@/views/monitor_device/index.vue')
const Contractor = () => import('@/views/contractor/index.vue')

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'dashboard', component: Dashboard },
    { path: '/pipeline', name: 'pipeline', component: Pipeline },
    { path: '/pipeline/:id', name: 'pipeline-detail', component: PipelineDetail },
    { path: '/inspection', name: 'inspection', component: Inspection },
    { path: '/defect', name: 'defect', component: Defect },
    { path: '/out_repair', name: 'out_repair', component: OutRepair },
    { path: '/repair_accept', name: 'repair_accept', component: RepairAccept },
    { path: '/pipe_detect', name: 'pipe_detect', component: PipeDetect },
    { path: '/manhole', name: 'manhole', component: Manhole },
    { path: '/pump_station', name: 'pump_station', component: PumpStation },
    { path: '/drain_network', name: 'drain_network', component: DrainNetwork },
    { path: '/water_quality', name: 'water_quality', component: WaterQuality },
    { path: '/flow_monitor', name: 'flow_monitor', component: FlowMonitor },
    { path: '/emergency', name: 'emergency', component: Emergency },
    { path: '/leak_detect', name: 'leak_detect', component: LeakDetect },
    { path: '/trenchless', name: 'trenchless', component: Trenchless },
    { path: '/pipe_cleaning', name: 'pipe_cleaning', component: PipeCleaning },
    { path: '/facility_archive', name: 'facility_archive', component: FacilityArchive },
    { path: '/monitor_device', name: 'monitor_device', component: MonitorDevice },
    { path: '/contractor', name: 'contractor', component: Contractor },
  ],
})

export default router
