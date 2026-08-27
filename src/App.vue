<template>
  <div class="app">
    <div class="topbar">
      <span>{{ toolLabel }}</span>
      <span v-if="cursorPos"> | {{ cursorPos.x }}, {{ cursorPos.y }}</span>
      <span v-if="activeLayer"> | {{ activeLayer.name }}</span>
      <span style="margin-left:auto;padding-right: 8px;">{{ canvasSize.w }} × {{ canvasSize.h }}  |  {{ t('layerCountPrefix') }}{{ layers.length }} {{ t('layerCountUnit') }}  |  {{ Math.round(viewZoom * 100) }}%</span>
    </div>
    <!-- ── Canvas + toolbar ───────────────────────────── -->
    <div class="app-body">
    <div class="main">
      <div class="canvas-area" ref="wrapperRef"
        :style="{ background: canvasBg }"
        :class="[canvasCursorClass, { 'has-brush-cursor': brushCursorStyle }]"
        @mousemove="onPointerMove" @mouseup="onPointerUp" @mouseleave="onPointerLeave">
        <div class="canvas-vp" :style="vpStyle">
          <canvas
            ref="canvasRef"
            class="draw-canvas"
            @mousedown="onPointerDown"
            @contextmenu.prevent
            @touchstart.prevent="onTouchStart"
            @touchmove.prevent="onTouchMove"
            @touchend.prevent="onTouchEnd"
          />
        <!-- Widget plugins (e.g. sticky notes) — each renders its own
             floating layer positioned in canvas/view coordinates. -->
        <component
          v-for="p in widgetPlugins" :key="p.id"
          :is="p.component" :plugin="p" :view-refs="widgetViewRefs" />
        <!-- Selection overlays -->
        <canvas ref="selMaskOverlayRef" class="sel-overlay sel-mask-ov" />
        <canvas ref="selBorderOverlayRef" class="sel-overlay" />
        <!-- Canvas resize handles -->
        <div class="crh crh-r"  @mousedown.stop="startCanvasResize('r',  $event)" />
        <div class="crh crh-b"  @mousedown.stop="startCanvasResize('b',  $event)" />
        <div class="crh crh-br" @mousedown.stop="startCanvasResize('br', $event)" />
        <div v-if="canvasResizeDragging" class="crh-preview"
          :style="{ width: canvasDragW + 'px', height: canvasDragH + 'px' }">
          <span class="crh-label">{{ canvasDragW }} × {{ canvasDragH }}</span>
        </div>
        </div><!-- /.canvas-vp -->

        <!-- Brush-size hover cursor: screen-space (not canvas-vp), so it stays
             a plain circle regardless of canvas rotation/zoom. -->
        <div v-if="brushCursorStyle" class="brush-cursor" :style="brushCursorStyle" />

        <!-- Text input overlay: outside canvas-vp, positioned in screen coords.
             Placement div top = textScreenPos.y - TEXT_HEADER_H so textarea top == textScreenPos.y -->
        <div v-if="textActive" class="text-placement"
          :style="{ left: (textScreenPos.x - 8) + 'px', top: (textScreenPos.y - 24) + 'px' }"
          @mousedown.stop @touchstart.stop>
          <div class="text-header"
            @mousedown.prevent.stop="startTextDrag"
            @touchstart.prevent.stop="startTextDragTouch">
            <span class="text-header-icon">⠿</span>
            <span class="text-header-hint">Ctrl+Enter ✓ &nbsp; Esc ✕</span>
          </div>
          <textarea
            ref="textInputRef"
            v-model="textValue"
            class="text-ta"
            :style="{
              fontSize:   Math.max(12, fontSize * fitScale) + 'px',
              fontFamily: fontFamily,
              fontWeight: fontBold   ? 'bold'   : 'normal',
              fontStyle:  fontItalic ? 'italic' : 'normal',
              color:      currentColor,
              opacity:    strokeOpacity / 100,
              lineHeight: 1.2,
            }"
            @keydown.esc.prevent="cancelText"
            @keydown.enter.ctrl.prevent="commitText"
            @input="autoResizeTextarea"
            @mousedown.stop @touchstart.stop
          />
        </div>
      </div>
    </div>

    <!-- ── Layer panel ────────────────────────────────── -->
    <div class="layer-panel"
      :class="{ collapsed: !isPanelOpen, 'lp-left': toolbarSide === 'left', 'lp-resizing': panelResizing }"
      :style="isPanelOpen ? { width: paintStore.layerPanelWidth + 'px' } : {}">
      <div v-if="isPanelOpen" class="lp-resize-handle"
        @mousedown.stop="startPanelResize" @touchstart.prevent.stop="startPanelResizeTouch"
        :title="t('resizeLayerPanel')" />
      <div class="panel-inner">
        <div class="panel-header">
          <span class="panel-title">{{ t('layers') }}</span>
          <div class="panel-actions">
            <button @click="addLayer"          :title="t('addLayer')"><Plus :size="14" /></button>
            <button @click="duplicateLayer"    :title="t('duplicateLayer')"><Copy :size="14" /></button>
            <button @click="mergeDown"         :title="t('mergeDown')" :disabled="activeIndex <= 0 || !isLayerEditable(activeLayer) || !isLayerEditable(layers[activeIndex - 1])"><ArrowDownToLine :size="14" /></button>
            <button @click="deleteActiveLayer" :title="t('deleteLayer')" :disabled="layers.length <= 1 || !isLayerEditable(activeLayer)"><Trash2 :size="14" /></button>
          </div>
        </div>
        <div class="layer-list">
          <div
            v-for="layer in displayedLayers"
            :key="layer.id"
            class="layer-item"
            :class="{ active: layer.id === activeLayerId, 'lp-readonly': !isLayerEditable(layer) }"
            :title="!isLayerEditable(layer) && isSyncActive && layer.ownerId && layer.ownerId !== myIdentity.id ? t('layerOwnedByOther') : undefined"
            @click="activeLayerId = layer.id"
          >
            <div class="layer-controls">
              <button class="lc-btn"
                :style="{ visibility: layer.id !== activeLayerId ? 'hidden' : 'visible' }"
                @click.stop="moveUp"
                :disabled="activeIndex >= layers.length - 1 || !isLayerEditable(layer)" :title="t('moveUp')">
                <ChevronUp :size="13" /></button>
              <button class="lc-btn"
                :style="{ visibility: layer.id !== activeLayerId || editingId === layer.id ? 'hidden' : 'visible' }"
                @click.stop="isLayerEditable(layer) && (editingId = layer.id)"
                :disabled="!isLayerEditable(layer)" :title="t('rename')">
                <Pen :size="11" /></button>
              <button class="lc-btn"
                :style="{ visibility: layer.id !== activeLayerId ? 'hidden' : 'visible' }"
                @click.stop="moveDown"
                :disabled="activeIndex <= 0 || !isLayerEditable(layer)" :title="t('moveDown')">
                <ChevronDown :size="13" /></button>
              <button class="lc-btn"
                :style="{ visibility: layer.id !== activeLayerId ? 'hidden' : 'visible' }"
                @click.stop="toggleVisible(layer)"
                :disabled="!isLayerEditable(layer)"
                :title="layer.visible ? t('hideLayer') : t('showLayer')">
                <Eye v-if="layer.visible" :size="11" />
                <EyeOff v-else :size="11" style="opacity:0.4" />
              </button>
              <button v-if="canToggleLock(layer)" class="lc-btn"
                :style="{ visibility: layer.id !== activeLayerId ? 'hidden' : 'visible' }"
                @click.stop="toggleLock(layer)"
                :title="layer.locked ? t('unlockLayer') : t('lockLayer')">
                <Lock v-if="layer.locked" :size="11" />
                <Unlock v-else :size="11" style="opacity:0.4" />
              </button>
            </div>
            <div style="position:relative">
              <canvas
                class="thumb"
                :ref="el => { if (el) thumbRefs[layer.id] = el; else delete thumbRefs[layer.id] }"
                width="44" height="33"
              />
              <div v-if="!isLayerEditable(layer)"
                style="position:absolute;top:-4px;left:-4px;background:#333;border-radius:50%;width:14px;height:14px;display:flex;align-items:center;justify-content:center;border:1px solid rgba(255,255,255,0.4)">
                <Lock :size="9" style="color:#ccc" />
              </div>
              <div v-if="isSyncActive && layerParticipants(layer.id).length"
                style="position:absolute;bottom:-4px;right:-4px;display:flex;gap:1px">
                <span v-for="p in layerParticipants(layer.id)" :key="p.socketId"
                  :title="identityName(p.identity)"
                  :style="{ background: p.identity?.color || '#888', borderRadius: '50%', width: '14px', height: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '9px', border: '1px solid rgba(0,0,0,0.4)' }">
                  {{ p.identity?.emoji }}
                </span>
              </div>
            </div>
            <div class="layer-meta">
              <input
                v-if="editingId === layer.id"
                v-model="layer.name"
                class="name-input"
                @blur="editingId = null"
                @keydown.enter="editingId = null"
                @click.stop
                :ref="el => el && nextTick(() => el.focus())"
              />
              <span v-else class="layer-name">
                {{ layer.name }}
              </span>
              <div class="op-row">
                <input
                  type="range" min="0" max="100"
                  v-model.number="layer.opacity"
                  class="op-slider"
                  :disabled="!isLayerEditable(layer)"
                  @input="requestComposite(layer.id)"
                  @change="saveHistory([])"
                />
                <div class="op-val-wrap">
                  <input type="number" class="op-val-input" min="0" max="100"
                    :value="layer.opacity"
                    :disabled="!isLayerEditable(layer)"
                    @change="layer.opacity = Math.max(0, Math.min(100, parseInt($event.target.value) || 0)); $event.target.value = layer.opacity; composite(undefined, true); saveHistory([])"
                    @keydown.enter.stop="$event.target.blur()"
                    @focus.stop="$event.target.select()"
                    @mousedown.stop @touchstart.stop
                  /><span class="op-unit">%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Vertical toolbar (rightmost / leftmost) ──── -->
    <aside class="toolbar" :class="{ 'tb-left': toolbarSide === 'left' }">
      <input ref="importInputRef" type="file" accept="image/*" style="display:none" @change="onImportFile" />
      <input ref="projectInputRef" type="file" accept=".atelier,application/json" style="display:none" @change="onProjectFile" />

      <!-- Core toolbar buttons: order + visibility (and user-added
           separators) are configurable from Settings → Toolbar (drag to
           reorder, on/off to hide, separators can be added/deleted there). -->
      <template v-for="item in visibleToolbarItems" :key="item.id">
        <div v-if="item.kind === 'separator'" class="tb-sep" />
        <button v-else class="tool-btn"
          :class="[item.extraClass, { active: toolbarItemActive(item) }]"
          :disabled="item.isDisabled?.()"
          :ref="el => { if (item.trigger) toolbarTriggerEls[item.id] = el }"
          @click.stop="toolbarItemClick(item)"
          :title="t(item.labelKey)">
          <template v-if="item.render === 'swatch'">
            <div class="ts-fill"   :style="{ background: fillColor }" />
            <div class="ts-stroke" :style="{ background: currentColor }" />
          </template>
          <component v-else :is="item.icon()" :size="16" />
        </button>
      </template>

      <!-- Selection controls (visible only when selection is active) -->
      <template v-if="selActive">
        <div class="tb-sep" />
        <button class="tool-btn sel-ctrl-cancel" @click="cancelSelection"    :title="t('selDeselect')"><X :size="16" /></button>
        <button v-if="!selDrawMode" class="tool-btn sel-ctrl-mask" @click="switchToDrawFromSel" :title="t('selToMask')"><PenLine :size="16" /></button>
      </template>
      <!-- SelPen commit button -->
      <template v-if="selPaintActive">
        <div class="tb-sep" />
        <button class="tool-btn" @click="commitSelPaint" :title="t('selPenCommit')"><SquareDashedMousePointer :size="16" /></button>
      </template>

      <!-- Settings — always pinned to the bottom and never hideable, so
           there's always a way back into Settings to re-show/reorder
           anything else. -->
      <div class="tb-bottom">
        <div class="tb-sep" />
        <button class="tool-btn" :class="{ active: settingsPopupOpen }" @click.stop="toggleSettingsPopup" :title="t('settings')"><Settings :size="16" /></button>
      </div>
    </aside>
    </div><!-- /.app-body -->

    <!-- ── All popups (Teleport to body) ─────────────── -->
    <Teleport to="body">
      <!-- Color popup -->
      <FloatingPopup
        ref="cpRef"
        :open="colorPopupOpen"
        @update:open="colorPopupOpen = $event"
        :title="t('palette')"
        :zIndex="cpZ"
        @bring-to-front="bringCpToFront"
        :width="cpWidth"
        @update:width="cpWidth = $event"
        :min-width="230"
        resizable
      >
        <template #icon>
          <div class="cpf-fill"   :style="{ background: fillColor }" />
          <div class="cpf-stroke" :style="{ background: currentColor }" />
        </template>
        <div class="cp-tabs">
          <button class="cp-tab" :class="{ active: activeColorTarget === 'stroke' }"
            @click="activeColorTarget = 'stroke'">
            <span class="cp-tab-dot" :style="{ background: currentColor }" />{{ t('strokeTab') }}
          </button>
          <button class="cp-tab" :class="{ active: activeColorTarget === 'fill' }"
            @click="activeColorTarget = 'fill'">
            <span class="cp-tab-dot" :style="{ background: fillColor }" />{{ t('fillTab') }}
          </button>
          <button class="cp-swap" @click="swapColors" :title="t('swapColors')"><ArrowLeftRight :size="14" /></button>
          <input type="color" :value="activeColor"
            @input="e => selectColor(e.target.value)" class="cp-picker" :title="t('customColor')" />
        </div>
        <div class="cp-mode">
          <button :class="{ active: colorMode === 'palette' }" @click="colorMode = 'palette'">{{ t('paletteMode') }}</button>
          <button :class="{ active: colorMode === 'wheel' }"   @click="colorMode = 'wheel'">{{ t('wheelMode') }}</button>
        </div>
        <div v-if="colorMode === 'palette'" class="cp-palette">
          <button class="cp-dot cp-dot-add" @click="addToUserPalette"
            :title="t('addColor') + ' ' + activeColor">＋</button>
          <button v-for="c in userPalette" :key="c" class="cp-dot"
            :style="{ background: c, boxShadow: activeColor === c ? '0 0 0 2px #7c7cff' : 'none' }"
            @click="selectColor(c)"
            @contextmenu.prevent.stop="removeFromUserPalette(c)"
            :title="c + ' (' + t('rightClickDel') + ')'" />
        </div>
        <div v-if="colorMode === 'wheel'" class="cp-wheel">
          <canvas ref="svCanvasRef" class="sv-canvas" width="184" height="110"
            @mousedown="onSvDown" @mousemove="onSvMove" @mouseup="onSvUp" @mouseleave="onSvUp"
            @touchstart.prevent="onSvTouchStart" @touchmove.prevent="onSvTouchMove" @touchend.prevent="onSvUp"
          />
          <input type="range" min="0" max="360" v-model.number="hsvH"
            class="hue-slider" @input="onHueInput" />
        </div>
      </FloatingPopup>

      <!-- Brush popup -->
      <FloatingPopup
        ref="bpRef"
        :open="brushPopupOpen"
        @update:open="brushPopupOpen = $event"
        :title="t('brushSettings')"
        :zIndex="bpZ"
        @bring-to-front="bringBpToFront"
        :width="220"
      >
        <template #icon>
          <component :is="currentToolComp" :size="16" />
        </template>
        <div class="bp-tool-wrap">
          <button ref="bpToolToggleRef" class="bp-tool-toggle" @click.stop="toggleBpTools" @mousedown.stop @touchstart.stop>
            <span class="bp-tool-icon"><component :is="currentToolComp" :size="15" /></span>
            <span class="bp-tool-label">{{ toolLabel }}</span>
            <ChevronDown :size="12" :style="{ transform: bpToolsExpanded ? 'rotate(180deg)' : '', transition: 'transform 0.15s' }" />
          </button>
          <div v-if="bpToolsExpanded" class="bp-tool-list" :class="{ 'drop-up': bpDropUp }">
            <button
              v-for="tool in tools" :key="tool.id"
              class="bp-tool" :class="{ active: currentTool === tool.id }"
              @click.stop="selectTool(tool.id); bpToolsExpanded = false"
              @touchstart.stop
            >
              <span class="bp-tool-icon"><component :is="tool.comp" :size="15" /></span>
              <span class="bp-tool-label">{{ t(tool.labelKey) }}</span>
              <span class="bp-tool-key">{{ tool.key }}</span>
            </button>
          </div>
        </div>
        <div class="bp-sliders">
          <div class="bp-row">
            <span class="bp-label">{{ t('brushSize') }}</span>
            <input type="range" min="1" max="200" v-model.number="lineWidth" class="bp-slider" @mousedown.stop @touchstart.stop />
            <div class="bp-val-wrap">
              <input type="number" class="bp-val-input" min="1" max="200"
                :value="lineWidth"
                @change="lineWidth = Math.max(1, Math.min(200, parseInt($event.target.value) || 1)); $event.target.value = lineWidth"
                @keydown.enter.stop="$event.target.blur()"
                @focus.stop="$event.target.select()"
                @mousedown.stop @touchstart.stop />
            </div>
          </div>
          <!-- Hardness/Flow only mean something for an actual brush plugin
               (pen/brush/eraser/airbrush) — line/rect/circle/mix/etc. share
               Size+Opacity above but have no dab tip or per-pass build-up. -->
          <div v-if="isBrushPluginTool(currentTool)" class="bp-row">
            <span class="bp-label">{{ t('hardness') }}</span>
            <input type="range" min="0" max="100" v-model.number="brushHardness" class="bp-slider" @mousedown.stop @touchstart.stop />
            <div class="bp-val-wrap">
              <input type="number" class="bp-val-input" min="0" max="100"
                :value="brushHardness"
                @change="brushHardness = Math.max(0, Math.min(100, parseInt($event.target.value) || 0)); $event.target.value = brushHardness"
                @keydown.enter.stop="$event.target.blur()"
                @focus.stop="$event.target.select()"
                @mousedown.stop @touchstart.stop /><span class="bp-unit">%</span>
            </div>
          </div>
          <div class="bp-row">
            <span class="bp-label">{{ t('opacity') }}</span>
            <input type="range" min="0" max="100" v-model.number="strokeOpacity" class="bp-slider" @mousedown.stop @touchstart.stop />
            <div class="bp-val-wrap">
              <input type="number" class="bp-val-input" min="0" max="100"
                :value="strokeOpacity"
                @change="strokeOpacity = Math.max(0, Math.min(100, parseInt($event.target.value) || 0)); $event.target.value = strokeOpacity"
                @keydown.enter.stop="$event.target.blur()"
                @focus.stop="$event.target.select()"
                @mousedown.stop @touchstart.stop /><span class="bp-unit">%</span>
            </div>
          </div>
          <div v-if="isBrushPluginTool(currentTool)" class="bp-row">
            <span class="bp-label">{{ t('flow') }}</span>
            <input type="range" min="0" max="100" v-model.number="brushFlow" class="bp-slider" @mousedown.stop @touchstart.stop />
            <div class="bp-val-wrap">
              <input type="number" class="bp-val-input" min="0" max="100"
                :value="brushFlow"
                @change="brushFlow = Math.max(0, Math.min(100, parseInt($event.target.value) || 0)); $event.target.value = brushFlow"
                @keydown.enter.stop="$event.target.blur()"
                @focus.stop="$event.target.select()"
                @mousedown.stop @touchstart.stop /><span class="bp-unit">%</span>
            </div>
          </div>
        </div>
      </FloatingPopup>

      <!-- Magic Wand popup -->
      <FloatingPopup
        ref="wdRef"
        :open="wandPopupOpen"
        @update:open="wandPopupOpen = $event"
        :title="t('tool_magic_wand')"
        :zIndex="wdZ"
        @bring-to-front="bringWdToFront"
        :width="220"
      >
        <template #icon><Wand2 :size="16" /></template>
        <div class="bp-sliders">
          <div class="bp-row">
            <span class="bp-label">{{ t('wandTolerance') }}</span>
            <input type="range" min="0" max="128" v-model.number="wandTolerance" class="bp-slider" @mousedown.stop @touchstart.stop />
            <div class="bp-val-wrap">
              <input type="number" class="bp-val-input" min="0" max="128"
                :value="wandTolerance"
                @change="wandTolerance = Math.max(0, Math.min(128, parseInt($event.target.value) || 0)); $event.target.value = wandTolerance"
                @keydown.enter.stop="$event.target.blur()"
                @focus.stop="$event.target.select()"
                @mousedown.stop @touchstart.stop />
            </div>
          </div>
        </div>
      </FloatingPopup>

      <!-- Text popup -->
      <FloatingPopup
        ref="txRef"
        :open="textPopupOpen"
        @update:open="textPopupOpen = $event"
        :title="t('tool_text')"
        :zIndex="txZ"
        @bring-to-front="bringTxToFront"
        :width="220"
      >
        <template #icon><Type :size="16" /></template>
        <div class="bp-sliders">
          <div class="bp-row">
            <span class="bp-label">{{ t('fontSize') }}</span>
            <input type="range" min="8" max="300" v-model.number="fontSize" class="bp-slider" @mousedown.stop @touchstart.stop />
            <div class="bp-val-wrap">
              <input type="number" class="bp-val-input" min="8" max="300"
                :value="fontSize"
                @change="fontSize = Math.max(8, Math.min(300, parseInt($event.target.value) || 8)); $event.target.value = fontSize"
                @keydown.enter.stop="$event.target.blur()"
                @focus.stop="$event.target.select()"
                @mousedown.stop @touchstart.stop />
            </div>
          </div>
          <div class="bp-row">
            <span class="bp-label">{{ t('opacity') }}</span>
            <input type="range" min="0" max="100" v-model.number="strokeOpacity" class="bp-slider" @mousedown.stop @touchstart.stop />
            <div class="bp-val-wrap">
              <input type="number" class="bp-val-input" min="0" max="100"
                :value="strokeOpacity"
                @change="strokeOpacity = Math.max(0, Math.min(100, parseInt($event.target.value) || 0)); $event.target.value = strokeOpacity"
                @keydown.enter.stop="$event.target.blur()"
                @focus.stop="$event.target.select()"
                @mousedown.stop @touchstart.stop /><span class="bp-unit">%</span>
            </div>
          </div>
          <div class="bp-row">
            <span class="bp-label">{{ t('fontFamily') }}</span>
            <div class="bp-font-btns">
              <button v-for="f in FONT_FAMILIES" :key="f.value"
                class="bp-font-btn" :class="{ active: fontFamily === f.value }"
                @mousedown.prevent="fontFamily = f.value">{{ f.label }}</button>
            </div>
          </div>
          <div class="bp-row">
            <button class="bp-style-btn" :class="{ active: fontBold }"
              @mousedown.prevent="fontBold = !fontBold"><Bold :size="14" /></button>
            <button class="bp-style-btn" :class="{ active: fontItalic }"
              @mousedown.prevent="fontItalic = !fontItalic"><Italic :size="14" /></button>
          </div>
        </div>
      </FloatingPopup>

      <!-- Settings modal — centered, blurred backdrop, same pattern as the
           changelog modal, with its own top-level tab bar per section. -->
      <Transition name="guide-fade">
        <div v-if="settingsPopupOpen" class="ipfs-guide-overlay st-overlay" @click.self="settingsPopupOpen = false" @mousedown.stop @touchstart.stop>
          <div class="ipfs-guide-card st-card" @click.stop @mousedown.stop>
            <div class="st-header">
              <span class="st-header-title">{{ t('settings') }}</span>
              <button class="ipfs-guide-close st-close" @click="settingsPopupOpen = false">✕</button>
            </div>
            <div class="st-tabs">
              <button class="st-tab" :class="{ active: settingsTab === 'canvas' }"   @click="settingsTab = 'canvas'">{{ t('settingsTabCanvas') }}</button>
              <button class="st-tab" :class="{ active: settingsTab === 'general' }"  @click="settingsTab = 'general'">{{ t('settingsTabGeneral') }}</button>
              <button class="st-tab" :class="{ active: settingsTab === 'toolbar' }"  @click="settingsTab = 'toolbar'">{{ t('settingsTabToolbar') }}</button>
            </div>
            <div class="st-body">
              <template v-if="settingsTab === 'canvas'">
                <div class="sp-title">{{ t('canvasSize') }}</div>
                <div class="csp-preset-list">
                  <div class="csp-preset-group">Social / Mobile</div>
                  <button class="csp-preset-btn" @click="newCanvasW=1080; newCanvasH=1920">1080 × 1920 <span>Stories 9:16</span></button>
                  <button class="csp-preset-btn" @click="newCanvasW=1080; newCanvasH=1350">1080 × 1350 <span>Portrait 4:5</span></button>
                  <button class="csp-preset-btn" @click="newCanvasW=1080; newCanvasH=1080">1080 × 1080 <span>Square 1:1</span></button>
                  <button class="csp-preset-btn" @click="newCanvasW=1920; newCanvasH=1080">1920 × 1080 <span>Landscape 16:9</span></button>
                  <button class="csp-preset-btn" @click="newCanvasW=1280; newCanvasH=720">1280 × 720 <span>HD 16:9</span></button>
                  <div class="csp-preset-group">Print (px @300dpi)</div>
                  <button class="csp-preset-btn" @click="newCanvasW=2480; newCanvasH=3508">2480 × 3508 <span>A4 Portrait</span></button>
                  <button class="csp-preset-btn" @click="newCanvasW=3508; newCanvasH=2480">3508 × 2480 <span>A4 Landscape</span></button>
                  <button class="csp-preset-btn" @click="newCanvasW=2551; newCanvasH=3579">2551 × 3579 <span>Letter Portrait</span></button>
                  <button class="csp-preset-btn" @click="newCanvasW=3579; newCanvasH=2551">3579 × 2551 <span>Letter Landscape</span></button>
                  <div class="csp-preset-group">Screen</div>
                  <button class="csp-preset-btn" @click="newCanvasW=1920; newCanvasH=1080">1920 × 1080 <span>FHD</span></button>
                  <button class="csp-preset-btn" @click="newCanvasW=2560; newCanvasH=1440">2560 × 1440 <span>QHD</span></button>
                  <button class="csp-preset-btn" @click="newCanvasW=3840; newCanvasH=2160">3840 × 2160 <span>4K UHD</span></button>
                  <button class="csp-preset-btn" @click="newCanvasW=2732; newCanvasH=2048">2732 × 2048 <span>iPad Pro</span></button>
                </div>
                <div class="csp-row">
                  <label>W</label>
                  <input type="number" v-model.number="newCanvasW" class="csp-input" min="1" max="8192"
                    @mousedown.stop @touchstart.stop />
                </div>
                <div class="csp-row">
                  <label>H</label>
                  <input type="number" v-model.number="newCanvasH" class="csp-input" min="1" max="8192"
                    @mousedown.stop @touchstart.stop />
                </div>
                <button class="csp-apply" @click="applyCanvasSize">{{ t('apply') }}</button>
                <div class="sp-divider" />
                <div class="sp-title">{{ t('canvasBg') }}</div>
                <div class="sp-presets">
                  <button
                    v-for="c in bgPresets" :key="c"
                    class="sp-preset-dot"
                    :style="{ background: c, boxShadow: canvasBg === c ? '0 0 0 2px #6060cc' : 'inset 0 0 0 1px rgba(255,255,255,0.15)' }"
                    @click="canvasBg = c"
                    :title="c"
                  />
                </div>
                <div class="sp-custom">
                  <span class="sp-label">{{ t('custom') }}</span>
                  <input type="color" :value="canvasBg" @input="e => canvasBg = e.target.value" class="sp-picker" />
                  <span class="sp-hex">{{ canvasBg }}</span>
                </div>
              </template>

              <template v-else-if="settingsTab === 'general'">
                <div class="sp-lang">
                  <span class="sp-label">{{ t('language') }}</span>
                  <div class="sp-lang-btns">
                    <button :class="{ active: locale === 'en' }" @click="setLocale('en')">EN</button>
                    <button :class="{ active: locale === 'zh' }" @click="setLocale('zh')">中文</button>
                  </div>
                </div>
                <div class="sp-lang">
                  <span class="sp-label">{{ t('toolbarPosition') }}</span>
                  <div class="sp-lang-btns">
                    <button :class="{ active: toolbarSide === 'left' }"  @click="toolbarSide = 'left'">{{ t('toolbarLeft') }}</button>
                    <button :class="{ active: toolbarSide === 'right' }" @click="toolbarSide = 'right'">{{ t('toolbarRight') }}</button>
                  </div>
                </div>
              </template>

              <template v-else-if="settingsTab === 'toolbar'">
                <div class="sp-title">{{ t('settingsTabToolbar') }}</div>
                <div class="tbl-hint">{{ t('toolbarCustomizeHint') }}</div>
                <button class="tbl-add-btn" @click="toolbarAddOpen = !toolbarAddOpen">
                  <Plus :size="13" /> {{ t('toolbarAdd') }}
                </button>
                <div v-if="toolbarAddOpen" class="tbl-add-list">
                  <button class="tbl-add-item" @click="addToolbarSeparator">
                    <span class="tbl-add-item-icon">┃</span> {{ t('toolbarSeparator') }}
                  </button>
                  <button v-for="item in hiddenToolbarItemsForAdd" :key="item.id" class="tbl-add-item" @click="setToolbarItemHidden(item.id, false)">
                    <span class="tbl-add-item-icon"><component :is="item.icon()" :size="14" /></span> {{ t(item.labelKey) }}
                  </button>
                </div>
                <div class="tbl-list">
                  <div v-for="item in visibleToolbarItems" :key="item.id" class="tbl-row"
                    :class="{ dragging: item.id === tblDragId, 'drag-over': item.id === tblDragOverId, 'tbl-row-sep': item.kind === 'separator' }"
                    draggable="true"
                    @dragstart="tblDragStart(item.id)"
                    @dragenter.prevent="tblDragEnter(item.id)"
                    @dragover.prevent
                    @dragleave="tblDragLeave(item.id)"
                    @drop="tblDrop(item.id)">
                    <span class="tbl-handle"><GripVertical :size="14" /></span>
                    <template v-if="item.kind === 'separator'">
                      <span class="tbl-sep-label">{{ t('toolbarSeparator') }}</span>
                    </template>
                    <template v-else>
                      <span class="tbl-icon">
                        <template v-if="item.render === 'swatch'">
                          <div class="ts-fill"   :style="{ background: fillColor }" />
                          <div class="ts-stroke" :style="{ background: currentColor }" />
                        </template>
                        <component v-else :is="item.icon()" :size="15" />
                      </span>
                      <span class="tbl-name">{{ t(item.labelKey) }}</span>
                    </template>
                    <button class="tbl-del"
                      @click="item.kind === 'separator' ? deleteToolbarSeparator(item.id) : setToolbarItemHidden(item.id, true)"
                      :title="t('toolbarDeleteItem')"><Trash2 :size="14" /></button>
                  </div>
                </div>

                <div class="sp-divider" />
                <div class="sp-title">{{ t('toolListTitle') }}</div>
                <div class="tbl-hint">{{ t('toolListHint') }}</div>
                <button class="tbl-add-btn" @click="toolListAddOpen = !toolListAddOpen">
                  <Plus :size="13" /> {{ t('toolbarAdd') }}
                </button>
                <div v-if="toolListAddOpen" class="tbl-add-list">
                  <button v-for="d in hiddenToolListItemsForAdd" :key="d.id" class="tbl-add-item" @click="setToolListItemHidden(d.id, false)">
                    <span class="tbl-add-item-icon"><component :is="d.comp" :size="14" /></span> {{ t(d.labelKey) }}
                  </button>
                  <div v-if="!hiddenToolListItemsForAdd.length" class="tbl-add-empty">{{ t('toolbarAddAllShown') }}</div>
                </div>
                <div class="tbl-list">
                  <div v-for="d in visibleToolListItems" :key="d.id" class="tbl-row"
                    :class="{ dragging: d.id === tlDragId, 'drag-over': d.id === tlDragOverId }"
                    draggable="true"
                    @dragstart="tlDragStart(d.id)"
                    @dragenter.prevent="tlDragEnter(d.id)"
                    @dragover.prevent
                    @dragleave="tlDragLeave(d.id)"
                    @drop="tlDrop(d.id)">
                    <span class="tbl-handle"><GripVertical :size="14" /></span>
                    <span class="tbl-icon"><component :is="d.comp" :size="15" /></span>
                    <span class="tbl-name">{{ t(d.labelKey) }}</span>
                    <button class="tbl-del" @click="setToolListItemHidden(d.id, true)" :title="t('toolbarDeleteItem')"><Trash2 :size="14" /></button>
                  </div>
                </div>
              </template>
            </div>
          </div>
        </div>
      </Transition>

      <!-- File management popup -->
      <FloatingPopup
        ref="fpRef"
        :open="filePopupOpen"
        @update:open="filePopupOpen = $event"
        :title="t('fileManagement')"
        :zIndex="fpZ"
        @bring-to-front="bringFpToFront"
        :width="240"
      >
        <template #icon><Folder :size="16" /></template>
        <div style="display:flex;flex-direction:column;gap:8px">
          <div class="fp-section">{{ t('project') }}</div>
          <div class="fp-row">
            <button class="fp-btn" @click="newProject">{{ t('newProject') }}</button>
            <button class="fp-btn" @click="triggerProjectImport">{{ t('loadProject') }}</button>
            <button class="fp-btn" @click="onSaveProject">{{ t('saveProject') }}</button>
          </div>
          <div class="fp-section">{{ t('imageSection') }}</div>
          <button class="fp-full-btn" @click="triggerImport">{{ t('importImage') }}</button>
          <div class="fp-section fp-section-sm">{{ t('exportImage') }}</div>
          <div class="ep-formats">
            <button :class="{ active: exportFormat === 'png-alpha' }" @click="exportFormat = 'png-alpha'">{{ t('formatPngAlpha') }}</button>
            <button :class="{ active: exportFormat === 'png' }"       @click="exportFormat = 'png'">{{ t('formatPng') }}</button>
            <button :class="{ active: exportFormat === 'jpg' }"       @click="exportFormat = 'jpg'">{{ t('formatJpeg') }}</button>
            <button :class="{ active: exportFormat === 'webp' }"      @click="exportFormat = 'webp'">{{ t('formatWebp') }}</button>
          </div>
          <div v-if="exportFormat === 'jpg' || exportFormat === 'webp'" class="ep-quality">
            <span class="ep-label">{{ t('exportQuality') }}</span>
            <input type="range" min="1" max="100" v-model.number="exportQuality" class="ep-slider" />
            <div class="bp-val-wrap">
              <input type="number" class="bp-val-input" min="1" max="100"
                :value="exportQuality"
                @change="exportQuality = Math.max(1, Math.min(100, parseInt($event.target.value) || 1)); $event.target.value = exportQuality"
                @keydown.enter.stop="$event.target.blur()"
                @focus.stop="$event.target.select()"
                @mousedown.stop @touchstart.stop /><span class="bp-unit">%</span>
            </div>
          </div>
          <button class="ep-btn" @click="doExportImage">{{ t('export') }}</button>
        </div>
      </FloatingPopup>

      <!-- IPFS Backup popup -->
      <FloatingPopup
        ref="bkRef"
        :open="backupPopupOpen"
        @update:open="backupPopupOpen = $event"
        :title="t('cloudPanel')"
        :zIndex="bkZ"
        @bring-to-front="bringBkToFront"
        :width="260"
      >
        <template #icon><CloudUpload :size="16" /></template>
        <div style="display:flex;flex-direction:column;gap:8px">

          <!-- Tab switcher -->
          <div class="sp-lang-btns">
            <button :class="{ active: backupPopupTab === 'sync' }"
              @click="backupPopupTab = 'sync'">{{ t('tabSync') }}</button>
            <button :class="{ active: backupPopupTab === 'ipfs' }"
              @click="backupPopupTab = 'ipfs'">{{ t('tabIpfs') }}</button>
          </div>

          <!-- ── Sync tab ─────────────────────────────────────── -->
          <template v-if="backupPopupTab === 'sync'">
            <template v-if="isSyncActive">
              <div class="bk-section">{{ t('collabLive') }}</div>
              <div class="bk-cid">{{ t('collabPeoplePrefix') }} {{ participants.length }}</div>
              <template v-if="isCollabSession">
                <div class="bk-label">{{ t('collabShareUrl') }}</div>
                <div class="bk-cid">{{ collabUrl }}</div>
                <button class="bk-sm-btn bk-full" :class="{ 'bk-copied': copiedKey === 'collab' }"
                  @click="copyText(collabUrl, 'collab')">
                  {{ copiedKey === 'collab' ? t('ipfsCopied') : t('ipfsCopyUrl') }}
                </button>
              </template>
            </template>
            <template v-else-if="!isWidget">
              <div class="bk-cid">{{ t('collabStartHint') }}</div>
              <button class="bk-sm-btn bk-full" @click="startCollabSession">{{ t('collabStart') }}</button>
            </template>
            <template v-else>
              <div class="bk-cid">{{ t('collabNoRoomId') }}</div>
            </template>
          </template>

          <!-- ── IPFS tab ─────────────────────────────────────── -->
          <template v-else>

          <!-- Open from CID -->
          <div class="bk-section">{{ t('ipfsOpenFromCid') }}</div>
          <input type="text" v-model="ipfsRestoreCid" class="bk-input"
            :placeholder="t('ipfsCidPlaceholder')"
            @mousedown.stop @touchstart.stop
            @keydown.enter="restoreFromCid" />
          <button class="fp-full-btn" @click="restoreFromCid"
            :disabled="!ipfsRestoreCid || ipfsStatus === 'restoring'">
            {{ ipfsStatus === 'restoring' ? t('ipfsRestoring') : t('ipfsOpenFromCid') }}
          </button>
          <div v-if="ipfsStatus === 'error'" class="bk-error">{{ ipfsStatusMsg }}</div>
          <div class="bk-divider" />

          <!-- Mode -->
          <div class="bk-section">{{ t('ipfsMode') }}</div>
          <div class="sp-lang-btns">
            <button :class="{ active: paintStore.ipfsMode === 'pinata' }"
              @click="paintStore.ipfsMode = 'pinata'">{{ t('ipfsPinata') }}</button>
            <button :class="{ active: paintStore.ipfsMode === 'local' }"
              @click="paintStore.ipfsMode = 'local'">{{ t('ipfsLocal') }}</button>
          </div>

          <!-- Pinata config -->
          <template v-if="paintStore.ipfsMode === 'pinata'">
            <div class="bk-label-row">
              <span class="bk-label">{{ t('ipfsJwt') }}</span>
              <button class="bk-guide-link" @click.stop="ipfsGuide = 'pinata'">{{ t('ipfsGuideBtn') }}</button>
            </div>
            <input type="password" v-model="paintStore.ipfsJwt" class="bk-input"
              :placeholder="t('ipfsJwtPlaceholder')" @mousedown.stop @touchstart.stop />
          </template>

          <!-- Local node config -->
          <template v-else>
            <div class="bk-label-row">
              <span class="bk-label">{{ t('ipfsNodeUrl') }}</span>
              <button class="bk-guide-link" @click.stop="ipfsGuide = 'local'">{{ t('ipfsGuideBtn') }}</button>
            </div>
            <input type="text" v-model="paintStore.ipfsNodeUrl" class="bk-input"
              :placeholder="t('ipfsNodePlaceholder')" @mousedown.stop @touchstart.stop />
          </template>

          <!-- Gateway URL -->
          <div class="bk-label">{{ t('ipfsGateway') }}</div>
          <input type="text" v-model="paintStore.ipfsGateway" class="bk-input"
            :placeholder="t('ipfsGatewayPlaceholder')" @mousedown.stop @touchstart.stop />

          <!-- Backup button -->
          <button class="bk-primary-btn" @click="backupToIPFS"
            :disabled="ipfsStatus === 'uploading' || ipfsStatus === 'restoring'">
            {{ ipfsStatus === 'uploading' ? t('ipfsUploading') : t('ipfsBackupBtn') }}
          </button>
          <div v-if="ipfsStatus === 'done' && !ipfsStatusMsg" class="bk-done">{{ t('ipfsDone') }}</div>
          <div v-if="ipfsStatus === 'error'" class="bk-error">{{ t('ipfsError') }}: {{ ipfsStatusMsg }}</div>

          <!-- Last backup CID + share URL -->
          <template v-if="ipfsLastCid">
            <div class="bk-divider" />
            <div class="bk-section">{{ t('ipfsLastBackup') }}</div>
            <div class="bk-cid">{{ ipfsLastCid }}</div>
            <div class="bk-cid-actions">
              <button class="bk-sm-btn" :class="{ 'bk-copied': copiedKey === 'cid' }"
                @click="copyText(ipfsLastCid, 'cid')">
                {{ copiedKey === 'cid' ? t('ipfsCopied') : t('ipfsCopy') }}
              </button>
              <button class="bk-sm-btn" @click="ipfsOpenLastCid">{{ t('ipfsOpen') }}</button>
            </div>
            <div class="bk-label">{{ t('ipfsShareUrl') }}</div>
            <div class="bk-cid">{{ shareUrl }}</div>
            <button class="bk-sm-btn bk-full" :class="{ 'bk-copied': copiedKey === 'url' }"
              @click="copyText(shareUrl, 'url')">
              {{ copiedKey === 'url' ? t('ipfsCopied') : t('ipfsCopyUrl') }}
            </button>
            <button v-if="isWidget" class="bk-sm-btn bk-full"
              :class="{ 'bk-copied': shareToRoomStatus === 'sent' }"
              :disabled="shareToRoomStatus === 'sending'"
              @click="shareToRoom">
              {{ shareToRoomStatus === 'sending' ? t('ipfsSharing')
                 : shareToRoomStatus === 'sent'    ? t('ipfsShared')
                 : shareToRoomStatus === 'error'   ? t('ipfsShareError')
                 : t('ipfsShareToRoom') }}
            </button>
          </template>

          </template>

        </div>
      </FloatingPopup>

      <!-- IPFS Setup Guide overlay -->
      <Transition name="guide-fade">
        <div v-if="ipfsGuide" class="ipfs-guide-overlay" @click.self="ipfsGuide = null" @mousedown.stop @touchstart.stop>
          <div class="ipfs-guide-card" @click.stop @mousedown.stop>
            <button class="ipfs-guide-close" @click="ipfsGuide = null">✕</button>

            <!-- Pinata Guide -->
            <template v-if="ipfsGuide === 'pinata'">
              <div class="ipfs-guide-title">{{ t('ipfsGuidePinataTitle') }}</div>
              <ol class="ipfs-guide-steps">
                <li>
                  {{ t('ipfsGuidePinataS1') }}&nbsp;<a href="https://app.pinata.cloud/register" target="_blank" rel="noopener" class="ipfs-guide-link-ext">pinata.cloud</a>
                </li>
                <li>{{ t('ipfsGuidePinataS2') }}</li>
                <li>{{ t('ipfsGuidePinataS3') }}</li>
                <li>{{ t('ipfsGuidePinataS4') }}</li>
                <li>{{ t('ipfsGuidePinataS5') }}</li>
              </ol>
            </template>

            <!-- Local Node Guide -->
            <template v-else-if="ipfsGuide === 'local'">
              <div class="ipfs-guide-title">{{ t('ipfsGuideLocalTitle') }}</div>
              <ol class="ipfs-guide-steps">
                <li>
                  {{ t('ipfsGuideLocalS1') }}&nbsp;<a href="https://dist.ipfs.tech/#kubo" target="_blank" rel="noopener" class="ipfs-guide-link-ext">dist.ipfs.tech</a>
                </li>
                <li>
                  {{ t('ipfsGuideLocalS2') }}<br>
                  <code class="ipfs-guide-inline">ipfs init</code>
                </li>
                <li>
                  {{ t('ipfsGuideLocalS3') }}
                  <pre class="ipfs-guide-pre">ipfs config --json API.HTTPHeaders.Access-Control-Allow-Origin '["{{ currentOrigin }}","http://localhost:5173"]'
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Methods '["PUT","POST","GET"]'
ipfs config --json API.HTTPHeaders.Access-Control-Allow-Headers '["Authorization"]'</pre>
                </li>
                <li>
                  {{ t('ipfsGuideLocalS4') }}&nbsp;<code class="ipfs-guide-inline">ipfs daemon</code>
                </li>
                <li>
                  {{ t('ipfsGuideLocalS5') }}&nbsp;<code class="ipfs-guide-inline">http://localhost:5001</code>
                </li>
              </ol>
            </template>

          </div>
        </div>
      </Transition>

      <!-- Changelog / announcement modal -->
      <Transition name="guide-fade">
        <div v-if="changelogOpen" class="ipfs-guide-overlay cl-overlay" @click.self="closeChangelog" @mousedown.stop @touchstart.stop>
          <div class="ipfs-guide-card cl-card" @click.stop @mousedown.stop>

            <div class="cl-header">
              <span class="cl-title">{{ t('changelogTitle') }}</span>
              <button class="ipfs-guide-close cl-close-x" @click="closeChangelog">✕</button>
            </div>

            <div class="cl-subheader">
              <span class="cl-version">{{ t('changelogVersion') }} {{ __APP_VERSION__ }}</span>
            </div>

            <ul class="cl-list">
              <li v-for="c in changelog" :key="c.hash" class="cl-item">
                <div class="cl-item-meta">
                  <span v-if="commitType(c.message)" class="cl-badge"
                    :style="{ background: COMMIT_TYPE_COLOR[commitType(c.message)] || '#444' }">
                    {{ commitType(c.message) }}
                  </span>
                  <span class="cl-date">{{ c.date }}</span>
                </div>
                <span class="cl-msg">{{ commitBody(c.message) }}</span>
              </li>
            </ul>

            <div class="cl-footer">
              <button class="bk-primary-btn cl-close-btn" @click="closeChangelog">
                {{ t('changelogGotIt') }}
              </button>
            </div>

          </div>
        </div>
      </Transition>

      <!-- IPFS loading overlay -->
      <div v-if="ipfsStatus === 'restoring'" class="ipfs-overlay">
        <div class="ipfs-overlay-box">
          <div class="ipfs-spinner" />
          <span>{{ t('ipfsRestoring') }}</span>
        </div>
      </div>

      <!-- Startup CID error toast -->
      <div v-if="startupErrorMsg" class="ipfs-toast" @click="startupErrorMsg = ''">
        IPFS Error: {{ startupErrorMsg }}
      </div>

      <!-- Layer limit toast -->
      <div v-if="layerLimitMsg" class="ipfs-toast" @click="layerLimitMsg = ''">
        {{ layerLimitMsg }}
      </div>

      <!-- Live collaboration presence: sits on whichever side the toolbar
           ISN'T on, so it never overlaps it. Collapsed to a stack of
           avatars by default; click to expand into the named list. -->
      <div v-if="isSyncActive && participants.length"
        :style="{ position: 'fixed', bottom: '8px', zIndex: 9998, [toolbarSide === 'right' ? 'left' : 'right']: '8px' }">

        <div v-if="!presencePanelOpen" @click="presencePanelOpen = true"
          style="display:flex;align-items:center;cursor:pointer;pointer-events:auto">
          <span v-for="(p, i) in participants.slice(0, 5)" :key="p.socketId"
            :title="isEditingMyLayer(p) ? t('layerConflictPrefix') : undefined"
            :style="{
              background: p.identity?.color || '#888', borderRadius: '50%',
              width: '22px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '12px', border: isEditingMyLayer(p) ? '2px solid #eab308' : '1.5px solid #111',
              marginLeft: i > 0 ? '-8px' : '0', zIndex: 10 - i,
            }">{{ p.identity?.emoji }}</span>
          <span v-if="participants.length > 5"
            style="margin-left:2px;font-size:11px;color:#fff;background:rgba(0,0,0,0.55);border-radius:999px;padding:2px 6px">
            +{{ participants.length - 5 }}
          </span>
        </div>

        <div v-else style="display:flex;flex-direction:column;gap:4px;align-items:stretch;pointer-events:auto">
          <div @click="presencePanelOpen = false"
            style="display:flex;justify-content:flex-end;cursor:pointer;font-size:11px;color:#aaa;padding:2px">
            {{ t('close') }} ✕
          </div>
          <div v-for="p in participants" :key="p.socketId"
            :style="{
              display: 'flex', alignItems: 'center', gap: '5px',
              background: 'rgba(0,0,0,0.55)', borderRadius: '999px',
              padding: '3px 10px 3px 4px', fontSize: '11px', color: '#fff',
              border: p.identity?.id === myIdentity.id ? '1px solid rgba(255,255,255,0.6)' : '1px solid transparent',
            }">
            <span :title="isEditingMyLayer(p) ? t('layerConflictPrefix') : undefined"
              :style="{
                background: p.identity?.color || '#888', borderRadius: '50%',
                width: '18px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '11px', border: isEditingMyLayer(p) ? '2px solid #eab308' : '2px solid transparent',
              }">
              {{ p.identity?.emoji }}
            </span>
            <span>{{ identityName(p.identity) }}{{ p.identity?.id === myIdentity.id ? ` (${t('collabYou')})` : '' }}</span>
          </div>
        </div>
      </div>

    </Teleport>
  </div>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import FloatingPopup from './FloatingPopup.vue'
