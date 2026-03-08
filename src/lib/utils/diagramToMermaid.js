/**
 * Serialize node/edge metadata as Mermaid comments for round-trip fidelity.
 * Mermaid ignores %% comments, so rendering is unaffected.
 */
function serializeMetadata(nodes, edges) {
  const lines = [];
  for (const node of nodes) {
    const parts = [`type=${node.type}`];
    if (node.x !== undefined) parts.push(`x=${Math.round(node.x)}`);
    if (node.y !== undefined) parts.push(`y=${Math.round(node.y)}`);
    if (node.w !== undefined) parts.push(`w=${Math.round(node.w)}`);
    if (node.h !== undefined) parts.push(`h=${Math.round(node.h)}`);
    if (node.color && node.color !== '#1b1b1f') parts.push(`color=${node.color}`);
    lines.push(`%% meta:${node.id}:${parts.join(',')}`);
  }
  for (const edge of edges) {
    const parts = [];
    if (edge.standalone) {
      parts.push('standalone=true');
      parts.push(`x1=${Math.round(edge.x1)}`);
      parts.push(`y1=${Math.round(edge.y1)}`);
      parts.push(`x2=${Math.round(edge.x2)}`);
      parts.push(`y2=${Math.round(edge.y2)}`);
    } else {
      if (edge.from) parts.push(`from=${edge.from}`);
      if (edge.to) parts.push(`to=${edge.to}`);
    }
    if (edge.color && edge.color !== '#1b1b1f') parts.push(`color=${edge.color}`);
    if (edge.edgeType) parts.push(`edgeType=${edge.edgeType}`);
    if (edge.style) parts.push(`style=${edge.style}`);
    if (edge.label) parts.push(`label=${edge.label.replace(/,/g, '&#44;')}`);
    lines.push(`%% meta:${edge.id}:${parts.join(',')}`);
  }
  return lines;
}

/**
 * Convert diagram data model to Mermaid flowchart syntax.
 * @param {Array<{id: string, type: string, label: string}>} nodes
 * @param {Array<{from: string, to: string, label?: string, style?: string, standalone?: boolean, edgeType?: string}>} edges
 * @param {'TD'|'LR'} direction - Graph direction
 * @param {'flowchart'|'knowledge'} mode - Diagram mode
 * @returns {string} Mermaid code (without fences)
 */
export function diagramToMermaid(nodes, edges, direction = 'TD', mode = 'flowchart') {
  if (nodes.length === 0 && edges.length === 0) return '';

  if (mode === 'knowledge') return knowledgeGraphToMermaid(nodes, edges);

  const lines = [`graph ${direction}`];

  for (const node of nodes) {
    const label = (node.label || node.id).replace(/"/g, '#quot;');
    switch (node.type) {
      case 'diamond':
        lines.push(`    ${node.id}{"${label}"}`);
        break;
      case 'ellipse':
        lines.push(`    ${node.id}(("${label}"))`);
        break;
      case 'table':
        lines.push(`    ${node.id}["${label} (table)"]`);
        break;
      case 'rectangle':
      case 'text':
      default:
        lines.push(`    ${node.id}["${label}"]`);
        break;
    }
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const edge of edges) {
    if (edge.standalone) continue;
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue;

    const isLine = edge.edgeType === 'line';
    const isDotted = edge.style === 'dotted';

    let arrowStyle;
    if (isLine && isDotted) arrowStyle = '-.-';
    else if (isLine) arrowStyle = '---';
    else if (isDotted) arrowStyle = '-.->';
    else arrowStyle = '-->';

    if (edge.label) {
      const safeLabel = edge.label.replace(/"/g, '#quot;');
      lines.push(`    ${edge.from} ${arrowStyle}|"${safeLabel}"| ${edge.to}`);
    } else {
      lines.push(`    ${edge.from} ${arrowStyle} ${edge.to}`);
    }
  }

  // Append metadata for round-trip fidelity
  const metaLines = serializeMetadata(nodes, edges);
  if (metaLines.length > 0) {
    lines.push('');
    lines.push(...metaLines);
  }

  return lines.join('\n');
}

function knowledgeGraphToMermaid(nodes, edges) {
  const lines = ['graph LR'];

  lines.push('    classDef concept fill:#e0e7ff,stroke:#6366f1,stroke-width:2px,color:#312e81');
  lines.push('    classDef entity fill:#dcfce7,stroke:#22c55e,stroke-width:2px,color:#166534');
  lines.push('    classDef attribute fill:#fef3c7,stroke:#f59e0b,stroke-width:2px,color:#92400e');

  for (const node of nodes) {
    const label = (node.label || node.id).replace(/"/g, '#quot;');
    switch (node.type) {
      case 'ellipse':
        lines.push(`    ${node.id}(("${label}"))`);
        break;
      case 'diamond':
        lines.push(`    ${node.id}{"${label}"}`);
        break;
      case 'rectangle':
      default:
        lines.push(`    ${node.id}["${label}"]`);
        break;
    }
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const edge of edges) {
    if (edge.standalone) continue;
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue;

    const isLine = edge.edgeType === 'line';
    const isDotted = edge.style === 'dotted';
    let arrowStyle;
    if (isLine && isDotted) arrowStyle = '-.-';
    else if (isLine) arrowStyle = '---';
    else if (isDotted) arrowStyle = '-.->';
    else arrowStyle = '-->';

    if (edge.label) {
      const safeLabel = edge.label.replace(/"/g, '#quot;');
      lines.push(`    ${edge.from} ${arrowStyle}|"${safeLabel}"| ${edge.to}`);
    } else {
      lines.push(`    ${edge.from} ${arrowStyle} ${edge.to}`);
    }
  }

  const concepts = nodes.filter(n => n.type === 'ellipse').map(n => n.id);
  const entities = nodes.filter(n => n.type === 'rectangle').map(n => n.id);
  const attrs = nodes.filter(n => n.type === 'diamond').map(n => n.id);

  if (concepts.length) lines.push(`    class ${concepts.join(',')} concept`);
  if (entities.length) lines.push(`    class ${entities.join(',')} entity`);
  if (attrs.length) lines.push(`    class ${attrs.join(',')} attribute`);

  // Append metadata for round-trip fidelity
  const metaLines = serializeMetadata(nodes, edges);
  if (metaLines.length > 0) {
    lines.push('');
    lines.push(...metaLines);
  }

  return lines.join('\n');
}
