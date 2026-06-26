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
        :class="canvasCursorClass"
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
        <!-- Sticky notes layer -->
        <div class="sticky-layer">
          <div
            v-for="note in stickyNotes" :key="note.id"
            class="sticky-note"
            :class="{ 'sn-active': note.id === activeNoteId, 'sn-minimized': note.minimized }"
            :style="{ left: note.x+'px', top: note.y+'px', width: note.minimized ? '36px' : note.w+'px', height: note.minimized ? '36px' : note.h+'px', background: note.color, zIndex: note.z }"
            @mousedown.stop="bringToFront(note)"
            @touchstart.stop
          >
            <!-- Minimized: small square float button -->
            <template v-if="note.minimized">
              <div class="sn-mini-body"
                @mousedown.stop="startDrag(note, $event)"
                @touchstart.prevent.stop="startDragTouch(note, $event)"
                @click.stop="note.minimized = false">
                <StickyNote :size="16" style="opacity:0.55" />
              </div>
              <button class="sn-mini-close" @click.stop="deleteNote(note.id)" @mousedown.stop @touchstart.stop><X :size="9" /></button>
            </template>
            <!-- Expanded: full note -->
            <template v-else>
              <div class="sn-header"
                @mousedown.stop="startDrag(note, $event)"
                @touchstart.prevent.stop="startDragTouch(note, $event)">
                <div class="sn-colors">
                  <button v-for="c in noteColors" :key="c" class="sn-color-dot"
                    :style="{ background: c }"
                    @click.stop="note.color = c" @mousedown.stop @touchstart.stop />
                </div>
                <div class="sn-btns">
                  <button class="sn-minimize" @click.stop="note.minimized = true" @mousedown.stop @touchstart.stop :title="t('minimize')">
                    <Minimize2 :size="11" />
                  </button>
                  <button class="sn-close" @click.stop="deleteNote(note.id)" @mousedown.stop @touchstart.stop><X :size="11" /></button>
                </div>
              </div>
              <textarea
                class="sn-text"
                v-model="note.text"
                :placeholder="t('stickyPlaceholder')"
                @mousedown.stop
                @touchstart.stop
              />
              <div class="sn-resize"
                @mousedown.stop="startResize(note, $event)"
                @touchstart.prevent.stop="startResizeTouch(note, $event)" />
            </template>
          </div>
        </div>
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
    <div class="layer-panel" :class="{ collapsed: !isPanelOpen, 'lp-left': toolbarSide === 'left' }">
      <div class="panel-inner">
        <div class="panel-header">
          <span class="panel-title">{{ t('layers') }}</span>
          <div class="panel-actions">
            <button @click="addLayer"          :title="t('addLayer')"><Plus :size="14" /></button>
            <button @click="duplicateLayer"    :title="t('duplicateLayer')"><Copy :size="14" /></button>
            <button @click="mergeDown"         :title="t('mergeDown')" :disabled="activeIndex <= 0"><ArrowDownToLine :size="14" /></button>
            <button @click="deleteActiveLayer" :title="t('deleteLayer')" :disabled="layers.length <= 1"><Trash2 :size="14" /></button>
          </div>
        </div>
        <div class="layer-list">
          <div
            v-for="layer in displayedLayers"
            :key="layer.id"
            class="layer-item"
            :class="{ active: layer.id === activeLayerId }"
            @click="activeLayerId = layer.id"
          >
            <div class="layer-controls">
              <button class="lc-btn"
                :style="{ visibility: layer.id !== activeLayerId ? 'hidden' : 'visible' }"
                @click.stop="moveUp"
                :disabled="activeIndex >= layers.length - 1" :title="t('moveUp')">
                <ChevronUp :size="13" /></button>
              <button class="lc-btn"
                :style="{ visibility: layer.id !== activeLayerId || editingId === layer.id ? 'hidden' : 'visible' }"
                @click.stop="editingId = layer.id" :title="t('rename')">
                <Pen :size="11" /></button>
              <button class="lc-btn"
                :style="{ visibility: layer.id !== activeLayerId ? 'hidden' : 'visible' }"
                @click.stop="moveDown"
                :disabled="activeIndex <= 0" :title="t('moveDown')">
                <ChevronDown :size="13" /></button>
              <button class="lc-btn"
                :style="{ visibility: layer.id !== activeLayerId ? 'hidden' : 'visible' }"
                @click.stop="toggleVisible(layer)"
                :title="layer.visible ? t('hideLayer') : t('showLayer')">
                <Eye v-if="layer.visible" :size="11" />
                <EyeOff v-else :size="11" style="opacity:0.4" />
              </button>
            </div>
            <canvas
              class="thumb"
              :ref="el => { if (el) thumbRefs[layer.id] = el; else delete thumbRefs[layer.id] }"
              width="44" height="33"
            />
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
                  @input="composite()"
                  @change="saveHistory()"
                />
                <input type="number" class="op-val-input" min="0" max="100"
                  :value="layer.opacity"
                  @change="layer.opacity = Math.max(0, Math.min(100, parseInt($event.target.value) || 0)); $event.target.value = layer.opacity; composite(); saveHistory()"
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

    <!-- ── Vertical toolbar (rightmost / leftmost) ──── -->
    <aside class="toolbar" :class="{ 'tb-left': toolbarSide === 'left' }">
      <!-- File management -->
      <button ref="fileTriggerRef" class="tool-btn" :class="{ active: filePopupOpen }" @click.stop="toggleFilePopup" :title="t('fileManagement')"><Folder :size="16" /></button>
      <input ref="importInputRef" type="file" accept="image/*" style="display:none" @change="onImportFile" />
      <input ref="projectInputRef" type="file" accept=".atelier,application/json" style="display:none" @change="onProjectFile" />

      <div class="tb-sep" />

      <!-- Brush / tool settings -->
      <button ref="toolTriggerRef" class="tool-btn tool-selector"
        :class="{ active: tools.some(x => x.id === currentTool) }"
        :title="t('brushSettings')"
        @click.stop="toggleBrushPopup">
        <component :is="lastDrawToolComp" :size="16" />
      </button>

      <div class="tb-sep" />

      <!-- Color / Palette -->
      <button ref="colorTriggerRef" class="tool-btn color-trigger"
        :class="{ active: colorPopupOpen }"
        @click.stop="toggleColorPopup" :title="t('colorSettings')">
        <div class="ts-fill"   :style="{ background: fillColor }" />
        <div class="ts-stroke" :style="{ background: currentColor }" />
      </button>

      <div class="tb-sep" />

      <!-- Actions -->
      <button class="tool-btn" :disabled="historyIndex <= 0" @click="undo" :title="t('undo')"><Undo2 :size="16" /></button>
      <button class="tool-btn" :disabled="historyIndex >= history.length - 1" @click="redo" :title="t('redo')"><Redo2 :size="16" /></button>

      <!-- Move / Select tools -->
      <div class="tb-sep" />
      <button class="tool-btn" :class="{ active: currentTool === 'move' }"        @click="currentTool = 'move'"        :title="t('tool_move')"><Move :size="16" /></button>
      <button class="tool-btn" :class="{ active: currentTool === 'select_rect' }"  @click="currentTool = 'select_rect'"  :title="t('tool_select_rect')"><SquareDashedMousePointer :size="16" /></button>
      <button class="tool-btn" :class="{ active: currentTool === 'lasso' }"        @click="currentTool = 'lasso'"        :title="t('tool_lasso')"><LassoSelect :size="16" /></button>
      <button ref="wandBtnRef" class="tool-btn" :class="{ active: currentTool === 'magic_wand' }" @click.stop="toggleWandPopup" :title="t('tool_magic_wand')"><Wand2 :size="16" /></button>
      <button ref="textBtnRef" class="tool-btn" :class="{ active: currentTool === 'text' }"         @click.stop="toggleTextPopup" :title="t('tool_text')"><Type :size="16" /></button>

      <!-- Canvas view controls -->
      <div class="tb-sep" />
      <button class="tool-btn" :class="{ active: currentTool === 'pan' }"    @click="currentTool = 'pan'"    :title="t('pan')"><Hand :size="16" /></button>
      <button class="tool-btn" :class="{ active: currentTool === 'rotate' }" @click="currentTool = 'rotate'" :title="t('rotateCanvas')"><RotateCcw :size="16" /></button>
      <button class="tool-btn" @click="resetView" :title="t('resetView')"><SquareDot :size="16" /></button>
      <button class="tool-btn" @click="zoomIn"  :title="t('zoomIn')"><ZoomIn  :size="16" /></button>
      <button class="tool-btn" @click="zoomOut" :title="t('zoomOut')"><ZoomOut :size="16" /></button>

      <!-- Sticky note -->
      <div class="tb-sep" />
      <button class="tool-btn" @click="addStickyNote" :title="t('addStickyNote')"><StickyNote :size="16" /></button>

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

      <!-- Layer toggle -->
      <div class="tb-sep" />
      <button class="tool-btn" :class="{ active: isPanelOpen }" @click="isPanelOpen = !isPanelOpen" :title="t('layersPanel')"><Layers :size="16" /></button>

      <!-- Backup + Settings — pinned to bottom -->
      <div class="tb-bottom">
        <div class="tb-sep" />
        <button ref="backupTriggerRef" class="tool-btn" :class="{ active: backupPopupOpen }" @click.stop="toggleBackupPopup" :title="t('ipfsBackup')"><CloudUpload :size="16" /></button>
        <button ref="settingsTriggerRef" class="tool-btn" :class="{ active: settingsPopupOpen }" @click.stop="toggleSettingsPopup" :title="t('settings')"><Settings :size="16" /></button>
      </div>
    </aside>
    </div><!-- /.app-body -->

    <!-- ── All popups (Teleport to body) ─────────────── -->
    <Teleport to="body">
      <!-- Tool selector popup -->
      <div v-if="toolPopupOpen" class="tool-popup" :style="toolPopupStyle" @click.stop>
        <button
          v-for="tool in tools" :key="tool.id"
          class="tp-item" :class="{ active: currentTool === tool.id }"
          @click="selectTool(tool.id)"
        >
          <span class="tp-icon"><component :is="tool.comp" :size="16" /></span>
          <span class="tp-label">{{ t(tool.labelKey) }}</span>
          <span class="tp-key">{{ tool.key }}</span>
        </button>
      </div>

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
            <input type="range" min="1" max="60" v-model.number="lineWidth" class="bp-slider" @mousedown.stop @touchstart.stop />
            <input type="number" class="bp-val-input" min="1" max="60"
              :value="lineWidth"
              @change="lineWidth = Math.max(1, Math.min(60, parseInt($event.target.value) || 1)); $event.target.value = lineWidth"
              @keydown.enter.stop="$event.target.blur()"
              @focus.stop="$event.target.select()"
              @mousedown.stop @touchstart.stop />
          </div>
          <div class="bp-row">
            <span class="bp-label">{{ t('opacity') }}</span>
            <input type="range" min="0" max="100" v-model.number="strokeOpacity" class="bp-slider" @mousedown.stop @touchstart.stop />
            <input type="number" class="bp-val-input" min="0" max="100"
              :value="strokeOpacity"
              @change="strokeOpacity = Math.max(0, Math.min(100, parseInt($event.target.value) || 0)); $event.target.value = strokeOpacity"
              @keydown.enter.stop="$event.target.blur()"
              @focus.stop="$event.target.select()"
              @mousedown.stop @touchstart.stop /><span class="bp-unit">%</span>
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
            <input type="number" class="bp-val-input" min="0" max="128"
              :value="wandTolerance"
              @change="wandTolerance = Math.max(0, Math.min(128, parseInt($event.target.value) || 0)); $event.target.value = wandTolerance"
              @keydown.enter.stop="$event.target.blur()"
              @focus.stop="$event.target.select()"
              @mousedown.stop @touchstart.stop />
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
            <input type="number" class="bp-val-input" min="8" max="300"
              :value="fontSize"
              @change="fontSize = Math.max(8, Math.min(300, parseInt($event.target.value) || 8)); $event.target.value = fontSize"
              @keydown.enter.stop="$event.target.blur()"
              @focus.stop="$event.target.select()"
              @mousedown.stop @touchstart.stop />
          </div>
          <div class="bp-row">
            <span class="bp-label">{{ t('opacity') }}</span>
            <input type="range" min="0" max="100" v-model.number="strokeOpacity" class="bp-slider" @mousedown.stop @touchstart.stop />
            <input type="number" class="bp-val-input" min="0" max="100"
              :value="strokeOpacity"
              @change="strokeOpacity = Math.max(0, Math.min(100, parseInt($event.target.value) || 0)); $event.target.value = strokeOpacity"
              @keydown.enter.stop="$event.target.blur()"
              @focus.stop="$event.target.select()"
              @mousedown.stop @touchstart.stop /><span class="bp-unit">%</span>
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

      <!-- Settings popup -->
      <FloatingPopup
        ref="spRef"
        :open="settingsPopupOpen"
        @update:open="settingsPopupOpen = $event"
        :title="t('settings')"
        :zIndex="spZ"
        @bring-to-front="bringSpToFront"
        :width="220"
      >
        <template #icon><Settings :size="16" /></template>
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
      </FloatingPopup>

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
          <div class="fp-section">{{ t('ipfsOpenFromCid') }}</div>
          <input type="text" v-model="fileOpenCid" class="bk-input"
            :placeholder="t('ipfsCidPlaceholder')"
            @mousedown.stop @touchstart.stop
            @keydown.enter="openProjectFromCid" />
          <button class="fp-full-btn" @click="openProjectFromCid"
            :disabled="!fileOpenCid || ipfsStatus === 'restoring'">
            {{ ipfsStatus === 'restoring' ? t('ipfsRestoring') : t('ipfsOpenFromCid') }}
          </button>
          <div v-if="ipfsStatus === 'error'" class="bk-error">{{ ipfsStatusMsg }}</div>
          <div class="fp-divider" />
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
            <input type="number" class="bp-val-input" min="1" max="100"
              :value="exportQuality"
              @change="exportQuality = Math.max(1, Math.min(100, parseInt($event.target.value) || 1)); $event.target.value = exportQuality"
              @keydown.enter.stop="$event.target.blur()"
              @focus.stop="$event.target.select()"
              @mousedown.stop @touchstart.stop /><span class="bp-unit">%</span>
          </div>
          <button class="ep-btn" @click="doExportImage">{{ t('export') }}</button>
        </div>
      </FloatingPopup>

      <!-- IPFS Backup popup -->
      <FloatingPopup
        ref="bkRef"
        :open="backupPopupOpen"
        @update:open="backupPopupOpen = $event"
        :title="t('ipfsBackup')"
        :zIndex="bkZ"
        @bring-to-front="bringBkToFront"
        :width="260"
      >
        <template #icon><CloudUpload :size="16" /></template>
        <div style="display:flex;flex-direction:column;gap:8px">

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
              <a :href="githubUrl" target="_blank" rel="noopener" class="cl-github-link">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"/></svg>
                {{ t('changelogSource') }}
              </a>
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

    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import FloatingPopup from './FloatingPopup.vue'
