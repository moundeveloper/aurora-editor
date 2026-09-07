<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { storeToRefs } from 'pinia'
import {
  Aperture, Blend, Box, Circle, Contrast, Droplet, Eye, EyeOff, Focus, Grid2X2, Image, Layers,
  Maximize2, Minus, MoreHorizontal, Move, Palette, Play, Plus, RotateCw, Scaling, ScanLine, Search,
  Sigma, Sparkles, Sun, Trash2, Type, ZoomIn,
} from '@lucide/vue'
import { useEditorStore } from '@/stores/editor'
import {
  canConnect, connectionPath, isSourceKind, NODE_CATEGORIES, NODE_DEFINITIONS, NODE_HEADER_HEIGHT,
  NODE_KINDS, NODE_ROW_HEIGHT, NODE_WIDTH, nodeHeight, nodeRows, SOCKET_COLORS, socketMeta,
  socketOffsetY, socketPosition,
} from '@/engine/nodes/nodeGraph'
import { contributingNodeIds, evaluateNodeGraph } from '@/engine/nodes/evaluateGraph'
import {groupNodes,insertReroute,captureNodePreset,instantiateNodePreset,type NodePreset} from '@/engine/nodes/nodeEditing'
import type { EditorNode, EditorNodeKind, EditorNodeSocket } from '@/models/editor'
import IconButton from './common/IconButton.vue'
import NumberField from './common/NumberField.vue'
import MSelect, { type MSelectOption } from './common/MSelect.vue'

const MIN_ZOOM = .25
const MAX_ZOOM = 2.5

const store = useEditorStore()
const { nodes, nodeConnections, selectedNodeId, selectedConnectionId, renderRootNodeId, layers, currentTime } = storeToRefs(store)
const canvas = ref<HTMLElement>()
const query = ref('')
const addMenu = ref(false)
const selectedNodes = ref<string[]>([]), toolName = ref(''), presets = ref<NodePreset[]>([]), presetId = ref(''), toolMessage = ref('')
const selectedIds = computed(()=>[...new Set([...selectedNodes.value,...(selectedNodeId.value?[selectedNodeId.value]:[])])].filter(id=>nodes.value.some(node=>node.id===id)))
const backdrops = computed(()=>nodes.value.filter(node=>node.kind==='backdrop'))
const ordinaryNodes = computed(()=>nodes.value.filter(node=>node.kind!=='backdrop'))
function createGroup() {const group=groupNodes(nodes.value,selectedIds.value,toolName.value);if(group){store.markChanged();selectedNodes.value=[group.id];store.selectNode(group.id)}}
function ungroup() {for(const node of nodes.value)if(selectedIds.value.includes(node.id))delete node.groupId;store.markChanged()}
function reroute() {const node=insertReroute(nodes.value,nodeConnections.value,selectedConnectionId.value ?? '');if(node){store.markChanged();store.selectNode(node.id)}}
function savePreset() {
  try{const preset=captureNodePreset(nodes.value,nodeConnections.value,selectedIds.value,toolName.value);if(!preset.nodes.length)return;presets.value.push(preset);localStorage.setItem('aurora-node-presets',JSON.stringify(presets.value));presetId.value=preset.id;toolMessage.value='Preset saved on this device.'}
  catch(error){toolMessage.value=String(error)}
}
function addPreset() {const preset=presets.value.find(item=>item.id===presetId.value);if(!preset)return;const copy=instantiateNodePreset(preset,100-view.value.x/view.value.zoom,100-view.value.y/view.value.zoom);nodes.value.push(...copy.nodes);nodeConnections.value.push(...copy.connections);selectedNodes.value=copy.nodes.map(node=>node.id);store.markChanged()}
const view = ref({ x: 60, y: 40, zoom: 1 })
let resizeObserver: ResizeObserver | null = null

const kindIcons: Record<EditorNodeKind, unknown> = {
  reroute:Circle,backdrop:Layers,
  image: Image, text: Type, scene3d: Box,
  translate: Move, rotate: RotateCw, scale: Scaling,
  blur: Sparkles, glow: Sun, vignette: Aperture,
  invert: Circle, brightnessContrast: Palette, colorMatrix: Grid2X2, hueSaturation: Droplet, rgbToBw: Contrast,
  mix: Blend, stack: Layers, math: Sigma,
  mask: ScanLine,
  output: Play, viewer: Eye,
}

