<script>
  import rough from 'roughjs';
  import { onMount, tick } from 'svelte';
  import { diagramToMermaid } from '$lib/utils/diagramToMermaid.js';

  let { onInsert = () => {}, onClose = () => {}, initialData = null } = $props();

  // ── Tools & Modes ──
  let activeTool = $state('select');
  let direction = $state('TD');
  let diagramMode = $state('flowchart'); // 'flowchart' | 'knowledge'

  // ── Data ──
  let nodes = $state([]);
  let edges = $state([]);

  // ── Interaction ──
  let selectedId = $state(null);
  let selectedIds = $state([]); // Multi-selection for Ctrl+A
  let clipboard = $state(null); // { nodes: [...], edges: [...] }
  let hoveredId = $state(null);
  let dragging = $state(false);
  let dragOff = $state({ x: 0, y: 0 });

  // Resize
  let resizing = $state(false);
  let resizeHandle = $state('');
  let resizeOrig = $state({ x: 0, y: 0, w: 0, h: 0, mx: 0, my: 0 });

  // Edge-drag from node connection dots
  let edgeDragging = $state(false);
  let edgeDragFrom = $state(null);
  let edgeDragMx = $state(0);
  let edgeDragMy = $state(0);
  let nearEdgeNode = $state(null);

  // Standalone drawing (arrow/line tool on empty space)
  let drawingEdge = $state(false);
  let drawEdgeType = $state('arrow'); // 'arrow' | 'line'
  let drawStartX = $state(0);
  let drawStartY = $state(0);
  let drawEndX = $state(0);
  let drawEndY = $state(0);

  // Standalone edge dragging
  let edgeDragStandalone = $state(false);
  let edgeDragStandaloneOff = $state({ x: 0, y: 0 });
  let edgeEndpointDragging = $state(false);
  let edgeEndpointHandle = $state(null); // 'start' | 'end'

  // Label editing
  let editingId = $state(null);
  let editingType = $state(null);
  let editValue = $state('');
  let editPos = $state({ x: 0, y: 0 });
  let editInputEl;

  // Color picker
  let showColorPicker = $state(false);
  let shapeColor = $state('#1b1b1f');
  const SHAPE_COLORS = [
    '#1b1b1f', '#6366f1', '#ec4899', '#ef4444', '#f59e0b',
    '#22c55e', '#06b6d4', '#8b5cf6', '#64748b',
  ];

  // Knowledge graph colors
  const KG_COLORS = {
    rectangle: { stroke: '#22c55e', fill: 'rgba(34,197,94,0.08)' },
    ellipse:   { stroke: '#6366f1', fill: 'rgba(99,102,241,0.08)' },
    diamond:   { stroke: '#f59e0b', fill: 'rgba(245,158,11,0.08)' },
  };

  // ── Undo history (REACTIVE) ──
  let historyStack = $state([]);
  let historyIndex = $state(-1);
  const MAX_HISTORY = 50;

  function saveHistory() {
    const snap = { nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) };
    historyStack = [...historyStack.slice(0, historyIndex + 1), snap];
    if (historyStack.length > MAX_HISTORY) historyStack = historyStack.slice(1);
    historyIndex = historyStack.length - 1;
  }

  function undo() {
    if (historyIndex <= 0) return;
    historyIndex--;
    const snap = historyStack[historyIndex];
    nodes = JSON.parse(JSON.stringify(snap.nodes));
    edges = JSON.parse(JSON.stringify(snap.edges));
    selectedId = null; rerender();
  }

  function redo() {
    if (historyIndex >= historyStack.length - 1) return;
    historyIndex++;
    const snap = historyStack[historyIndex];
    nodes = JSON.parse(JSON.stringify(snap.nodes));
    edges = JSON.parse(JSON.stringify(snap.edges));
    selectedId = null; rerender();
  }

  let canUndo = $derived(historyIndex > 0);
  let canRedo = $derived(historyIndex < historyStack.length - 1);

  // SVG
  let svgEl;
  let roughSvg;
  let idCounter = 0;
  let tick_ = $state(0);

  function genId() { return 'n' + (++idCounter); }
  function rerender() { tick_++; }

  onMount(() => {
    if (svgEl) roughSvg = rough.svg(svgEl);
    // Load initial data if editing an existing diagram
    if (initialData) {
      nodes = initialData.nodes || [];
      edges = initialData.edges || [];
      direction = initialData.direction || 'TD';
      diagramMode = initialData.mode || 'flowchart';
      // Set idCounter above all existing ids
      let maxId = 0;
      for (const n of nodes) { const m = parseInt(n.id.replace(/\D/g, ''), 10); if (m > maxId) maxId = m; }
      for (const e of edges) { const m = parseInt(e.id.replace(/\D/g, ''), 10); if (m > maxId) maxId = m; }
      idCounter = maxId;
    }
    saveHistory();
  });

  // ═══ RENDERING ═══
  $effect(() => {
    if (!roughSvg || !svgEl) return;
    void tick_; void selectedId; void hoveredId; void nearEdgeNode; void selectedIds;

    const layer = svgEl.querySelector('#rough-layer');
    if (!layer) return;
    layer.innerHTML = '';

    const cs = getComputedStyle(document.documentElement);
    const S = cs.getPropertyValue('--text').trim() || '#1b1b1f';
    const F = cs.getPropertyValue('--accent-soft').trim() || 'rgba(99,102,241,0.08)';
    const A = cs.getPropertyValue('--accent').trim() || '#6366f1';
    const isKG = diagramMode === 'knowledge';

    // ── Draw connected edges ──
    const selEdgeSet = new Set(selectedIds);
    for (const edge of edges) {
      if (edge.standalone) continue;
      const fn = nodes.find(n => n.id === edge.from);
      const tn = nodes.find(n => n.id === edge.to);
      if (!fn || !tn) continue;
      const p1 = connPt(fn, tn), p2 = connPt(tn, fn);
      const isSel = edge.id === selectedId || selEdgeSet.has(edge.id);
      const isHov = edge.id === hoveredId;
      const ec = isSel ? A : (isHov ? A : (edge.color || S));
      const ew = isSel ? 2.5 : (isHov ? 2 : 1.5);
      const isDot = edge.style === 'dotted';

      if (edge.edgeType !== 'line') {
        // Curved bezier edges for both KG and flowchart
        curvedEdge(layer, p1, p2, ec, ew, isDot, isKG ? 0.4 : 0.25);
      } else {
        const el = roughSvg.line(p1.x, p1.y, p2.x, p2.y, {
          roughness: isKG ? 0.3 : 0.5, strokeWidth: ew, stroke: ec, fill: 'none',
          ...(isDot ? { strokeLineDash: [6, 4] } : {}),
        });
        layer.appendChild(el);
      }

      if (edge.label) {
        const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2 - 8;
        svgText(layer, edge.label, mx, my, ec, 11, true);
      }
    }

    // ── Standalone edges ──
    for (const edge of edges) {
      if (!edge.standalone) continue;
      const isSel = edge.id === selectedId;
      const isHov = edge.id === hoveredId;
      const ec = isSel ? A : (isHov ? A : (edge.color || S));
      const ew = isSel ? 2.5 : (isHov ? 2 : 1.5);
      const isDot = edge.style === 'dotted';
      const sp = { x: edge.x1, y: edge.y1 }, ep = { x: edge.x2, y: edge.y2 };

      if (edge.edgeType !== 'line') {
        curvedEdge(layer, sp, ep, ec, ew, isDot, 0.2);
      } else {
        const el = roughSvg.line(edge.x1, edge.y1, edge.x2, edge.y2, {
          roughness: 0.5, strokeWidth: ew, stroke: ec, fill: 'none',
          ...(isDot ? { strokeLineDash: [6, 4] } : {}),
        });
        layer.appendChild(el);
      }
      if (edge.label) {
        const mx = (edge.x1 + edge.x2) / 2, my = (edge.y1 + edge.y2) / 2 - 8;
        svgText(layer, edge.label, mx, my, ec, 11, true);
      }
      // Endpoint handles for selected standalone edges
      if (isSel) {
        for (const ep_ of [{ x: edge.x1, y: edge.y1 }, { x: edge.x2, y: edge.y2 }]) {
          const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          circle.setAttribute('cx', ep_.x); circle.setAttribute('cy', ep_.y);
          circle.setAttribute('r', '5');
          circle.setAttribute('fill', '#fff');
          circle.setAttribute('stroke', A);
          circle.setAttribute('stroke-width', '1.5');
          circle.setAttribute('pointer-events', 'none');
          layer.appendChild(circle);
        }
      }
    }

    // ── Edge-drag preview from node ──
    if (edgeDragging && edgeDragFrom) {
      const fn = nodes.find(n => n.id === edgeDragFrom);
      if (fn) {
        // Use connPt to start from edge of shape (not center)
        const fakeTo = { x: edgeDragMx - 1, y: edgeDragMy - 1, w: 2, h: 2 };
        const startPt = connPt(fn, fakeTo);
        curvedEdge(layer, startPt, { x: edgeDragMx, y: edgeDragMy }, A, 1.5, false, 0.2);
      }
    }

    // ── Drawing preview (arrow/line tool on canvas) ──
    if (drawingEdge) {
      const pl = roughSvg.line(drawStartX, drawStartY, drawEndX, drawEndY, {
        roughness: 0.2, strokeWidth: 1.5, stroke: A, fill: 'none',
      });
      layer.appendChild(pl);
      if (drawEdgeType === 'arrow') {
        layer.appendChild(arrowHead({ x: drawStartX, y: drawStartY }, { x: drawEndX, y: drawEndY }, A));
      }
    }

    // ── Draw nodes ──
    const selSet = new Set(selectedIds);
    for (const node of nodes) {
      const isSel = node.id === selectedId || selSet.has(node.id);
      const isHov = node.id === hoveredId && !isSel;
      const isNearEdge = node.id === nearEdgeNode;
      const kc = isKG ? KG_COLORS[node.type] || KG_COLORS.rectangle : null;

      const nodeColor = node.color || S;
      const stroke = isSel ? A : (isHov ? A : (kc ? kc.stroke : nodeColor));
      const fill = kc ? kc.fill : (node.fill || F);
      const sw = isSel ? 2.5 : (isHov ? 2 : 1.5);
      const roughness = isKG ? 0.3 : 1.0;
      const o = { roughness, strokeWidth: sw, stroke, fill, fillStyle: isKG ? 'solid' : 'hachure', hachureGap: 8 };

      let shapeEl;
      if (node.type === 'rectangle') {
        shapeEl = roughSvg.rectangle(node.x, node.y, node.w, node.h, { ...o, ...(isKG ? { bowing: 0 } : {}) });
      } else if (node.type === 'diamond') {
        const cx = node.x + node.w / 2, cy = node.y + node.h / 2;
        const hw = node.w / 2, hh = node.h / 2;
        shapeEl = roughSvg.polygon([[cx, cy - hh], [cx + hw, cy], [cx, cy + hh], [cx - hw, cy]], o);
      } else if (node.type === 'ellipse') {
        shapeEl = roughSvg.ellipse(node.x + node.w / 2, node.y + node.h / 2, node.w, node.h, { ...o, ...(isKG ? { bowing: 0 } : {}) });
      } else if (node.type === 'text') {
        // Text nodes: no visible border at all (clean look)
      } else if (node.type === 'table') {
        // Table nodes: draw grid
        const cols = node.cols || 3, rows = node.rows || 3;
        const cw = node.w / cols, rh = node.h / rows;
        // Outer border
        shapeEl = roughSvg.rectangle(node.x, node.y, node.w, node.h, { ...o, roughness: 0.3, bowing: 0 });
        // Inner grid lines
        for (let c = 1; c < cols; c++) {
          const lx = node.x + c * cw;
          layer.appendChild(roughSvg.line(lx, node.y, lx, node.y + node.h, { roughness: 0.2, strokeWidth: 1, stroke, fill: 'none' }));
        }
        for (let r = 1; r < rows; r++) {
          const ly = node.y + r * rh;
          layer.appendChild(roughSvg.line(node.x, ly, node.x + node.w, ly, { roughness: 0.2, strokeWidth: 1, stroke, fill: 'none' }));
        }
        // Header row fill
        const headerRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        headerRect.setAttribute('x', node.x + 1); headerRect.setAttribute('y', node.y + 1);
        headerRect.setAttribute('width', node.w - 2); headerRect.setAttribute('height', rh - 1);
        headerRect.setAttribute('fill', kc ? kc.fill : F);
        headerRect.setAttribute('opacity', '0.5');
        layer.appendChild(headerRect);
      }
      if (shapeEl) layer.appendChild(shapeEl);

      // Label
      if (node.label) {
        const cx = node.x + node.w / 2, cy = node.y + node.h / 2;
        if (node.type === 'text') {
          svgText(layer, node.label, cx, cy, node.color || S, 16, false);
        } else if (node.type === 'table') {
          // Table label goes in header row
          const rh = node.h / (node.rows || 3);
          svgText(layer, node.label, cx, node.y + rh / 2, isSel ? A : (node.color || S), 12, false);
        } else {
          const fontSize = isKG ? 12 : Math.min(14, Math.max(10, node.w / 10));
          const labelColor = isSel ? A : (kc ? kc.stroke : (node.color || S));
          // In KG mode, show full label (node auto-sizes). In flowchart, truncate.
          if (isKG) {
            svgText(layer, node.label, cx, cy, labelColor, fontSize, false);
          } else {
            const maxChars = Math.max(3, Math.floor((node.w - 16) / 7));
            const display = node.label.length > maxChars ? node.label.slice(0, maxChars - 1) + '\u2026' : node.label;
            svgText(layer, display, cx, cy, labelColor, fontSize, false);
          }
        }
      }

      // Edge connection dots — show for hovered nodes too when arrow/line tool is active
      const showDots = (isNearEdge || isSel || (isHov && (activeTool === 'arrow' || activeTool === 'line'))) && (activeTool === 'select' || activeTool === 'arrow' || activeTool === 'line') && !dragging && !resizing && node.type !== 'text';
      if (showDots) {
        for (const d of getEdgeDots(node)) {
          const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          circle.setAttribute('cx', d.x); circle.setAttribute('cy', d.y);
          circle.setAttribute('r', '5'); circle.setAttribute('fill', A);
          circle.setAttribute('opacity', '0.7'); circle.setAttribute('pointer-events', 'none');
          layer.appendChild(circle);
        }
      }

      // Resize handles
      if (isSel && !resizing && !dragging && !edgeDragging) {
        for (const h of getResizeHandles(node)) {
          const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          r.setAttribute('x', h.x - 4); r.setAttribute('y', h.y - 4);
          r.setAttribute('width', 8); r.setAttribute('height', 8);
          r.setAttribute('rx', 2); r.setAttribute('fill', '#fff');
          r.setAttribute('stroke', A); r.setAttribute('stroke-width', '1.5');
          r.setAttribute('pointer-events', 'none');
          layer.appendChild(r);
        }
      }
    }
  });

  // ═══ GEOMETRY ═══
  function connPt(from, to) {
    const fx = from.x + from.w / 2, fy = from.y + from.h / 2;
    const tx = to.x + to.w / 2, ty = to.y + to.h / 2;
    const dx = tx - fx, dy = ty - fy;
    const hw = from.w / 2, hh = from.h / 2;
    if (dx === 0 && dy === 0) return { x: fx, y: fy };
    if (Math.abs(dx) * hh > Math.abs(dy) * hw) {
      const sx = dx > 0 ? hw : -hw;
      return { x: fx + sx, y: fy + (sx * dy / dx) };
    }
    const sy = dy > 0 ? hh : -hh;
    return { x: fx + (sy * dx / dy), y: fy + sy };
  }

  /** Draw a curved bezier path between two points */
  function curvedEdge(layer, p1, p2, color, width, isDot, curvature = 0.4) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    // Control point offset — use both dx and dy for natural curves in any direction
    const dist = Math.hypot(dx, dy);
    const cpOff = dist * curvature;
    // Offset control points perpendicular-ish: horizontal bias for LR, vertical bias for TD
    const isHorizontal = Math.abs(dx) > Math.abs(dy);
    const cp1x = isHorizontal ? p1.x + cpOff : p1.x;
    const cp1y = isHorizontal ? p1.y : p1.y + cpOff;
    const cp2x = isHorizontal ? p2.x - cpOff : p2.x;
    const cp2y = isHorizontal ? p2.y : p2.y - cpOff;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M ${p1.x} ${p1.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`);
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', String(width));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-linecap', 'round');
    if (isDot) path.setAttribute('stroke-dasharray', '6,4');
    layer.appendChild(path);

    // Arrow head at the end — use the tangent direction at the endpoint
    const tangentX = p2.x - cp2x, tangentY = p2.y - cp2y;
    const a = Math.atan2(tangentY, tangentX), s = 8;
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    const ax1 = p2.x - s * Math.cos(a - Math.PI / 7), ay1 = p2.y - s * Math.sin(a - Math.PI / 7);
    const ax2 = p2.x - s * Math.cos(a + Math.PI / 7), ay2 = p2.y - s * Math.sin(a + Math.PI / 7);
    poly.setAttribute('points', `${p2.x},${p2.y} ${ax1},${ay1} ${ax2},${ay2}`);
    poly.setAttribute('fill', color);
    layer.appendChild(poly);
  }

  function arrowHead(from, to, color) {
    const dx = to.x - from.x, dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len < 2) {
      const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      return g; // empty group for zero-length
    }
    const a = Math.atan2(dy, dx), s = 10;
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    const p1x = to.x - s * Math.cos(a - Math.PI / 7), p1y = to.y - s * Math.sin(a - Math.PI / 7);
    const p2x = to.x - s * Math.cos(a + Math.PI / 7), p2y = to.y - s * Math.sin(a + Math.PI / 7);
    poly.setAttribute('points', `${to.x},${to.y} ${p1x},${p1y} ${p2x},${p2y}`);
    poly.setAttribute('fill', color);
    return poly;
  }

  function svgText(layer, text, cx, cy, color, size, withBg) {
    if (withBg) {
      const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      const bw = text.length * 6.5 + 10, bh = 16;
      bg.setAttribute('x', cx - bw / 2); bg.setAttribute('y', cy - bh / 2);
      bg.setAttribute('width', bw); bg.setAttribute('height', bh);
      bg.setAttribute('rx', 3);
      bg.setAttribute('fill', document.documentElement.getAttribute('data-theme') === 'dark' ? '#121215' : '#ffffff');
      bg.setAttribute('opacity', '0.85');
      layer.appendChild(bg);
    }
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', cx); t.setAttribute('y', cy);
    t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'central');
    t.setAttribute('fill', color); t.setAttribute('font-family', 'Virgil, Segoe UI Emoji, Inter, sans-serif');
    t.setAttribute('font-size', String(size)); t.setAttribute('pointer-events', 'none');
    t.textContent = text;
    layer.appendChild(t);
  }

  function getEdgeDots(node) {
    const { x, y, w, h } = node;
    return [{ x: x + w / 2, y }, { x: x + w, y: y + h / 2 }, { x: x + w / 2, y: y + h }, { x, y: y + h / 2 }];
  }

  function getResizeHandles(node) {
    const { x, y, w, h } = node;
    return [{ id: 'nw', x, y }, { id: 'ne', x: x + w, y }, { id: 'se', x: x + w, y: y + h }, { id: 'sw', x, y: y + h }];
  }

  // ═══ HIT TESTING ═══
  function pt(e) { const r = svgEl.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  function hitNode(p) {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (p.x >= n.x - 4 && p.x <= n.x + n.w + 4 && p.y >= n.y - 4 && p.y <= n.y + n.h + 4) return n;
    }
    return null;
  }

  function hitEdge(p) {
    for (const e of edges) {
      let p1, p2;
      if (e.standalone) {
        p1 = { x: e.x1, y: e.y1 }; p2 = { x: e.x2, y: e.y2 };
      } else {
        const fn = nodes.find(n => n.id === e.from), tn = nodes.find(n => n.id === e.to);
        if (!fn || !tn) continue;
        p1 = connPt(fn, tn); p2 = connPt(tn, fn);
      }
      const A_ = p.x - p1.x, B_ = p.y - p1.y, C_ = p2.x - p1.x, D_ = p2.y - p1.y;
      const dot = A_ * C_ + B_ * D_, lenSq = C_ * C_ + D_ * D_;
      let t = lenSq !== 0 ? dot / lenSq : -1;
      t = Math.max(0, Math.min(1, t));
      if (Math.hypot(p.x - (p1.x + t * C_), p.y - (p1.y + t * D_)) < 12) return e;
    }
    return null;
  }

  function hitEdgeEndpoint(p, edge) {
    if (!edge || !edge.standalone) return null;
    if (Math.hypot(p.x - edge.x1, p.y - edge.y1) < 8) return 'start';
    if (Math.hypot(p.x - edge.x2, p.y - edge.y2) < 8) return 'end';
    return null;
  }

  function hitHandle(p, node) {
    for (const h of getResizeHandles(node)) {
      if (Math.abs(p.x - h.x) < 7 && Math.abs(p.y - h.y) < 7) return h.id;
    }
    return null;
  }

  function nearNodeEdge(p) {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (n.type === 'text') continue;
      const inside = p.x >= n.x && p.x <= n.x + n.w && p.y >= n.y && p.y <= n.y + n.h;
      if (!inside) continue;
      const distL = p.x - n.x, distR = n.x + n.w - p.x;
      const distT = p.y - n.y, distB = n.y + n.h - p.y;
      if (Math.min(distL, distR, distT, distB) < 14) return n;
    }
    return null;
  }

  function hitEdgeDot(p) {
    for (const node of nodes) {
      if (node.type === 'text') continue;
      for (const d of getEdgeDots(node)) {
        if (Math.hypot(p.x - d.x, p.y - d.y) < 10) return node;
      }
    }
    return null;
  }

  function findNonOverlappingPosition(startX, startY, w, h) {
    let x = startX, y = startY;
    const margin = 10;
    let attempts = 0;
    while (attempts < 50) {
      const overlap = nodes.some(n =>
        x < n.x + n.w + margin && x + w + margin > n.x &&
        y < n.y + n.h + margin && y + h + margin > n.y
      );
      if (!overlap) return { x, y };
      x += w + 20;
      attempts++;
      if (attempts % 8 === 0) { x = startX; y += h + 20; }
    }
    return { x, y };
  }

  // ═══ MOUSE HANDLERS ═══
  function onMouseDown(e) {
    if (e.button !== 0 || editingId) return;
    e.preventDefault(); // Prevent text selection / blue screen while dragging
    showColorPicker = false;
    const p_ = pt(e);

    // ── Arrow or Line tool ──
    if (activeTool === 'arrow' || activeTool === 'line') {
      const edgeDotNode = hitEdgeDot(p_);
      const nearEdge_ = !edgeDotNode ? nearNodeEdge(p_) : null;
      const fromNode = edgeDotNode || nearEdge_;

      if (fromNode) {
        // Start edge from node
        edgeDragging = true;
        edgeDragFrom = fromNode.id;
        edgeDragMx = p_.x; edgeDragMy = p_.y;
      } else {
        // Standalone drawing on canvas
        drawingEdge = true;
        drawEdgeType = activeTool; // 'arrow' or 'line'
        drawStartX = p_.x; drawStartY = p_.y;
        drawEndX = p_.x; drawEndY = p_.y;
      }
      return;
    }

    if (activeTool === 'select') {
      // 1. Resize handles
      if (selectedId) {
        const sn = nodes.find(n => n.id === selectedId);
        if (sn) {
          const h = hitHandle(p_, sn);
          if (h) {
            resizing = true; resizeHandle = h;
            resizeOrig = { x: sn.x, y: sn.y, w: sn.w, h: sn.h, mx: p_.x, my: p_.y };
            return;
          }
        }
        // 1b. Edge endpoint handles → resize edge endpoint
        const se = edges.find(e => e.id === selectedId);
        if (se && se.standalone) {
          const eh = hitEdgeEndpoint(p_, se);
          if (eh) {
            edgeEndpointDragging = true;
            edgeEndpointHandle = eh;
            return;
          }
        }
      }

      // 2. Edge dots → edge drag
      const edgeDotNode = hitEdgeDot(p_);
      if (edgeDotNode) {
        edgeDragging = true;
        edgeDragFrom = edgeDotNode.id;
        edgeDragMx = p_.x; edgeDragMy = p_.y;
        return;
      }

      // 3. Near-edge → edge drag
      const nearEdge_ = nearNodeEdge(p_);
      if (nearEdge_ && nearEdge_.id === nearEdgeNode) {
        edgeDragging = true;
        edgeDragFrom = nearEdge_.id;
        edgeDragMx = p_.x; edgeDragMy = p_.y;
        return;
      }

      // 4. Hit node → drag
      const hn = hitNode(p_);
      if (hn) { selectedId = hn.id; selectedIds = []; dragging = true; dragOff = { x: p_.x - hn.x, y: p_.y - hn.y }; rerender(); return; }

      // 5. Hit edge → select (and drag if standalone)
      const he = hitEdge(p_);
      if (he) {
        selectedId = he.id; selectedIds = [];
        if (he.standalone) {
          edgeDragStandalone = true;
          const midX = (he.x1 + he.x2) / 2, midY = (he.y1 + he.y2) / 2;
          edgeDragStandaloneOff = { x: p_.x - midX, y: p_.y - midY };
        }
        rerender(); return;
      }

      selectedId = null; selectedIds = []; rerender(); return;
    }

    // Shape tools
    if (['rectangle', 'diamond', 'ellipse'].includes(activeTool)) {
      const w = activeTool === 'diamond' ? 120 : 140;
      const h = activeTool === 'diamond' ? 80 : 60;
      const pos = findNonOverlappingPosition(p_.x - w / 2, p_.y - h / 2, w, h);
      const nn = { id: genId(), type: activeTool, x: pos.x, y: pos.y, w, h, label: '', color: shapeColor };
      nodes = [...nodes, nn]; selectedId = nn.id; activeTool = 'select'; saveHistory(); rerender();
      tick().then(() => startEdit(nn.id, 'node'));
      return;
    }

    // Text tool
    if (activeTool === 'text') {
      const pos = findNonOverlappingPosition(p_.x - 60, p_.y - 16, 120, 32);
      const nn = { id: genId(), type: 'text', x: pos.x, y: pos.y, w: 120, h: 32, label: '', color: shapeColor };
      nodes = [...nodes, nn]; selectedId = nn.id; activeTool = 'select'; saveHistory(); rerender();
      tick().then(() => startEdit(nn.id, 'node'));
      return;
    }
  }

  function onMouseMove(e) {
    const p_ = pt(e);

    if (drawingEdge) {
      e.preventDefault();
      drawEndX = p_.x; drawEndY = p_.y; rerender();
      return;
    }

    if (edgeEndpointDragging && selectedId) {
      const idx = edges.findIndex(e_ => e_.id === selectedId);
      if (idx >= 0) {
        if (edgeEndpointHandle === 'start') {
          edges[idx] = { ...edges[idx], x1: p_.x, y1: p_.y };
        } else {
          edges[idx] = { ...edges[idx], x2: p_.x, y2: p_.y };
        }
        edges = [...edges]; rerender();
      }
      return;
    }

    if (edgeDragStandalone && selectedId) {
      const idx = edges.findIndex(e_ => e_.id === selectedId);
      if (idx >= 0) {
        const ed = edges[idx];
        const midX = (ed.x1 + ed.x2) / 2, midY = (ed.y1 + ed.y2) / 2;
        const newMidX = p_.x - edgeDragStandaloneOff.x, newMidY = p_.y - edgeDragStandaloneOff.y;
        const dx = newMidX - midX, dy = newMidY - midY;
        edges[idx] = { ...ed, x1: ed.x1 + dx, y1: ed.y1 + dy, x2: ed.x2 + dx, y2: ed.y2 + dy };
        edges = [...edges]; rerender();
      }
      return;
    }

    if (resizing) {
      const dx = p_.x - resizeOrig.mx, dy = p_.y - resizeOrig.my;
      const idx = nodes.findIndex(n => n.id === selectedId);
      if (idx < 0) return;
      let { x, y, w, h } = resizeOrig;
      if (resizeHandle.includes('e')) w = Math.max(40, w + dx);
      if (resizeHandle.includes('w')) { x += dx; w = Math.max(40, w - dx); if (w === 40) x = resizeOrig.x + resizeOrig.w - 40; }
      if (resizeHandle.includes('s')) h = Math.max(30, h + dy);
      if (resizeHandle.includes('n')) { y += dy; h = Math.max(30, h - dy); if (h === 30) y = resizeOrig.y + resizeOrig.h - 30; }
      nodes[idx] = { ...nodes[idx], x, y, w, h }; nodes = [...nodes]; rerender();
      return;
    }

    if (dragging && selectedId) {
      const idx = nodes.findIndex(n => n.id === selectedId);
      if (idx >= 0) { nodes[idx] = { ...nodes[idx], x: p_.x - dragOff.x, y: p_.y - dragOff.y }; nodes = [...nodes]; rerender(); }
      return;
    }

    if (edgeDragging) {
      edgeDragMx = p_.x; edgeDragMy = p_.y; rerender();
      return;
    }

    // Hover + near-edge detection
    const hn = hitNode(p_);
    const he = !hn ? hitEdge(p_) : null;
    hoveredId = hn ? hn.id : (he ? he.id : null);
    const ne = nearNodeEdge(p_);
    nearEdgeNode = ne ? ne.id : null;
    rerender();
    updateCursor(p_);
  }

  function onMouseUp(e) {
    const p_ = pt(e);

    if (edgeEndpointDragging) { edgeEndpointDragging = false; edgeEndpointHandle = null; saveHistory(); return; }
    if (edgeDragStandalone) { edgeDragStandalone = false; saveHistory(); return; }

    // Standalone edge drawing (arrow/line on canvas)
    if (drawingEdge) {
      const dist = Math.hypot(drawEndX - drawStartX, drawEndY - drawStartY);
      if (dist > 15) {
        const startNode = hitNode({ x: drawStartX, y: drawStartY });
        const endNode = hitNode({ x: drawEndX, y: drawEndY });

        if (startNode && endNode && startNode.id !== endNode.id) {
          // Connect two nodes
          const ne = { id: 'e' + (++idCounter), from: startNode.id, to: endNode.id, label: '', style: 'solid', color: shapeColor, edgeType: drawEdgeType };
          edges = [...edges, ne]; selectedId = ne.id;
        } else {
          // Standalone arrow/line on canvas
          const ne = { id: 'e' + (++idCounter), standalone: true, x1: drawStartX, y1: drawStartY, x2: drawEndX, y2: drawEndY, label: '', style: 'solid', color: shapeColor, edgeType: drawEdgeType };
          edges = [...edges, ne]; selectedId = ne.id;
        }
        saveHistory();
      }
      drawingEdge = false; rerender();
      return;
    }

    // Edge drag from node dot
    if (edgeDragging && edgeDragFrom) {
      const target = hitNode(p_);
      const fromNode = nodes.find(n => n.id === edgeDragFrom);
      const edgeType = activeTool === 'line' ? 'line' : 'arrow';

      if (target && target.id !== edgeDragFrom) {
        // Connect two nodes
        const ne = { id: 'e' + (++idCounter), from: edgeDragFrom, to: target.id, label: '', style: 'solid', color: shapeColor, edgeType };
        edges = [...edges, ne]; selectedId = ne.id;
        saveHistory();
      } else if (fromNode) {
        // Dropped on empty space — create standalone arrow from edge of shape
        const fakeTo = { x: p_.x - 1, y: p_.y - 1, w: 2, h: 2 };
        const startPt = connPt(fromNode, fakeTo);
        const dist = Math.hypot(p_.x - startPt.x, p_.y - startPt.y);
        if (dist > 15) {
          const ne = { id: 'e' + (++idCounter), standalone: true, x1: startPt.x, y1: startPt.y, x2: p_.x, y2: p_.y, label: '', style: 'solid', color: shapeColor, edgeType };
          edges = [...edges, ne]; selectedId = ne.id;
          saveHistory();
        }
      }
      edgeDragging = false; edgeDragFrom = null; rerender();
      return;
    }

    if (dragging) { dragging = false; saveHistory(); return; }
    if (resizing) { resizing = false; saveHistory(); rerender(); return; }
  }

  function onDblClick(e) {
    const p_ = pt(e);
    const hn = hitNode(p_);
    if (hn) { startEdit(hn.id, 'node'); return; }
    const he = hitEdge(p_);
    if (he) { startEdit(he.id, 'edge'); }
  }

  function updateCursor(p_) {
    if (!svgEl) return;
    if (activeTool !== 'select') { svgEl.style.cursor = 'crosshair'; return; }
    if (selectedId) {
      const sn = nodes.find(n => n.id === selectedId);
      if (sn) {
        const h = hitHandle(p_, sn);
        if (h) { svgEl.style.cursor = { nw: 'nwse-resize', ne: 'nesw-resize', se: 'nwse-resize', sw: 'nesw-resize' }[h]; return; }
      }
      const se = edges.find(e => e.id === selectedId);
      if (se && se.standalone) {
        const eh = hitEdgeEndpoint(p_, se);
        if (eh) { svgEl.style.cursor = 'grab'; return; }
      }
    }
    if (nearNodeEdge(p_)) { svgEl.style.cursor = 'crosshair'; return; }
    const hn = hitNode(p_);
    if (hn) { svgEl.style.cursor = 'move'; return; }
    const he = hitEdge(p_);
    if (he) { svgEl.style.cursor = he.standalone ? 'move' : 'pointer'; return; }
    svgEl.style.cursor = 'default';
  }

  // ═══ LABEL EDITING ═══
  let editNodeW = $state(140); // width of node being edited (for inline sizing)

  function startEdit(id, type) {
    editingId = id; editingType = type;
    if (type === 'node') {
      const n = nodes.find(n_ => n_.id === id); if (!n) return;
      editValue = n.label;
      editNodeW = n.w;
      if (diagramMode === 'knowledge') {
        // Position relative to the canvas-wrap for inline editing
        editPos = { x: n.x + n.w / 2, y: n.y + n.h / 2 };
      } else {
        const r = svgEl.getBoundingClientRect();
        editPos = { x: r.left + n.x + n.w / 2, y: r.top + n.y + n.h / 2 };
      }
    } else {
      const e_ = edges.find(e => e.id === id); if (!e_) return;
      editValue = e_.label || '';
      editNodeW = 140;
      if (diagramMode === 'knowledge') {
        if (e_.standalone) {
          editPos = { x: (e_.x1 + e_.x2) / 2, y: (e_.y1 + e_.y2) / 2 };
        } else {
          const fn = nodes.find(n => n.id === e_.from), tn = nodes.find(n => n.id === e_.to);
          if (fn && tn) editPos = { x: (fn.x + fn.w / 2 + tn.x + tn.w / 2) / 2, y: (fn.y + fn.h / 2 + tn.y + tn.h / 2) / 2 };
        }
      } else {
        const r = svgEl.getBoundingClientRect();
        if (e_.standalone) {
          editPos = { x: r.left + (e_.x1 + e_.x2) / 2, y: r.top + (e_.y1 + e_.y2) / 2 };
        } else {
          const fn = nodes.find(n => n.id === e_.from), tn = nodes.find(n => n.id === e_.to);
          if (fn && tn) editPos = { x: r.left + (fn.x + fn.w / 2 + tn.x + tn.w / 2) / 2, y: r.top + (fn.y + fn.h / 2 + tn.y + tn.h / 2) / 2 };
        }
      }
    }
    tick().then(() => {
      editInputEl?.focus();
      editInputEl?.select();
    });
  }

  function commitLabel() {
    if (!editingId) return;
    if (editingType === 'node') {
      const idx = nodes.findIndex(n => n.id === editingId);
      if (idx >= 0) {
        const node = nodes[idx];
        if (node.type === 'text' && editValue) {
          nodes[idx] = { ...node, label: editValue, w: Math.max(60, editValue.length * 10 + 24) };
        } else {
          // Auto-resize width to fit label in KG mode, keep original in flowchart
          if (diagramMode === 'knowledge' && editValue) {
            const fitW = Math.max(80, editValue.length * 8 + 32);
            nodes[idx] = { ...node, label: editValue, w: fitW };
          } else {
            nodes[idx] = { ...node, label: editValue };
          }
        }
        nodes = [...nodes];
      }
    } else {
      const idx = edges.findIndex(e => e.id === editingId);
      if (idx >= 0) { edges[idx] = { ...edges[idx], label: editValue }; edges = [...edges]; }
    }
    editingId = null; saveHistory();
    rerender();
  }

  function onEditKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); commitLabel(); }
    if (e.key === 'Escape') { editingId = null; }
    e.stopPropagation();
  }

  // ═══ COPY / PASTE ═══
  function doCopy() {
    const selSet = new Set(selectedIds.length > 0 ? selectedIds : (selectedId ? [selectedId] : []));
    if (selSet.size === 0) return;
    // Collect selected nodes
    const copiedNodes = nodes.filter(n => selSet.has(n.id)).map(n => ({ ...n }));
    const nodeIdSet = new Set(copiedNodes.map(n => n.id));
    // If a connected edge is selected, also include its endpoint nodes
    const selectedEdges = edges.filter(e => selSet.has(e.id));
    for (const e of selectedEdges) {
      if (e.from && !nodeIdSet.has(e.from)) {
        const fn = nodes.find(n => n.id === e.from);
        if (fn) { copiedNodes.push({ ...fn }); nodeIdSet.add(fn.id); }
      }
      if (e.to && !nodeIdSet.has(e.to)) {
        const tn = nodes.find(n => n.id === e.to);
        if (tn) { copiedNodes.push({ ...tn }); nodeIdSet.add(tn.id); }
      }
    }
    const copiedEdges = edges.filter(e =>
      selSet.has(e.id) || (e.from && e.to && nodeIdSet.has(e.from) && nodeIdSet.has(e.to))
    ).map(e => ({ ...e }));
    clipboard = { nodes: copiedNodes, edges: copiedEdges };
  }

  function doPaste() {
    if (!clipboard || (clipboard.nodes.length === 0 && clipboard.edges.length === 0)) return;
    const idMap = new Map();
    const pastedNodes = clipboard.nodes.map(n => {
      const newId = genId();
      idMap.set(n.id, newId);
      return { ...n, id: newId, x: n.x + 20, y: n.y + 20 };
    });
    const pastedEdges = clipboard.edges.map(e => {
      const newId = 'e' + (++idCounter);
      if (e.standalone) {
        return { ...e, id: newId, x1: e.x1 + 20, y1: e.y1 + 20, x2: e.x2 + 20, y2: e.y2 + 20 };
      }
      return { ...e, id: newId, from: idMap.get(e.from) || e.from, to: idMap.get(e.to) || e.to };
    });
    nodes = [...nodes, ...pastedNodes];
    edges = [...edges, ...pastedEdges];
    selectedIds = [...pastedNodes.map(n => n.id), ...pastedEdges.map(e => e.id)];
    selectedId = selectedIds[0] || null;
    saveHistory();
    rerender();
  }

  // ═══ KEYBOARD ═══
  function onKey(e) {
    if (editingId) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if (mod && e.key === 'z' && e.shiftKey) { e.preventDefault(); redo(); return; }
    if (mod && e.key === 'y') { e.preventDefault(); redo(); return; }
    if (mod && e.key === 'Enter') { e.preventDefault(); handleInsert(); return; }
    if (mod && e.key === 'c') { e.preventDefault(); doCopy(); return; }
    if (mod && e.key === 'v') { e.preventDefault(); doPaste(); return; }

    if (e.key === 'Escape') {
      if (drawingEdge) { drawingEdge = false; rerender(); return; }
      if (edgeDragging) { edgeDragging = false; edgeDragFrom = null; rerender(); return; }
      onClose(); return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && (selectedId || selectedIds.length > 0)) { e.preventDefault(); doDelete(); return; }

    // Ctrl+A / Cmd+A: select all nodes
    if (mod && e.key === 'a') {
      e.preventDefault();
      selectAll();
      return;
    }

    // Single-key shortcuts (only without modifier)
    if (!mod) {
      if (e.key === 'k') { toggleKnowledgeMode(); return; }
      const map = { v: 'select', '1': 'select', r: 'rectangle', '2': 'rectangle', d: 'diamond', '3': 'diamond', o: 'ellipse', '4': 'ellipse', a: 'arrow', '5': 'arrow', l: 'line', '6': 'line', t: 'text', '7': 'text' };
      if (map[e.key]) activeTool = map[e.key];
    }
  }

  // ═══ KNOWLEDGE GRAPH (MIND MAP) ═══
  let kgChildCounter = 0; // For auto-naming: Topic 1, Topic 2, ...

  function toggleKnowledgeMode() {
    if (diagramMode === 'knowledge') {
      diagramMode = 'flowchart';
      rerender();
      return;
    }
    diagramMode = 'knowledge';
    direction = 'LR';
    kgChildCounter = 0;
    // Seed a root node if canvas is empty
    if (nodes.length === 0) {
      const cx = svgEl ? svgEl.clientWidth / 2 - 70 : 300;
      const cy = svgEl ? svgEl.clientHeight / 2 - 25 : 250;
      const root = { id: genId(), type: 'ellipse', x: cx, y: cy, w: 140, h: 50, label: 'Central Topic', color: '#6366f1' };
      nodes = [...nodes, root];
      selectedId = root.id;
      saveHistory();
      tick().then(() => startEdit(root.id, 'node'));
    }
    rerender();
  }

  /** Get all children of a parent node (via edges) */
  function getChildIds(parentId) {
    return edges.filter(e => e.from === parentId && !e.standalone).map(e => e.to);
  }

  /** Recursively compute subtree height for layout */
  function subtreeHeight(nodeId, nodeGapY) {
    const childIds = getChildIds(nodeId);
    if (childIds.length === 0) return 36; // leaf node height
    let total = 0;
    for (const cid of childIds) {
      total += subtreeHeight(cid, nodeGapY);
    }
    total += (childIds.length - 1) * nodeGapY;
    return Math.max(36, total);
  }

  /** Auto-layout the entire mind map tree from root */
  function layoutMindMap() {
    if (nodes.length === 0) return;
    // Find root node (node with no incoming edges)
    const hasIncoming = new Set(edges.filter(e => !e.standalone).map(e => e.to));
    const roots = nodes.filter(n => !hasIncoming.has(n.id));
    if (roots.length === 0) return;

    const root = roots[0];
    const gapX = 60; // horizontal gap between levels
    const gapY = 8;  // vertical gap between siblings

    function layoutNode(nodeId, x, yStart, yEnd) {
      const node = nodes.find(n => n.id === nodeId);
      if (!node) return;
      const midY = (yStart + yEnd) / 2;
      node.x = x;
      node.y = midY - node.h / 2;

      const childIds = getChildIds(nodeId);
      if (childIds.length === 0) return;

      const childX = x + node.w + gapX;
      // Compute each child's subtree height
      const heights = childIds.map(cid => subtreeHeight(cid, gapY));
      const totalH = heights.reduce((a, b) => a + b, 0) + (childIds.length - 1) * gapY;
      let curY = midY - totalH / 2;

      for (let i = 0; i < childIds.length; i++) {
        const cEnd = curY + heights[i];
        layoutNode(childIds[i], childX, curY, cEnd);
        curY = cEnd + gapY;
      }
    }

    const totalH = subtreeHeight(root.id, gapY);
    const canvasH = svgEl ? svgEl.clientHeight : 600;
    const startY = Math.max(40, canvasH / 2 - totalH / 2);
    const startX = 60;

    layoutNode(root.id, startX, startY, startY + totalH);
    nodes = [...nodes]; // trigger reactivity
    rerender();
  }

  function addChildNode(parentId) {
    const parent = nodes.find(n => n.id === parentId);
    if (!parent) return;

    kgChildCounter++;
    const childW = 120, childH = 36;
    // Temporary placement (will be re-laid-out)
    const cx = parent.x + parent.w + 60;
    const cy = parent.y;

    const defaultLabel = `Topic ${kgChildCounter}`;
    const child = { id: genId(), type: 'rectangle', x: cx, y: cy, w: childW, h: childH, label: defaultLabel, color: '#22c55e' };
    const edge = { id: 'e' + (++idCounter), from: parentId, to: child.id, label: '', style: 'solid', color: '#6366f1', edgeType: 'arrow' };
    nodes = [...nodes, child];
    edges = [...edges, edge];
    selectedId = child.id;
    saveHistory();

    // Re-layout the entire tree for clean arrangement
    layoutMindMap();

    tick().then(() => startEdit(child.id, 'node'));
  }

  // ═══ ACTIONS ═══
  function selectAll() {
    selectedIds = [...nodes.map(n => n.id), ...edges.map(e => e.id)];
    selectedId = selectedIds[0] || null;
    rerender();
  }

  function doDelete() {
    // Multi-selection delete
    if (selectedIds.length > 0) {
      const idsToDelete = new Set(selectedIds);
      nodes = nodes.filter(n => !idsToDelete.has(n.id));
      edges = edges.filter(e => !idsToDelete.has(e.id) && !idsToDelete.has(e.from) && !idsToDelete.has(e.to));
      selectedIds = [];
      selectedId = null;
      saveHistory(); rerender();
      return;
    }
    if (!selectedId) return;
    const nid = selectedId;
    if (nodes.find(n => n.id === nid)) {
      nodes = nodes.filter(n => n.id !== nid);
      edges = edges.filter(e => e.from !== nid && e.to !== nid);
    } else {
      edges = edges.filter(e => e.id !== nid);
    }
    selectedId = null; saveHistory(); rerender();
  }

  function handleInsert() {
    const m = diagramToMermaid(nodes, edges, direction, diagramMode);
    if (!m) return;
    onInsert(m);
    onClose();
  }

  function handleClear() {
    nodes = []; edges = []; selectedId = null; selectedIds = []; edgeDragging = false; edgeDragFrom = null; drawingEdge = false; idCounter = 0; saveHistory(); rerender();
  }

  function toggleEdgeStyle() {
    const idx = edges.findIndex(e => e.id === selectedId);
    if (idx >= 0) { edges[idx] = { ...edges[idx], style: edges[idx].style === 'dotted' ? 'solid' : 'dotted' }; edges = [...edges]; saveHistory(); rerender(); }
  }

  function setColor(c) {
    shapeColor = c;
    if (selectedId) {
      const ni = nodes.findIndex(n => n.id === selectedId);
      if (ni >= 0) { nodes[ni] = { ...nodes[ni], color: c }; nodes = [...nodes]; saveHistory(); rerender(); }
      const ei = edges.findIndex(e => e.id === selectedId);
      if (ei >= 0) { edges[ei] = { ...edges[ei], color: c }; edges = [...edges]; saveHistory(); rerender(); }
    }
    showColorPicker = false;
  }

  let hasSelectedEdge = $derived(selectedId && edges.find(e => e.id === selectedId));
</script>

<svelte:window onkeydown={onKey} />

<div class="dg-overlay">
  <!-- ── Unified toolbar ── -->
  <div class="dg-toolbar">
    <button class="dg-tb" onclick={undo} disabled={!canUndo} title="Undo (Cmd+Z)">
      <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M4 6h6a3 3 0 010 6H8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 4L4 6l2 2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <button class="dg-tb" onclick={redo} disabled={!canRedo} title="Redo (Cmd+Shift+Z)">
      <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M12 6H6a3 3 0 000 6h2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 4l2 2-2 2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <div class="dg-sep"></div>

    {#each [
      { id: 'select', key: '1', svg: '<path d="M3 2l2 12 3-4 4-1z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>' },
      { id: 'rectangle', key: '2', svg: '<rect x="2" y="3.5" width="12" height="9" rx="1" stroke="currentColor" stroke-width="1.2"/>' },
      { id: 'diamond', key: '3', svg: '<path d="M8 2l6 6-6 6-6-6z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>' },
      { id: 'ellipse', key: '4', svg: '<ellipse cx="8" cy="8" rx="6" ry="5" stroke="currentColor" stroke-width="1.2"/>' },
      { id: 'arrow', key: '5', svg: '<path d="M2 14L14 2M14 2H8M14 2v6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>' },
      { id: 'line', key: '6', svg: '<path d="M3 13L13 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>' },
      { id: 'text', key: '7', svg: '<path d="M3 4h10M8 4v9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>' },
    ] as tool}
      <button class="dg-tb" class:on={activeTool === tool.id} onclick={() => activeTool = tool.id} title="{tool.id} ({tool.key})">
        <svg width="18" height="18" viewBox="0 0 16 16" fill="none">{@html tool.svg}</svg>
        <span class="dg-tb-key">{tool.key}</span>
      </button>
    {/each}

    <div class="dg-sep"></div>
    <button class="dg-tb color-btn" onclick={() => showColorPicker = !showColorPicker} title="Stroke color">
      <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="8" r="5.5" stroke="currentColor" stroke-width="1.2"/>
        <circle cx="8" cy="8" r="3" fill={shapeColor}/>
      </svg>
    </button>
    <button class="dg-tb del" onclick={doDelete} disabled={!selectedId} title="Delete (Del)">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4.5 3V2.5a1 1 0 011-1h5a1 1 0 011 1V3M2.5 3h11M3.5 3v9.5a1 1 0 001 1h7a1 1 0 001-1V3" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.5 6v4M9.5 6v4" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>
    </button>
    {#if hasSelectedEdge}
      <button class="dg-tb" onclick={toggleEdgeStyle} title="Toggle dotted/solid">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 8h3M7 8h2M11 8h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
    {/if}
    <div class="dg-sep"></div>
    <!-- Mode & direction toggles inline -->
    <button class="dg-tb dg-mode-tb" class:on={diagramMode === 'knowledge'} onclick={toggleKnowledgeMode} title="Knowledge graph mode (K)">
      <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><circle cx="5" cy="5" r="2.5" stroke="currentColor" stroke-width="1.1"/><circle cx="11" cy="5" r="2.5" stroke="currentColor" stroke-width="1.1"/><circle cx="8" cy="12" r="2.5" stroke="currentColor" stroke-width="1.1"/><path d="M6.8 6.5L7.3 10M9.2 6.5L8.7 10" stroke="currentColor" stroke-width="0.9"/></svg>
    </button>
    <button class="dg-tb" onclick={() => { direction = direction === 'TD' ? 'LR' : 'TD'; rerender(); }} title="Direction: {direction}">
      {#if direction === 'TD'}
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2v10M5 9l3 3 3-3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
      {:else}
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 8h10M9 5l3 3-3 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
      {/if}
    </button>
  </div>

  <!-- Hint -->
  <div class="dg-hint-bar">
    <kbd>Esc</kbd> close · <kbd>⌘↵</kbd> insert · <kbd>K</kbd> knowledge graph
  </div>

  <!-- Color picker -->
  {#if showColorPicker}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="dg-color-backdrop" onclick={() => showColorPicker = false}></div>
    <div class="dg-color-picker">
      {#each SHAPE_COLORS as c}
        <button class="dg-color-swatch" class:active={shapeColor === c} style="background:{c}" onclick={() => setColor(c)} title={c}></button>
      {/each}
    </div>
  {/if}

  {#if edgeDragging || drawingEdge}
    <div class="dg-drag-hint">
      {edgeDragging ? 'Release on a shape to connect' : 'Drag to draw — release to place'}
    </div>
  {/if}

  <!-- Knowledge graph legend -->
  {#if diagramMode === 'knowledge'}
    <div class="dg-legend">
      <span style="color: #6366f1;">● Concept (ellipse)</span>
      <span style="color: #22c55e;">● Entity (rect)</span>
      <span style="color: #f59e0b;">● Attribute (diamond)</span>
    </div>
  {/if}

  <!-- ── Canvas ── -->
  <div class="dg-canvas-wrap">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <svg class="dg-svg" bind:this={svgEl} onmousedown={onMouseDown} onmousemove={onMouseMove} onmouseup={onMouseUp} ondblclick={onDblClick} role="img">
      <g id="rough-layer"></g>
    </svg>

    <!-- Knowledge graph "+" overlay buttons — only on hovered or selected node -->
    {#if diagramMode === 'knowledge' && !editingId && !dragging && !resizing && !edgeDragging && !drawingEdge}
      {#each nodes as node}
        {#if node.id === hoveredId || node.id === selectedId}
          <button
            class="kg-add-btn"
            style="left:{node.x + node.w + 8}px;top:{node.y + node.h / 2 - 10}px"
            onclick={(e) => { e.stopPropagation(); addChildNode(node.id); }}
            title="Add child node"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          </button>
        {/if}
      {/each}
    {/if}

    <!-- Inline label editor for KG mode (inside canvas-wrap, no border) -->
    {#if editingId && diagramMode === 'knowledge'}
      <input class="dg-label-inline" type="text" bind:value={editValue} bind:this={editInputEl}
        style="left:{editPos.x}px;top:{editPos.y}px;width:{editNodeW}px"
        onkeydown={onEditKey} onblur={commitLabel} placeholder="Type..." />
    {/if}
  </div>

  <!-- Label editor (outside canvas-wrap for flowchart, inside for KG) -->
  {#if editingId && diagramMode !== 'knowledge'}
    <input class="dg-label-input" type="text" bind:value={editValue} bind:this={editInputEl}
      style="left:{editPos.x}px;top:{editPos.y}px;width:{editNodeW}px" onkeydown={onEditKey} onblur={commitLabel} placeholder="Type label..." />
  {/if}

  <!-- ── Bottom bar ── -->
  <div class="dg-bottom">
    <div class="dg-bottom-left">
      <span class="dg-count">{nodes.length} shapes · {edges.length} edges</span>
      {#if nodes.length > 0 || edges.length > 0}
        <button class="dg-clear" onclick={handleClear}>Clear all</button>
      {/if}
    </div>
    <div class="dg-bottom-right">
      {#if diagramMode === 'knowledge'}
        <span class="dg-mode-badge">Knowledge Graph</span>
      {/if}
      <span class="dg-dir-badge">{direction === 'TD' ? '↓ Top-Down' : '→ Left-Right'}</span>
      <button class="dg-cancel" onclick={onClose}>Cancel</button>
      <button class="dg-insert" onclick={handleInsert} disabled={nodes.length === 0 && edges.length === 0}>Insert as Mermaid</button>
    </div>
  </div>
</div>

<style>
  .dg-overlay {
    position: fixed; inset: 0; z-index: 1000;
    background: #ffffff;
    display: flex; flex-direction: column; overflow: hidden;
    user-select: none; -webkit-user-select: none;
  }
  :global([data-theme="dark"]) .dg-overlay {
    background: #121215;
  }

  /* ── Toolbar ── */
  .dg-toolbar {
    position: absolute; top: 12px; left: 50%; transform: translateX(-50%);
    z-index: 1002; display: flex; align-items: center; gap: 2px;
    padding: 4px 8px; background: #ffffff;
    border: 1px solid rgba(0,0,0,0.08); border-radius: 12px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.08);
  }
  :global([data-theme="dark"]) .dg-toolbar {
    background: #1e1e24; border-color: rgba(255,255,255,0.08);
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
  }

  .dg-tb {
    position: relative; display: flex; align-items: center; justify-content: center;
    width: 36px; height: 36px; border: none; background: none;
    color: #6b6b76; cursor: pointer; border-radius: 8px; transition: all 0.12s;
  }
  :global([data-theme="dark"]) .dg-tb { color: #8b8b95; }
  .dg-tb:hover { background: rgba(0,0,0,0.04); color: #1b1b1f; }
  :global([data-theme="dark"]) .dg-tb:hover { background: rgba(255,255,255,0.06); color: #e4e4e7; }
  .dg-tb.on { background: rgba(99,102,241,0.12); color: #6366f1; }
  :global([data-theme="dark"]) .dg-tb.on { background: rgba(129,140,248,0.15); color: #818cf8; }
  .dg-tb.del:hover { color: #ef4444; background: rgba(239,68,68,0.08); }
  .dg-tb:disabled { opacity: 0.25; cursor: not-allowed; }
  .dg-tb:disabled:hover { background: none; }

  .dg-tb-key {
    position: absolute; bottom: 1px; right: 3px;
    font-size: 8px; font-weight: 600; opacity: 0.4;
    font-family: 'SF Mono', monospace; pointer-events: none;
  }

  .dg-sep { width: 1px; height: 24px; background: rgba(0,0,0,0.06); margin: 0 4px; }
  :global([data-theme="dark"]) .dg-sep { background: rgba(255,255,255,0.06); }

  /* ── Hint bar ── */
  .dg-hint-bar {
    position: absolute; top: 60px; left: 50%; transform: translateX(-50%);
    z-index: 1001; font-size: 12px; color: #a1a1aa; pointer-events: none;
  }
  .dg-hint-bar kbd {
    display: inline-block; padding: 1px 6px;
    background: #f8f9fa; border: 1px solid rgba(0,0,0,0.08);
    border-radius: 4px; font-size: 11px; font-family: 'SF Mono', monospace; color: #6b6b76;
  }
  :global([data-theme="dark"]) .dg-hint-bar kbd {
    background: #1a1a1f; border-color: rgba(255,255,255,0.08); color: #8b8b95;
  }

  /* ── Color picker ── */
  .dg-color-backdrop { position: fixed; inset: 0; z-index: 1003; }
  .dg-color-picker {
    position: absolute; top: 58px; left: 50%; transform: translateX(-50%);
    z-index: 1004; display: flex; gap: 5px; padding: 8px 10px;
    background: #ffffff; border: 1px solid rgba(0,0,0,0.08);
    border-radius: 10px; box-shadow: 0 4px 16px rgba(0,0,0,0.12);
  }
  :global([data-theme="dark"]) .dg-color-picker {
    background: #1e1e24; border-color: rgba(255,255,255,0.08);
  }
  .dg-color-swatch {
    width: 22px; height: 22px; border-radius: 50%; border: 2px solid transparent;
    cursor: pointer; transition: all 0.1s;
  }
  .dg-color-swatch:hover { transform: scale(1.15); }
  .dg-color-swatch.active { border-color: #1b1b1f; box-shadow: 0 0 0 2px #fff, 0 0 0 4px #1b1b1f; }
  :global([data-theme="dark"]) .dg-color-swatch.active { border-color: #e4e4e7; box-shadow: 0 0 0 2px #121215, 0 0 0 4px #e4e4e7; }

  /* ── Drag hint ── */
  .dg-drag-hint {
    position: absolute; top: 60px; left: 50%; transform: translateX(-50%);
    z-index: 1002; padding: 5px 14px; background: #6366f1; color: #fff;
    font-size: 11px; font-weight: 500; border-radius: 16px;
    box-shadow: 0 2px 8px rgba(99,102,241,0.3); pointer-events: none;
  }

  /* ── Legend ── */
  .dg-legend {
    position: absolute; bottom: 52px; left: 12px; z-index: 1002;
    display: flex; gap: 12px; padding: 5px 12px;
    background: #ffffff; border: 1px solid rgba(0,0,0,0.06);
    border-radius: 16px; box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    font-size: 10px; font-weight: 600;
  }
  :global([data-theme="dark"]) .dg-legend {
    background: #1e1e24; border-color: rgba(255,255,255,0.06);
  }

  /* ── Canvas ── */
  .dg-canvas-wrap {
    flex: 1;
    position: relative;
    overflow: hidden;
  }
  .dg-svg {
    width: 100%; height: 100%;
    background-image: radial-gradient(circle, rgba(0,0,0,0.06) 1px, transparent 1px);
    background-size: 20px 20px;
    user-select: none; cursor: default;
  }
  :global([data-theme="dark"]) .dg-svg {
    background-image: radial-gradient(circle, rgba(255,255,255,0.06) 1px, transparent 1px);
  }

  /* ── Label input ── */
  .dg-label-input {
    position: fixed; z-index: 1003;
    padding: 4px 8px; border: 1px solid transparent;
    background: #ffffff; color: #1b1b1f;
    font-size: 14px; font-family: Inter, sans-serif;
    border-radius: 4px; outline: none;
    text-align: center;
    transform: translate(-50%, -50%);
    box-shadow: 0 1px 4px rgba(0,0,0,0.06);
  }
  :global([data-theme="dark"]) .dg-label-input {
    background: #1e1e24; color: #e4e4e7; border-color: transparent;
  }
  .dg-label-input::placeholder { color: #a1a1aa; }

  /* Inline label editor for KG mode (transparent, inside shape) */
  .dg-label-inline {
    position: absolute;
    z-index: 1003;
    padding: 2px 4px;
    border: none;
    background: transparent;
    color: inherit;
    font-size: 12px;
    font-family: 'Virgil', 'Segoe UI Emoji', Inter, sans-serif;
    outline: none;
    text-align: center;
    transform: translate(-50%, -50%);
    caret-color: var(--accent, #6366f1);
    color: #1b1b1f;
  }
  :global([data-theme="dark"]) .dg-label-inline {
    color: #e4e4e7;
  }
  .dg-label-inline::placeholder { color: #a1a1aa; opacity: 0.5; }

  /* ── Bottom bar ── */
  .dg-bottom {
    display: flex; align-items: center; justify-content: space-between;
    height: 44px; padding: 0 16px;
    border-top: 1px solid rgba(0,0,0,0.06);
    background: #ffffff; flex-shrink: 0; font-size: 12px;
  }
  :global([data-theme="dark"]) .dg-bottom {
    background: #1e1e24; border-color: rgba(255,255,255,0.06);
  }
  .dg-bottom-left { display: flex; align-items: center; gap: 10px; }
  .dg-bottom-right { display: flex; align-items: center; gap: 8px; }
  .dg-count { color: #a1a1aa; font-size: 11px; }
  .dg-clear { border: none; background: none; color: #a1a1aa; font-size: 11px; cursor: pointer; padding: 2px 6px; border-radius: 4px; }
  .dg-clear:hover { color: #ef4444; }

  .dg-mode-badge {
    padding: 3px 8px; background: rgba(99,102,241,0.12); color: #6366f1;
    font-size: 10px; font-weight: 700; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.5px;
  }
  :global([data-theme="dark"]) .dg-mode-badge { background: rgba(129,140,248,0.15); color: #818cf8; }
  .dg-dir-badge {
    padding: 3px 8px; background: rgba(0,0,0,0.04); color: #a1a1aa;
    font-size: 10px; font-weight: 600; border-radius: 4px;
  }
  :global([data-theme="dark"]) .dg-dir-badge { background: rgba(255,255,255,0.04); }
  .dg-mode-tb.on { background: rgba(99,102,241,0.12); color: #6366f1; }
  :global([data-theme="dark"]) .dg-mode-tb.on { background: rgba(129,140,248,0.15); color: #818cf8; }

  .dg-cancel {
    padding: 5px 12px; border: 1px solid rgba(0,0,0,0.08); background: #f8f9fa;
    color: #6b6b76; border-radius: 8px; font-size: 12px; font-weight: 500; cursor: pointer;
  }
  :global([data-theme="dark"]) .dg-cancel { background: #1a1a1f; border-color: rgba(255,255,255,0.08); color: #8b8b95; }
  .dg-cancel:hover { color: #1b1b1f; }

  .dg-insert {
    padding: 5px 14px; background: #6366f1; color: #fff; border: none;
    border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer;
    box-shadow: 0 2px 8px rgba(99,102,241,0.25);
  }
  .dg-insert:hover { opacity: 0.9; }
  .dg-insert:disabled { opacity: 0.4; cursor: not-allowed; }

  /* ── Knowledge graph "+" buttons ── */
  .kg-add-btn {
    position: absolute;
    z-index: 1001;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border: 1.5px solid rgba(99, 102, 241, 0.4);
    background: #ffffff;
    color: #6366f1;
    border-radius: 50%;
    cursor: pointer;
    transition: all 0.15s;
    opacity: 0.6;
    box-shadow: 0 1px 4px rgba(0,0,0,0.08);
  }
  .kg-add-btn:hover {
    opacity: 1;
    transform: scale(1.2);
    background: #6366f1;
    color: #fff;
    border-color: #6366f1;
    box-shadow: 0 2px 8px rgba(99, 102, 241, 0.3);
  }
  :global([data-theme="dark"]) .kg-add-btn {
    background: #1e1e24;
    color: #818cf8;
    border-color: rgba(129, 140, 248, 0.4);
  }
  :global([data-theme="dark"]) .kg-add-btn:hover {
    background: #818cf8;
    color: #fff;
    border-color: #818cf8;
  }
</style>