import { usePaintStore } from './stores/paintStore.js'
import { t, locale, setLocale } from './i18n.js'
import { useView } from './composables/useView.js'
import { useColorWheel } from './composables/useColorWheel.js'
import { useStickyNotes } from './composables/useStickyNotes.js'
import { useLayers } from './composables/useLayers.js'
import {
  Pencil, Brush, Minus, Square, Circle, PaintBucket, Pipette, Eraser,
  Trash2, Undo2, Redo2, Download, Hand, RotateCcw, SquareDot,
  StickyNote, Layers, ChevronUp, ChevronDown, Eye, EyeOff,
  Plus, Copy, ArrowDownToLine, X, Pen, ArrowLeftRight, Minimize2,
  ZoomIn, ZoomOut, Settings, Upload, Folder, CloudUpload,
  SquareDashedMousePointer, LassoSelect, PenLine, Paintbrush, Move, Wand2,
  Type, Bold, Italic
} from 'lucide-vue-next'
import { useIpfsBackup } from './composables/useIpfsBackup.js'

// ── Store ─────────────────────────────────────────────────
const paintStore = usePaintStore()

// ── Tool definitions ──────────────────────────────────────
const tools = [
  { id: 'pen',          comp: Pencil,                   labelKey: 'tool_pen',          key: 'P' },
  { id: 'brush',        comp: Brush,                    labelKey: 'tool_brush',        key: 'B' },
  { id: 'line',         comp: Minus,                    labelKey: 'tool_line',         key: 'L' },
  { id: 'rect',         comp: Square,                   labelKey: 'tool_rect',         key: 'R' },
  { id: 'circle',       comp: Circle,                   labelKey: 'tool_circle',       key: 'C' },
  { id: 'fill',         comp: PaintBucket,              labelKey: 'tool_fill',         key: 'F' },
  { id: 'eyedropper',   comp: Pipette,                  labelKey: 'tool_eyedropper',   key: 'I' },
  { id: 'eraser',       comp: Eraser,                   labelKey: 'tool_eraser',       key: 'E' },
  { id: 'sel_pen',  comp: Paintbrush, labelKey: 'tool_sel_pen',  key: 'W' },
  { id: 'sel_eras', comp: Eraser,     labelKey: 'tool_sel_eras', key: null },
]