import { usePaintStore } from './stores/paintStore.js'
import { t, locale, setLocale } from './i18n.js'
import { useView } from './composables/useView.js'
import { useColorWheel } from './composables/useColorWheel.js'
import { useLayers } from './composables/useLayers.js'
import {
  Pencil, Minus, Square, Circle, PaintBucket, Pipette, Eraser,
  Trash2, Undo2, Redo2, Download, Hand, RotateCcw, SquareDot,
  Layers, ChevronUp, ChevronDown, Eye, EyeOff,
  Plus, Copy, ArrowDownToLine, X, Pen, ArrowLeftRight,
  ZoomIn, ZoomOut, Settings, Upload, Folder, CloudUpload,
  SquareDashedMousePointer, LassoSelect, PenLine, Paintbrush, Move, Wand2,
  Type, Bold, Italic, Blend, Lock, Unlock, GripVertical
} from 'lucide-vue-next'
import { useIpfsBackup } from './composables/useIpfsBackup.js'
import { isWidget, isSyncActive, isCollabSession, generateCollabSessionId } from './widgetContext.js'
import { formatIdentityName } from './collabIdentity.js'
import { sendRoomMessage } from './widgetApi.js'
import { initCollabSync, waitForJoin, participants, myIdentity, syncConnected, recentEdits, RECENT_EDIT_WINDOW_MS } from './collabSync.js'
import { getPlugin, getPlugins } from './plugins/registry.js'
import './plugins/builtin/index.js'

// Perf instrumentation — active only on the atelier-dev test subdomain.
const PERF_DEBUG = /atelier-dev\./.test(window.location.hostname)

// ── Store ─────────────────────────────────────────────────
const paintStore = usePaintStore()