interface NodeDragState { pointerId: number; nodeId: string; offsetX: number; offsetY: number; members: {id:string;x:number;y:number}[]; originX:number;originY:number }
interface PanState { pointerId: number; startX: number; startY: number; originX: number; originY: number }
interface LinkDragState {
  pointerId: number
  fromNodeId: string
  fromPortId: string
  type: EditorNodeSocket['type']
  x: number
  y: number
  hover: { nodeId: string; portId: string } | null
}

const nodeDrag = ref<NodeDragState | null>(null)
const panState = ref<PanState | null>(null)
const linkDrag = ref<LinkDragState | null>(null)

const layerStyle = computed(() => ({ transform: `translate(${view.value.x}px, ${view.value.y}px) scale(${view.value.zoom})` }))
const zoomLabel = computed(() => `${Math.round(view.value.zoom * 100)}%`)
const nodeById = computed(() => new Map(nodes.value.map((node) => [node.id, node])))
const contributing = computed(() => contributingNodeIds(nodes.value, nodeConnections.value, renderRootNodeId.value))
const linkedSocketIds = computed(() => new Set(nodeConnections.value.map((connection) => `${connection.toNodeId}:${connection.toPortId}`)))
const matchedNodeIds = computed(() => {
  const term = query.value.trim().toLowerCase()
  if (!term) return null
  return new Set(nodes.value.filter((node) => node.title.toLowerCase().includes(term)).map((node) => node.id))
})

const liveLayerIds = computed(() => new Set(layers.value
  .filter((layer) => !layer.isPlaceholder && layer.visible && layer.type !== 'audio'
    && currentTime.value >= layer.start && currentTime.value < layer.start + layer.duration)
  .map((layer) => layer.id)))
const renderedCount = computed(() => (evaluateNodeGraph(nodes.value, nodeConnections.value, renderRootNodeId.value) ?? [])
  .filter((pass) => liveLayerIds.value.has(pass.layerId)).length)

const wires = computed(() => nodeConnections.value.flatMap((connection) => {
  const from = nodeById.value.get(connection.fromNodeId)
  const to = nodeById.value.get(connection.toNodeId)
  if (!from || !to) return []
  const start = socketPosition(from, connection.fromPortId, 'output')
  const end = socketPosition(to, connection.toPortId, 'input')
  if (!start || !end) return []
  const socket = from.outputs.find((item) => item.id === connection.fromPortId)
  return [{ id: connection.id, path: connectionPath(start, end), color: SOCKET_COLORS[socket?.type ?? 'image'] }]
}))

const pendingWire = computed(() => {
  const drag = linkDrag.value
  if (!drag) return null
  const from = nodeById.value.get(drag.fromNodeId)
  const start = from && socketPosition(from, drag.fromPortId, 'output')
  if (!start) return null
  const hoverNode = drag.hover ? nodeById.value.get(drag.hover.nodeId) : null
  const end = (hoverNode && drag.hover && socketPosition(hoverNode, drag.hover.portId, 'input')) ?? { x: drag.x, y: drag.y }
  return { path: connectionPath(start, end), valid: Boolean(drag.hover), color: SOCKET_COLORS[drag.type] }
})