// ── Tool state ────────────────────────────────────────────
const currentTool   = ref('pen')
const currentColor  = ref('#000000')
const fillColor     = ref('#ffffff')
const lineWidth     = ref(4)
const strokeOpacity = ref(100)
const wandTolerance = ref(32)

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

const _extraTools = {
  magic_wand: { labelKey: 'tool_magic_wand', comp: Wand2 },
  text:        { labelKey: 'tool_text',       comp: Type  },
}
const toolLabel       = computed(() => { const f = tools.find(x => x.id === currentTool.value) ?? _extraTools[currentTool.value]; return f ? t(f.labelKey) : '' })
const currentToolComp = computed(() => (tools.find(x => x.id === currentTool.value) ?? _extraTools[currentTool.value])?.comp ?? Pencil)

// Brush button tracks last used drawing tool independently from text/magic_wand
const lastDrawTool     = ref('pen')
const lastDrawToolComp = computed(() => tools.find(x => x.id === lastDrawTool.value)?.comp ?? Pencil)
watch(currentTool, newTool => {
  if (tools.some(x => x.id === newTool)) lastDrawTool.value = newTool
  else brushPopupOpen.value = false
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
const fileOpenCid   = ref('')

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
const githubUrl     = __GITHUB_URL__

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
const toolPopupOpen     = ref(false)
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
} = lc

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

const copiedKey       = ref('')
const startupErrorMsg = ref('')

async function copyText(text, key) {
  try {
    await navigator.clipboard.writeText(text)
    copiedKey.value = key
    setTimeout(() => { if (copiedKey.value === key) copiedKey.value = '' }, 1800)
  } catch { /* clipboard denied */ }
}

const vw = useView(canvasLogicalW, canvasLogicalH)
const { viewX, viewY, viewR, viewZoom, fitScale, vpStyle, resetView, zoomIn, zoomOut } = vw

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

const sn = useStickyNotes(fitScale, viewR)
const {
  stickyNotes, activeNoteId, noteColors,
  addStickyNote, deleteNote, bringToFront,
  startDrag, startDragTouch, startResize, startResizeTouch,
  onSnMouseMove, onSnTouchMove, onSnMouseUp,
} = sn

const cw = useColorWheel({ activeColor, activeColorTarget, colorMode, colorPopupOpen, selectColor })
const { svCanvasRef, hsvH, hsvS, hsvV, onSvDown, onSvMove, onSvUp, onSvTouchStart, onSvTouchMove, onHueInput } = cw

// ── Layout refs ───────────────────────────────────────────
const wrapperRef         = ref(null)
const colorTriggerRef    = ref(null)
const toolTriggerRef     = ref(null)
const settingsTriggerRef = ref(null)
const fileTriggerRef       = ref(null)
const backupTriggerRef     = ref(null)
const importInputRef       = ref(null)
const projectInputRef      = ref(null)

// ── Toolbar side ──────────────────────────────────────────
const toolbarSide = ref(localStorage.getItem('paint-toolbar-side') ?? 'right')
watch(toolbarSide, v => {
  localStorage.setItem('paint-toolbar-side', v)
  ;[cpRef, bpRef, fpRef, spRef, bkRef].forEach(r => r.value?.reset())
})

// ── Popup z-index ─────────────────────────────────────────
let _popupZ = 9999
const cpZ = ref(9999), bpZ = ref(9999), fpZ = ref(9999), spZ = ref(9999), bkZ = ref(9999)
const wdZ = ref(9999), txZ = ref(9999)
function bringCpToFront() { cpZ.value = ++_popupZ }
function bringBpToFront() { bpZ.value = ++_popupZ }
function bringFpToFront() { fpZ.value = ++_popupZ }
function bringSpToFront() { spZ.value = ++_popupZ }
function bringBkToFront() { bkZ.value = ++_popupZ }
function bringWdToFront() { wdZ.value = ++_popupZ }
function bringTxToFront() { txZ.value = ++_popupZ }

// ── Popup refs ────────────────────────────────────────────
const cpRef = ref(null), bpRef = ref(null)
const fpRef = ref(null), spRef = ref(null), bkRef = ref(null)
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
      bpDropUp.value = (window.innerHeight - r.bottom) < (tools.length * 34 + 16)
    }
  }
  bpToolsExpanded.value = !bpToolsExpanded.value
}