// ── Tool definitions ──────────────────────────────────────
// pen/brush/eraser are registered as brush-type plugins (see
// plugins/builtin/brushes.js) with `core: true` — always shown, never in
// any removable list. Everything else that can appear in the brush
// tool-list (the hardcoded shape/selection tools below, AND any other
// registered non-core brush plugin, e.g. airbrush) is one combined
// catalog the user can freely add/remove/reorder from Settings → Toolbar,
// same pattern as the main toolbar below.
const toggleableToolDefs = [
  { id: 'mix',         comp: Blend,       labelKey: 'tool_mix',          key: 'M' },
  { id: 'line',        comp: Minus,       labelKey: 'tool_line',         key: 'L' },
  { id: 'rect',        comp: Square,      labelKey: 'tool_rect',         key: 'R' },
  { id: 'circle',      comp: Circle,      labelKey: 'tool_circle',       key: 'C' },
  { id: 'fill',        comp: PaintBucket, labelKey: 'tool_fill',         key: 'F' },
  { id: 'eyedropper',  comp: Pipette,     labelKey: 'tool_eyedropper',   key: 'I' },
  { id: 'sel_pen',     comp: Paintbrush,  labelKey: 'tool_sel_pen',      key: 'W' },
  { id: 'sel_eras',    comp: Eraser,      labelKey: 'tool_sel_eras',     key: null },
]
const toolListCatalog = computed(() => [
  ...toggleableToolDefs,
  ...getPlugins('brush').filter(p => !p.core && !toggleableToolDefs.some(d => d.id === p.id)),
])

const TOOLS_LAYOUT_KEY = 'atelier-tools-layout'
function loadToolsLayout() {
  try { return JSON.parse(localStorage.getItem(TOOLS_LAYOUT_KEY) || '{}') } catch { return {} }
}
// Same { order, hidden } shape as toolbarLayout below.
const toolsLayout = reactive(loadToolsLayout())
watch(toolsLayout, () => {
  try { localStorage.setItem(TOOLS_LAYOUT_KEY, JSON.stringify(toolsLayout)) } catch {}
}, { deep: true })

const orderedToolListItems = computed(() => {
  const catalog = toolListCatalog.value
  const byId = new Map(catalog.map(i => [i.id, i]))
  const seen = new Set()
  const out = []
  for (const id of toolsLayout.order || []) {
    if (byId.has(id) && !seen.has(id)) { out.push(byId.get(id)); seen.add(id) }
  }
  for (const item of catalog) {
    if (!seen.has(item.id)) out.push(item)
  }
  return out
})
function isToolListItemHidden(id) {
  return (toolsLayout.hidden || []).includes(id)
}
function setToolListItemHidden(id, hidden) {
  const set = new Set(toolsLayout.hidden || [])
  if (hidden) set.add(id); else set.delete(id)
  toolsLayout.hidden = [...set]
}
const visibleToolListItems = computed(() =>
  orderedToolListItems.value.filter(item => !isToolListItemHidden(item.id))
)
const hiddenToolListItemsForAdd = computed(() =>
  toolListCatalog.value.filter(item => isToolListItemHidden(item.id))
)
const toolListAddOpen = ref(false)
const tlDragId     = ref(null)
const tlDragOverId = ref(null)
function tlDragStart(id) { tlDragId.value = id }
function tlDragEnter(id) { tlDragOverId.value = id }
function tlDragLeave(id) { if (tlDragOverId.value === id) tlDragOverId.value = null }
function tlDrop(targetId) {
  tlDragOverId.value = null
  if (tlDragId.value === null || tlDragId.value === targetId) return
  const ids = orderedToolListItems.value.map(i => i.id)
  const from = ids.indexOf(tlDragId.value)
  const to   = ids.indexOf(targetId)
  if (from === -1 || to === -1) return
  ids.splice(to, 0, ids.splice(from, 1)[0])
  toolsLayout.order = ids
  tlDragId.value = null
}

// pen/brush/eraser first (fixed, un-removable), then the user's ordered
// tool-list selection.
const tools = computed(() => [
  getPlugin('pen'),
  getPlugin('brush'),
  getPlugin('eraser'),
  ...visibleToolListItems.value,
].filter(Boolean))

// ── Tool state ────────────────────────────────────────────
const currentTool   = ref('pen')
const currentColor  = ref('#000000')
const fillColor     = ref('#ffffff')
const wandTolerance = ref(32)

// Per-brush-plugin settings (Size/Hardness/Opacity/Flow) — each brush
// plugin (pen/brush/eraser/airbrush/...) remembers its OWN values
// independently, seeded from that plugin's own `defaults`, so switching
// tools shows each brush's own last-used settings rather than one value
// shared across every tool. Non-brush tools (line/rect/circle/mix/
// sel_pen/sel_eras/text) don't participate in this — they keep sharing
// the plain _sharedLineWidth/_sharedOpacity refs below via lineWidth/
// strokeOpacity's fallback branch.
const brushToolSettings = reactive({}) // { [pluginId]: { size, hardness, opacity, flow } }
const DEFAULT_BRUSH_SETTINGS = { size: 4, hardness: 100, opacity: 100, flow: 100 }
function ensureBrushToolSettings(toolId) {
  if (!brushToolSettings[toolId]) {
    const plugin = getPlugin(toolId)
    brushToolSettings[toolId] = { ...DEFAULT_BRUSH_SETTINGS, ...(plugin?.defaults || {}) }
  }
  return brushToolSettings[toolId]
}
function isBrushPluginTool(toolId) {
  return getPlugin(toolId)?.type === 'brush'
}

const _sharedLineWidth = ref(4)    // Size fallback for non-brush-plugin tools
const _sharedOpacity   = ref(100)  // Opacity fallback for non-brush-plugin tools

// lineWidth/strokeOpacity stay drop-in compatible with every existing
// v-model/.value use elsewhere in this file (writable computeds behave
// like refs for both) — they just now resolve to the current tool's own
// brush settings when it's a brush plugin, and to the shared fallback
// otherwise.
const lineWidth = computed({
  get()  { return isBrushPluginTool(currentTool.value) ? ensureBrushToolSettings(currentTool.value).size : _sharedLineWidth.value },
  set(v) { if (isBrushPluginTool(currentTool.value)) ensureBrushToolSettings(currentTool.value).size = v; else _sharedLineWidth.value = v },
})
const strokeOpacity = computed({
  get()  { return isBrushPluginTool(currentTool.value) ? ensureBrushToolSettings(currentTool.value).opacity : _sharedOpacity.value },
  set(v) { if (isBrushPluginTool(currentTool.value)) ensureBrushToolSettings(currentTool.value).opacity = v; else _sharedOpacity.value = v },
})
// Hardness/Flow only exist for brush-plugin tools — no legacy shared
// fallback needed since these are new (the popup only shows them when
// isBrushPluginTool(currentTool) is true; see brushHardness/brushFlow's
// use in the template).
const brushHardness = computed({
  get()  { return ensureBrushToolSettings(currentTool.value).hardness },
  set(v) { ensureBrushToolSettings(currentTool.value).hardness = v },
})
const brushFlow = computed({
  get()  { return ensureBrushToolSettings(currentTool.value).flow },
  set(v) { ensureBrushToolSettings(currentTool.value).flow = v },
})

// ── Text tool state ───────────────────────────────────────
const textActive   = ref(false)
const textPos      = ref({ x: 0, y: 0 })
const textValue    = ref('')
const fontSize     = ref(48)
const fontFamily   = ref('sans-serif')
const fontBold     = ref(false)
const fontItalic   = ref(false)
const textInputRef = ref(null)
const FONT_FAMILIES = [
  { label: 'Sans', value: 'sans-serif' },
  { label: 'Serif', value: 'serif' },
  { label: 'Mono', value: 'monospace' },
]
const cursorPos     = ref(null)
// Raw screen-space position of the pointer within .canvas-area (unlike
// cursorPos, which is in rotated/zoomed canvas-logical coordinates) — used
// only to place the brush-size hover cursor, which should stay a plain
// screen-aligned circle regardless of canvas rotation. Shares cursorPos's
// null-on-leave lifecycle; see onPointerLeave.
const brushCursorScreen = ref(null)

const _extraTools = {
  magic_wand: { labelKey: 'tool_magic_wand', comp: Wand2 },
  text:        { labelKey: 'tool_text',       comp: Type  },
}
// Resolves a tool id against every place a "tool" can come from: the
// tools list, the small hardcoded extras above, or a widget-as-tool
// plugin (e.g. sticky notes — registered with `icon`/`label` instead of
// this file's `comp`/`labelKey` convention, hence the fallback fields).
function resolveTool(id) {
  return tools.value.find(x => x.id === id) ?? _extraTools[id] ?? getPlugin(id)
}
const toolLabel       = computed(() => { const f = resolveTool(currentTool.value); return f ? t(f.labelKey ?? f.label) : '' })
const currentToolComp = computed(() => resolveTool(currentTool.value)?.comp ?? resolveTool(currentTool.value)?.icon ?? Pencil)

// Brush button tracks last used drawing tool independently from text/magic_wand
const lastDrawTool     = ref('pen')
const lastDrawToolComp = computed(() => tools.value.find(x => x.id === lastDrawTool.value)?.comp ?? Pencil)
watch(currentTool, newTool => {
  if (tools.value.some(x => x.id === newTool)) lastDrawTool.value = newTool
  else brushPopupOpen.value = false
})
// Removing a tool-list entry (Settings → Toolbar) is a visibility change,
// not a real disable — same as hiding a toolbar button, it stays fully
// reachable (keyboard shortcut, or whatever set currentTool to it), it
// just won't show up highlighted in `tools`. So the fallback below only
// needs to catch a currentTool that isn't valid ANYWHERE — including
// toolListCatalog, which still lists hidden entries — not merely "not in
// the currently-visible list."
watch(tools, newTools => {
  const stillKnown = _extraTools[currentTool.value]
    || getPlugin(currentTool.value)
    || toolListCatalog.value.some(x => x.id === currentTool.value)
  if (!newTools.some(x => x.id === currentTool.value) && !stillKnown) {
    currentTool.value = newTools[0]?.id ?? 'pen'
  }
})

// ── Color state ───────────────────────────────────────────
const activeColorTarget = ref('stroke')
const activeColor = computed(() =>
  activeColorTarget.value === 'stroke' ? currentColor.value : fillColor.value
)
const colorMode = ref('palette')

function selectColor(c) {
  if (activeColorTarget.value === 'stroke') {
    currentColor.value = c
    if (currentTool.value === 'eraser') currentTool.value = 'pen'
  } else {
    fillColor.value = c
  }
}

function swapColors() {
  const tmp = currentColor.value
  currentColor.value = fillColor.value
  fillColor.value = tmp
}

// ── User palette ──────────────────────────────────────────
const userPalette = ref([...paintStore.userPalette])
watch(userPalette, v => { paintStore.userPalette = [...v] }, { deep: true })

function addToUserPalette() {
  const c = activeColor.value
  if (!userPalette.value.includes(c))
    userPalette.value = [c, ...userPalette.value.slice(0, 31)]
}

function removeFromUserPalette(c) {
  userPalette.value = userPalette.value.filter(x => x !== c)
}

// ── Canvas background ─────────────────────────────────────
const canvasBg  = ref(paintStore.canvasBg)
const bgPresets = ['#000000','#111111','#1e1e1e','#2a2a2a','#444444','#777777','#cccccc','#ffffff']
watch(canvasBg, v => { paintStore.canvasBg = v })

// ── Export state ──────────────────────────────────────────
const exportFormat  = ref('png')
const exportQuality = ref(90)

// ── Popup open states (declared early for useColorWheel) ──
const colorPopupOpen    = ref(false)
const brushPopupOpen    = ref(false)
const settingsPopupOpen = ref(false)
const filePopupOpen     = ref(false)
const backupPopupOpen   = ref(false)
const ipfsGuide         = ref(null)   // 'pinata' | 'local' | null

// ── Changelog ─────────────────────────────────────────────────────────────
const changelogOpen = ref(false)
const changelog     = __CHANGELOG__

function closeChangelog() {
  changelogOpen.value = false
}

const COMMIT_TYPE_COLOR = {
  feat:     '#7070dd',
  fix:      '#dd9040',
  refactor: '#888888',
  docs:     '#50aa70',
  perf:     '#40aacc',
  style:    '#888888',
  chore:    '#555555',
}

function commitType(msg) {
  const m = msg.match(/^([a-z]+)[\(:]/)
  return m ? m[1] : ''
}
function commitBody(msg) {
  return msg.replace(/^[a-z]+(\([^)]*\))?:\s*/, '')
}
const wandPopupOpen     = ref(false)
const textPopupOpen     = ref(false)

// ── Composables ───────────────────────────────────────────
const lc = useLayers({ paintStore, onCancelDraw: () => { cancelSelection(); drawing = false }, getFloatOverlay: () => selFloat })
const {
  canvasRef, thumbRefs,
  canvasLogicalW, canvasLogicalH, canvasSize,
  layers, activeLayerId, editingId, isPanelOpen,
  activeIndex, activeLayer, displayedLayers,
  history, historyIndex,
  composite, saveHistory, undo, redo,
  addLayer, duplicateLayer, deleteActiveLayer,
  toggleVisible, moveUp, moveDown, mergeDown, mergeAll, clearLayer,
  importImageLayer, getThumbnailBlob, exportProject, loadProject, resetToBlank, resizeCanvasTo,
  isLayerEditable, canToggleLock, toggleLock, layerLimitMsg,
} = lc

// composite() redraws every layer onto the display canvas — cost scales
// with layer count. Pointer-move handlers (freehand strokes, shape preview,
// mix/move/transform drags, ...) can fire far more often than the screen
// actually repaints, so calling composite() directly from them means
// redoing that full-layer redraw many times more than what's ever shown —
// with a couple dozen layers, enough to make the whole app stall while
// dragging. Coalesce those call sites to at most once per animation frame
// instead. Discrete call sites (stroke end, tool commits, undo/redo, ...)
// keep calling composite() directly so their result renders immediately,
// not a frame later.
//
// touchedIds, when the caller knows it, is forwarded to composite()'s own
// touchedIds so the (also O(layer count)) thumbnail refresh inside it stays
// scoped to whichever layer(s) this drag actually touches — pass a single
// id, an array (empty if the drag genuinely doesn't touch any layer's own
// canvas, e.g. moving a floating selection around), or omit it entirely if
// that's not knowable (composite() then falls back to refreshing every
// thumbnail, its safe default). Accumulated across however many calls land
// before the frame fires — if any of them is "unknown", the whole batch
// conservatively refreshes everything.
//
// requestComposite always skips the thumbnail refresh (skipThumbs=true):
// this is the live-drag path, called on every pointermove, and the layer
// panel isn't even visible mid-stroke. Whoever ends the drag (pointerup
// handlers etc.) calls composite(touchedIds) directly afterwards — no
// skipThumbs — to catch the thumbnail up exactly once, instead of every
// frame of the stroke.
let _compositeRAF = null
let _compositeTouched = new Set()
let _compositeTouchedAll = false
function requestComposite(touchedIds) {
  if (touchedIds === undefined) _compositeTouchedAll = true
  else for (const id of Array.isArray(touchedIds) ? touchedIds : [touchedIds]) _compositeTouched.add(id)
  if (_compositeRAF) return
  const requestedAt = PERF_DEBUG ? performance.now() : 0
  _compositeRAF = requestAnimationFrame(() => {
    _compositeRAF = null
    if (PERF_DEBUG) {
      const delay = performance.now() - requestedAt
      if (delay > 20) console.log(`[perf] requestComposite rAF delayed ${delay.toFixed(1)}ms — main thread busy`)
    }
    const ids = _compositeTouchedAll ? undefined : Array.from(_compositeTouched)
    _compositeTouched = new Set()
    _compositeTouchedAll = false
    composite(ids, true)
  })
}

const bk = useIpfsBackup({
  getProjectData: () => lc.getProjectData(canvasBg.value, userPalette.value),
  getThumbnail:   () => lc.getThumbnailBlob(),
  restoreProject: async (project) => {
    const result = await loadProject(project)
    if (result?.canvasBg)    canvasBg.value    = result.canvasBg
    if (result?.userPalette) userPalette.value = [...result.userPalette]
  },
  paintStore,
})
const { status: ipfsStatus, statusMsg: ipfsStatusMsg, lastCid: ipfsLastCid,
        lastThumbCid: ipfsLastThumbCid,
        restoreCid: ipfsRestoreCid, gatewayHint: ipfsGatewayHint,
        backupToIPFS, restoreFromCid,
        copyLastCid: ipfsCopyLastCid, openLastCid: ipfsOpenLastCid } = bk

// ── IPFS share URL + copy feedback ───────────────────────
const currentOrigin = computed(() => window.location.origin)

const shareUrl = computed(() => {
  if (!ipfsLastCid.value) return ''
  let base = `${window.location.origin}/og?cid=${ipfsLastCid.value}&v=${__APP_VERSION__}`
  const mode = paintStore.ipfsMode
  if (mode === 'pinata') base += '&gw=pinata'
  else {
    const gw = paintStore.ipfsGateway
    if (gw && gw !== 'https://ipfs.io') base += `&gw=${encodeURIComponent(gw)}`
  }
  if (ipfsLastThumbCid.value) base += `&thumb=${ipfsLastThumbCid.value}`
  return base
})

// ── Share to room (widget mode only) ─────────────────────
const shareToRoomStatus = ref('idle') // 'idle' | 'sending' | 'sent' | 'error'

async function shareToRoom() {
  if (!shareUrl.value) return
  shareToRoomStatus.value = 'sending'
  const ok = await sendRoomMessage(`${t('ipfsSharedFromAtelier')}: ${shareUrl.value}`)
  shareToRoomStatus.value = ok ? 'sent' : 'error'
  if (ok) setTimeout(() => { shareToRoomStatus.value = 'idle' }, 2000)
}

// Which sub-tab of the Cloud popup is showing, default Live Sync.
const backupPopupTab = ref('sync')

// ── Standalone collaboration session (non-widget) ────────
// Starts a new shared session: mints an id, moves the URL to /collab/<id>,
// and reloads so widgetContext.js (which reads location.pathname once, at
// module load) picks it up and connects the sync socket from a clean state.
function startCollabSession() {
  const id = generateCollabSessionId()
  window.history.pushState({}, '', `/collab/${id}`)
  window.location.reload()
}

const collabUrl = computed(() => window.location.origin + window.location.pathname)
const presencePanelOpen = ref(false)

// Renders an identity in the viewer's OWN current locale, not whatever
// locale its owner had when the identity was generated — see
// collabIdentity.js for why the name isn't just baked into the identity.
function identityName(identity) {
  return formatIdentityName(identity, locale.value)
}

// Participants (excluding self) currently on a given layer, for the tiny
// avatar badges shown on each layer thumbnail.
function layerParticipants(layerId) {
  return participants.value.filter(p => p.activeLayerId === layerId && p.identity?.id !== myIdentity.id)
}

// Whoever else has *actually edited* (not just selected) the layer the
// local user currently has active, within the last RECENT_EDIT_WINDOW_MS —
// drives a heads-up banner near the canvas, since two people drawing on one
// layer overwrite each other's work (whole-layer last-write-wins, no
// pixel-level merge). Deliberately distinct from layerParticipants() above:
// merely having a layer selected isn't worth warning about, only recent
// real edits are. `nowTick` exists purely so this recomputes as time
// passes even when no new sync events arrive (otherwise a warning would
// never clear once the window elapses without a fresh event to trigger it).
const nowTick = ref(Date.now())
let nowTickTimer = null
const activeLayerCollaborators = computed(() => {
  const cutoff = nowTick.value - RECENT_EDIT_WINDOW_MS
  const latestById = new Map()
  for (const e of recentEdits.value) {
    if (e.layerId !== activeLayerId.value) continue
    if (e.identity?.id === myIdentity.id) continue
    if (e.timestamp < cutoff) continue
    const prev = latestById.get(e.identity?.id)
    if (!prev || prev.timestamp < e.timestamp) latestById.set(e.identity?.id, e)
  }
  return Array.from(latestById.values()).map(e => e.identity)
})

// Drives the amber avatar-border highlight in the presence panel, instead
// of a separate banner — a participant who's recently edited the layer the
// local user has active right now.
function isEditingMyLayer(p) {
  return activeLayerCollaborators.value.some(id => id?.id === p.identity?.id)
}

const copiedKey       = ref('')
const startupErrorMsg = ref('')

let _layerLimitMsgTimer = null
watch(layerLimitMsg, msg => {
  clearTimeout(_layerLimitMsgTimer)
  if (msg) _layerLimitMsgTimer = setTimeout(() => { layerLimitMsg.value = '' }, 3000)
})

async function copyText(text, key) {
  try {
    await navigator.clipboard.writeText(text)
    copiedKey.value = key
    setTimeout(() => { if (copiedKey.value === key) copiedKey.value = '' }, 1800)
  } catch { /* clipboard denied */ }
}

const vw = useView(canvasLogicalW, canvasLogicalH)
const { viewX, viewY, viewR, viewZoom, fitScale, vpStyle, resetView, zoomIn, zoomOut } = vw
// Bundled (not passed as separate props) so widget-plugin components get
// the live refs, not an auto-unwrapped snapshot value — see the comment
// in StickyNotesWidget.vue for why that distinction matters.
const widgetViewRefs = { fitScale, viewR }

// Convert logical canvas point to canvas-area screen coordinates
const textScreenPos = computed(() => {
  const s   = fitScale.value
  const rad = viewR.value * Math.PI / 180
  const lx  = (textPos.value.x - canvasLogicalW.value / 2) * s
  const ly  = (textPos.value.y - canvasLogicalH.value / 2) * s
  return {
    x: vw.areaSize.w / 2 + viewX.value + lx * Math.cos(rad) - ly * Math.sin(rad),
    y: vw.areaSize.h / 2 + viewY.value + lx * Math.sin(rad) + ly * Math.cos(rad),
  }
})

const widgetPlugins = computed(() => getPlugins('widget'))

// ── Settings modal tab ──────────────────────────────────────
const settingsTab = ref('canvas')

const cw = useColorWheel({ activeColor, activeColorTarget, colorMode, colorPopupOpen, selectColor })
const { svCanvasRef, hsvH, hsvS, hsvV, onSvDown, onSvMove, onSvUp, onSvTouchStart, onSvTouchMove, onHueInput } = cw

// ── Layout refs ───────────────────────────────────────────
const wrapperRef         = ref(null)
const importInputRef       = ref(null)
const projectInputRef      = ref(null)

// ── Toolbar side ──────────────────────────────────────────
const toolbarSide = ref(localStorage.getItem('paint-toolbar-side') ?? 'right')
watch(toolbarSide, v => {
  localStorage.setItem('paint-toolbar-side', v)
  ;[cpRef, bpRef, fpRef, bkRef].forEach(r => r.value?.reset())
})

// ── Layer panel width (persisted, drag-resizable) ──────────
const panelResizing = ref(false)
let _prStartX = 0, _prStartW = 0

function startPanelResize(e) {
  panelResizing.value = true
  _prStartX = e.clientX
  _prStartW = paintStore.layerPanelWidth
  window.addEventListener('mousemove', _onPanelResizeMove)
  window.addEventListener('mouseup', _onPanelResizeUp)
  window.addEventListener('touchmove', _onPanelResizeTouchMove, { passive: false })
  window.addEventListener('touchend', _onPanelResizeUp)
}
function startPanelResizeTouch(e) { startPanelResize(e.touches[0]) }

function _onPanelResizeMove(e) {
  // The panel is screen-edge-anchored on whichever side the toolbar isn't,
  // so which direction "wider" means depends on which edge is the free one.
  const dx = e.clientX - _prStartX
  const signedDx = toolbarSide.value === 'left' ? dx : -dx
  paintStore.layerPanelWidth = Math.max(200, Math.min(_prStartW + signedDx, window.innerWidth - 120))
}
function _onPanelResizeTouchMove(e) {
  if (panelResizing.value) { e.preventDefault(); _onPanelResizeMove(e.touches[0]) }
}
function _onPanelResizeUp() {
  panelResizing.value = false
  window.removeEventListener('mousemove', _onPanelResizeMove)
  window.removeEventListener('mouseup', _onPanelResizeUp)
  window.removeEventListener('touchmove', _onPanelResizeTouchMove)
  window.removeEventListener('touchend', _onPanelResizeUp)
}

// ── Popup z-index ─────────────────────────────────────────
let _popupZ = 9999
const cpZ = ref(9999), bpZ = ref(9999), fpZ = ref(9999), bkZ = ref(9999)
const wdZ = ref(9999), txZ = ref(9999)
function bringCpToFront() { cpZ.value = ++_popupZ }
function bringBpToFront() { bpZ.value = ++_popupZ }
function bringFpToFront() { fpZ.value = ++_popupZ }
function bringBkToFront() { bkZ.value = ++_popupZ }
function bringWdToFront() { wdZ.value = ++_popupZ }
function bringTxToFront() { txZ.value = ++_popupZ }

// ── Popup refs ────────────────────────────────────────────
const cpRef = ref(null), bpRef = ref(null)
const fpRef = ref(null), bkRef = ref(null)
const wdRef = ref(null), txRef = ref(null)
const cpWidth = ref(230)

// ── Brush popup ───────────────────────────────────────────
const bpToolToggleRef = ref(null)
const bpToolsExpanded = ref(false)
const bpDropUp        = ref(false)

function toggleBpTools() {
  if (!bpToolsExpanded.value) {
    const btn = bpToolToggleRef.value
    if (btn) {
      const r = btn.getBoundingClientRect()
      bpDropUp.value = (window.innerHeight - r.bottom) < (tools.value.length * 34 + 16)
    }
  }
  bpToolsExpanded.value = !bpToolsExpanded.value
}