const graphBounds = computed(() => {
  if (!nodes.value.length) return { minX: 0, minY: 0, maxX: NODE_WIDTH, maxY: 100 }
  return nodes.value.reduce((bounds, node) => ({
    minX: Math.min(bounds.minX, node.x),
    minY: Math.min(bounds.minY, node.y),
    maxX: Math.max(bounds.maxX, node.x + NODE_WIDTH),
    maxY: Math.max(bounds.maxY, node.y + nodeHeight(node)),
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity })
})

function socketStyle(node: EditorNode, socket: EditorNodeSocket, side: 'input' | 'output') {
  return {
    top: `${socketOffsetY(node, socket.id, side) ?? 0}px`,
    [side === 'input' ? 'left' : 'right']: '-5px',
    background: SOCKET_COLORS[socket.type],
  }
}

function rowStyle(index: number, section: 'outputs' | 'properties' | 'inputs', node: EditorNode) {
  const rows = nodeRows(node)
  const offset = section === 'outputs' ? 0 : section === 'properties' ? rows.outputs : rows.outputs + rows.properties
  return { top: `${NODE_HEADER_HEIGHT + (offset + index) * NODE_ROW_HEIGHT}px`, height: `${NODE_ROW_HEIGHT}px` }
}

const isLinked = (node: EditorNode, socket: EditorNodeSocket) => linkedSocketIds.value.has(`${node.id}:${socket.id}`)

function sourceOptions(node: EditorNode): MSelectOption[] {
  const kinds = NODE_DEFINITIONS[node.kind].sourceLayerTypes ?? []
  return [
    { value: '', label: 'No source' },
    ...layers.value
      .filter((layer) => !layer.isPlaceholder && kinds.includes(layer.type))
      .map((layer) => ({ value: layer.id, label: layer.name })),
  ]
}

function graphPoint(clientX: number, clientY: number) {
  const bounds = canvas.value?.getBoundingClientRect()
  if (!bounds) return { x: 0, y: 0 }
  return {
    x: (clientX - bounds.left - view.value.x) / view.value.zoom,
    y: (clientY - bounds.top - view.value.y) / view.value.zoom,
  }
}

function setZoom(nextZoom: number, anchorClientX?: number, anchorClientY?: number) {
  const bounds = canvas.value?.getBoundingClientRect()
  const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom))
  if (!bounds || clamped === view.value.zoom) return
  const localX = anchorClientX === undefined ? bounds.width / 2 : anchorClientX - bounds.left
  const localY = anchorClientY === undefined ? bounds.height / 2 : anchorClientY - bounds.top
  // Keep the graph point under the cursor pinned while the scale changes.
  const graphX = (localX - view.value.x) / view.value.zoom
  const graphY = (localY - view.value.y) / view.value.zoom
  view.value = { zoom: clamped, x: localX - graphX * clamped, y: localY - graphY * clamped }
}

function onWheel(event: WheelEvent) {
  event.preventDefault()
  setZoom(view.value.zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12), event.clientX, event.clientY)
}

function frameBounds(bounds: { minX: number; minY: number; maxX: number; maxY: number }) {
  const element = canvas.value
  if (!element) return
  const padding = 48
  const width = Math.max(1, bounds.maxX - bounds.minX)
  const height = Math.max(1, bounds.maxY - bounds.minY)
  const zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(
    (element.clientWidth - padding * 2) / width,
    (element.clientHeight - padding * 2) / height,
  )))
  view.value = {
    zoom,
    x: element.clientWidth / 2 - (bounds.minX + width / 2) * zoom,
    y: element.clientHeight / 2 - (bounds.minY + height / 2) * zoom,
  }
}

const fitGraph = () => frameBounds(graphBounds.value)

function frameSelected() {
  const node = nodeById.value.get(selectedNodeId.value)
  if (!node) return fitGraph()
  frameBounds({ minX: node.x - 90, minY: node.y - 90, maxX: node.x + NODE_WIDTH + 90, maxY: node.y + nodeHeight(node) + 90 })
}

function beginPan(event: PointerEvent) {
  const target = event.target as HTMLElement
  const onBackground = !target.closest('.graph-node, .graph-backdrop, .node-menu')
  if (event.button !== 1 && !(event.button === 0 && onBackground)) return
  event.preventDefault()
  if (event.button === 0 && onBackground) {
    store.selectNode(null)
    selectedNodes.value=[]
    store.selectNodeConnection(null)
    addMenu.value = false
  }
  panState.value = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX: view.value.x, originY: view.value.y }
}

