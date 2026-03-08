/**
 * Render diagram data as a static SVG string.
 * Uses the exact node/edge positions from the data model (preserving canvas layout).
 *
 * @param {{ nodes: Array, edges: Array, direction: string, mode: string }} data
 * @returns {string} SVG markup
 */
export function renderDiagramSvg(data) {
  const { nodes, edges, mode } = data;
  if (!nodes.length && !edges.length) return '';

  const isKG = mode === 'knowledge';
  const accent = '#6366f1';
  const accentFill = 'rgba(99,102,241,0.06)';
  const stroke = '#4b4b55';
  const textColor = '#1b1b1f';

  const KG = {
    rectangle: { stroke: '#22c55e', fill: 'rgba(34,197,94,0.08)' },
    ellipse: { stroke: '#6366f1', fill: 'rgba(99,102,241,0.08)' },
    diamond: { stroke: '#f59e0b', fill: 'rgba(245,158,11,0.08)' },
  };

  // Compute bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w);
    maxY = Math.max(maxY, n.y + n.h);
  }
  for (const e of edges) {
    if (e.standalone) {
      minX = Math.min(minX, e.x1, e.x2);
      minY = Math.min(minY, e.y1, e.y2);
      maxX = Math.max(maxX, e.x1, e.x2);
      maxY = Math.max(maxY, e.y1, e.y2);
    }
  }

  const pad = 40;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const w = maxX - minX;
  const h = maxY - minY;

  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${w} ${h}" width="100%" style="max-height:400px">`);

  // Helper: connection point on node edge facing target
  function connPt(n, tx, ty) {
    const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
    const dx = tx - cx, dy = ty - cy;
    if (dx === 0 && dy === 0) return { x: cx, y: cy };
    const hw = n.w / 2, hh = n.h / 2;
    const sx = hw / (Math.abs(dx) || 1), sy = hh / (Math.abs(dy) || 1);
    const s = Math.min(sx, sy);
    return { x: cx + dx * s, y: cy + dy * s };
  }

  // Build defs with per-edge color markers
  const extraMarkers = [];
  const markerMap = new Map();
  let markerIdx = 0;

  function getMarkerId(color) {
    if (color === stroke) return 'dg-arrow';
    if (color === accent) return 'dg-arrow-kg';
    if (markerMap.has(color)) return markerMap.get(color);
    const id = `dg-arrow-${markerIdx++}`;
    markerMap.set(color, id);
    extraMarkers.push(`<marker id="${id}" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="${color}"/></marker>`);
    return id;
  }

  // Pre-scan edges to collect custom markers
  const edgeRenderData = edges.map(edge => {
    const edgeColor = (edge.color && edge.color !== '#1b1b1f') ? edge.color : (isKG ? accent : stroke);
    const isArrow = edge.edgeType !== 'line';
    const markerId = isArrow ? getMarkerId(edgeColor) : null;
    return { edge, edgeColor, markerId };
  });

  // Now write defs
  parts.push(`<defs>`);
  parts.push(`<marker id="dg-arrow" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="${stroke}"/></marker>`);
  parts.push(`<marker id="dg-arrow-kg" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto"><polygon points="0 0, 10 3.5, 0 7" fill="${accent}"/></marker>`);
  for (const m of extraMarkers) parts.push(m);
  parts.push(`</defs>`);

  // Draw edges
  for (const { edge, edgeColor, markerId } of edgeRenderData) {
    const isDot = edge.style === 'dotted';
    const isArrow = edge.edgeType !== 'line';

    if (edge.standalone) {
      parts.push(`<line x1="${edge.x1}" y1="${edge.y1}" x2="${edge.x2}" y2="${edge.y2}" stroke="${edgeColor}" stroke-width="1.5"${isDot ? ' stroke-dasharray="6,4"' : ''}${isArrow ? ` marker-end="url(#${markerId})"` : ''}/>`);
      if (edge.label) {
        const mx = (edge.x1 + edge.x2) / 2, my = (edge.y1 + edge.y2) / 2 - 6;
        parts.push(`<text x="${mx}" y="${my}" text-anchor="middle" font-size="11" font-family="Inter, sans-serif" fill="${textColor}">${esc(edge.label)}</text>`);
      }
      continue;
    }

    const fn = nodes.find(n => n.id === edge.from);
    const tn = nodes.find(n => n.id === edge.to);
    if (!fn || !tn) continue;

    const p1 = connPt(fn, tn.x + tn.w / 2, tn.y + tn.h / 2);
    const p2 = connPt(tn, fn.x + fn.w / 2, fn.y + fn.h / 2);

    // Curved bezier
    const mx = (p1.x + p2.x) / 2, my = (p1.y + p2.y) / 2;
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const curv = len * 0.2;
    const nx = -dy / len, ny = dx / len;
    const cpx = mx + nx * curv, cpy = my + ny * curv;

    parts.push(`<path d="M${p1.x},${p1.y} Q${cpx},${cpy} ${p2.x},${p2.y}" fill="none" stroke="${edgeColor}" stroke-width="1.5"${isDot ? ' stroke-dasharray="6,4"' : ''}${isArrow ? ` marker-end="url(#${markerId})"` : ''}/>`);

    if (edge.label) {
      const lx = cpx, ly = cpy - 6;
      parts.push(`<text x="${lx}" y="${ly}" text-anchor="middle" font-size="11" font-family="Inter, sans-serif" fill="${textColor}">${esc(edge.label)}</text>`);
    }
  }

  // Draw nodes
  for (const node of nodes) {
    const kc = isKG ? (KG[node.type] || KG.rectangle) : null;
    const ns = kc ? kc.stroke : stroke;
    const nf = kc ? kc.fill : accentFill;
    const cx = node.x + node.w / 2, cy = node.y + node.h / 2;

    if (node.type === 'rectangle') {
      parts.push(`<rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="4" fill="${nf}" stroke="${ns}" stroke-width="1.5"/>`);
    } else if (node.type === 'diamond') {
      const hw = node.w / 2, hh = node.h / 2;
      parts.push(`<polygon points="${cx},${cy - hh} ${cx + hw},${cy} ${cx},${cy + hh} ${cx - hw},${cy}" fill="${nf}" stroke="${ns}" stroke-width="1.5"/>`);
    } else if (node.type === 'ellipse') {
      parts.push(`<ellipse cx="${cx}" cy="${cy}" rx="${node.w / 2}" ry="${node.h / 2}" fill="${nf}" stroke="${ns}" stroke-width="1.5"/>`);
    } else if (node.type === 'text') {
      // No border, just text
    } else if (node.type === 'table') {
      parts.push(`<rect x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" rx="2" fill="${nf}" stroke="${ns}" stroke-width="1.5"/>`);
    }

    if (node.label) {
      const fs = isKG ? 12 : Math.min(14, Math.max(10, node.w / 10));
      const lc = kc ? kc.stroke : textColor;
      parts.push(`<text x="${cx}" y="${cy + fs * 0.35}" text-anchor="middle" font-size="${fs}" font-weight="500" font-family="Inter, sans-serif" fill="${lc}">${esc(node.label)}</text>`);
    }
  }

  parts.push('</svg>');
  return parts.join('\n');
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