// ── Popup toggle functions ────────────────────────────────
// Trigger elements for popup-positioning, keyed by toolbar item id — the
// old approach (one named ref per button: fileTriggerRef, colorTriggerRef,
// ...) doesn't work once the buttons are v-for generated from a data-driven
// list (see toolbarCatalog below), so every trigger element lands in one
// map instead, written by the :ref callback on each rendered button.
const toolbarTriggerEls = {}

function closeAllPopups() {
  settingsPopupOpen.value = false
  filePopupOpen.value     = false
  backupPopupOpen.value   = false
  // wandPopupOpen and textPopupOpen intentionally excluded —
  // they should stay open while the user interacts with the canvas
}

function toggleColorPopup() {
  if (colorPopupOpen.value) { colorPopupOpen.value = false; return }
  bringCpToFront()
  closeAllPopups()
  const r = toolbarTriggerEls.color.getBoundingClientRect()
  const x = toolbarSide.value === 'left'
    ? Math.min(r.right + 6, window.innerWidth - cpWidth.value - 6)
    : Math.max(6, r.left - cpWidth.value - 6)
  cpRef.value?.initPos(x, Math.max(6, r.top))
  colorPopupOpen.value = true
}

function toggleBrushPopup() {
  const onDrawTool = tools.value.some(x => x.id === currentTool.value)
  if (!onDrawTool) {
    // Not on a drawing tool → first click just switches back to last drawing tool
    currentTool.value = lastDrawTool.value
    return
  }
  // Already on a drawing tool → toggle popup
  if (brushPopupOpen.value) { brushPopupOpen.value = false; return }
  bringBpToFront()
  const r = toolbarTriggerEls.brushSettings.getBoundingClientRect()
  const x = toolbarSide.value === 'left'
    ? Math.min(r.right + 6, window.innerWidth - 220 - 6)
    : Math.max(6, r.left - 220 - 6)
  bpRef.value?.initPos(x, Math.max(6, r.top))
  if (bpRef.value) bpRef.value.minimized = false
  bpToolsExpanded.value = false
  brushPopupOpen.value = true
}

function toggleWandPopup() {
  currentTool.value = 'magic_wand'
  if (wandPopupOpen.value) { wandPopupOpen.value = false; return }
  bringWdToFront()
  closeAllPopups()
  wandPopupOpen.value = true
  nextTick(() => {
    const r = toolbarTriggerEls.tool_magic_wand?.getBoundingClientRect()
    if (!r) return
    const x = toolbarSide.value === 'left'
      ? Math.min(r.right + 6, window.innerWidth - 220 - 6)
      : Math.max(6, r.left - 220 - 6)
    wdRef.value?.initPos(x, Math.max(6, r.top))
  })
}

function toggleTextPopup() {
  currentTool.value = 'text'
  if (textPopupOpen.value) { textPopupOpen.value = false; return }
  bringTxToFront()
  closeAllPopups()
  textPopupOpen.value = true
  nextTick(() => {
    const r = toolbarTriggerEls.tool_text?.getBoundingClientRect()
    if (!r) return
    const x = toolbarSide.value === 'left'
      ? Math.min(r.right + 6, window.innerWidth - 220 - 6)
      : Math.max(6, r.left - 220 - 6)
    txRef.value?.initPos(x, Math.max(6, r.top))
  })
}

function toggleSettingsPopup() {
  const wasOpen = settingsPopupOpen.value
  closeAllPopups()
  if (!wasOpen) settingsPopupOpen.value = true
}

function selectTool(id) {
  currentTool.value = id
}

function toggleFilePopup() {
  const wasOpen = filePopupOpen.value
  closeAllPopups()
  if (!wasOpen) {
    bringFpToFront()
    const r = toolbarTriggerEls.file.getBoundingClientRect()
    const x = toolbarSide.value === 'left'
      ? Math.min(r.right + 6, window.innerWidth - 210 - 6)
      : Math.max(6, r.left - 240 - 6)
    fpRef.value?.initPos(x, Math.max(6, r.top))
    filePopupOpen.value = true
  }
}

function toggleBackupPopup() {
  const wasOpen = backupPopupOpen.value
  closeAllPopups()
  if (!wasOpen) {
    bringBkToFront()
    const r = toolbarTriggerEls.cloudPanel.getBoundingClientRect()
    const x = toolbarSide.value === 'left'
      ? Math.min(r.right + 6, window.innerWidth - 260 - 6)
      : Math.max(6, r.left - 260 - 6)
    bkRef.value?.initPos(x, Math.max(6, r.top))
    backupPopupOpen.value = true
  }
}

// ── Toolbar customization ───────────────────────────────────
// The core toolbar buttons (file, brush settings, color, undo/redo, tools,
// view controls, layers panel, cloud panel) are data-driven so Settings →
// Toolbar can let the user hide and reorder them. Widget plugins (sticky
// notes etc.) and Settings itself are NOT in this catalog — plugins have
// their own on/off in Settings → Plugins. Settings itself stays pinned so
// there's always a way back into these controls, and is NOT in this
// catalog either. Widget plugins (sticky notes, ...) ARE merged in below
// via combinedToolbarCatalog — they can be dragged/hidden alongside the
// built-ins, but whether the plugin exists at all is still Plugins tab's
// job, not this one's.
const toolbarCatalog = [
  { id: 'file', labelKey: 'fileManagement', icon: () => Folder, trigger: true,
    onClick: () => toggleFilePopup(), isActive: () => filePopupOpen.value },
  { id: 'brushSettings', labelKey: 'brushSettings', icon: () => lastDrawToolComp.value, trigger: true, extraClass: 'tool-selector',
    onClick: () => toggleBrushPopup(), isActive: () => tools.value.some(x => x.id === currentTool.value) },
  { id: 'color', labelKey: 'colorSettings', render: 'swatch', trigger: true, extraClass: 'color-trigger',
    onClick: () => toggleColorPopup(), isActive: () => colorPopupOpen.value },
  { id: 'undo', labelKey: 'undo', icon: () => Undo2,
    onClick: () => undo(), isDisabled: () => historyIndex.value <= 0 },
  { id: 'redo', labelKey: 'redo', icon: () => Redo2,
    onClick: () => redo(), isDisabled: () => historyIndex.value >= history.value.length - 1 },
  { id: 'tool_move', labelKey: 'tool_move', icon: () => Move, toolId: 'move' },
  { id: 'tool_select_rect', labelKey: 'tool_select_rect', icon: () => SquareDashedMousePointer, toolId: 'select_rect' },
  { id: 'tool_lasso', labelKey: 'tool_lasso', icon: () => LassoSelect, toolId: 'lasso' },
  { id: 'tool_magic_wand', labelKey: 'tool_magic_wand', icon: () => Wand2, trigger: true,
    onClick: () => toggleWandPopup(), isActive: () => currentTool.value === 'magic_wand' },
  { id: 'tool_text', labelKey: 'tool_text', icon: () => Type, trigger: true,
    onClick: () => toggleTextPopup(), isActive: () => currentTool.value === 'text' },
  { id: 'pan', labelKey: 'pan', icon: () => Hand, toolId: 'pan' },
  { id: 'rotate', labelKey: 'rotateCanvas', icon: () => RotateCcw, toolId: 'rotate' },
  { id: 'resetView', labelKey: 'resetView', icon: () => SquareDot, onClick: () => resetView() },
  { id: 'zoomIn', labelKey: 'zoomIn', icon: () => ZoomIn, onClick: () => zoomIn() },
  { id: 'zoomOut', labelKey: 'zoomOut', icon: () => ZoomOut, onClick: () => zoomOut() },
  { id: 'layersPanel', labelKey: 'layersPanel', icon: () => Layers,
    onClick: () => { isPanelOpen.value = !isPanelOpen.value }, isActive: () => isPanelOpen.value },
  { id: 'cloudPanel', labelKey: 'cloudPanel', icon: () => CloudUpload, trigger: true,
    onClick: () => toggleBackupPopup(), isActive: () => backupPopupOpen.value },
]

// Widget plugins reuse the exact same item contract (toolId for an
// asTool plugin, onClick otherwise) as the built-ins above, adapted from
// their own manifest fields (label/icon instead of labelKey/icon()).
const combinedToolbarCatalog = computed(() => [
  ...toolbarCatalog,
  ...widgetPlugins.value.map(p => ({
    id: p.id,
    labelKey: p.label,
    icon: () => p.icon,
    toolId: p.asTool ? p.id : undefined,
    onClick: p.asTool ? undefined : () => p.primaryAction?.(),
  })),
])

function toolbarItemClick(item) {
  if (item.toolId) currentTool.value = item.toolId
  else item.onClick?.()
}
function toolbarItemActive(item) {
  if (item.toolId) return currentTool.value === item.toolId
  return item.isActive?.() ?? false
}

const TOOLBAR_LAYOUT_KEY = 'atelier-toolbar-layout'
function loadToolbarLayout() {
  try { return JSON.parse(localStorage.getItem(TOOLBAR_LAYOUT_KEY) || '{}') } catch { return {} }
}
// { order: [ids in display order], hidden: [ids not shown] }. An id from
// toolbarCatalog missing from `order` (a newly added built-in button)
// falls in at the end automatically — see orderedToolbarItems below. A
// user-added separator is just an id in `order` prefixed "sep-" that
// isn't in toolbarCatalog at all — orderedToolbarItems synthesizes a
// { kind: 'separator' } item for those, so no separate list to keep in
// sync is needed; deleting one is just removing its id from `order`.
const toolbarLayout = reactive(loadToolbarLayout())
watch(toolbarLayout, () => {
  try { localStorage.setItem(TOOLBAR_LAYOUT_KEY, JSON.stringify(toolbarLayout)) } catch {}
}, { deep: true })