// ── Popup toggle functions ────────────────────────────────
const toolPopupStyle = ref({})

function popupPos(triggerEl, popupW, popupH) {
  const r = triggerEl.getBoundingClientRect()
  const left = toolbarSide.value === 'left'
    ? Math.min(r.right + 6, window.innerWidth - popupW - 6)
    : Math.max(6, r.left - popupW - 6)
  const top = Math.max(6, Math.min(r.top, window.innerHeight - popupH - 6))
  return { position: 'fixed', top: top + 'px', left: left + 'px' }
}

function closeAllPopups() {
  toolPopupOpen.value     = false
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
  const r = colorTriggerRef.value.getBoundingClientRect()
  const x = toolbarSide.value === 'left'
    ? Math.min(r.right + 6, window.innerWidth - cpWidth.value - 6)
    : Math.max(6, r.left - cpWidth.value - 6)
  cpRef.value?.initPos(x, Math.max(6, r.top))
  colorPopupOpen.value = true
}

function toggleBrushPopup() {
  const onDrawTool = tools.some(x => x.id === currentTool.value)
  if (!onDrawTool) {
    // Not on a drawing tool → first click just switches back to last drawing tool
    currentTool.value = lastDrawTool.value
    return
  }
  // Already on a drawing tool → toggle popup
  if (brushPopupOpen.value) { brushPopupOpen.value = false; return }
  bringBpToFront()
  const r = toolTriggerRef.value.getBoundingClientRect()
  const x = toolbarSide.value === 'left'
    ? Math.min(r.right + 6, window.innerWidth - 220 - 6)
    : Math.max(6, r.left - 220 - 6)
  bpRef.value?.initPos(x, Math.max(6, r.top))
  if (bpRef.value) bpRef.value.minimized = false
  bpToolsExpanded.value = false
  brushPopupOpen.value = true
}