function beginNodeDrag(event: PointerEvent, node: EditorNode) {
  if (event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  if(event.shiftKey || event.ctrlKey || event.metaKey) {
    const previous=selectedIds.value
    selectedNodes.value=previous.includes(node.id)?previous.filter(id=>id!==node.id):[...previous,node.id]
    store.selectNode(selectedNodes.value.at(-1) ?? null);return
  }
  if(!selectedIds.value.includes(node.id))selectedNodes.value=[node.id]
  store.selectNode(node.id)
  const point = graphPoint(event.clientX, event.clientY)
  const ids=new Set(selectedIds.value)
  for(const item of nodes.value)if(item.groupId && ids.has(item.groupId))ids.add(item.id)
  nodeDrag.value = { pointerId: event.pointerId, nodeId: node.id, offsetX: point.x - node.x, offsetY: point.y - node.y,originX:node.x,originY:node.y,members:nodes.value.filter(item=>ids.has(item.id)).map(item=>({id:item.id,x:item.x,y:item.y})) }
}

function beginLinkDrag(event: PointerEvent, node: EditorNode, socket: EditorNodeSocket) {
  if (event.button !== 0) return
  event.preventDefault()
  event.stopPropagation()
  const point = graphPoint(event.clientX, event.clientY)
  linkDrag.value = { pointerId: event.pointerId, fromNodeId: node.id, fromPortId: socket.id, type: socket.type, x: point.x, y: point.y, hover: null }
}

/** Dragging from a linked input detaches it, the way Blender lets you pull a noodle off a socket. */
function detachInput(event: PointerEvent, node: EditorNode, socket: EditorNodeSocket) {
  const link = nodeConnections.value.find((connection) => connection.toNodeId === node.id && connection.toPortId === socket.id)
  if (!link) return
  event.preventDefault()
  event.stopPropagation()
  store.disconnectNodes(link.id)
  const from = nodeById.value.get(link.fromNodeId)
  const fromSocket = from?.outputs.find((item) => item.id === link.fromPortId)
  if (from && fromSocket) beginLinkDrag(event, from, fromSocket)
}

/** Snaps the loose end to the nearest compatible input within reach, so links need no pixel aim. */
function nearestInput(point: { x: number; y: number }, drag: LinkDragState) {
  let best: { nodeId: string; portId: string; distance: number } | null = null
  nodes.value.forEach((node) => {
    node.inputs.forEach((socket) => {
      if (socket.type !== drag.type) return
      const offsetY = socketOffsetY(node, socket.id, 'input')
      if (offsetY === null) return
      const distance = Math.hypot(node.x - point.x, node.y + offsetY - point.y)
      if (distance > 55 || (best && distance >= best.distance)) return
      if (!canConnect(nodes.value, nodeConnections.value, { fromNodeId: drag.fromNodeId, fromPortId: drag.fromPortId, toNodeId: node.id, toPortId: socket.id })) return
      best = { nodeId: node.id, portId: socket.id, distance }
    })
  })
  return best as { nodeId: string; portId: string } | null
}

function onPointerMove(event: PointerEvent) {
  const pan = panState.value
  if (pan && pan.pointerId === event.pointerId) {
    view.value = { ...view.value, x: pan.originX + (event.clientX - pan.startX), y: pan.originY + (event.clientY - pan.startY) }
    return
  }
  const drag = nodeDrag.value
  if (drag && drag.pointerId === event.pointerId) {
    const point = graphPoint(event.clientX, event.clientY)
    const dx=point.x-drag.offsetX-drag.originX,dy=point.y-drag.offsetY-drag.originY
    for(const member of drag.members){const node=nodeById.value.get(member.id);if(node){node.x=Math.round(member.x+dx);node.y=Math.round(member.y+dy)}}
    return
  }
  const link = linkDrag.value
  if (link && link.pointerId === event.pointerId) {
    const point = graphPoint(event.clientX, event.clientY)
    link.x = point.x
    link.y = point.y
    link.hover = nearestInput(point, link)
  }
}

function onPointerUp(event: PointerEvent) {
  if (panState.value?.pointerId === event.pointerId) panState.value = null
  if (nodeDrag.value?.pointerId === event.pointerId) {nodeDrag.value = null;store.markChanged()}
  const link = linkDrag.value
  if (link?.pointerId === event.pointerId) {
    if (link.hover) store.connectNodes({ fromNodeId: link.fromNodeId, fromPortId: link.fromPortId, toNodeId: link.hover.nodeId, toPortId: link.hover.portId })
    linkDrag.value = null
  }
}

function onKeydown(event: KeyboardEvent) {
  const target = event.target
  if (target instanceof HTMLElement && target.matches('input, textarea, select')) return
  if (event.key === 'Escape') {
    addMenu.value = false
    linkDrag.value = null
    return
  }
  if (event.key.toLowerCase() === 'm' && selectedNodeId.value) {
    event.preventDefault()
    store.toggleNodeMuted(selectedNodeId.value)
    return
  }
  if (event.key !== 'Delete' && event.key !== 'Backspace') return
  if (selectedConnectionId.value) {
    event.preventDefault()
    store.disconnectNodes(selectedConnectionId.value)
  } else if (selectedNodeId.value && nodeById.value.has(selectedNodeId.value)) {
    event.preventDefault()
    store.deleteNode(selectedNodeId.value)
  }
}

function addNodeOfKind(kind: EditorNodeKind) {
  const element = canvas.value
  const bounds = element?.getBoundingClientRect()
  const center = bounds
    ? graphPoint(bounds.left + element!.clientWidth / 2, bounds.top + element!.clientHeight / 2)
    : { x: 0, y: 0 }
  store.addNode(kind, center.x - NODE_WIDTH / 2, center.y - 40)
  addMenu.value = false
}

function toggleViewer(node: EditorNode) {
  store.setRenderRootNode(renderRootNodeId.value === node.id ? null : node.id)
}

onMounted(async () => {
  try{const saved=JSON.parse(localStorage.getItem('aurora-node-presets') ?? '[]');if(Array.isArray(saved))presets.value=saved.filter(preset=>typeof preset.id==='string' && Array.isArray(preset.nodes) && Array.isArray(preset.connections) && preset.nodes.every((node:EditorNode)=>NODE_DEFINITIONS[node.kind]))}catch{/* Storage may be unavailable. */}
  await nextTick()
  if (canvas.value) {
    resizeObserver = new ResizeObserver(() => undefined)
    resizeObserver.observe(canvas.value)
    fitGraph()
  }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerUp)
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <section class="node-workspace">
    <div class="node-toolbar">
      <button class="add-node-button" type="button" @click="addMenu = !addMenu"><Plus :size="13" /> Add Node</button>
      <details class="node-tools"><summary>Groups & presets</summary><div>
        <small>Shift-click node headers to select several nodes.</small><input v-model="toolName" placeholder="Group or preset name" aria-label="Group or preset name" />
        <button type="button" :disabled="!selectedIds.length" @click="createGroup">Group selection</button><button type="button" :disabled="!selectedIds.length" @click="ungroup">Ungroup selection</button>
        <button type="button" :disabled="!selectedConnectionId" @click="reroute">Insert reroute on selected wire</button>
        <button type="button" :disabled="!selectedIds.length" @click="savePreset">Save selection as preset</button>
        <MSelect v-model="presetId" :options="presets.map(preset=>({value:preset.id,label:preset.name}))" label="Node preset" /><button type="button" :disabled="!presetId" @click="addPreset">Insert preset</button><span role="status">{{toolMessage}}</span>
      </div></details>
      <span class="divider" />
      <IconButton :icon="Focus" label="Frame selected" :disabled="!selectedNodeId" @click="frameSelected" />
      <IconButton :icon="Maximize2" label="Fit graph" @click="fitGraph" />
      <IconButton :icon="Minus" label="Zoom out" @click="setZoom(view.zoom / 1.2)" />
      <span class="zoom-label">{{ zoomLabel }}</span>
      <IconButton :icon="ZoomIn" label="Zoom in" @click="setZoom(view.zoom * 1.2)" />
      <span class="divider" />
      <IconButton :icon="EyeOff" label="Mute node (M)" :disabled="!selectedNodeId" @click="store.toggleNodeMuted(selectedNodeId)" />
      <IconButton :icon="Trash2" label="Delete selection" :disabled="!selectedNodeId && !selectedConnectionId" @click="selectedConnectionId ? store.disconnectNodes(selectedConnectionId) : store.deleteNode(selectedNodeId)" />
      <span class="toolbar-spacer" />
      <span class="render-summary" :class="{ empty: !renderedCount }" :title="renderedCount ? 'Sources reaching the render root at the playhead' : 'The render root receives nothing — the viewport is empty'">
        {{ renderedCount }} → {{ renderRootNodeId ? 'viewer' : 'composite' }}
      </span>
      <label class="node-search"><Search :size="12" /><input v-model="query" placeholder="Search nodes" /></label>
      <IconButton :icon="MoreHorizontal" label="Graph options" />
    </div>

    <div ref="canvas" class="node-canvas" :class="{ panning: panState, linking: linkDrag }" @pointerdown="beginPan" @wheel="onWheel" @contextmenu.prevent>
      <div class="node-grid" :style="{ backgroundSize: `${20 * view.zoom}px ${20 * view.zoom}px`, backgroundPosition: `${view.x}px ${view.y}px, ${view.x + 10 * view.zoom}px ${view.y + 10 * view.zoom}px` }" />

      <div class="graph-layer" :style="layerStyle">
        <div v-for="group in backdrops" :key="group.id" class="graph-backdrop" :class="{selected:selectedIds.includes(group.id)}" :style="{left:`${group.x}px`,top:`${group.y}px`,width:`${Math.max(200,Number(group.properties.width)||440)}px`,height:`${Math.max(100,Number(group.properties.height)||300)}px`,borderColor:group.properties.color||'#68729a'}">
          <header @pointerdown="beginNodeDrag($event,group)"><input v-model="group.title" aria-label="Node group name" @pointerdown.stop @change="store.markChanged()" /><input v-model="group.properties.color" type="color" aria-label="Node group color" @pointerdown.stop @input="store.markChanged()" /><button type="button" @click="store.deleteNode(group.id)">Ungroup</button></header>
          <textarea v-model="group.properties.note" aria-label="Backdrop note" placeholder="Add a note…" @pointerdown.stop @change="store.markChanged()" />
        </div>
        <svg class="connections" aria-hidden="true">
          <path
            v-for="wire in wires"
            :key="wire.id"
            :d="wire.path"
            :stroke="wire.color"
            :class="{ selected: selectedConnectionId === wire.id }"
            @pointerdown.stop="store.selectNodeConnection(wire.id)"
          />
          <path v-if="pendingWire" :d="pendingWire.path" class="pending" :class="{ valid: pendingWire.valid }" :stroke="pendingWire.color" />
        </svg>

        <div
          v-for="node in ordinaryNodes"
          :key="node.id"
          class="graph-node"
          :class="{
            selected: selectedIds.includes(node.id),
            dimmed: matchedNodeIds && !matchedNodeIds.has(node.id),
            inert: !contributing.has(node.id),
            muted: node.muted,
          }"
          :style="{ left: `${node.x}px`, top: `${node.y}px`, width: `${NODE_WIDTH}px`, height: `${nodeHeight(node)}px`, '--node-color': NODE_DEFINITIONS[node.kind].color }"
          @pointerdown="beginNodeDrag($event, node)"
        >
          <span class="node-header">
            <component :is="kindIcons[node.kind]" :size="11" />
            <strong :title="node.title">{{ node.title }}</strong>
            <button v-if="node.kind === 'viewer'" type="button" class="viewer-toggle" :class="{ active: renderRootNodeId === node.id }" title="Send this branch to the viewport" @pointerdown.stop @click.stop="toggleViewer(node)"><Eye :size="10" /></button>
          </span>

          <span v-for="(socket, index) in node.outputs" :key="socket.id" class="node-row output" :style="rowStyle(index, 'outputs', node)">
            <span class="socket-label">{{ socket.label }}</span>
          </span>

          <span v-for="(property, index) in NODE_DEFINITIONS[node.kind].properties" :key="property.key" class="node-row property" :style="rowStyle(index, 'properties', node)">
            <MSelect
              :model-value="node.properties[property.key] ?? property.value"
              :options="property.options"
              :label="`${node.title}: ${property.label}`"
              @pointerdown.stop
              @update:model-value="store.setNodeProperty(node.id, property.key, $event)"
            />
          </span>

          <span v-for="(socket, index) in node.inputs" :key="socket.id" class="node-row input" :style="rowStyle(index, 'inputs', node)">
            <template v-if="socket.type === 'value' && !isLinked(node, socket)">
              <span class="socket-label">{{ socket.label }}</span>
              <NumberField
                class="socket-value"
                :model-value="socket.value ?? 0"
                :min="socketMeta(node.kind, 'input', index)?.min"
                :max="socketMeta(node.kind, 'input', index)?.max"
                :step="socketMeta(node.kind, 'input', index)?.step ?? 1"
                :label="socket.label"
                @pointerdown.stop
                @update:model-value="store.setNodeSocketValue(node.id, socket.id, $event)"
              />
            </template>
            <span v-else class="socket-label">{{ socket.label }}</span>
          </span>

          <span v-if="isSourceKind(node.kind)" class="node-row source-row" :style="rowStyle(0, 'properties', node)">
            <MSelect
              :model-value="node.sourceId ?? ''"
              :options="sourceOptions(node)"
              :label="`${node.title}: source layer`"
              @pointerdown.stop
              @update:model-value="store.setNodeSource(node.id, $event || null)"
            />
          </span>

          <i
            v-for="socket in node.inputs"
            :key="`in-${socket.id}`"
            class="socket input"
            :class="{ active: linkDrag?.hover?.nodeId === node.id && linkDrag?.hover?.portId === socket.id, linked: isLinked(node, socket) }"
            :style="socketStyle(node, socket, 'input')"
            :title="`${socket.label} (${socket.type})`"
            @pointerdown="detachInput($event, node, socket)"
          />
          <i
            v-for="socket in node.outputs"
            :key="`out-${socket.id}`"
            class="socket output"
            :style="socketStyle(node, socket, 'output')"
            :title="`Drag ${socket.label} (${socket.type}) to an input`"
            @pointerdown="beginLinkDrag($event, node, socket)"
          />
        </div>
      </div>

      <div class="canvas-help">Pan: drag empty space · Zoom: wheel · Link: drag a socket · M: mute · Delete: remove</div>

      <div v-if="addMenu" class="node-menu" @pointerdown.stop @wheel.stop>
        <div v-for="category in NODE_CATEGORIES" :key="category" class="menu-group">
          <strong>{{ category }}</strong>
          <button v-for="kind in NODE_KINDS.filter((item) => NODE_DEFINITIONS[item].category === category)" :key="kind" type="button" @click="addNodeOfKind(kind)">
            <component :is="kindIcons[kind]" :size="11" />{{ NODE_DEFINITIONS[kind].label }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.node-tools{position:relative;font-size:10px}.node-tools summary{cursor:pointer;white-space:nowrap}.node-tools>div{position:absolute;z-index:100;top:25px;left:0;width:230px;padding:10px;display:grid;gap:7px;background:#20242e;border:1px solid #4c5364;box-shadow:0 8px 30px #0008}.node-tools input,.node-tools button{min-width:0;padding:5px;color:var(--text-secondary);background:var(--bg-input);border:1px solid var(--border-strong);font:inherit}.graph-backdrop{position:absolute;background:#242b3b66;border:2px solid;border-radius:7px}.graph-backdrop.selected{box-shadow:0 0 0 2px #c6d0ff}.graph-backdrop header{display:flex;align-items:center;gap:6px;height:28px;padding:3px 8px;background:#30394c;cursor:grab}.graph-backdrop input:not([type=color]){flex:1;min-width:0;background:transparent;color:#e3e9fa;border:0;font-size:11px}.graph-backdrop input[type=color]{width:23px;height:22px;border:0;padding:0}.graph-backdrop button{font-size:9px;color:#dce3f2;background:#252b39;border:1px solid #69738a}.graph-backdrop textarea{display:block;width:calc(100% - 16px);height:33px;resize:none;margin:5px 8px;background:transparent;border:0;color:#c5cee0;font-size:10px}
.node-workspace { display: flex; height: 100%; min-height: 0; flex-direction: column; background: #0d0f13; }.node-toolbar { display: flex; height: 34px; flex: 0 0 auto; align-items: center; gap: 3px; padding: 0 7px; background: var(--bg-panel-alt); border-bottom: 1px solid var(--border-subtle); }.add-node-button { display: flex; height: 25px; align-items: center; gap: 4px; padding: 0 7px; color: #dbe1ff; background: var(--bg-selected); border: 1px solid var(--accent-border); border-radius: 4px; font: inherit; font-size: 9.5px; cursor: pointer; }.divider { width: 1px; height: 20px; margin: 0 3px; background: var(--border-subtle); }.toolbar-spacer { flex: 1; }.zoom-label { min-width: 32px; color: var(--text-muted); font-size: 8.5px; text-align: center; font-variant-numeric: tabular-nums; }.node-search { display: flex; width: 116px; height: 24px; align-items: center; gap: 5px; padding: 0 6px; color: var(--text-muted); background: var(--bg-input); border: 1px solid var(--border-strong); border-radius: 3px; }.node-search input { width: 100%; min-width: 0; color: var(--text-primary); background: transparent; border: 0; outline: 0; font: inherit; font-size: 9px; }.render-summary { padding: 0 6px; color: #7ee0c0; font-size: 8px; white-space: nowrap; }.render-summary.empty { color: #c98d8d; }
.node-canvas { position: relative; min-height: 0; flex: 1; overflow: hidden; cursor: grab; touch-action: none; }.node-canvas.panning { cursor: grabbing; }.node-canvas.linking { cursor: crosshair; }.node-grid { position: absolute; inset: 0; background-color: #0c0e12; background-image: radial-gradient(#272b34 1px, transparent 1px), radial-gradient(#181b21 1px, transparent 1px); }.graph-layer { position: absolute; top: 0; left: 0; transform-origin: 0 0; }.connections { position: absolute; top: 0; left: 0; width: 1px; height: 1px; overflow: visible; }.connections path { fill: none; stroke-width: 2; cursor: pointer; pointer-events: stroke; }.connections path:hover { stroke-width: 3; }.connections path.selected { stroke: #e3ae72 !important; stroke-width: 3; }.connections path.pending { stroke-dasharray: 5 4; pointer-events: none; opacity: .7; }.connections path.pending.valid { stroke-dasharray: none; opacity: 1; }
.graph-node { --node-color: #7b84b8; position: absolute; z-index: 2; overflow: visible; color: var(--text-secondary); text-align: left; background: #1b1e26; border: 1px solid #3a3e48; border-radius: 5px; box-shadow: 0 4px 12px rgb(0 0 0 / .35); cursor: grab; user-select: none; }.graph-node:hover { border-color: #666c7b; }.graph-node.selected { z-index: 5; border-color: #e0e5ff; box-shadow: 0 0 0 1px #e0e5ff, 0 7px 18px rgb(0 0 0 / .45); }.graph-node.dimmed { opacity: .3; }.graph-node.inert { opacity: .55; border-style: dashed; }.graph-node.muted { filter: grayscale(.7); }.graph-node.muted .node-header { background: #4a4f5c; }
.node-header { position: absolute; top: 0; right: 0; left: 0; display: flex; height: 22px; align-items: center; gap: 4px; padding: 0 6px; color: #f2f4fb; background: color-mix(in srgb, var(--node-color) 68%, #15171d); border-radius: 4px 4px 0 0; }.node-header strong { min-width: 0; flex: 1; overflow: hidden; font-size: 8.5px; font-weight: 620; text-overflow: ellipsis; white-space: nowrap; }.viewer-toggle { display: grid; width: 15px; height: 15px; place-items: center; padding: 0; color: #f2f4fb; background: rgb(0 0 0 / .25); border: 0; border-radius: 2px; cursor: pointer; }.viewer-toggle.active { color: #101219; background: #e3ae72; }
.node-row { position: absolute; right: 0; left: 0; display: flex; align-items: center; gap: 4px; padding: 0 8px; font-size: 8px; }.node-row.output { justify-content: flex-end; }.node-row .socket-label { overflow: hidden; color: var(--text-muted); text-overflow: ellipsis; white-space: nowrap; }.node-row.input .socket-label { flex: 0 0 auto; }.socket-value { width: 100%; min-width: 0; height: 15px; margin-left: auto; padding: 0 4px; color: var(--text-primary); background: #2b3040; border: 1px solid #3c4354; border-radius: 8px; font: inherit; font-size: 8px; }.socket-value :deep(input) { text-align: right; }.socket-value:focus-within { border-color: var(--focus); }.node-row :deep(.m-select) { width: 100%; }.node-row :deep(.m-select-trigger) { height: 16px; padding: 0 4px; background: #272c39; border-color: #394052; border-radius: 3px; font-size: 7.5px; }.node-row :deep(.m-select-trigger svg) { width: 8px; height: 8px; }.node-row :deep(.m-select-menu) { top: calc(100% + 2px); min-width: 132px; max-height: 144px; padding: 2px; }.node-row :deep(.m-select-menu button) { height: 20px; padding: 0 4px; font-size: 7.5px; }.node-row.source-row { z-index: 4; }
.socket { position: absolute; z-index: 3; width: 10px; height: 10px; margin-top: -5px; border: 1px solid #0e1014; border-radius: 50%; cursor: crosshair; }.socket:hover { transform: scale(1.3); }.socket.input.active { box-shadow: 0 0 0 3px rgb(126 224 192 / .5); transform: scale(1.3); }
.canvas-help { position: absolute; right: 9px; bottom: 8px; color: #6f7583; font-size: 7px; pointer-events: none; }
.node-menu { position: absolute; z-index: 10; top: 8px; left: 10px; display: grid; max-height: calc(100% - 24px); width: 168px; gap: 6px; overflow: auto; padding: 6px; background: #1a1d24; border: 1px solid #444955; border-radius: 5px; box-shadow: 0 12px 30px rgb(0 0 0 / .55); }.menu-group { display: grid; }.menu-group strong { padding: 3px 5px 4px; color: var(--text-muted); font-size: 7px; letter-spacing: .07em; text-transform: uppercase; }.node-menu button { display: flex; height: 22px; align-items: center; gap: 6px; padding: 0 6px; color: var(--text-secondary); background: transparent; border: 1px solid transparent; border-radius: 3px; font: inherit; font-size: 8.5px; cursor: pointer; }.node-menu button:hover { color: #dce2ff; background: var(--bg-selected); border-color: var(--accent-border); }
</style>