const orderedToolbarItems = computed(() => {
  const catalog = combinedToolbarCatalog.value
  const byId = new Map(catalog.map(i => [i.id, i]))
  const seen = new Set()
  const out = []
  for (const id of toolbarLayout.order || []) {
    if (seen.has(id)) continue
    if (byId.has(id)) { out.push(byId.get(id)); seen.add(id) }
    else if (id.startsWith('sep-')) { out.push({ id, kind: 'separator', labelKey: 'toolbarSeparator' }); seen.add(id) }
  }
  for (const item of catalog) {
    if (!seen.has(item.id)) out.push(item)
  }
  return out
})
const visibleToolbarItems = computed(() =>
  orderedToolbarItems.value.filter(item => !(toolbarLayout.hidden || []).includes(item.id))
)
function isToolbarItemHidden(id) {
  return (toolbarLayout.hidden || []).includes(id)
}
function setToolbarItemHidden(id, hidden) {
  const set = new Set(toolbarLayout.hidden || [])
  if (hidden) set.add(id); else set.delete(id)
  toolbarLayout.hidden = [...set]
}
function addToolbarSeparator() {
  const id = `sep-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  toolbarLayout.order = [...orderedToolbarItems.value.map(i => i.id), id]
}
function deleteToolbarSeparator(id) {
  toolbarLayout.order = orderedToolbarItems.value.map(i => i.id).filter(x => x !== id)
}
// Items not currently shown — what the "Add" picker in Settings → Toolbar
// offers. Removing something just hides it (setToolbarItemHidden); it
// stays in combinedToolbarCatalog so it can always be added back here.
const hiddenToolbarItemsForAdd = computed(() =>
  combinedToolbarCatalog.value.filter(item => isToolbarItemHidden(item.id))
)
const toolbarAddOpen = ref(false)

const tblDragId    = ref(null)
const tblDragOverId = ref(null)
function tblDragStart(id) { tblDragId.value = id }
function tblDragEnter(id) { tblDragOverId.value = id }
function tblDragLeave(id) { if (tblDragOverId.value === id) tblDragOverId.value = null }
function tblDrop(targetId) {
  tblDragOverId.value = null
  if (tblDragId.value === null || tblDragId.value === targetId) return
  const ids = orderedToolbarItems.value.map(i => i.id)
  const from = ids.indexOf(tblDragId.value)
  const to   = ids.indexOf(targetId)
  if (from === -1 || to === -1) return
  ids.splice(to, 0, ids.splice(from, 1)[0])
  toolbarLayout.order = ids
  tblDragId.value = null
}

// ── Canvas size dialog ────────────────────────────────────
const newCanvasW = ref(1080)
const newCanvasH = ref(1920)
watch(canvasSize, v => { newCanvasW.value = v.w; newCanvasH.value = v.h })

function onCanvasPreset(e) {
  const val = e.target.value
  if (!val) return
  const [w, h] = val.split(',').map(Number)
  newCanvasW.value = w
  newCanvasH.value = h
  e.target.value = ''   // reset so same preset can be re-selected
}

async function applyCanvasSize() {
  const cw = Math.max(1, Math.min(8192, newCanvasW.value || 1080))
  const ch = Math.max(1, Math.min(8192, newCanvasH.value || 1920))
  await resizeCanvasTo(cw, ch)
  viewX.value = 0; viewY.value = 0
}

// ── Canvas drag-resize ────────────────────────────────────
const canvasResizeDragging = ref(false)
const canvasDragW          = ref(0)
const canvasDragH          = ref(0)

function startCanvasResize(dir, e) {
  e.preventDefault()
  const startX = e.clientX
  const startY = e.clientY
  const startW = canvasLogicalW.value
  const startH = canvasLogicalH.value
  const scale  = fitScale.value

  canvasResizeDragging.value = true
  canvasDragW.value = startW
  canvasDragH.value = startH

  function onMove(ev) {
    const dx = ev.clientX - startX
    const dy = ev.clientY - startY
    if (dir === 'r'  || dir === 'br') canvasDragW.value = Math.max(1, Math.min(8192, Math.round(startW + dx / scale)))
    if (dir === 'b'  || dir === 'br') canvasDragH.value = Math.max(1, Math.min(8192, Math.round(startH + dy / scale)))
  }

  async function onUp() {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup',   onUp)
    canvasResizeDragging.value = false
    const w = canvasDragW.value, h = canvasDragH.value
    if (w !== startW || h !== startH) {
      await resizeCanvasTo(w, h)
      viewX.value = 0; viewY.value = 0
    }
  }

  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup',   onUp)
}

// ── Selection system ──────────────────────────────────────
const selState           = ref('idle') // 'idle'|'selecting'|'selected'|'moving'
const selRect            = ref(null)   // {x,y,w,h} canvas coords, always normalized
const selBorderOverlayRef = ref(null)
const selMaskOverlayRef   = ref(null)

let selFloat      = null  // { canvas, x, y } floating cut content
let selDragStart  = null  // { mx, my, fx, fy } for move drag
let selAnchorPt   = null  // { x, y } drag start for rect selection
let selMaskCanvas = null  // offscreen canvas: white-on-transparent = committed selection mask
let lassoPoints   = []    // [{x,y}] points recorded during lasso stroke
let selPaintCanvas = null // offscreen canvas: sel_pen accumulation (before commit)
const selPaintActive = ref(false)  // true when selPaintCanvas has content
const selDrawMode    = ref(false)  // true when drawing on selFloat (draw-on-float mode)
const selHoverHandle = ref(null)   // handle id under pointer ('tl','tc','tr','ml','mr','bl','bc','br')
let selTransformDrag = null        // { handle, origRect, cropCanvas, mx, my }

const selActive   = computed(() => selState.value !== 'idle')

const SEL_HANDLE_CURSORS = { tl: 'cur-nwse', br: 'cur-nwse', tr: 'cur-nesw', bl: 'cur-nesw', tc: 'cur-ns', bc: 'cur-ns', ml: 'cur-ew', mr: 'cur-ew' }
const canvasCursorClass = computed(() => {
  if (selHoverHandle.value) return SEL_HANDLE_CURSORS[selHoverHandle.value] || ''
  if (selState.value === 'moving' || currentTool.value === 'move') return 'cur-move'
  if (['select_rect', 'lasso', 'sel_pen', 'sel_eras', 'magic_wand'].includes(currentTool.value)) return 'cur-crosshair'
  if (currentTool.value === 'text') return 'cur-text'
  return ''
})

// On-canvas diameter (logical px, before fitScale) of the current tool's
// brush footprint at the current lineWidth — null for tools with no size
// concept (fill, eyedropper, move, select/lasso, text, ...). Brush-plugin
// tools (pen/brush/eraser/airbrush/any future plugin) report their own via
// cursorDiameter() so this stays correct even as multipliers change; the
// three built-ins below aren't plugins and so declare their own multiplier
// inline (see applyStyle()/mixRadius() for the matching draw-time formula).
function toolCursorDiameter(toolId) {
  const plugin = getPlugin(toolId)
  if (plugin?.type === 'brush') {
    return typeof plugin.cursorDiameter === 'function' ? plugin.cursorDiameter(lineWidth.value) : lineWidth.value
  }
  if (toolId === 'line' || toolId === 'rect' || toolId === 'circle') return lineWidth.value
  if (toolId === 'mix') return mixRadius() * 2
  if (toolId === 'sel_pen' || toolId === 'sel_eras') return lineWidth.value * 2
  return null
}
const brushCursorDiameter = computed(() => toolCursorDiameter(currentTool.value))

// Screen-space style for the hover cursor circle — null (and so hidden via
// v-if) whenever the pointer's off-canvas or the current tool has no size
// concept. Diameter converts logical px to screen px via fitScale so it
// tracks canvas zoom.
const brushCursorStyle = computed(() => {
  if (!brushCursorScreen.value || !brushCursorDiameter.value) return null
  const d = Math.max(2, brushCursorDiameter.value * fitScale.value)
  return {
    left:   brushCursorScreen.value.x + 'px',
    top:    brushCursorScreen.value.y + 'px',
    width:  d + 'px',
    height: d + 'px',
  }
})

watch(canvasSize, () => { cancelSelection() })

// sel_pen / sel_eras 雙向同步
watch(currentTool, (newTool, oldTool) => {
  // 離開文字工具時 commit 已輸入的文字
  if (oldTool === 'text' && newTool !== 'text') commitText()

  // 切換到繪圖工具時若 float 懸浮（移動模式），先 commit
  const drawingTools = ['pen', 'brush', 'mix', 'eraser', 'line', 'rect', 'circle', 'fill']
  if (drawingTools.includes(newTool) && selFloat && !selDrawMode.value) commitFloat()

  const enteringSelPaint = newTool === 'sel_pen' || newTool === 'sel_eras'
  const leavingSelPaint  = oldTool === 'sel_pen' || oldTool === 'sel_eras'

  // 進入 sel_pen/sel_eras：把現有選取區（任何類型）搬進 selPaintCanvas（藍色）
  if (enteringSelPaint && selState.value !== 'idle' && !selPaintCanvas) {
    if (selFloat) commitFloat()   // 先 commit float，確保 selMaskCanvas 位置已更新

    // 矩形選取沒有 selMaskCanvas，從 selRect 建出一個
    if (!selMaskCanvas && selRect.value) {
      const w = canvasLogicalW.value, h = canvasLogicalH.value
      selMaskCanvas = mkCanvas(w, h)
      const r = selRect.value
      selMaskCanvas.getContext('2d').fillStyle = '#ffffff'
      selMaskCanvas.getContext('2d').fillRect(r.x, r.y, r.w, r.h)
    }

    if (selMaskCanvas) {
      selPaintCanvas = selMaskCanvas
      selMaskCanvas  = null
      selPaintActive.value = true
      selState.value = 'idle'
      selRect.value  = null
      renderSelOverlay()
    }
  }

  // 離開 sel_pen/sel_eras（且非互切）：若有未 commit 的畫面，自動 commit 成選取區
  if (leavingSelPaint && !enteringSelPaint && selPaintCanvas) {
    commitSelPaint()
    return
  }

  // 切換工具時更新 overlay（反色顯示與否會隨工具改變）
  if (selState.value !== 'idle' || selPaintActive.value) renderSelOverlay()
})

function syncOverlaySizes() {
  const w = canvasLogicalW.value, h = canvasLogicalH.value
  ;[selBorderOverlayRef.value, selMaskOverlayRef.value].forEach(c => {
    if (c && (c.width !== w || c.height !== h)) { c.width = w; c.height = h }
  })
}

function cancelSelection() {
  if (selFloat) commitFloat()
  selState.value = 'idle'
  selRect.value  = null
  selFloat = null; selDragStart = null; selAnchorPt = null; selMaskCanvas = null
  lassoPoints = []; selPaintCanvas = null; selPaintActive.value = false
  selDrawMode.value = false; selTransformDrag = null; selHoverHandle.value = null
  renderSelOverlay()
}

function commitFloat() {
  if (!selFloat || !activeLayer.value) return
  // 把 selMaskCanvas 同步移到 float 的新位置，再合併圖層
  if (selMaskCanvas && (selFloat.x !== 0 || selFloat.y !== 0)) {
    const w = canvasLogicalW.value, h = canvasLogicalH.value
    const shifted = mkCanvas(w, h)
    shifted.getContext('2d').drawImage(selMaskCanvas, selFloat.x, selFloat.y)
    selMaskCanvas = shifted
  }
  const ctx = activeLayer.value.canvas.getContext('2d')
  ctx.drawImage(selFloat.canvas, selFloat.x, selFloat.y)
  selFloat = null
  composite(activeLayerId.value)
  saveHistory([activeLayerId.value])
}

function applyMaskClip(ctx) {
  const r = selRect.value
  if (!r) return
  ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip()
}

function mkCanvas(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c
}

function selHandlePositions(r) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2
  return [
    { id: 'tl', x: r.x,       y: r.y       },
    { id: 'tc', x: cx,        y: r.y       },
    { id: 'tr', x: r.x + r.w, y: r.y       },
    { id: 'ml', x: r.x,       y: cy        },
    { id: 'mr', x: r.x + r.w, y: cy        },
    { id: 'bl', x: r.x,       y: r.y + r.h },
    { id: 'bc', x: cx,        y: r.y + r.h },
    { id: 'br', x: r.x + r.w, y: r.y + r.h },
  ]
}

function hitTestSelHandle(p) {
  if (!selFloat || selFloat.drawMode || !selRect.value) return null
  const hs = 8 / fitScale.value  // 8 screen-px hit area → logical coords
  for (const h of selHandlePositions(selRect.value)) {
    if (Math.abs(p.x - h.x) <= hs && Math.abs(p.y - h.y) <= hs) return h.id
  }
  return null
}

// 取得當前選取區的有效 mask canvas（selMaskCanvas 或從 selRect 生成的矩形 mask）
// 若 float 已偏移，回傳位移後的副本（避免遮罩還停在原始位置）
function getEffectiveMask() {
  if (selMaskCanvas) {
    if (selFloat && (selFloat.x !== 0 || selFloat.y !== 0)) {
      const w = canvasLogicalW.value, h = canvasLogicalH.value
      const shifted = mkCanvas(w, h)
      shifted.getContext('2d').drawImage(selMaskCanvas, selFloat.x, selFloat.y)
      return shifted
    }
    return selMaskCanvas
  }
  const r = selRect.value
  if (!r) return null
  const w = canvasLogicalW.value, h = canvasLogicalH.value
  const m = mkCanvas(w, h)
  m.getContext('2d').fillStyle = '#ffffff'
  m.getContext('2d').fillRect(r.x, r.y, r.w, r.h)
  return m
}

function renderSelOverlay() {
  syncOverlaySizes()
  const w = canvasLogicalW.value, h = canvasLogicalH.value
  if (!w || !h) return

  // ── Border overlay: floating content + selection outline ──────────────
  const bc = selBorderOverlayRef.value
  if (bc) {
    const ctx = bc.getContext('2d')
    ctx.clearRect(0, 0, w, h)

    // SelPen paint canvas preview (blue tint, not yet committed)
    if (selPaintCanvas) {
      const tmp = mkCanvas(w, h)
      const tc = tmp.getContext('2d')
      tc.drawImage(selPaintCanvas, 0, 0)
      tc.globalCompositeOperation = 'source-in'
      tc.fillStyle = '#3399ff'; tc.fillRect(0, 0, w, h)
      ctx.globalAlpha = 0.5
      ctx.drawImage(tmp, 0, 0)
      ctx.globalAlpha = 1
    }

    if (selState.value !== 'idle') {
      if (selMaskCanvas) {
        if (selFloat && !selFloat.drawMode) {
          // float 懸浮中（移動模式）：改用跟著 selRect 走的虛線框
          const r = selRect.value
          if (r) {
            ctx.save()
            ctx.lineWidth = 1.5; ctx.setLineDash([6, 4])
            ctx.strokeStyle = '#000000'; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h)
            ctx.lineDashOffset = 5; ctx.strokeStyle = '#ffffff'; ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h)
            ctx.restore()
          }
        } else {
          // 靜態：形態侵蝕法求實際輪廓
          const interior = mkCanvas(w, h)
          const ic = interior.getContext('2d')
          ic.drawImage(selMaskCanvas, 0, 0)
          for (const [dx, dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
            ic.globalCompositeOperation = 'destination-in'
            ic.drawImage(selMaskCanvas, dx, dy)
          }
          const edgeIn = mkCanvas(w, h)
          const ei = edgeIn.getContext('2d')
          ei.drawImage(selMaskCanvas, 0, 0)
          ei.globalCompositeOperation = 'destination-out'
          ei.drawImage(interior, 0, 0)
          ei.globalCompositeOperation = 'source-in'
          ei.fillStyle = '#000000'; ei.fillRect(0, 0, w, h)
          const edgeOut = mkCanvas(w, h)
          const eo = edgeOut.getContext('2d')
          for (const [dx, dy] of [[0,0],[-1,0],[1,0],[0,-1],[0,1]]) {
            eo.drawImage(selMaskCanvas, dx, dy)
          }
          eo.globalCompositeOperation = 'destination-out'
          eo.drawImage(selMaskCanvas, 0, 0)
          eo.globalCompositeOperation = 'source-in'
          eo.fillStyle = '#ffffff'; eo.fillRect(0, 0, w, h)
          ctx.drawImage(edgeIn, 0, 0)
          ctx.drawImage(edgeOut, 0, 0)
        }
      } else if (currentTool.value === 'lasso' && lassoPoints.length > 1) {
        // Lasso in progress: show freehand path preview
        ctx.save()
        ctx.lineWidth = 1.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
        ctx.setLineDash([5, 4])
        ctx.beginPath()
        ctx.moveTo(lassoPoints[0].x, lassoPoints[0].y)
        for (let i = 1; i < lassoPoints.length; i++) ctx.lineTo(lassoPoints[i].x, lassoPoints[i].y)
        ctx.strokeStyle = '#000000'; ctx.stroke()
        ctx.lineDashOffset = 5
        ctx.strokeStyle = '#ffffff'; ctx.stroke()
        ctx.restore()
      } else {
        // Rect selection: classic dashed border
        const r = selRect.value
        if (r) {
          ctx.save()
          ctx.lineWidth = 1.5
          ctx.setLineDash([6, 4])
          ctx.strokeStyle = '#000000'
          ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h)
          ctx.lineDashOffset = 5
          ctx.strokeStyle = '#ffffff'
          ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w, r.h)
          ctx.restore()
        }
      }
    }

    // ── Transform handles (when float is active and not in draw mode) ──────
    if (selFloat && !selFloat.drawMode && selRect.value) {
      const r  = selRect.value
      const hs = Math.max(4, 5 / fitScale.value)  // constant ~5px on screen
      ctx.setLineDash([])
      ctx.lineWidth = 1
      for (const { x, y } of selHandlePositions(r)) {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(x - hs, y - hs, hs * 2, hs * 2)
        ctx.strokeStyle = '#444444'
        ctx.strokeRect(x - hs + 0.5, y - hs + 0.5, hs * 2 - 1, hs * 2 - 1)
      }
    }
  }

  // ── Mask overlay: tinted selection area (white → mix-blend difference = 反色) ──
  // 進入繪圖遮罩模式時不顯示反色（只保留虛線框）
  const selToolIds = ['move', 'select_rect', 'lasso', 'sel_pen', 'sel_eras', 'magic_wand']
  const inDrawMaskMode = selActive.value && !selToolIds.includes(currentTool.value)
  const mc = selMaskOverlayRef.value
  if (mc) {
    const ctx = mc.getContext('2d')
    ctx.clearRect(0, 0, w, h)
    if (selState.value !== 'idle' && !inDrawMaskMode) {
      if (selMaskCanvas) {
        // float 懸浮中（包含放開後）要跟著偏移
        const ox = selFloat ? selFloat.x : 0
        const oy = selFloat ? selFloat.y : 0
        const tmp = mkCanvas(w, h)
        const tc = tmp.getContext('2d')
        tc.drawImage(selMaskCanvas, ox, oy)
        tc.globalCompositeOperation = 'source-in'
        tc.fillStyle = '#ffffff'; tc.fillRect(0, 0, w, h)
        ctx.drawImage(tmp, 0, 0)
      } else if (selRect.value) {
        // Rect selection: white fill inside rect
        const r = selRect.value
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(r.x, r.y, r.w, r.h)
      }
    }
  }
}

// ── Selection pointer handlers ────────────────────────────
function handleSelRectDown(p) {
  if (selState.value === 'selected' || selState.value === 'moving') {
    const r = selRect.value
    if (r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) {
      // Inside selection: start floating move
      if (!selFloat) {
        const layer = activeLayer.value; if (!layer) return
        const lw = layer.canvas.width, lh = layer.canvas.height

        if (selMaskCanvas) {
          // ── Brush selection: pixel-perfect cut using mask ──
          const fc = mkCanvas(lw, lh)
          const fc2 = fc.getContext('2d')
          fc2.drawImage(layer.canvas, 0, 0)
          fc2.globalCompositeOperation = 'destination-in'
          fc2.drawImage(selMaskCanvas, 0, 0)   // keep only selected pixels

          const lctx = layer.canvas.getContext('2d')
          lctx.globalCompositeOperation = 'destination-out'
          lctx.drawImage(selMaskCanvas, 0, 0)  // erase selected pixels from layer
          lctx.globalCompositeOperation = 'source-over'

          selFloat = { canvas: fc, x: 0, y: 0 }
        } else {
          // ── Rect selection: crop to rect ──
          const fc = mkCanvas(r.w, r.h)
          fc.getContext('2d').drawImage(layer.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h)
          layer.canvas.getContext('2d').clearRect(r.x, r.y, r.w, r.h)
          selFloat = { canvas: fc, x: r.x, y: r.y }
        }
        composite(layer.id)
      }
      selDragStart = { mx: p.x, my: p.y, fx: selFloat.x, fy: selFloat.y, rx: r.x, ry: r.y }
      selState.value = 'moving'
      renderSelOverlay()
      return
    }
    // Outside selection: cancel and start new
    cancelSelection()
  }
  selAnchorPt = { x: p.x, y: p.y }
  selRect.value = { x: p.x, y: p.y, w: 0, h: 0 }
  selState.value = 'selecting'
  renderSelOverlay()
}

function handleSelRectMove(p) {
  const ax = selAnchorPt.x, ay = selAnchorPt.y
  selRect.value = {
    x: Math.min(ax, p.x), y: Math.min(ay, p.y),
    w: Math.abs(p.x - ax), h: Math.abs(p.y - ay),
  }
  renderSelOverlay()
}

function handleSelMoveMove(p) {
  const dx = p.x - selDragStart.mx
  const dy = p.y - selDragStart.my
  selFloat.x = selDragStart.fx + dx
  selFloat.y = selDragStart.fy + dy
  const r = selRect.value
  selRect.value = { x: selDragStart.rx + dx, y: selDragStart.ry + dy, w: r.w, h: r.h }
  // Only the floating selection's position moves here, not any layer's own
  // canvas — nothing for the thumbnail refresh to catch up on.
  requestComposite([])
  renderSelOverlay()
}

function handleSelRectUp() {
  if (selState.value === 'moving') {
    // 放開後不立即 commit，讓 float 繼續懸浮
    selState.value = 'selected'
    selDragStart = null
    renderSelOverlay()
    return
  }
  if (!selRect.value || (selRect.value.w < 2 && selRect.value.h < 2)) {
    cancelSelection()
    return
  }
  selState.value = 'selected'
  renderSelOverlay()
}

// ── Lasso: freehand closed-path selection ─────────────────
function handleLassoDown(p) {
  if (selState.value === 'selected' || selState.value === 'moving') {
    const r = selRect.value
    if (r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) {
      if (!selFloat) {
        const layer = activeLayer.value; if (!layer) return
        const lw = layer.canvas.width, lh = layer.canvas.height
        if (selMaskCanvas) {
          const fc = mkCanvas(lw, lh)
          const fc2 = fc.getContext('2d')
          fc2.drawImage(layer.canvas, 0, 0)
          fc2.globalCompositeOperation = 'destination-in'
          fc2.drawImage(selMaskCanvas, 0, 0)
          const lctx = layer.canvas.getContext('2d')
          lctx.globalCompositeOperation = 'destination-out'
          lctx.drawImage(selMaskCanvas, 0, 0)
          lctx.globalCompositeOperation = 'source-over'
          selFloat = { canvas: fc, x: 0, y: 0 }
        } else {
          const fc = mkCanvas(r.w, r.h)
          fc.getContext('2d').drawImage(layer.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h)
          layer.canvas.getContext('2d').clearRect(r.x, r.y, r.w, r.h)
          selFloat = { canvas: fc, x: r.x, y: r.y }
        }
        composite(layer.id)
      }
      selDragStart = { mx: p.x, my: p.y, fx: selFloat.x, fy: selFloat.y, rx: r.x, ry: r.y }
      selState.value = 'moving'
      renderSelOverlay()
      return
    }
    cancelSelection()
  }
  lassoPoints = [p]
  selMaskCanvas = null
  selState.value = 'selecting'
  renderSelOverlay()
}

function handleLassoMove(p) {
  lassoPoints.push(p)
  renderSelOverlay()
}

function handleLassoUp() {
  if (lassoPoints.length < 3) { cancelSelection(); return }
  const w = canvasLogicalW.value, h = canvasLogicalH.value
  selMaskCanvas = mkCanvas(w, h)
  const ctx = selMaskCanvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.moveTo(lassoPoints[0].x, lassoPoints[0].y)
  for (let i = 1; i < lassoPoints.length; i++) ctx.lineTo(lassoPoints[i].x, lassoPoints[i].y)
  ctx.closePath(); ctx.fill()
  const xs = lassoPoints.map(pt => pt.x), ys = lassoPoints.map(pt => pt.y)
  selRect.value = {
    x: Math.floor(Math.min(...xs)), y: Math.floor(Math.min(...ys)),
    w: Math.ceil(Math.max(...xs)) - Math.floor(Math.min(...xs)),
    h: Math.ceil(Math.max(...ys)) - Math.floor(Math.min(...ys)),
  }
  lassoPoints = []
  selState.value = 'selected'
  renderSelOverlay()
}

// ── SelPen: accumulate paint → commit to selection ────────
function handleSelPenDown(p) {
  if (!selPaintCanvas) {
    selPaintCanvas = mkCanvas(canvasLogicalW.value, canvasLogicalH.value)
    selPaintActive.value = true
  }
  const ctx = selPaintCanvas.getContext('2d')
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = lineWidth.value * 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.arc(p.x, p.y, lineWidth.value, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.moveTo(p.x, p.y)
  renderSelOverlay()
}

function handleSelPenMove(p) {
  if (!selPaintCanvas) return
  const ctx = selPaintCanvas.getContext('2d')
  ctx.lineTo(p.x, p.y); ctx.stroke()
  renderSelOverlay()
}

function handleSelPenUp() {
  if (!selPaintCanvas) return
  selPaintCanvas.getContext('2d').beginPath()
  renderSelOverlay()
}

// ── SelEras: erase from selPaintCanvas ────────────────────
function handleSelErasDown(p) {
  if (!selPaintCanvas) return
  const ctx = selPaintCanvas.getContext('2d')
  ctx.globalCompositeOperation = 'destination-out'
  ctx.lineWidth = lineWidth.value * 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.arc(p.x, p.y, lineWidth.value, 0, Math.PI * 2); ctx.fill()
  ctx.beginPath(); ctx.moveTo(p.x, p.y)
  renderSelOverlay()
}

function handleSelErasMove(p) {
  if (!selPaintCanvas) return
  const ctx = selPaintCanvas.getContext('2d')
  ctx.lineTo(p.x, p.y); ctx.stroke()
  renderSelOverlay()
}

function handleSelErasUp() {
  if (!selPaintCanvas) return
  const ctx = selPaintCanvas.getContext('2d')
  ctx.globalCompositeOperation = 'source-over'
  ctx.beginPath()
  renderSelOverlay()
}

// ── Transform handles: scale selFloat content ─────────────
function startTransformDrag(handle, p) {
  const r = selRect.value
  // Crop selFloat content to current selRect bounds
  const crop = mkCanvas(r.w, r.h)
  crop.getContext('2d').drawImage(
    selFloat.canvas,
    r.x - selFloat.x, r.y - selFloat.y, r.w, r.h,
    0, 0, r.w, r.h
  )
  selTransformDrag = { handle, origRect: { ...r }, cropCanvas: crop, mx: p.x, my: p.y }
}

function handleTransformMove(p) {
  const { handle, origRect: or, cropCanvas } = selTransformDrag
  const dx = p.x - selTransformDrag.mx
  const dy = p.y - selTransformDrag.my

  let x = or.x, y = or.y, w = or.w, h = or.h

  if      (handle === 'tl') { x += dx; y += dy; w -= dx; h -= dy }
  else if (handle === 'tc') { y += dy; h -= dy }
  else if (handle === 'tr') { y += dy; w += dx; h -= dy }
  else if (handle === 'ml') { x += dx; w -= dx }
  else if (handle === 'mr') { w += dx }
  else if (handle === 'bl') { x += dx; w -= dx; h += dy }
  else if (handle === 'bc') { h += dy }
  else if (handle === 'br') { w += dx; h += dy }

  // Clamp to minimum 1px, handle flip when dragging past opposite edge
  if (w < 1) { if ('tl ml bl'.includes(handle)) x = or.x + or.w - 1; w = 1 }
  if (h < 1) { if ('tl tc tr'.includes(handle)) y = or.y + or.h - 1; h = 1 }
  x = Math.round(x); y = Math.round(y)
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h))

  const lw = canvasLogicalW.value, lh = canvasLogicalH.value
  const nc = mkCanvas(lw, lh)
  nc.getContext('2d').drawImage(cropCanvas, 0, 0, or.w, or.h, x, y, w, h)
  selFloat.canvas = nc
  selFloat.x = 0; selFloat.y = 0
  selRect.value = { x, y, w, h }
  // Reshapes selFloat, a scratch canvas — not any layer's own canvas.
  requestComposite([])
  renderSelOverlay()
}

function handleTransformUp() {
  selTransformDrag = null
  selMaskCanvas = null  // stale after scale, clear it
  saveHistory()
}

// ── Commit selPaintCanvas → active selection mask ─────────
function commitSelPaint() {
  if (!selPaintCanvas) return
  // Merge into existing selMaskCanvas if any, otherwise replace
  if (selMaskCanvas) {
    selMaskCanvas.getContext('2d').drawImage(selPaintCanvas, 0, 0)
  } else {
    selMaskCanvas = selPaintCanvas
  }
  selPaintCanvas = null; selPaintActive.value = false
  // Compute bounding rect from pixels
  const w = selMaskCanvas.width, h = selMaskCanvas.height
  const data = selMaskCanvas.getContext('2d').getImageData(0, 0, w, h).data
  let x1 = w, y1 = h, x2 = -1, y2 = -1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] > 0) {
      if (x < x1) x1 = x; if (x > x2) x2 = x
      if (y < y1) y1 = y; if (y > y2) y2 = y
    }
  }
  if (x2 < 0) { cancelSelection(); return }
  selRect.value = { x: x1, y: y1, w: x2 - x1 + 1, h: y2 - y1 + 1 }
  selState.value = 'selected'
  renderSelOverlay()
}

// ── Magic Wand: flood-select connected same-color region ─────
function handleMagicWandDown(p, addToSel = false) {
  const layer = activeLayer.value
  if (!layer) return

  if (!addToSel && selState.value !== 'idle') cancelSelection()

  const canvas = layer.canvas
  const w = canvas.width, h = canvas.height
  const ix = Math.round(p.x), iy = Math.round(p.y)
  if (ix < 0 || ix >= w || iy < 0 || iy >= h) return

  const data    = canvas.getContext('2d').getImageData(0, 0, w, h).data
  const ci      = (iy * w + ix) * 4
  const tr = data[ci], tg = data[ci+1], tb = data[ci+2], ta = data[ci+3]
  const tol     = wandTolerance.value

  const colorMatch = i =>
    Math.abs(data[i]   - tr) <= tol &&
    Math.abs(data[i+1] - tg) <= tol &&
    Math.abs(data[i+2] - tb) <= tol &&
    Math.abs(data[i+3] - ta) <= tol

  const visited  = new Uint8Array(w * h)
  const selected = new Uint8Array(w * h)
  const stack    = [iy * w + ix]

  while (stack.length) {
    const pos = stack.pop()
    if (visited[pos]) continue
    visited[pos] = 1
    if (!colorMatch(pos * 4)) continue
    selected[pos] = 1
    const col = pos % w, row = (pos / w) | 0
    if (col > 0)     stack.push(pos - 1)
    if (col < w - 1) stack.push(pos + 1)
    if (row > 0)     stack.push(pos - w)
    if (row < h - 1) stack.push(pos + w)
  }

  // Build white mask from selected pixels
  const newMask = mkCanvas(w, h)
  const mctx    = newMask.getContext('2d')
  const maskImg = mctx.createImageData(w, h)
  const md      = maskImg.data
  let x1 = w, y1 = h, x2 = -1, y2 = -1

  for (let i = 0; i < selected.length; i++) {
    if (!selected[i]) continue
    const x = i % w, y = (i / w) | 0
    md[i*4] = 255; md[i*4+1] = 255; md[i*4+2] = 255; md[i*4+3] = 255
    if (x < x1) x1 = x; if (x > x2) x2 = x
    if (y < y1) y1 = y; if (y > y2) y2 = y
  }

  if (x2 < 0) return  // nothing matched

  mctx.putImageData(maskImg, 0, 0)

  if (addToSel && selMaskCanvas) {
    selMaskCanvas.getContext('2d').drawImage(newMask, 0, 0)
    const r = selRect.value
    if (r) {
      selRect.value = {
        x: Math.min(r.x, x1),
        y: Math.min(r.y, y1),
        w: Math.max(r.x + r.w, x2 + 1) - Math.min(r.x, x1),
        h: Math.max(r.y + r.h, y2 + 1) - Math.min(r.y, y1),
      }
    }
  } else {
    selMaskCanvas = newMask
    selRect.value = { x: x1, y: y1, w: x2 - x1 + 1, h: y2 - y1 + 1 }
  }

  selState.value = 'selected'
  selFloat = null
  renderSelOverlay()
}

function switchToDrawFromSel() {
  if (!activeLayer.value) return
  if (selFloat) commitFloat()

  const layer = activeLayer.value
  const w = canvasLogicalW.value, h = canvasLogicalH.value

  // Build pixel mask from colored regions of active layer (clipped to rect selection if any)
  selMaskCanvas = mkCanvas(w, h)
  const mctx = selMaskCanvas.getContext('2d')
  mctx.drawImage(layer.canvas, 0, 0)
  if (selRect.value) {
    const r = selRect.value
    const clip = mkCanvas(w, h)
    const cctx = clip.getContext('2d')
    cctx.fillStyle = '#ffffff'
    cctx.fillRect(r.x, r.y, r.w, r.h)
    mctx.globalCompositeOperation = 'destination-in'
    mctx.drawImage(clip, 0, 0)
    mctx.globalCompositeOperation = 'source-over'
  }
  // Convert colored pixels to white mask (white = drawable area)
  mctx.globalCompositeOperation = 'source-in'
  mctx.fillStyle = '#ffffff'
  mctx.fillRect(0, 0, w, h)
  mctx.globalCompositeOperation = 'source-over'

  // Empty float canvas for drawing; drawMode flag prevents move-float commit
  selFloat = { canvas: mkCanvas(w, h), x: 0, y: 0, drawMode: true }
  selDrawMode.value = true
  selState.value = 'selected'
  selRect.value = null

  currentTool.value = 'pen'
  renderSelOverlay()
}

// ── Text tool ─────────────────────────────────────────────
let textDrag = null

function screenDeltaToCanvas(dx, dy) {
  const rad = -viewR.value * Math.PI / 180
  const s   = fitScale.value
  return {
    x: (dx * Math.cos(rad) - dy * Math.sin(rad)) / s,
    y: (dx * Math.sin(rad) + dy * Math.cos(rad)) / s,
  }
}

function startTextDrag(e) {
  textDrag = { sx: e.clientX, sy: e.clientY, ox: textPos.value.x, oy: textPos.value.y }
  window.addEventListener('mousemove', onTextDragMove)
  window.addEventListener('mouseup',   onTextDragUp)
}

function startTextDragTouch(e) {
  const t = e.touches[0]
  textDrag = { sx: t.clientX, sy: t.clientY, ox: textPos.value.x, oy: textPos.value.y }
  window.addEventListener('touchmove', onTextDragTouchMove, { passive: false })
  window.addEventListener('touchend',  onTextDragUp)
}

function onTextDragMove(e) {
  if (!textDrag) return
  const d = screenDeltaToCanvas(e.clientX - textDrag.sx, e.clientY - textDrag.sy)
  textPos.value = { x: Math.round(textDrag.ox + d.x), y: Math.round(textDrag.oy + d.y) }
}

function onTextDragTouchMove(e) {
  e.preventDefault()
  const t = e.touches[0]
  const d = screenDeltaToCanvas(t.clientX - textDrag.sx, t.clientY - textDrag.sy)
  textPos.value = { x: Math.round(textDrag.ox + d.x), y: Math.round(textDrag.oy + d.y) }
}

function onTextDragUp() {
  textDrag = null
  window.removeEventListener('mousemove', onTextDragMove)
  window.removeEventListener('mouseup',   onTextDragUp)
  window.removeEventListener('touchmove', onTextDragTouchMove)
  window.removeEventListener('touchend',  onTextDragUp)
}

function handleTextDown(p) {
  if (textActive.value) {
    // Commit any typed text, then reopen at new position without closing the box
    if (textValue.value.trim()) commitText()
    textValue.value = ''
    textPos.value = { x: Math.round(p.x), y: Math.round(p.y) }
    nextTick(() => { textInputRef.value?.focus(); autoResizeTextarea() })
    return
  }
  textPos.value  = { x: Math.round(p.x), y: Math.round(p.y) }
  textValue.value = ''
  textActive.value = true
  nextTick(() => {
    textInputRef.value?.focus()
    autoResizeTextarea()
  })
}

function commitText() {
  if (!textActive.value || !textValue.value.trim()) { cancelText(); return }
  const ctx = getActiveCtx()
  if (!ctx) { cancelText(); return }
  const weight = fontBold.value ? 'bold ' : ''
  const style  = fontItalic.value ? 'italic ' : ''
  ctx.save()
  ctx.font         = `${style}${weight}${fontSize.value}px ${fontFamily.value}`
  ctx.fillStyle    = currentColor.value
  ctx.globalAlpha  = strokeOpacity.value / 100
  ctx.textBaseline = 'top'
  const lines = textValue.value.split('\n')
  const lh    = fontSize.value * 1.2
  lines.forEach((line, i) => ctx.fillText(line, textPos.value.x, textPos.value.y + i * lh))
  ctx.restore()
  composite(activeLayerId.value)
  saveHistory([activeLayerId.value])
  cancelText()
}

function cancelText() {
  textActive.value = false
  textValue.value  = ''
}

function autoResizeTextarea() {
  const el = textInputRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = el.scrollHeight + 'px'
}

// ── Move tool: move layer or selection ────────────────────
function handleMoveDown(p) {
  if (selActive.value) {
    const r = selRect.value
    const inside = r && p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
    if (inside) {
      handleSelRectDown(p)  // starts floating move
    } else {
      cancelSelection()     // click outside → clear selection only, don't start new rect
    }
    return
  }
  // Without selection: move entire active layer
  const layer = activeLayer.value; if (!layer) return
  drawing = true
  layerSnapshot = layer.canvas.getContext('2d').getImageData(0, 0, layer.canvas.width, layer.canvas.height)
}

function handleMoveMove(p) {
  if (!drawing || !layerSnapshot) return
  const dx = Math.round(p.x - startX), dy = Math.round(p.y - startY)
  const layer = activeLayer.value; if (!layer) return
  const ctx = layer.canvas.getContext('2d')
  ctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height)
  ctx.putImageData(layerSnapshot, dx, dy)
  requestComposite(layer.id)
}

function handleMoveUp() {
  if (!drawing) return
  drawing = false; layerSnapshot = null
  composite(activeLayerId.value)
  saveHistory([activeLayerId.value])
}

// ── File operations ───────────────────────────────────────
function triggerImport() { closeAllPopups(); importInputRef.value?.click() }

function onImportFile(e) {
  const file = e.target.files[0]
  if (!file || !file.type.startsWith('image/')) return
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.onload = async () => {
    if (layers.value.length <= 1) {
      await resizeCanvasTo(img.naturalWidth, img.naturalHeight)
    }
    importImageLayer(img, file.name.replace(/\.[^.]+$/, ''))
    URL.revokeObjectURL(url)
    importInputRef.value.value = ''
  }
  img.src = url
}

function triggerProjectImport() { closeAllPopups(); projectInputRef.value?.click() }

async function onProjectFile(e) {
  const file = e.target.files[0]
  if (!file) return
  try {
    const project = JSON.parse(await file.text())
    const result = await loadProject(project)
    if (result) {
      if (result.canvasBg)    canvasBg.value    = result.canvasBg
      if (result.userPalette) userPalette.value = [...result.userPalette]
    }
  } catch { /* invalid file, ignore */ }
  projectInputRef.value.value = ''
}

function onSaveProject() {
  exportProject(canvasBg.value, userPalette.value)
  closeAllPopups()
}

function doExportImage() {
  lc.doExport(exportFormat.value, exportQuality.value)
  closeAllPopups()
}

function newProject() {
  if (!confirm(t('newProjectConfirm'))) return
  closeAllPopups()
  resetToBlank()
}

// ── Draw state ────────────────────────────────────────────
let drawing       = false
let startX        = 0
let startY        = 0
let strokePoints  = []  // accumulated points of an in-progress freehand stroke
let layerSnapshot = null
let drawingButton = 0
// Accumulates this stroke's Flow-alpha dabs for its whole duration (see
// compositeStroke()) — allocated in onPointerDown for any brush-plugin
// stroke, masked or not.
let strokeCanvas  = null
let maskCache     = null  // effective mask canvas cached per stroke
let brushStampLast = null // last mousemove position, for 'stamp'-mode brush plugins
// Cumulative path length since mousedown, and the length at which the next
// dab is due — mirrors mixCumDist/mixNextStampAt below and exists for the
// exact same reason: stamping unconditionally once per mousemove event
// (rather than at fixed distance intervals) makes a slow/jittery drag
// deposit far more paint than a fast one covering the same path, since a
// real pointer fires many more events per px when moving slowly.
let brushCumDist     = 0
let brushNextStampAt = 0
// Keeps depositing dabs at the held pointer position while the mouse stays
// down but doesn't move — distance-based stamping alone (above) only fires
// when the pointer actually travels, so a real pen just resting in one spot
// would otherwise never build up further, unlike a real brush loaded with
// ink. Ticks independently of movement; see startBrushHoldTimer.
let brushHoldTimer = null
const BRUSH_HOLD_INTERVAL_MS = 40

// ── Mix (smudge) tool state ────────────────────────────────
let mixBuf      = null  // "carried" paint sampled under the brush, updated as the stroke moves
let mixR        = 0     // sample radius (px) for the current stroke
let mixLast     = null  // last mousemove position (NOT last stamp — see mixNextStampAt)
let mixMaskCache = null // effective selection mask, cached per stroke
let _mixMaskCanvas = null, _mixMaskRadius = -1  // cached soft circular falloff mask, keyed by radius
// Cumulative path length travelled since mousedown, and the cumulative
// length at which the next dab is due — NOT reset per mousemove event. A
// real pointer fires mousemove far more often when moving slowly (a slow
// drag or hand jitter can produce many events for a couple of px each) than
// when moving fast; stamping unconditionally once per event — as this used
// to — stamped the same near-stationary spot dozens of times over for a
// slow drag, wildly overshooting the ~8-overlapping-dabs assumption
// stampMixAt's alpha math is solved for (see MIX_DAB_OVERLAP) and depositing
// far more/darker pigment, over a much wider area, than an equivalent fast
// drag over the same path — this is what made mixing feel like it painted
// solid colour into "empty" space and made strength feel inconsistent.
// Tracking distance-since-last-dab across events (instead of per-event)
// guarantees dabs land every `spacing` px along the actual path regardless
// of how many (or how few) mousemove events that path was split across.
let mixCumDist     = 0
let mixNextStampAt = 0

function mixRadius() {
  return Math.max(3, Math.round(lineWidth.value * 1.5))
}

// Soft round falloff mask (opaque centre → transparent edge), reused while the radius is unchanged
function getMixFalloffMask(r) {
  if (_mixMaskCanvas && _mixMaskRadius === r) return _mixMaskCanvas
  const c = mkCanvas(r * 2, r * 2)
  const g = c.getContext('2d')
  const grad = g.createRadialGradient(r, r, 0, r, r, r)
  grad.addColorStop(0,   'rgba(255,255,255,1)')
  grad.addColorStop(0.6, 'rgba(255,255,255,1)')
  grad.addColorStop(1,   'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.beginPath(); g.arc(r, r, r, 0, Math.PI * 2); g.fill()
  _mixMaskCanvas = c; _mixMaskRadius = r
  return c
}

function sampleCanvasRegion(srcCanvas, cx, cy, r) {
  const buf = mkCanvas(r * 2, r * 2)
  // cx/cy are fractional (interpolated dab positions). Rounding them to the
  // nearest whole pixel before cropping means this drawImage is always a
  // 1:1, pixel-aligned copy — no scaling/sub-pixel offset means the browser
  // never has a reason to resample, so this is an exact copy regardless of
  // imageSmoothingEnabled. That matters: sub-pixel cropping WITH smoothing
  // bilinear-blends the source, which for Mix's repeated round-trip
  // sample→blend→re-sample loop introduced a tiny but real per-dab colour
  // bias — invisible on one dab, but compounding over many into a visible
  // darken/lighten drift on prolonged scrubbing over the same area, even on
  // a perfectly uniform source with nothing to actually blend toward.
  // Disabling smoothing instead of rounding "fixes" the drift too, but
  // trades it for visible terracing in the falloff mask's soft gradient
  // when it's later drawn at a sub-pixel offset — pixel-snapping avoids
  // both problems at once by never triggering resampling anywhere.
  const sx = Math.round(cx - r), sy = Math.round(cy - r)
  buf.getContext('2d').drawImage(srcCanvas, sx, sy, r * 2, r * 2, 0, 0, r * 2, r * 2)
  return buf
}

function handleMixDown(p) {
  const ctx = getActiveCtx()
  if (!ctx) return
  mixR = mixRadius()
  mixBuf  = sampleCanvasRegion(ctx.canvas, p.x, p.y, mixR)
  mixLast = { x: p.x, y: p.y }
  mixMaskCache = (selActive.value && (selRect.value || selMaskCanvas)) ? getEffectiveMask() : null
  mixCumDist     = 0
  mixNextStampAt = 0
}

const MIX_PICKUP_RATE = 0.35  // how fast the carried paint drifts toward newly-touched pixels, independent of opacity

// handleMixMove spaces dabs at mixR/8, so a straight drag re-stamps any
// given pixel near the stroke's centreline about 2r / (r/8) = 16 times.
// (Was mixR/4 / 8 overlaps — too sparse: consecutive dabs' soft falloff
// edges didn't overlap enough to blend into a smooth gradient, showing up
// as a visible repeating ripple/wave pattern along a pushed trail. Same
// class of fix as brushDabSpacing's tightening for the paint brushes.)
const MIX_DAB_OVERLAP = 16

function stampMixAt(ctx, q) {
  const r = mixR
  // Cap the per-dab alpha well under 1 so a single overlapping dab never fully
  // overwrites the destination — otherwise a wide brush painting ahead of itself
  // at full opacity would erase the very colours later steps need to pick up,
  // degenerating into a hard clone-stamp instead of a blend.
  //
  // That cap has to account for MIX_DAB_OVERLAP, though: source-over alpha
  // compounds across overlapping dabs (after n dabs at alpha a, coverage is
  // 1 - (1-a)^n), so stamping at the "intended" strength on every one of
  // ~8 overlapping dabs would compound to near-total opacity regardless of
  // how low that strength looks on its own — the mixed colour comes out far
  // darker/more saturated, over a much wider swath, than the strength
  // slider implies. Solve for the per-dab alpha that compounds back to the
  // intended strength instead of applying it directly.
  const desiredStrength = (strokeOpacity.value / 100) * 0.5
  if (desiredStrength <= 0) return
  const strength = 1 - Math.pow(1 - desiredStrength, 1 / MIX_DAB_OVERLAP)

  // Sample what's actually under the brush *before* painting, so the pickup
  // below reflects the untouched destination rather than what we just laid down
  // (sampling after painting would make the carried buffer a copy of itself
  // every step, freezing it at the very first colour picked up).
  const freshBefore = sampleCanvasRegion(ctx.canvas, q.x, q.y, r)

  // Carried paint, clipped to a soft round falloff
  const stamp = mkCanvas(r * 2, r * 2)
  const sctx = stamp.getContext('2d')
  sctx.drawImage(mixBuf, 0, 0)
  sctx.globalCompositeOperation = 'destination-in'
  sctx.drawImage(getMixFalloffMask(r), 0, 0)
  sctx.globalCompositeOperation = 'source-over'

  // Further clip by the active selection, if any
  if (mixMaskCache) {
    const selCrop = sampleCanvasRegion(mixMaskCache, q.x, q.y, r)
    sctx.globalCompositeOperation = 'destination-in'
    sctx.drawImage(selCrop, 0, 0)
    sctx.globalCompositeOperation = 'source-over'
  }

  ctx.save()
  ctx.globalAlpha = strength
  // Same pixel-snapping reasoning as sampleCanvasRegion: q.x/q.y are
  // fractional, and drawing `stamp` (a genuinely smooth radial falloff —
  // getMixFalloffMask) at a sub-pixel offset forces a resample either way
  // — bilinear blending compounds into the darkening-drift bug over many
  // overlapping dabs, while disabling smoothing instead quantizes the
  // falloff's own gradient into visible terraced/banded rings. Rounding to
  // the nearest pixel makes this a 1:1 aligned draw, so neither problem
  // has anything to resample.
  ctx.drawImage(stamp, Math.round(q.x - r), Math.round(q.y - r))
  ctx.restore()

  // Drift the carried paint toward the colours it just passed over
  const mbCtx = mixBuf.getContext('2d')
  mbCtx.save()
  mbCtx.globalAlpha = MIX_PICKUP_RATE
  mbCtx.drawImage(freshBefore, 0, 0)
  mbCtx.restore()
}

function handleMixMove(p) {
  const ctx = getActiveCtx()
  if (!ctx || !mixBuf) return
  const spacing = Math.max(2, mixR / 8)
  const dx = p.x - mixLast.x, dy = p.y - mixLast.y
  const dist = Math.hypot(dx, dy)
  // Stamp at fixed distance intervals along the actual travelled path,
  // tracked cumulatively across events — NOT once per event. A slow drag
  // (or hand jitter) fires far more mousemove events per px than a fast
  // one; stamping unconditionally per event used to re-stamp a near-
  // stationary spot dozens of times for a slow drag, blowing way past the
  // ~8-overlap the alpha math in stampMixAt is solved for and depositing
  // far more pigment, over a much wider area, than the same drag done
  // quickly — see mixCumDist's declaration.
  if (dist > 0) {
    const segStart = mixCumDist
    mixCumDist += dist
    while (mixNextStampAt <= mixCumDist) {
      const t = (mixNextStampAt - segStart) / dist
      stampMixAt(ctx, { x: mixLast.x + dx * t, y: mixLast.y + dy * t })
      mixNextStampAt += spacing
    }
  }
  mixLast = { x: p.x, y: p.y }
  // Usually paints onto the active layer directly; in selDrawMode it's
  // actually selFloat that gets touched instead (no layer canvas changes
  // then) — pass activeLayerId either way since a redundant refresh for a
  // layer that turns out untouched is harmless, unlike skipping one that
  // wasn't.
  requestComposite(activeLayerId.value)
}

function handleMixUp() {
  mixBuf = null; mixLast = null; mixMaskCache = null
}

function activeDrawColor() {
  return drawingButton === 2 ? fillColor.value : currentColor.value
}

function getActiveCtx() {
  if (selDrawMode.value && selFloat) return selFloat.canvas.getContext('2d')
  return activeLayer.value?.canvas.getContext('2d') ?? null
}

// ── Brush plugin stroke runner ──────────────────────────────
// Generic driver for any registry plugin with type: 'brush' (see
// plugins/builtin/brushes.js for the plugin contract). Owns everything a
// brush plugin shouldn't have to reimplement itself: snapshot/restore,
// selection-mask clipping, compositeOperation (source-over vs
// destination-out for erasers), and — see compositeStroke() below — the
// Size/Hardness/Opacity/Flow model: a plugin's paint()/stamp() only ever
// draws in plain source-over onto whatever ctx it's handed, at whatever
// alpha IT decides (normally settings.flow), and never needs to know
// about the stroke-wide Opacity ceiling at all.
function brushSettings() {
  const t = ensureBrushToolSettings(currentTool.value)
  return {
    color:     activeDrawColor(),
    lineWidth: t.size,
    hardness:  t.hardness,
    opacity:   t.opacity / 100,
    flow:      t.flow / 100,
  }
}

// Distance between dabs for a 'stamp'-mode plugin. A fixed plugin.stampSpacing
// (e.g. airbrush's scatter cadence) wins if given; otherwise derived from the
// plugin's own on-canvas footprint (cursorDiameter — the same figure the
// hover cursor circle uses) so tiny and huge brushes both look like a smooth
// continuous line rather than either dots-with-gaps or wastefully dense dabs.
// Deliberately tight (≈1/8 diameter, floor 1px): at anything looser, a hard-
// edged (high-Hardness) dab under 100% Flow shows visible discrete rings
// along the stroke where consecutive dabs' edges overlap — this is affordable
// now that accumulating a dab (accumulateDab) is decoupled from the
// expensive full-layer composite step (compositeStroke), which only runs
// once per pointermove event instead of once per dab — see onPointerMove.
function brushDabSpacing(plugin) {
  if (typeof plugin.stampSpacing === 'number') return plugin.stampSpacing
  const diameter = plugin.cursorDiameter ? plugin.cursorDiameter(lineWidth.value) : lineWidth.value
  return Math.max(1, diameter / 8)
}

function isMasked() {
  return selActive.value && (selRect.value || selMaskCanvas)
}

// Composites the stroke-so-far (strokeCanvas, which paint()/stamp() have
// been accumulating Flow-alpha dabs into — see its declaration) onto the
// real layer, restoring the pre-stroke snapshot first so this can be called
// repeatedly as the stroke progresses without double-applying anything.
//
// The key move: strokeCanvas's own per-pixel alpha can reach all the way to
// ~1 wherever Flow-alpha dabs have overlapped enough times (that build-up
// IS what Flow controls — low flow needs many overlapping passes to reach
// full local coverage, high flow gets there in one) — but drawImage()-ing
// strokeCanvas onto the layer through an outer ctx.globalAlpha = opacity
// multiplies that per-pixel alpha down by `opacity`, so the stroke's
// effective coverage can never exceed Opacity no matter how much Flow
// build-up happened inside strokeCanvas. That's exactly Photoshop's
// Opacity-caps-Flow-buildup relationship.
function compositeStroke(plugin, settings) {
  const ctx = getActiveCtx()
  const { width: lw, height: lh } = activeLayer.value.canvas
  ctx.putImageData(layerSnapshot, 0, 0)

  let src = strokeCanvas
  if (isMasked() && maskCache) {
    // Clip a COPY, not strokeCanvas itself — future dabs this stroke still
    // need to accumulate onto the raw (unmasked) buffer.
    const tmp = mkCanvas(lw, lh)
    const tc = tmp.getContext('2d')
    tc.drawImage(strokeCanvas, 0, 0)
    tc.globalCompositeOperation = 'destination-in'
    tc.drawImage(maskCache, 0, 0)
    src = tmp
  }

  ctx.globalCompositeOperation = plugin.blend || 'source-over'
  ctx.globalAlpha = settings.opacity
  ctx.drawImage(src, 0, 0)
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
}

// 'path'-mode: replays the whole accumulated path each call, at Flow alpha,
// into a freshly-cleared strokeCanvas (path-mode plugins draw the path as
// ONE shape via ctx.stroke(), which — unlike stamped dabs — doesn't
// self-compound where it crosses itself within a single call, so there's no
// true per-pass Flow build-up here the way stamp-mode dabs get; only
// Opacity's ceiling behaviour applies). No built-in plugin uses this mode
// any more (pen/brush/eraser are all 'stamp' now, for real Hardness/Flow
// support) — kept for any third-party plugin that wants a smooth vector-
// style stroke without dab texture.
function renderBrushPath(plugin, points) {
  const settings = brushSettings()
  const { width: lw, height: lh } = activeLayer.value.canvas
  const sctx = strokeCanvas.getContext('2d')
  sctx.clearRect(0, 0, lw, lh)
  sctx.globalCompositeOperation = 'source-over'
  sctx.globalAlpha = settings.flow
  plugin.paint(sctx, points, settings)
  sctx.globalAlpha = 1
  compositeStroke(plugin, settings)
}

// 'stamp'-mode dabs accumulate into strokeCanvas (never cleared mid-stroke)
// at Flow alpha — overlapping dabs (a lingering cursor, a slow drag, or
// deliberately scribbling back and forth) compound via normal source-over
// blending, which is exactly Flow's "build up toward Opacity with repeated
// passes" behaviour. See compositeStroke() for the Opacity ceiling this
// gets composited through.
//
// Accumulates one dab into strokeCanvas ONLY — cheap (a small offscreen
// draw), unlike compositeStroke (a full-layer-sized putImageData +
// drawImage). Multiple dabs from one pointermove event should all call
// this in a loop and let the caller composite ONCE afterward — see
// onPointerMove's stamp-mode branch. Calling compositeStroke once per dab
// (the original version of this split) made small brushes (which space
// dabs much closer together in absolute px) visibly janky, since a single
// fast mousemove could queue up dozens of full-layer composites.
function accumulateDab(plugin, point, settings) {
  const sctx = strokeCanvas.getContext('2d')
  sctx.globalCompositeOperation = 'source-over'
  sctx.globalAlpha = settings.flow
  plugin.stamp(sctx, point, settings)
  sctx.globalAlpha = 1
}

// Single-dab convenience wrapper (accumulate + composite together) for
// call sites that only ever place exactly one dab, e.g. onPointerDown's
// click-with-no-drag mark.
function stampBrush(plugin, point) {
  const settings = brushSettings()
  accumulateDab(plugin, point, settings)
  compositeStroke(plugin, settings)
}

// rAF-throttled compositeStroke — same pattern as requestComposite (the
// multi-layer display merge) below, applied to the single-layer stroke
// composite. A fast drag with a small brush can accumulate many dabs
// across many pointermove events within one animation frame (spacing is
// tight — see brushDabSpacing — specifically so small brushes don't show
// banding), and compositeStroke's putImageData+drawImage cost is O(layer
// area) regardless of how many dabs it's asked to show — coalescing every
// event within a frame into one compositeStroke call, instead of one per
// event, is what actually fixes small-brush jank rather than just moving
// it from "per dab" (the earlier, worse version) to "per event".
let _strokeCompositeRAF = null
function requestStrokeComposite() {
  if (_strokeCompositeRAF) return
  _strokeCompositeRAF = requestAnimationFrame(() => {
    _strokeCompositeRAF = null
    if (!drawing || !strokeCanvas) return
    const plugin = getPlugin(currentTool.value)
    if (plugin?.type !== 'brush') return
    compositeStroke(plugin, brushSettings())
  })
}

// Keeps depositing dabs at brushStampLast (the current held position, kept
// up to date by onPointerMove even when the pointer isn't travelling far
// enough to trigger a distance-based dab) for as long as the stroke stays
// active — see brushHoldTimer's declaration for why. Self-guards against
// `drawing` having gone false through some path that didn't explicitly
// call stopBrushHoldTimer, so an exhaustive audit of every draw-cancelling
// code path isn't required for correctness.
function startBrushHoldTimer(plugin) {
  stopBrushHoldTimer()
  brushHoldTimer = setInterval(() => {
    if (!drawing || !strokeCanvas || getPlugin(currentTool.value) !== plugin) { stopBrushHoldTimer(); return }
    const settings = brushSettings()
    accumulateDab(plugin, brushStampLast, settings)
    compositeStroke(plugin, settings)
    requestComposite(activeLayerId.value)
  }, BRUSH_HOLD_INTERVAL_MS)
}
function stopBrushHoldTimer() {
  if (brushHoldTimer) { clearInterval(brushHoldTimer); brushHoldTimer = null }
}

function applyStyle(ctx) {
  ctx.globalAlpha              = strokeOpacity.value / 100
  ctx.strokeStyle              = activeDrawColor()
  ctx.lineWidth                = lineWidth.value
  ctx.lineCap                  = 'round'
  ctx.lineJoin                 = 'round'
  ctx.globalCompositeOperation = 'source-over'
}

function drawLine(ctx, x1, y1, x2, y2) {
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke()
}

function drawRect(ctx, x1, y1, x2, y2) {
  const rx = Math.min(x1,x2), ry = Math.min(y1,y2)
  const rw = Math.abs(x2-x1), rh = Math.abs(y2-y1)
  ctx.fillStyle = fillColor.value
  ctx.fillRect(rx, ry, rw, rh); ctx.strokeRect(rx, ry, rw, rh)
}

function drawCircle(ctx, x1, y1, x2, y2) {
  ctx.beginPath()
  ctx.ellipse((x1+x2)/2, (y1+y2)/2, Math.abs(x2-x1)/2, Math.abs(y2-y1)/2, 0, 0, Math.PI*2)
  ctx.fillStyle = fillColor.value; ctx.fill(); ctx.stroke()
}

// ── Flood fill ────────────────────────────────────────────
function floodFill(x, y, color = currentColor.value, clip = null, targetCanvas = null) {
  const layer = activeLayer.value
  if (!layer) return
  const canvas = targetCanvas || layer.canvas
  const ctx = canvas.getContext('2d')
  const w = canvas.width, h = canvas.height

  // Clamp start point to clip rect when mask is active
  if (clip) {
    if (x < clip.x || x >= clip.x + clip.w || y < clip.y || y >= clip.y + clip.h) return
  }

  const imgData = ctx.getImageData(0, 0, w, h)
  const data = imgData.data

  const ci = (y * w + x) * 4
  const target = [data[ci], data[ci + 1], data[ci + 2], data[ci + 3]]
  const fill = hexToRgba(color)

  const matches = (i) =>
    Math.abs(data[i]   - target[0]) <= 15 &&
    Math.abs(data[i+1] - target[1]) <= 15 &&
    Math.abs(data[i+2] - target[2]) <= 15 &&
    Math.abs(data[i+3] - target[3]) <= 15

  if (matches(ci) && data[ci] === fill[0] && data[ci+1] === fill[1] &&
      data[ci+2] === fill[2] && data[ci+3] === fill[3]) return

  const visited = new Uint8Array(w * h)
  const stack = [x + y * w]
  while (stack.length) {
    const pos = stack.pop()
    if (visited[pos]) continue
    visited[pos] = 1
    const px = pos * 4
    if (!matches(px)) continue
    data[px] = fill[0]; data[px+1] = fill[1]; data[px+2] = fill[2]; data[px+3] = fill[3]
    const col = pos % w, row = (pos / w) | 0
    if (col > 0     && (!clip || col - 1 >= clip.x))                    stack.push(pos - 1)
    if (col < w - 1 && (!clip || col + 1 <  clip.x + clip.w))           stack.push(pos + 1)
    if (row > 0     && (!clip || row - 1 >= clip.y))                    stack.push(pos - w)
    if (row < h - 1 && (!clip || row + 1 <  clip.y + clip.h))           stack.push(pos + w)
  }
  ctx.putImageData(imgData, 0, 0)
}

function hexToRgba(hex) {
  return [parseInt(hex.slice(1,3),16), parseInt(hex.slice(3,5),16), parseInt(hex.slice(5,7),16), 255]
}

// ── Eyedropper ────────────────────────────────────────────
function pickColor(x, y) {
  const p = canvasRef.value.getContext('2d').getImageData(x, y, 1, 1).data
  currentColor.value = '#' + [p[0],p[1],p[2]].map(v => v.toString(16).padStart(2,'0')).join('')
  currentTool.value = 'pen'
}

// ── Pointer events ────────────────────────────────────────
function canvasPoint(e) {
  const area   = wrapperRef.value
  const canvas = canvasRef.value
  const ar = area.getBoundingClientRect()
  let dx = e.clientX - (ar.left + ar.width / 2)
  let dy = e.clientY - (ar.top  + ar.height / 2)
  dx -= viewX.value; dy -= viewY.value
  const rad = -viewR.value * Math.PI / 180
  const rdx = dx * Math.cos(rad) - dy * Math.sin(rad)
  const rdy = dx * Math.sin(rad) + dy * Math.cos(rad)
  const s = fitScale.value
  return {
    x: Math.round(rdx / s + canvas.width  / 2),
    y: Math.round(rdy / s + canvas.height / 2),
  }
}

let viewDrag = null

function onPointerDown(e) {
  if (e.button !== 0 && e.button !== 2) return
  // The canvas wrapper only gets mousemove/mouseup while the cursor is over
  // it — a fast stroke (more likely to outrun the cursor when a heavy
  // layer stack makes rendering fall behind) can slip past its edge for an
  // instant, at which point onPointerLeave used to treat that as "done" and
  // cut the stroke off mid-draw. Track the rest of this drag on window
  // instead, same pattern as the panel/popup resize handlers elsewhere in
  // this file, so drawing (or any other drag: pan, select, move, transform,
  // mix) keeps going anywhere on the page until the button is actually
  // released.
  window.addEventListener('mousemove', onPointerMove)
  window.addEventListener('mouseup', onPointerUp)
  if (currentTool.value === 'pan' || currentTool.value === 'rotate') {
    if (e.button !== 0) return
    if (currentTool.value === 'pan')
      viewDrag = { type: 'pan', sx: e.clientX, sy: e.clientY, svx: viewX.value, svy: viewY.value }
    else
      viewDrag = { type: 'rotate', sx: e.clientX, svr: viewR.value }
    return
  }
  drawingButton = e.button
  if (!activeLayer.value || !isLayerEditable(activeLayer.value)) return
  const p = canvasPoint(e)
  startX = p.x; startY = p.y

  // ── Transform handles take priority over move/new-selection ──
  if (selFloat && !selFloat.drawMode) {
    const hitHandle = hitTestSelHandle(p)
    if (hitHandle) { startTransformDrag(hitHandle, p); return }
  }

  // ── Selection / Move tools ──
  if (currentTool.value === 'move')        { handleMoveDown(p); return }
  if (currentTool.value === 'select_rect') { handleSelRectDown(p); return }
  if (currentTool.value === 'lasso')      { drawing = true; handleLassoDown(p);   return }
  if (currentTool.value === 'sel_pen')    { drawing = true; handleSelPenDown(p);  return }
  if (currentTool.value === 'sel_eras')   { drawing = true; handleSelErasDown(p); return }
  if (currentTool.value === 'magic_wand') { handleMagicWandDown(p, e.shiftKey);   return }
  if (currentTool.value === 'text')       { handleTextDown(p);                     return }

  // ── Widget-as-tool plugins (e.g. sticky notes): place at the click point ──
  const widgetTool = getPlugin(currentTool.value)
  if (widgetTool?.type === 'widget' && widgetTool.asTool) { widgetTool.placeAt?.(p.x, p.y); return }

  if (currentTool.value === 'fill') {
    if (selDrawMode.value && selFloat && selMaskCanvas) {
      // selDrawMode: fill on float canvas, then mask to colored region
      floodFill(p.x, p.y, activeDrawColor(), null, selFloat.canvas)
      const fctx = selFloat.canvas.getContext('2d')
      fctx.globalCompositeOperation = 'destination-in'
      fctx.drawImage(selMaskCanvas, 0, 0)
      fctx.globalCompositeOperation = 'source-over'
    } else {
      const clip = selActive.value ? selRect.value : null
      floodFill(p.x, p.y, activeDrawColor(), clip)
    }
    composite(activeLayerId.value)
    saveHistory([activeLayerId.value])
    return
  }
  if (currentTool.value === 'eyedropper') {
    pickColor(p.x, p.y)
    return
  }
  if (currentTool.value === 'mix') { drawing = true; handleMixDown(p); return }

  drawing = true
  const ctx = getActiveCtx()
  const { width: lw, height: lh } = activeLayer.value.canvas
  layerSnapshot = ctx.getImageData(0, 0, lw, lh)

  const masked = selActive.value && (selRect.value || selMaskCanvas)
  const brushPlugin = getPlugin(currentTool.value)
  const isBrush = brushPlugin?.type === 'brush'

  if (isBrush) {
    strokePoints = [{ x: p.x, y: p.y }]
    brushStampLast = { x: p.x, y: p.y }
    brushCumDist = 0
    brushNextStampAt = 0
    // strokeCanvas accumulates this stroke's Flow-alpha dabs for its whole
    // duration (masked or not) — see compositeStroke()'s comment for why
    // this always exists now, not just under a selection mask.
    strokeCanvas = mkCanvas(lw, lh)
    if (masked) maskCache = getEffectiveMask()
  }

  if (isBrush && brushPlugin.mode === 'stamp') {
    // A single click with no move should still leave a mark.
    stampBrush(brushPlugin, p)
    requestComposite(activeLayerId.value)
    startBrushHoldTimer(brushPlugin)
  }
}

let _lastPointerMoveAt = 0
function onPointerMove(e) {
  if (!PERF_DEBUG || e._atelierHandled) { _onPointerMoveInner(e); return }
  const now = performance.now()
  if (_lastPointerMoveAt && now - _lastPointerMoveAt > 40)
    console.log(`[perf] pointermove gap ${(now - _lastPointerMoveAt).toFixed(1)}ms since last — event(s) likely dropped/coalesced by the browser`)
  _lastPointerMoveAt = now
  _onPointerMoveInner(e)
  const dt = performance.now() - now
  if (dt > 8) console.log(`[perf] onPointerMove handler took ${dt.toFixed(1)}ms`)
}
function _onPointerMoveInner(e) {
  // While a drag is active this same native event reaches us twice — once
  // via the wrapper's own @mousemove (bubble phase, cursor still over the
  // canvas) and again via the window listener added in onPointerDown — so
  // tag it to only process once.
  if (e._atelierHandled) return
  e._atelierHandled = true
  if (viewDrag) {
    if (viewDrag.type === 'pan') {
      viewX.value = viewDrag.svx + e.clientX - viewDrag.sx
      viewY.value = viewDrag.svy + e.clientY - viewDrag.sy
    } else {
      viewR.value = viewDrag.svr + (e.clientX - viewDrag.sx) * 0.4
    }
    return
  }
  const p = canvasPoint(e)
  cursorPos.value = p
  const _ar = wrapperRef.value.getBoundingClientRect()
  brushCursorScreen.value = { x: e.clientX - _ar.left, y: e.clientY - _ar.top }

  // Update hover handle (runs every frame so cursor stays correct)
  selHoverHandle.value = (selFloat && !selFloat.drawMode && !selTransformDrag) ? hitTestSelHandle(p) : null

  // ── Transform drag ──
  if (selTransformDrag) { handleTransformMove(p); return }

  // ── Selection / Move ──
  if (selState.value === 'moving') { handleSelMoveMove(p); return }
  if (drawing && currentTool.value === 'move')       { handleMoveMove(p);    return }
  if (selState.value === 'selecting' && currentTool.value === 'select_rect') { handleSelRectMove(p); return }
  if (drawing && currentTool.value === 'lasso')    { handleLassoMove(p);   return }
  if (drawing && currentTool.value === 'sel_pen')  { handleSelPenMove(p);  return }
  if (drawing && currentTool.value === 'sel_eras') { handleSelErasMove(p); return }
  if (drawing && currentTool.value === 'mix')      { handleMixMove(p);     return }

  if (!drawing || !activeLayer.value) return

  const ctx    = getActiveCtx()
  const masked = selActive.value && (selRect.value || selMaskCanvas)
  const brushPlugin = getPlugin(currentTool.value)

  if (brushPlugin?.type === 'brush') {
    if (brushPlugin.mode === 'stamp') {
      const spacing = brushDabSpacing(brushPlugin)
      const dx = p.x - brushStampLast.x, dy = p.y - brushStampLast.y
      const dist = Math.hypot(dx, dy)
      // Stamp at fixed distance intervals along the actual travelled path,
      // tracked cumulatively across events — not once per event — for the
      // same reason as Mix's identical fix: a slow/jittery drag fires far
      // more mousemove events per px than a fast one, and stamping once per
      // event regardless of distance would deposit far more paint (Flow
      // compounds per dab) for a slow stroke than a fast one over the same
      // path. See brushCumDist's declaration.
      if (dist > 0) {
        const settings = brushSettings()
        const segStart = brushCumDist
        brushCumDist += dist
        let stamped = false
        while (brushNextStampAt <= brushCumDist) {
          const t = (brushNextStampAt - segStart) / dist
          accumulateDab(brushPlugin, { x: brushStampLast.x + dx * t, y: brushStampLast.y + dy * t }, settings)
          brushNextStampAt += spacing
          stamped = true
        }
        // rAF-throttled: coalesces every pointermove within one frame into
        // a single full-layer composite — see requestStrokeComposite.
        if (stamped) requestStrokeComposite()
      }
      brushStampLast = { x: p.x, y: p.y }
    } else {
      strokePoints.push({ x: p.x, y: p.y })
      renderBrushPath(brushPlugin, strokePoints)
    }
    requestComposite(activeLayerId.value)
  } else if (layerSnapshot) {
    ctx.putImageData(layerSnapshot, 0, 0)
    applyStyle(ctx)
    if (masked && !selDrawMode.value) { ctx.save(); applyMaskClip(ctx) }
    if (currentTool.value === 'line')   drawLine(ctx, startX, startY, p.x, p.y)
    if (currentTool.value === 'rect')   drawRect(ctx, startX, startY, p.x, p.y)
    if (currentTool.value === 'circle') drawCircle(ctx, startX, startY, p.x, p.y)
    if (masked && !selDrawMode.value) ctx.restore()
    if (masked && selDrawMode.value && maskCache) {
      ctx.globalCompositeOperation = 'destination-in'
      ctx.drawImage(maskCache, 0, 0)
      ctx.globalCompositeOperation = 'source-over'
    }
    requestComposite(activeLayerId.value)
  }
}

// A remote sync update can arrive (async image decode) at any point,
// including mid-stroke, and applyRemoteLayers() itself is async (each
// incoming layer's dataURL decodes via Image.onload). Two updates arriving
// close together — e.g. a peer sending several quick edits — must never
// run through applyRemoteLayers() concurrently: whichever decode happens
// to resolve last wins regardless of arrival order, and both calls stamp
// _lastSynced from their own possibly-stale intermediate snapshot, which
// can make an already-applied peer edit look locally "changed" again and
// get echoed back to the server with a rev older than what that peer just
// pushed (see the rejected_stale log in syncRoom.js). So every update
// always goes through this one queue and is drained strictly one at a
// time, never in parallel — additionally paused while the local user is
// mid-stroke, since drawing tools write onto the active layer's canvas via
// a live-held context (getActiveCtx()) and swapping that canvas's content
// out from under an in-progress stroke corrupts it.
let _pendingRemoteUpdates = []
let _drainingRemoteUpdates = false

function queueOrApplyRemoteUpdate(payload) {
  _pendingRemoteUpdates.push(payload)
  drainRemoteUpdates()
}

async function drainRemoteUpdates() {
  if (_drainingRemoteUpdates) return
  _drainingRemoteUpdates = true
  try {
    while (_pendingRemoteUpdates.length && !drawing) {
      const payload = _pendingRemoteUpdates.shift()
      await lc.applyRemoteLayers(payload)
    }
  } finally {
    _drainingRemoteUpdates = false
  }
}

function onPointerUp(e) {
  // Same event can reach us via both the wrapper's @mouseup and the window
  // listener added in onPointerDown — process it once. e is only present
  // when called as a real event handler (window listener, or the
  // template's @mouseup); internal callers invoke this with no event.
  if (e) {
    if (e._atelierHandled) return
    e._atelierHandled = true
  }
  window.removeEventListener('mousemove', onPointerMove)
  window.removeEventListener('mouseup', onPointerUp)
  _onPointerUpInner()
  if (!drawing) drainRemoteUpdates()
}

function _onPointerUpInner() {
  if (viewDrag) { viewDrag = null; return }

  // ── Transform handle up ──
  if (selTransformDrag) { handleTransformUp(); return }

  // ── Selection / Move up ──
  if (selState.value === 'moving') { drawing = false; handleSelRectUp(); return }
  if (currentTool.value === 'move'        && drawing) { handleMoveUp();    return }
  if (currentTool.value === 'select_rect')            { drawing = false; handleSelRectUp(); return }
  if (currentTool.value === 'lasso'    && drawing)    { drawing = false; handleLassoUp();   return }
  if (currentTool.value === 'sel_pen'  && drawing)    { drawing = false; handleSelPenUp();  return }
  if (currentTool.value === 'sel_eras' && drawing)    { drawing = false; handleSelErasUp(); return }
  if (currentTool.value === 'mix'      && drawing)    { drawing = false; handleMixUp(); composite(activeLayerId.value); saveHistory([activeLayerId.value]); return }

  if (!drawing) return
  drawing = false
  stopBrushHoldTimer()
  layerSnapshot = null
  strokeCanvas = null; maskCache = null; strokePoints = []; brushStampLast = null
  brushCumDist = 0; brushNextStampAt = 0
  const ctx = getActiveCtx()
  if (ctx) {
    ctx.closePath()
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
  }
  composite(activeLayerId.value)
  saveHistory([activeLayerId.value])
}

function onPointerLeave() {
  cursorPos.value = null
  brushCursorScreen.value = null
  selHoverHandle.value = null
  // Every in-progress drag (drawing included) now keeps tracking via the
  // window listener attached in onPointerDown, so leaving the canvas
  // element's bounds is no longer where any of them end — only an actual
  // mouseup is. Nothing else to do here beyond clearing the hover cursor.
}

// ── Touch ─────────────────────────────────────────────────
function t2m(e) {
  const touch = e.touches[0] || e.changedTouches[0]
  return { clientX: touch.clientX, clientY: touch.clientY, button: 0 }
}
function onTouchStart(e) { onPointerDown(t2m(e)) }
function onTouchMove(e)  {
  const active = viewDrag || drawing || selState.value === 'selecting' || selState.value === 'moving'
  if (active) onPointerMove(t2m(e))
}
function onTouchEnd() { onPointerUp() }

// ── Keyboard ──────────────────────────────────────────────
const keyMap = { p:'pen', b:'brush', a:'airbrush', m:'mix', l:'line', r:'rect', c:'circle', f:'fill', i:'eyedropper', e:'eraser', h:'pan', v:'move', s:'select_rect', q:'lasso', w:'sel_pen', g:'magic_wand', t:'text' }

function onKey(e) {
  // Block all shortcuts while text tool is active or text box is open
  if (textActive.value || currentTool.value === 'text') return

  if (e.ctrlKey && e.key === 'z')                     { e.preventDefault(); undo() }
  if (e.ctrlKey && (e.key === 'y' || e.key === 'Z')) { e.preventDefault(); redo() }
  if (e.ctrlKey && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomIn() }
  if (e.ctrlKey && e.key === '-')                     { e.preventDefault(); zoomOut() }
  if (e.ctrlKey && e.key === '0')                     { e.preventDefault(); resetView() }
  if (e.key === 'Escape')                             { cancelSelection() }
  if (!e.ctrlKey && !e.altKey && keyMap[e.key.toLowerCase()]) currentTool.value = keyMap[e.key.toLowerCase()]
}

// ── Init ──────────────────────────────────────────────────
function onResize() { vw.resizeCanvas(wrapperRef.value) }

onMounted(async () => {
  await nextTick()
  vw.resizeCanvas(wrapperRef.value)
  await lc.init()

  initCollabSync({ onRemoteUpdate: queueOrApplyRemoteUpdate })
  // Wait for the room's existing state (if any) to arrive before creating
  // — and broadcasting — this participant's own layer at whatever size the
  // canvas locally defaults to. Otherwise a joiner on a slow connection can
  // push their own device's default size before the room's real size gets
  // applied, clobbering it for everyone else already there.
  await waitForJoin()
  lc.ensureOwnLayer()
  if (isSyncActive) nowTickTimer = setInterval(() => { nowTick.value = Date.now() }, 5000)

  changelogOpen.value = true

  const params   = new URLSearchParams(window.location.search)
  const cidParam = params.get('cid')
  if (cidParam) {
    ipfsRestoreCid.value  = cidParam
    ipfsGatewayHint.value = params.get('gw') ?? ''
    await restoreFromCid()
    ipfsGatewayHint.value = ''
    window.history.replaceState({}, '', window.location.pathname)
    if (ipfsStatus.value === 'error') {
      startupErrorMsg.value = ipfsStatusMsg.value
      setTimeout(() => { startupErrorMsg.value = '' }, 10000)
    }
  }

  window.addEventListener('resize',    onResize)
  window.addEventListener('keydown',   onKey)
  document.addEventListener('click',   closeAllPopups)
  document.addEventListener('contextmenu', e => e.preventDefault())
})

onUnmounted(() => {
  window.removeEventListener('resize',    onResize)
  window.removeEventListener('keydown',   onKey)
  document.removeEventListener('click',   closeAllPopups)
  if (nowTickTimer) clearInterval(nowTickTimer)
})
</script>

<style scoped>
/* ── Layout ──────────────────────────────────────────── */
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  background: #000000;
  overflow: hidden;
}

.app-body {
  flex: 1;
  display: flex;
  flex-direction: row;
  overflow: hidden;
  min-height: 0;
}

.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}


/* ── Tool selector button ────────────────────────────── */
.tool-selector {
  width: 30px;
  height: 30px;
}


/* ── Toolbar ─────────────────────────────────────────── */
.toolbar {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 34px;
  flex-shrink: 0;
  overflow-y: auto;
  overflow-x: hidden;
  gap: 4px;
  padding: 8px 0 max(8px, env(safe-area-inset-bottom)) 0;
  background: #0d0d0d;
  border-left: 1px solid #1a1a1a;
  user-select: none;
  scrollbar-width: none;
  position: relative;
  z-index: 10;
  touch-action: manipulation;
}
.toolbar::-webkit-scrollbar { display: none; }
.toolbar.tb-left {
  order: -1;
  border-left: none;
  border-right: 1px solid #1a1a1a;
}
.tb-bottom {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.tb-sep {
  width: 22px;
  height: 1px;
  background: #2a2a2a;
  margin: 2px 0;
  flex-shrink: 0;
}

.op-pct {
  font-size: 10px;
  color: #aaaaaa;
  line-height: 1;
  pointer-events: none;
}

.tool-btn {
  width: 30px;
  height: 30px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  font-size: 15px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #ccc;
  transition: background 0.12s, border-color 0.12s;
}
.tool-btn:hover  { background: #1c1c1c; }
.tool-btn.active { background: #252525; border-color: #6060cc; }

/* ── Color trigger (compact double-swatch button) ────── */
.color-trigger {
  position: relative;
  width: 30px;
  height: 30px;
  border: 1px solid #2a2a2a;
  border-radius: 6px;
  background: #1a1a1a;
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  transition: border-color 0.12s, background 0.12s;
}
.color-trigger:hover, .color-trigger.open {
  border-color: #6060cc;
  background: #1c1c1c;
}
.ts-fill, .ts-stroke {
  position: absolute;
  width: 13px;
  height: 13px;
  border-radius: 2px;
  border: 1px solid rgba(0,0,0,0.4);
}
.ts-fill   { bottom: 3px; right: 3px; }
.ts-stroke { top: 3px;    left: 3px; z-index: 1; }

/* ── Icon-only action buttons ────────────────────────── */
.icon-btn {
  width: 34px;
  height: 34px;
  border: 1px solid #2a2a2a;
  border-radius: 6px;
  background: #1a1a1a;
  color: #ccc;
  cursor: pointer;
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: background 0.12s;
  flex-shrink: 0;
}
.icon-btn:hover:not(:disabled) { background: #2a2a2a; }
.icon-btn:disabled { opacity: 0.35; cursor: not-allowed; }

/* ── Canvas area ─────────────────────────────────────── */
.canvas-area {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.canvas-vp {
  position: absolute;
  left: 50%;
  top: 50%;
  transform-origin: 50% 50%;
  box-shadow: 0 6px 32px rgba(0,0,0,0.6);
}

/* ── Selection overlays ──────────────────────────────── */
.sel-overlay {
  position: absolute;
  inset: 0;
  width: 100%; height: 100%;
  pointer-events: none;
  z-index: 15;
}
.sel-mask-ov {
  z-index: 14;
  mix-blend-mode: difference;
  opacity: 0.65;
}

/* ── Canvas cursor classes ───────────────────────────── */
.cur-crosshair .draw-canvas { cursor: crosshair; }
.cur-move      .draw-canvas { cursor: move; }
.cur-nwse      .draw-canvas { cursor: nwse-resize; }
.cur-nesw      .draw-canvas { cursor: nesw-resize; }
.cur-ns        .draw-canvas { cursor: ns-resize; }
.cur-ew        .draw-canvas { cursor: ew-resize; }
.cur-text      .draw-canvas { cursor: text; }

/* has-brush-cursor takes priority over the native browser cursor — the
   .brush-cursor circle below stands in for it. Doesn't apply while a
   selection-handle/move/etc cursor class is also active since those tools
   never set brushCursorDiameter, so has-brush-cursor and e.g. cur-move are
   mutually exclusive in practice. */
.has-brush-cursor .draw-canvas { cursor: none; }

/* Semi-transparent, centered on the pointer, sized to the current tool's
   brush diameter (brushCursorStyle sets left/top/width/height inline). The
   dark outer ring + light inner ring keeps it visible against both light
   and dark canvas backgrounds. */
.brush-cursor {
  position: absolute;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  background: rgba(255, 255, 255, 0.15);
  border: 1.5px solid rgba(255, 255, 255, 0.85);
  box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.55);
  pointer-events: none;
  z-index: 25;
}

/* ── Text overlay ────────────────────────────────────────── */
.text-placement {
  position: absolute;
  z-index: 30;
  pointer-events: all;
  transform-origin: top left;
  filter: drop-shadow(0 0 3px rgba(0,0,0,0.8));
}
.text-header {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 20px;
  padding: 0 6px;
  background: rgba(96, 96, 204, 0.85);
  border-radius: 4px 4px 0 0;
  cursor: grab;
  user-select: none;
}
.text-header:active { cursor: grabbing; }
.text-header-icon {
  font-size: 14px;
  color: #fff;
  opacity: 0.9;
  line-height: 1;
}
.text-header-hint {
  font-size: 10px;
  color: rgba(255,255,255,0.75);
  white-space: nowrap;
}
.text-ta {
  display: block;
  background: transparent;
  border: 2px solid rgba(96, 96, 204, 0.9);
  border-top: none;
  border-radius: 0 0 4px 4px;
  outline: none;
  resize: both;
  overflow: auto;
  min-width: 80px;
  min-height: 1.4em;
  padding: 4px 6px;
  caret-color: white;
  white-space: pre;
  box-sizing: border-box;
  width: 300px;
}

/* ── Canvas resize handles ───────────────────────────── */
.crh {
  position: absolute;
  background: rgba(96, 96, 204, 0.75);
  border-radius: 3px;
  z-index: 20;
  transition: background 0.15s, transform 0.1s;
}
.crh:hover { background: rgba(120, 120, 240, 0.95); }
.crh-r {
  right: -5px; top: 50%; transform: translateY(-50%);
  width: 5px; height: 40px; cursor: ew-resize;
}
.crh-b {
  bottom: -5px; left: 50%; transform: translateX(-50%);
  height: 5px; width: 40px; cursor: ns-resize;
}
.crh-br {
  right: -5px; bottom: -5px;
  width: 12px; height: 12px; cursor: nwse-resize;
  border-radius: 0 0 3px 0;
}
.crh-preview {
  position: absolute;
  top: 0; left: 0;
  border: 2px dashed rgba(96, 96, 204, 0.8);
  pointer-events: none;
  z-index: 19;
  box-sizing: border-box;
}
.crh-label {
  position: absolute;
  bottom: -26px; right: 0;
  background: rgba(20, 20, 40, 0.88);
  color: #aaaaff;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  white-space: nowrap;
  pointer-events: none;
}


.draw-canvas {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
}

/* ── Layer panel ─────────────────────────────────────── */
.layer-panel {
  display: flex;
  flex-direction: row;
  position: fixed;
  right: 34px;
  top: 34px;
  bottom: 0;
  width: 260px;
  overflow: hidden;
  transition: width 0.22s ease;
  background: #0d0d0d;
  border-left: 1px solid #1a1a1a;
  box-shadow: -4px 0 16px rgba(0,0,0,0.4);
  z-index: 200;
  touch-action: manipulation;
}
.layer-panel.collapsed {
  width: 0;
}
.layer-panel.lp-resizing {
  transition: none;
}
.layer-panel.lp-left {
  right: auto;
  left: 34px;
  border-left: none;
  border-right: 1px solid #1a1a1a;
  box-shadow: 4px 0 16px rgba(0,0,0,0.4);
}

/* Drag strip on the panel's free edge (opposite the screen-anchored side) */
.lp-resize-handle {
  position: absolute;
  top: 0; bottom: 0; left: -3px;
  width: 6px;
  cursor: ew-resize;
  z-index: 5;
  touch-action: none;
}
.lp-resize-handle:hover, .layer-panel.lp-resizing .lp-resize-handle {
  background: rgba(96,96,204,0.4);
}
.layer-panel.lp-left .lp-resize-handle {
  left: auto;
  right: -3px;
}

/* Panel body — overflows and gets clipped when collapsed */
.panel-inner {
  flex: 1;
  min-width: 192px;   /* prevents shrinking below content width; clip is via parent overflow:hidden */
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-bottom: 1px solid #1a1a1a;
  background: #111111;
  flex-shrink: 0;
}

.panel-title {
  font-size: 12px;
  font-weight: 600;
  color: #999999;
  letter-spacing: 0.05em;
}

.panel-actions {
  display: flex;
  gap: 3px;
}
.panel-actions button {
  width: 24px;
  height: 24px;
  border: 1px solid #2a2a2a;
  border-radius: 5px;
  background: #161616;
  color: #aaaaaa;
  cursor: pointer;
  font-size: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.12s;
}
.panel-actions button:hover:not(:disabled) { background: #252525; }
.panel-actions button:disabled { opacity: 0.3; cursor: not-allowed; }

/* ── Layer list ──────────────────────────────────────── */
.layer-list {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 4px 0;
}

.layer-item {
  /* Skip layout/paint for rows scrolled out of view — with two dozen+
     layers each carrying a thumbnail <canvas>, the browser was doing real
     rendering work for off-screen rows on every scroll frame. */
  content-visibility: auto;
  contain-intrinsic-size: auto 48px;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 6px;
  cursor: pointer;
  border-bottom: 1px solid #0d0d0d;
  transition: background 0.12s;
  min-width: 0;
  overflow: hidden;
}
.layer-item:hover   { background: #141414; }
.layer-item.active  { background: #1a1a1a; border-left: 3px solid #6060cc; padding-left: 5px; }
.layer-item.lp-readonly          { opacity: 0.5; filter: grayscale(0.6); }
.layer-item.lp-readonly.active   { border-left-color: #555; }

.layer-controls {
  display: flex;
  flex-wrap: wrap;
  width: 41px;
  gap: 1px;
  flex-shrink: 0;
  align-content: flex-start;
}

.lc-btn {
  width: 20px;
  height: 20px;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 12px;
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  padding: 0;
  transition: background 0.12s;
  flex-shrink: 0;
}
.lc-btn:hover:not(:disabled) { background: #252525; }
.lc-btn:disabled { opacity: 0.25; cursor: not-allowed; }

.thumb {
  width: 44px;
  height: 33px;
  flex-shrink: 0;
  border-radius: 3px;
  border: 1px solid #2a2a2a;
  image-rendering: pixelated;
}

.layer-meta {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.layer-name {
  font-size: 12px;
  color: #cccccc;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: text;
  user-select: none;
  flex: 1;
  min-width: 0;
}


.name-input {
  font-size: 12px;
  color: #ffffff;
  background: #252525;
  border: 1px solid #6060cc;
  border-radius: 3px;
  padding: 1px 4px;
  width: 100%;
  outline: none;
  box-shadow: none;
  -webkit-box-shadow: none;
}

.op-row {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  overflow: hidden;
}
.op-slider {
  flex: 1;
  min-width: 0;
  width: 0;
  height: 3px;
  accent-color: #6060cc;
  cursor: pointer;
}
.op-val-wrap {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  width: 32px;
  flex-shrink: 0;
}
.op-val-input {
  font-size: 10px;
  color: #666666;
  width: 0;
  flex: 1;
  text-align: right;
  background: transparent;
  border: none;
  border-bottom: 1px solid transparent;
  padding: 0;
  cursor: text;
  -moz-appearance: textfield;
  min-width: 0;
}
.op-val-input:hover { border-bottom-color: #333; }
.op-val-input:focus { border-bottom-color: #6060cc; color: #aaa; outline: none; }
.op-val-input::-webkit-inner-spin-button,
.op-val-input::-webkit-outer-spin-button { -webkit-appearance: none; }
.op-unit { font-size: 10px; color: #555; flex-shrink: 0; }


/* ── Top bar (info) ──────────────────────────────────── */
.topbar {
  display: flex;
  align-items: center;
  padding: 3px 0 3px 12px;
  background: #0d0d0d;
  border-bottom: 1px solid #1a1a1a;
  font-size: 11px;
  color: #c7c7c7;
  min-height: 34px;
  flex-shrink: 0;
  gap: 0;
  user-select: none;
}


/* ── Scrollbar ───────────────────────────────────────── */
.layer-list::-webkit-scrollbar { width: 5px; }
.layer-list::-webkit-scrollbar-track { background: #0d0d0d; }
.layer-list::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 3px; }

</style>

<!-- ── Unscoped global styles (teleported elements) ─── -->
<style>
/* ── iOS / browser resets ────────────────────────────── */
* {
  -webkit-tap-highlight-color: transparent;
  -webkit-touch-callout: none;
  box-sizing: border-box;
}
button, input, textarea, select {
  -webkit-appearance: none;
  appearance: none;
  outline: none;
  box-shadow: none;
  accent-color: #6060cc;
}
input[type="range"] {
  -webkit-appearance: none;
}
input:focus, textarea:focus, select:focus {
  outline: none;
  box-shadow: none;
  -webkit-box-shadow: none;
}
button:focus-visible {
  outline: 2px solid #6060cc;
  outline-offset: 1px;
}

/* ── Color popup floating mini swatches ──────────────── */
.cpf-fill, .cpf-stroke {
  position: absolute;
  width: 16px;
  height: 16px;
  border-radius: 3px;
}
.cpf-fill   { bottom: 6px; right: 6px; border: 1px solid rgba(0,0,0,0.35); }
.cpf-stroke { top: 6px; left: 6px; z-index: 1; border: 1px solid rgba(255,255,255,0.25); }

/* Tab row */
.cp-tabs {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
}
.cp-tab {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 8px;
  border: 1px solid #2a2a2a;
  border-radius: 6px;
  background: #161616;
  color: #888888;
  cursor: pointer;
  font-size: 12px;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
}
.cp-tab.active {
  background: #252525;
  border-color: #6060cc;
  color: #dddddd;
}
.cp-tab:hover:not(.active) { background: #2d2d55; }
.cp-tab-dot {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  border: 1px solid rgba(255,255,255,0.2);
  flex-shrink: 0;
}

/* Swap + custom picker */
.cp-swap {
  width: 26px;
  height: 26px;
  border: 1px solid #2a2a2a;
  border-radius: 5px;
  background: #161616;
  color: #aaaaaa;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  flex-shrink: 0;
}
.cp-swap:hover { background: #252525; }

.cp-picker {
  width: 30px;
  height: 30px;
  border: none;
  background: none;
  cursor: pointer;
  border-radius: 6px;
  padding: 0;
  flex-shrink: 0;
}

/* Mode toggle */
.cp-mode {
  display: flex;
  gap: 4px;
  margin-bottom: 8px;
}
.cp-mode button {
  flex: 1;
  padding: 4px 0;
  border: 1px solid #2a2a2a;
  border-radius: 5px;
  background: #161616;
  color: #888888;
  cursor: pointer;
  font-size: 12px;
  transition: background 0.12s, color 0.12s, border-color 0.12s;
}
.cp-mode button.active { background: #252525; border-color: #6060cc; color: #dddddd; }

/* Palette grid */
.cp-palette {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 4px;
}
.cp-dot {
  width: 22px;
  height: 22px;
  border-radius: 4px;
  border: 1px solid rgba(255,255,255,0.08);
  cursor: pointer;
  transition: transform 0.1s;
}
.cp-dot:hover { transform: scale(1.2); }
.cp-dot-add {
  background: rgba(255,255,255,0.08) !important;
  border: 1px dashed rgba(255,255,255,0.25) !important;
  color: #888888;
  font-size: 14px;
  line-height: 1;
}
.cp-dot-add:hover { background: rgba(255,255,255,0.18) !important; color: #fff; transform: scale(1.1); }

/* Color wheel */
.cp-wheel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.sv-canvas {
  width: 100%;
  border-radius: 6px;
  cursor: crosshair;
  display: block;
}
.hue-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 14px;
  border-radius: 7px;
  background: linear-gradient(to right,
    hsl(0,100%,50%),   hsl(30,100%,50%),  hsl(60,100%,50%),
    hsl(90,100%,50%),  hsl(120,100%,50%), hsl(150,100%,50%),
    hsl(180,100%,50%), hsl(210,100%,50%), hsl(240,100%,50%),
    hsl(270,100%,50%), hsl(300,100%,50%), hsl(330,100%,50%),
    hsl(360,100%,50%));
  outline: none;
  cursor: pointer;
  border: none;
}
.hue-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 18px; height: 18px;
  border-radius: 50%;
  border: 2px solid #fff;
  box-shadow: 0 1px 4px rgba(0,0,0,0.6);
  background: #888;
  cursor: pointer;
}
.hue-slider::-moz-range-thumb {
  width: 18px; height: 18px;
  border-radius: 50%;
  border: 2px solid #fff;
  box-shadow: 0 1px 4px rgba(0,0,0,0.6);
  background: #888;
  cursor: pointer;
}

/* ── Brush controls (inside palette) ────────────────── */
.cp-brush {
  border-bottom: 1px solid #2a2a2a;
  padding-bottom: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cp-brush-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.cp-brush-label {
  font-size: 10px;
  color: #888888;
  width: 46px;
  flex-shrink: 0;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.cp-brush-slider {
  flex: 1;
  min-width: 0;
  accent-color: #6060cc;
  cursor: pointer;
}
.cp-brush-val {
  font-size: 11px;
  color: #aaaaaa;
  width: 30px;
  text-align: right;
  flex-shrink: 0;
}

/* ── Brush popup ────────────────────────────────────── */
.bp-tool-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: 1px solid #2a2a2a;
  border-radius: 7px;
  background: #161616;
  color: #cccccc;
  cursor: pointer;
  text-align: left;
  margin-bottom: 4px;
  transition: background 0.12s, border-color 0.12s;
}
.bp-tool-toggle:hover { background: #1e1e1e; border-color: #444; }
.bp-tool-wrap {
  position: relative;
  margin-bottom: 4px;
}
.bp-tool-list {
  position: absolute;
  top: calc(100% + 2px);
  bottom: auto;
  left: -10px;
  right: -10px;
  z-index: 10001;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border: 1px solid #2a2a2a;
  border-radius: 7px;
  overflow: hidden;
  padding: 3px;
  background: #111111;
  box-shadow: 0 8px 24px rgba(0,0,0,0.7);
}
.bp-tool-list.drop-up {
  top: auto;
  bottom: calc(100% + 2px);
  box-shadow: 0 -6px 24px rgba(0,0,0,0.7);
}
.bp-tool {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: none;
  color: #cccccc;
  cursor: pointer;
  width: 100%;
  text-align: left;
  transition: background 0.12s;
}
.bp-tool:hover { background: #1c1c1c; }
.bp-tool.active { background: #252525; border-color: #6060cc; }
.bp-tool-icon { width: 20px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.bp-tool-label { flex: 1; font-size: 12px; }
.bp-tool-key {
  font-size: 10px;
  color: #666666;
  background: #161616;
  border: 1px solid #2a2a2a;
  border-radius: 3px;
  padding: 1px 4px;
  flex-shrink: 0;
}
.bp-sliders {
  border-top: 1px solid #1e1e1e;
  padding-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.bp-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.bp-label {
  font-size: 10px;
  color: #888888;
  width: 48px;
  flex-shrink: 0;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.bp-slider {
  -webkit-appearance: none;
  appearance: none;
  flex: 1;
  min-width: 0;
  height: 4px;
  border-radius: 2px;
  background: #2a2a2a;
  outline: none;
  cursor: pointer;
  border: none;
}
.bp-slider::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 2px;
  background: #2a2a2a;
}
.bp-slider::-moz-range-track {
  height: 4px;
  border-radius: 2px;
  background: #2a2a2a;
}
.bp-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #6060cc;
  cursor: pointer;
  border: 2px solid #1a1a1a;
  box-shadow: 0 1px 4px rgba(0,0,0,0.5);
  margin-top: -6px;
}
.bp-slider::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #6060cc;
  cursor: pointer;
  border: 2px solid #1a1a1a;
  box-shadow: 0 1px 4px rgba(0,0,0,0.5);
}
.bp-val-wrap {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  width: 38px;
  flex-shrink: 0;
}
.bp-val-input {
  font-size: 11px;
  color: #aaaaaa;
  width: 0;
  flex: 1;
  text-align: right;
  background: transparent;
  border: none;
  border-bottom: 1px solid transparent;
  padding: 0;
  cursor: text;
  -moz-appearance: textfield;
  min-width: 0;
}
.bp-val-input:hover { border-bottom-color: #3a3a3a; }
.bp-val-input:focus { border-bottom-color: #6060cc; color: #fff; outline: none; }
.bp-val-input::-webkit-inner-spin-button,
.bp-val-input::-webkit-outer-spin-button { -webkit-appearance: none; }
.bp-unit {
  font-size: 11px;
  color: #666;
  flex-shrink: 0;
}

/* ── Font controls in brush popup ───────────────────── */
.bp-font-btns {
  display: flex;
  gap: 4px;
  flex: 1;
}
.bp-font-btn {
  flex: 1;
  padding: 3px 6px;
  font-size: 11px;
  background: #2a2a2a;
  color: #cccccc;
  border: 1px solid #444;
  border-radius: 4px;
  cursor: pointer;
}
.bp-font-btn.active {
  background: #6060cc;
  color: #fff;
  border-color: #6060cc;
}
.bp-style-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: #2a2a2a;
  color: #cccccc;
  border: 1px solid #444;
  border-radius: 4px;
  cursor: pointer;
}
.bp-style-btn.active {
  background: #6060cc;
  color: #fff;
  border-color: #6060cc;
}

/* ── Canvas size popup ───────────────────────────────── */
.csp-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.csp-row label {
  font-size: 12px;
  color: #888888;
  width: 16px;
  flex-shrink: 0;
}
.csp-input {
  flex: 1;
  background: #161616;
  border: 1px solid #2a2a2a;
  border-radius: 5px;
  color: #cccccc;
  font-size: 13px;
  padding: 4px 7px;
  outline: none;
  box-shadow: none;
  width: 0;
  -moz-appearance: textfield;
}
.csp-input::-webkit-inner-spin-button,
.csp-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.csp-input:focus { border-color: #6060cc; box-shadow: none; }
.csp-preset-list {
  max-height: 160px;
  overflow-y: auto;
  margin-bottom: 8px;
  border: 1px solid #2a2a2a;
  border-radius: 5px;
  background: #0f0f0f;
}
.csp-preset-group {
  font-size: 10px;
  color: #555;
  padding: 4px 6px 2px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  user-select: none;
}
.csp-preset-btn {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding: 4px 8px;
  background: transparent;
  border: none;
  color: #aaaaaa;
  font-size: 11px;
  text-align: left;
  cursor: pointer;
}
.csp-preset-btn span { color: #555; font-size: 10px; }
.csp-preset-btn:hover { background: #1e1e1e; color: #e0e0e0; }
.csp-apply {
  width: 100%;
  padding: 6px 0;
  background: #4040aa;
  border: none;
  border-radius: 6px;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.12s;
}
.csp-apply:hover { background: #5050cc; }

/* ── Settings modal ─────────────────────────────────── */
.st-overlay { z-index: 99996; }
.st-card {
  max-width: 420px;
  width: calc(100vw - 32px);
  max-height: 85vh;
  padding: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.st-header {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  padding: 14px 16px 10px 20px;
}
.st-header-title {
  font-size: 15px;
  font-weight: 700;
  color: #dddddd;
  flex: 1;
}
.st-close {
  /* .ipfs-guide-close (base class) absolutely positions this in the
     corner of the whole card — put it back in normal flow so it sits in
     the header's flex row next to the title instead. */
  position: static;
  flex-shrink: 0;
}
.st-tabs {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
  padding: 10px 20px 0;
  border-bottom: 1px solid #2a2a2a;
}
.st-tab {
  padding: 7px 14px;
  border: none;
  background: none;
  color: #888888;
  font-size: 12px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: color 0.12s, border-color 0.12s;
}
.st-tab:hover { color: #cccccc; }
.st-tab.active { color: #ffffff; border-bottom-color: #6060cc; }
.st-body {
  padding: 18px 20px 20px;
  overflow-y: auto;
  /* Roughly the tallest tab's (Canvas) natural height — keeps shorter tabs
     (General, Plugins) from making the whole card visibly shrink/jump
     every time you switch tabs. */
  min-height: 400px;
}

.sp-title {
  font-size: 11px;
  color: #888888;
  font-weight: 600;
  letter-spacing: 0.05em;
  margin-bottom: 10px;
}
.sp-presets {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 5px;
  margin-bottom: 12px;
}
.sp-preset-dot {
  width: 100%;
  aspect-ratio: 1;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  padding: 0;
  transition: transform 0.1s;
}
.sp-preset-dot:hover { transform: scale(1.2); }
.sp-custom {
  display: flex;
  align-items: center;
  gap: 8px;
}
.sp-label {
  font-size: 12px;
  color: #aaaaaa;
  flex-shrink: 0;
}
.sp-picker {
  width: 28px;
  height: 28px;
  border: none;
  background: none;
  cursor: pointer;
  padding: 0;
  border-radius: 5px;
  flex-shrink: 0;
}
.sp-hex {
  font-size: 11px;
  color: #666666;
  font-family: monospace;
}

.sp-divider {
  border: none;
  border-top: 1px solid #2a2a3a;
  margin: 10px 0 8px;
}

.sp-lang {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #1a1a24;
}
.sp-lang + .sp-lang { margin-top: 8px; }
.sp-lang-btns {
  display: flex;
  gap: 4px;
}
.sp-lang-btns button {
  padding: 3px 10px;
  border: 1px solid #3a3a4a;
  border-radius: 4px;
  background: #1e1e2e;
  color: #888888;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}
.sp-lang-btns button:hover { background: #2a2a3a; color: #cccccc; }
.sp-lang-btns button.active { background: #6060cc; border-color: #6060cc; color: #ffffff; }

/* ── Toolbar customization (inside Settings popup) ─────── */
.tbl-hint {
  font-size: 11px;
  color: #777777;
  margin-bottom: 10px;
}
.tbl-add-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  margin-bottom: 8px;
  border: 1px dashed #3a3a4a;
  border-radius: 6px;
  background: none;
  color: #8888cc;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}
.tbl-add-btn:hover { background: #1a1a24; border-color: #6060cc; color: #9090ff; }
.tbl-add-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-bottom: 10px;
  padding: 6px;
  border-radius: 8px;
  background: #101018;
  max-height: 160px;
  overflow-y: auto;
}
.tbl-add-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: none;
  border-radius: 5px;
  background: none;
  color: #cccccc;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: background 0.12s;
}
.tbl-add-item:hover { background: #22223a; }
.tbl-add-item-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  color: #9090cc;
  flex-shrink: 0;
}
.tbl-add-empty {
  font-size: 11px;
  color: #666666;
  padding: 6px 8px;
}
.tbl-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.tbl-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background: #1a1a24;
  cursor: grab;
  outline: 2px solid transparent;
  outline-offset: -2px;
  transition: outline-color 0.1s, background 0.1s;
}
.tbl-row.dragging { opacity: 0.4; }
.tbl-row.drag-over { outline-color: #6060cc; background: #22223a; }
.tbl-row:active { cursor: grabbing; }
.tbl-row-sep { background: #15151d; }
.tbl-handle {
  display: flex;
  align-items: center;
  color: #666666;
  flex-shrink: 0;
}
.tbl-icon {
  position: relative;
  display: flex;
  align-items: center;
  width: 16px;
  height: 16px;
  color: #aaaaaa;
  flex-shrink: 0;
}
.tbl-icon .ts-fill, .tbl-icon .ts-stroke { width: 9px; height: 9px; }
.tbl-name {
  font-size: 12px;
  color: #dddddd;
  flex: 1;
}
.tbl-sep-label {
  flex: 1;
  font-size: 11px;
  color: #666666;
  font-style: italic;
}
.tbl-del {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 5px;
  background: none;
  color: #886060;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.12s, color 0.12s;
}
.tbl-del:hover { background: rgba(200,50,50,0.2); color: #ff8080; }

/* ── File management popup ───────────────────────────────── */
.fp-section {
  font-size: 10px;
  font-weight: 600;
  color: #888888;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.fp-section-sm { margin-top: 2px; }
.fp-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 5px;
}
.fp-btn {
  padding: 6px 0;
  border: 1px solid #333333;
  border-radius: 5px;
  background: #1e1e1e;
  color: #aaaaaa;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}
.fp-btn:hover { background: #2a2a2a; color: #cccccc; }
.fp-full-btn {
  padding: 7px 0;
  border: 1px solid #333333;
  border-radius: 5px;
  background: #1e1e1e;
  color: #aaaaaa;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}
.fp-full-btn:hover { background: #2a2a2a; color: #cccccc; }
.fp-divider {
  height: 1px;
  background: #2a2a2a;
  margin: 2px 0;
}
.fp-checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #888;
  cursor: pointer;
  padding: 2px 0;
  user-select: none;
}
.fp-checkbox input { accent-color: #6060cc; cursor: pointer; }
.ep-formats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px;
}
.ep-formats button {
  padding: 5px 0;
  border: 1px solid #333333;
  border-radius: 5px;
  background: #1e1e1e;
  color: #aaaaaa;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}
.ep-formats button:hover  { background: #2a2a2a; color: #cccccc; }
.ep-formats button.active { background: #6060cc; border-color: #6060cc; color: #ffffff; }
.ep-quality {
  display: flex;
  align-items: center;
  gap: 6px;
}
.ep-label { font-size: 11px; color: #888888; flex-shrink: 0; }
.ep-slider { flex: 1; accent-color: #6060cc; }
.ep-val { font-size: 11px; color: #aaaaaa; width: 32px; text-align: right; flex-shrink: 0; }
.ep-btn {
  padding: 7px 0;
  border: none;
  border-radius: 6px;
  background: #6060cc;
  color: #ffffff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}
.ep-btn:hover { background: #7070dd; }

/* ── IPFS Backup popup ───────────────────────────────── */
.bk-section {
  font-size: 10px;
  font-weight: 600;
  color: #888888;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.bk-label {
  font-size: 11px;
  color: #888888;
  margin-bottom: -2px;
}
.bk-input {
  width: 100%;
  background: #161616;
  border: 1px solid #2a2a2a;
  border-radius: 5px;
  color: #cccccc;
  font-size: 12px;
  padding: 5px 7px;
  outline: none;
  box-sizing: border-box;
}
.bk-input:focus { border-color: #6060cc; }
.bk-input::placeholder { color: #444444; }
.bk-primary-btn {
  width: 100%;
  padding: 7px 0;
  border: none;
  border-radius: 6px;
  background: #4040aa;
  color: #ffffff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}
.bk-primary-btn:hover:not(:disabled) { background: #5050cc; }
.bk-primary-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.bk-secondary-btn {
  width: 100%;
  padding: 6px 0;
  border: 1px solid #333333;
  border-radius: 5px;
  background: #1e1e1e;
  color: #aaaaaa;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}
.bk-secondary-btn:hover:not(:disabled) { background: #2a2a2a; color: #cccccc; }
.bk-secondary-btn:disabled { opacity: 0.45; cursor: not-allowed; }
.bk-divider {
  height: 1px;
  background: #2a2a2a;
  margin: 2px 0;
}
.bk-cid {
  font-family: monospace;
  font-size: 10px;
  color: #7070dd;
  word-break: break-all;
  overflow-wrap: anywhere;
  background: #0d0d0d;
  border: 1px solid #2a2a2a;
  border-radius: 4px;
  padding: 4px 6px;
  box-sizing: border-box;
  max-width: 100%;
  overflow: hidden;
}
.bk-cid-actions {
  display: flex;
  gap: 6px;
}
.bk-sm-btn {
  flex: 1;
  padding: 4px 0;
  border: 1px solid #333333;
  border-radius: 4px;
  background: #1a1a1a;
  color: #888888;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.12s;
}
.bk-sm-btn:hover { background: #252525; color: #cccccc; }
.bk-full { width: 100%; }
.bk-copied { color: #60cc80 !important; border-color: #60cc80 !important; }
.bk-label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.bk-hint-link {
  font-size: 10px;
  color: #7070dd;
  text-decoration: none;
}
.bk-hint-link:hover { color: #9090ff; text-decoration: underline; }
.bk-guide-link {
  font-size: 10px;
  color: #7070dd;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  text-decoration: none;
  transition: color 0.12s;
}
.bk-guide-link:hover { color: #9090ff; text-decoration: underline; }
.bk-error {
  font-size: 11px;
  color: #cc6060;
  word-break: break-word;
}
.bk-done {
  font-size: 11px;
  color: #60cc80;
  text-align: center;
}

/* ── IPFS Setup Guide overlay ───────────────────────── */
.ipfs-guide-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  z-index: 99998;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  box-sizing: border-box;
}
.ipfs-guide-card {
  position: relative;
  background: #181818;
  border: 1px solid #333333;
  border-radius: 16px;
  padding: 28px 32px 24px;
  width: 100%;
  max-width: 480px;
  max-height: 85vh;
  overflow-y: auto;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.7);
}
.ipfs-guide-close {
  position: absolute;
  top: 14px;
  right: 16px;
  background: none;
  border: none;
  color: #666666;
  font-size: 16px;
  cursor: pointer;
  line-height: 1;
  padding: 4px 6px;
  border-radius: 4px;
  transition: color 0.12s, background 0.12s;
}
.ipfs-guide-close:hover { color: #cccccc; background: #2a2a2a; }
.ipfs-guide-title {
  font-size: 15px;
  font-weight: 700;
  color: #dddddd;
  margin-bottom: 18px;
  padding-right: 28px;
}
.ipfs-guide-steps {
  margin: 0;
  padding-left: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.ipfs-guide-steps li {
  font-size: 13px;
  color: #aaaaaa;
  line-height: 1.6;
}
.ipfs-guide-steps li::marker {
  color: #7070dd;
  font-weight: 700;
}
.ipfs-guide-link-ext {
  color: #7070dd;
  text-decoration: none;
}
.ipfs-guide-link-ext:hover { color: #9090ff; text-decoration: underline; }
.ipfs-guide-inline {
  display: inline-block;
  background: #111111;
  border: 1px solid #2a2a2a;
  border-radius: 4px;
  padding: 1px 6px;
  font-family: monospace;
  font-size: 12px;
  color: #9090dd;
  margin-top: 4px;
}
.ipfs-guide-pre {
  margin: 8px 0 0;
  background: #0f0f0f;
  border: 1px solid #2a2a2a;
  border-radius: 8px;
  padding: 10px 12px;
  font-family: monospace;
  font-size: 11px;
  color: #8888cc;
  white-space: pre-wrap;
  word-break: break-all;
  line-height: 1.7;
}
/* Transition */
.guide-fade-enter-active, .guide-fade-leave-active { transition: opacity 0.18s ease; }
.guide-fade-enter-from, .guide-fade-leave-to { opacity: 0; }

/* ── Changelog modal ────────────────────────────────── */
.cl-overlay { z-index: 99997; }
.cl-card {
  max-width: 520px;
  width: calc(100vw - 32px);
  max-height: 85vh;
  padding: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
/* sticky header */
.cl-header {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  padding: 14px 12px 10px 20px;
  border-bottom: 1px solid #2a2a2a;
}
.cl-title {
  font-size: 15px;
  font-weight: 700;
  color: #dddddd;
  flex: 1;
}
.cl-close-x { flex-shrink: 0; }
.cl-subheader {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
  padding: 8px 20px 0;
}
/* scrollable body */
.cl-version {
  font-size: 10px;
  color: #444444;
  font-family: monospace;
  margin-left: auto;
}
.cl-list {
  list-style: none;
  margin: 0;
  padding: 10px 20px 12px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  overflow-y: auto;
  flex: 1;
}
.cl-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12.5px;
  color: #aaaaaa;
  line-height: 1.5;
}
.cl-item-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}
.cl-badge {
  flex-shrink: 0;
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 2px 7px;
  border-radius: 3px;
  color: #ffffff;
}
.cl-msg { word-break: break-word; color: #cccccc; }
.cl-date {
  font-size: 10px;
  color: #444444;
  font-family: monospace;
}
/* sticky footer */
.cl-footer {
  flex-shrink: 0;
  padding: 12px 20px 16px;
  border-top: 1px solid #2a2a2a;
}
.cl-close-btn { width: 100%; }

/* ── IPFS loading overlay ────────────────────────────── */
.ipfs-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.72);
  z-index: 99999;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ipfs-overlay-box {
  background: #1a1a1a;
  border: 1px solid #2a2a2a;
  border-radius: 12px;
  padding: 28px 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  color: #cccccc;
  font-size: 13px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8);
}
@keyframes ipfs-spin {
  to { transform: rotate(360deg); }
}
.ipfs-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid #2a2a2a;
  border-top-color: #6060cc;
  border-radius: 50%;
  animation: ipfs-spin 0.75s linear infinite;
}

/* ── IPFS startup error toast ────────────────────────── */
.ipfs-toast {
  position: fixed;
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%);
  background: #2a1212;
  border: 1px solid #cc5050;
  border-radius: 8px;
  padding: 10px 18px;
  color: #ee8080;
  font-size: 12px;
  z-index: 99999;
  max-width: 80vw;
  white-space: normal;
  text-align: center;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.7);
  cursor: pointer;
}
</style>