const wandBtnRef = ref(null)
const textBtnRef = ref(null)

function toggleWandPopup() {
  currentTool.value = 'magic_wand'
  if (wandPopupOpen.value) { wandPopupOpen.value = false; return }
  bringWdToFront()
  closeAllPopups()
  wandPopupOpen.value = true
  nextTick(() => {
    const r = wandBtnRef.value?.getBoundingClientRect()
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
    const r = textBtnRef.value?.getBoundingClientRect()
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
  if (!wasOpen) {
    bringSpToFront()
    const r = settingsTriggerRef.value.getBoundingClientRect()
    const x = toolbarSide.value === 'left'
      ? r.right + 6
      : Math.max(6, r.left - 196 - 6)
    spRef.value?.initPos(x, Math.max(6, r.top))
    settingsPopupOpen.value = true
  }
}

function toggleToolPopup() {
  const wasOpen = toolPopupOpen.value
  closeAllPopups()
  if (!wasOpen) {
    toolPopupStyle.value = popupPos(toolTriggerRef.value, 160, tools.length * 38 + 8)
    toolPopupOpen.value = true
  }
}

function selectTool(id) {
  currentTool.value = id
  toolPopupOpen.value = false
}

function toggleFilePopup() {
  const wasOpen = filePopupOpen.value
  closeAllPopups()
  if (!wasOpen) {
    bringFpToFront()
    const r = fileTriggerRef.value.getBoundingClientRect()
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
    const r = backupTriggerRef.value.getBoundingClientRect()
    const x = toolbarSide.value === 'left'
      ? Math.min(r.right + 6, window.innerWidth - 260 - 6)
      : Math.max(6, r.left - 260 - 6)
    bkRef.value?.initPos(x, Math.max(6, r.top))
    backupPopupOpen.value = true
  }
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

watch(canvasSize, () => { cancelSelection() })

// sel_pen / sel_eras 雙向同步
watch(currentTool, (newTool, oldTool) => {
  // 離開文字工具時 commit 已輸入的文字
  if (oldTool === 'text' && newTool !== 'text') commitText()

  // 切換到繪圖工具時若 float 懸浮（移動模式），先 commit
  const drawingTools = ['pen', 'brush', 'eraser', 'line', 'rect', 'circle', 'fill']
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
  composite()
  saveHistory()
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
        composite()
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
  composite()
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
        composite()
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
  composite()
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
  composite()
  saveHistory()
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
  composite()
}

function handleMoveUp() {
  if (!drawing) return
  drawing = false; layerSnapshot = null
  saveHistory()
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

async function openProjectFromCid() {
  const cid = fileOpenCid.value.trim()
  if (!cid) return
  ipfsRestoreCid.value = cid
  await restoreFromCid()
  if (ipfsStatus.value === 'done') {
    fileOpenCid.value   = ''
    filePopupOpen.value = false
  }
}

// ── Draw state ────────────────────────────────────────────
let drawing       = false
let startX        = 0
let startY        = 0
let layerSnapshot = null
let drawingButton = 0
let strokeCanvas  = null  // temp canvas for masked pen/brush/eraser strokes
let maskCache     = null  // effective mask canvas cached per stroke

function activeDrawColor() {
  return drawingButton === 2 ? fillColor.value : currentColor.value
}

function getActiveCtx() {
  if (selDrawMode.value && selFloat) return selFloat.canvas.getContext('2d')
  return activeLayer.value?.canvas.getContext('2d') ?? null
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
  if (currentTool.value === 'pan' || currentTool.value === 'rotate') {
    if (e.button !== 0) return
    if (currentTool.value === 'pan')
      viewDrag = { type: 'pan', sx: e.clientX, sy: e.clientY, svx: viewX.value, svy: viewY.value }
    else
      viewDrag = { type: 'rotate', sx: e.clientX, svr: viewR.value }
    return
  }
  drawingButton = e.button
  if (!activeLayer.value) return
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
    composite()
    saveHistory()
    return
  }
  if (currentTool.value === 'eyedropper') {
    pickColor(p.x, p.y)
    return
  }

  drawing = true
  const ctx = getActiveCtx()
  const { width: lw, height: lh } = activeLayer.value.canvas
  layerSnapshot = ctx.getImageData(0, 0, lw, lh)

  const masked = selActive.value && (selRect.value || selMaskCanvas)
  const isFreehand = currentTool.value === 'pen' || currentTool.value === 'brush' || currentTool.value === 'eraser'

  if (masked && isFreehand) {
    // 遮罩模式：在 strokeCanvas 上累積筆跡，避免 clip() 破壞路徑
    maskCache    = getEffectiveMask()
    strokeCanvas = mkCanvas(lw, lh)
    const sctx   = strokeCanvas.getContext('2d')
    if (currentTool.value === 'eraser') {
      // 橡皮擦：在 strokeCanvas 畫不透明白色標記，最後用 destination-out 套用
      sctx.strokeStyle = '#ffffff'; sctx.fillStyle = '#ffffff'
      sctx.lineWidth = lineWidth.value * 3; sctx.lineCap = 'round'; sctx.lineJoin = 'round'
    } else {
      applyStyle(sctx)
      if (currentTool.value === 'brush') {
        sctx.lineWidth   = lineWidth.value * 3
        sctx.globalAlpha = (strokeOpacity.value / 100) * 0.4
      }
    }
    sctx.beginPath(); sctx.moveTo(p.x, p.y)
  } else {
    applyStyle(ctx)
    if (currentTool.value === 'pen' || currentTool.value === 'brush') {
      if (currentTool.value === 'brush') {
        ctx.lineWidth   = lineWidth.value * 3
        ctx.globalAlpha = (strokeOpacity.value / 100) * 0.4
      }
      ctx.beginPath(); ctx.moveTo(p.x, p.y)
    }
    if (currentTool.value === 'eraser') {
      ctx.beginPath(); ctx.moveTo(p.x, p.y)
    }
  }
}

function onPointerMove(e) {
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

  if (!drawing || !activeLayer.value) return

  const ctx    = getActiveCtx()
  const masked = selActive.value && (selRect.value || selMaskCanvas)
  const { width: lw, height: lh } = activeLayer.value.canvas

  // ── 遮罩 + 自由筆跡（pen/brush/eraser）：strokeCanvas 模式 ──────────
  if (strokeCanvas && masked) {
    const sctx = strokeCanvas.getContext('2d')
    sctx.lineTo(p.x, p.y); sctx.stroke()

    // 把 strokeCanvas 套上 mask，只保留選取區內的像素
    const tmp = mkCanvas(lw, lh)
    const tc  = tmp.getContext('2d')
    tc.drawImage(strokeCanvas, 0, 0)
    if (maskCache) {
      tc.globalCompositeOperation = 'destination-in'
      tc.drawImage(maskCache, 0, 0)
    }

    // 從 snapshot 還原，再把遮罩後的筆跡合併
    ctx.putImageData(layerSnapshot, 0, 0)
    if (currentTool.value === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.drawImage(tmp, 0, 0)
      ctx.globalCompositeOperation = 'source-over'
    } else {
      ctx.drawImage(tmp, 0, 0)
    }
    composite()
    return
  }

  applyStyle(ctx)

  if (currentTool.value === 'pen') {
    ctx.lineTo(p.x, p.y); ctx.stroke()
    composite()
  } else if (currentTool.value === 'brush') {
    ctx.lineWidth   = lineWidth.value * 3
    ctx.globalAlpha = (strokeOpacity.value / 100) * 0.4
    ctx.lineTo(p.x, p.y); ctx.stroke()
    composite()
  } else if (currentTool.value === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out'
    ctx.globalAlpha = 1; ctx.lineWidth = lineWidth.value * 3
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'
    ctx.lineTo(p.x, p.y); ctx.stroke()
    ctx.globalCompositeOperation = 'source-over'; composite()
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
    composite()
  }
}

function onPointerUp() {
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

  if (!drawing) return
  drawing = false
  layerSnapshot = null
  strokeCanvas = null; maskCache = null
  const ctx = getActiveCtx()
  if (ctx) {
    ctx.closePath()
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
  }
  composite()
  saveHistory()
}

function onPointerLeave() {
  cursorPos.value = null
  selHoverHandle.value = null
  if (viewDrag) return
  if (selState.value === 'moving') return  // keep floating until mouseup outside
  if (selTransformDrag) return             // keep transform until mouseup outside
  if (drawing) onPointerUp()
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
const keyMap = { p:'pen', b:'brush', l:'line', r:'rect', c:'circle', f:'fill', i:'eyedropper', e:'eraser', h:'pan', v:'move', s:'select_rect', q:'lasso', w:'sel_pen', g:'magic_wand', t:'text' }

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
  window.addEventListener('mousemove', onSnMouseMove)
  window.addEventListener('mouseup',   onSnMouseUp)
  window.addEventListener('touchmove', onSnTouchMove, { passive: false })
  window.addEventListener('touchend',  onSnMouseUp)
})

onUnmounted(() => {
  window.removeEventListener('resize',    onResize)
  window.removeEventListener('keydown',   onKey)
  document.removeEventListener('click',   closeAllPopups)
  window.removeEventListener('mousemove', onSnMouseMove)
  window.removeEventListener('mouseup',   onSnMouseUp)
  window.removeEventListener('touchmove', onSnTouchMove)
  window.removeEventListener('touchend',  onSnMouseUp)
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

/* ── Sticky notes ────────────────────────────────────── */
.sticky-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 10;
}

.sticky-note {
  position: absolute;
  display: flex;
  flex-direction: column;
  border-radius: 5px;
  box-shadow: 3px 5px 14px rgba(0,0,0,0.4);
  pointer-events: all;
  min-width: 120px;
  min-height: 80px;
  touch-action: manipulation;
}
.sticky-note.sn-active {
  box-shadow: 3px 5px 20px rgba(0,0,0,0.6), 0 0 0 2px rgba(96,96,204,0.6);
}

.sn-header {
  display: flex;
  align-items: center;
  padding: 4px 6px;
  cursor: grab;
  flex-shrink: 0;
  background: rgba(0,0,0,0.1);
  border-radius: 5px 5px 0 0;
  gap: 4px;
}
.sn-header:active { cursor: grabbing; }

.sn-colors { display: flex; gap: 3px; }
.sn-color-dot {
  width: 12px; height: 12px;
  border-radius: 50%;
  border: 1.5px solid rgba(0,0,0,0.2);
  cursor: pointer; padding: 0;
  transition: transform 0.1s;
}
.sn-color-dot:hover { transform: scale(1.35); }

.sn-btns { display: flex; gap: 3px; flex-shrink: 0; margin-left: auto; }

.sn-minimize, .sn-close {
  width: 18px; height: 18px;
  border: none;
  background: rgba(0,0,0,0.12);
  border-radius: 3px;
  cursor: pointer;
  font-size: 11px;
  color: #333;
  display: flex; align-items: center; justify-content: center;
  padding: 0; flex-shrink: 0;
}
.sn-minimize:hover { background: rgba(0,0,0,0.22); }
.sn-close:hover { background: rgba(200,50,50,0.4); color: #fff; }

.sticky-note.sn-minimized {
  min-width: 0; min-height: 0;
  border-radius: 9px;
  overflow: visible;
}

.sn-mini-body {
  width: 100%; height: 100%;
  border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
  cursor: grab;
}
.sn-mini-body:active { cursor: grabbing; }

.sn-mini-close {
  position: absolute;
  top: -6px; right: -6px;
  width: 16px; height: 16px;
  border-radius: 50%;
  border: none;
  background: rgba(0,0,0,0.55);
  color: #fff;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  padding: 0;
}
.sn-mini-close:hover { background: rgba(200,50,50,0.85); }

.sn-text {
  flex: 1;
  border: none;
  background: transparent;
  resize: none;
  padding: 6px 8px;
  font-size: 16px;   /* ≥16px 避免 iOS 在 focus 時自動放大 viewport */
  font-family: inherit;
  color: #333;
  outline: none;
  box-shadow: none;
  -webkit-box-shadow: none;
  cursor: text;
  line-height: 1.5;
}

.sn-resize {
  position: absolute;
  bottom: 0; right: 0;
  width: 14px; height: 14px;
  cursor: se-resize;
  background: rgba(0,0,0,0.15);
  border-radius: 2px 0 5px 0;
  flex-shrink: 0;
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
  width: 220px;
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
.layer-panel.lp-left {
  right: auto;
  left: 34px;
  border-left: none;
  border-right: 1px solid #1a1a1a;
  box-shadow: 4px 0 16px rgba(0,0,0,0.4);
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
.op-val-input {
  font-size: 10px;
  color: #666666;
  width: 20px;
  text-align: right;
  flex-shrink: 0;
  background: transparent;
  border: none;
  border-bottom: 1px solid transparent;
  padding: 0;
  cursor: text;
  -moz-appearance: textfield;
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

/* ── Tool popup ─────────────────────────────────────── */
.tool-popup {
  position: fixed;
  z-index: 9999;
  background: #111111;
  border: 1px solid #2a2a2a;
  border-radius: 10px;
  padding: 4px;
  box-shadow: 0 8px 28px rgba(0,0,0,0.7);
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 150px;
  user-select: none;
}

.tp-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: none;
  color: #cccccc;
  cursor: pointer;
  width: 100%;
  text-align: left;
  transition: background 0.12s;
}
.tp-item:hover { background: #1c1c1c; }
.tp-item.active { background: #252525; border-color: #6060cc; }

.tp-icon  { width: 22px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.tp-label { flex: 1; font-size: 13px; }
.tp-key {
  font-size: 10px;
  color: #666666;
  background: #161616;
  border: 1px solid #2a2a2a;
  border-radius: 3px;
  padding: 1px 5px;
  flex-shrink: 0;
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
.bp-val-input {
  font-size: 11px;
  color: #aaaaaa;
  width: 26px;
  text-align: right;
  flex-shrink: 0;
  background: transparent;
  border: none;
  border-bottom: 1px solid transparent;
  padding: 0;
  cursor: text;
  -moz-appearance: textfield;
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

/* ── Settings popup ──────────────────────────────────── */
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
  font-size: 11px;
  color: #888888;
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
  gap: 8px;
  margin-top: 4px;
  padding-top: 8px;
  border-top: 1px solid #2a2a3a;
}
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
.cl-github-link {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: #7070dd;
  text-decoration: none;
}
.cl-github-link:hover { color: #9090ff; text-decoration: underline; }
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
