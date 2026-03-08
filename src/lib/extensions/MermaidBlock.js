import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import mermaid from 'mermaid';
import { mermaidToDiagram } from '$lib/utils/mermaidToDiagram.js';
import { renderDiagramSvg } from '$lib/utils/renderDiagramSvg.js';

let mermaidInitialized = false;
let mermaidCounter = 0;

function ensureMermaidInit() {
  if (mermaidInitialized) return;
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  mermaid.initialize({
    startOnLoad: false,
    theme: isDark ? 'dark' : 'default',
    securityLevel: 'loose',
    flowchart: { useMaxWidth: true, htmlLabels: true, curve: 'basis' },
  });
  mermaidInitialized = true;
}

export function updateMermaidTheme(isDark) {
  mermaid.initialize({
    startOnLoad: false,
    theme: isDark ? 'dark' : 'default',
    securityLevel: 'loose',
    flowchart: { useMaxWidth: true, htmlLabels: true, curve: 'basis' },
  });
  mermaidInitialized = true;
  svgCache.clear();
}

const svgCache = new Map();

/**
 * Try rendering with custom SVG renderer first (preserves positions).
 * Fall back to Mermaid if no metadata or custom render fails.
 */
function renderDiagram(src) {
  if (svgCache.has(src)) return svgCache.get(src);

  // Check if the source has metadata comments for position-preserving rendering
  const hasMetadata = src.includes('%% meta:');
  if (hasMetadata) {
    try {
      const data = mermaidToDiagram(src);
      if (data.nodes.length > 0) {
        const svg = renderDiagramSvg(data);
        if (svg) {
          svgCache.set(src, svg);
          return svg;
        }
      }
    } catch {
      // Fall through to Mermaid
    }
  }

  return null; // null means needs async Mermaid render
}

async function renderMermaidSvg(src) {
  if (svgCache.has(src)) return svgCache.get(src);
  ensureMermaidInit();
  try {
    const id = `mermaid-${++mermaidCounter}`;
    const { svg } = await mermaid.render(id, src);
    svgCache.set(src, svg);
    return svg;
  } catch {
    return null;
  }
}

const mermaidPluginKey = new PluginKey('mermaidPreview');

/**
 * TipTap extension that renders mermaid code blocks as visual diagrams.
 * Uses custom SVG renderer when metadata is present (preserves positions),
 * falls back to Mermaid's auto-layout for plain mermaid code.
 */
export const MermaidPreview = Extension.create({
  name: 'mermaidPreview',

  addOptions() {
    return {
      onEditDiagram: null,
    };
  },

  addProseMirrorPlugins() {
    const thisEditor = this.editor;
    const onEditDiagram = this.options.onEditDiagram;

    return [
      new Plugin({
        key: mermaidPluginKey,
        state: {
          init(_, state) {
            return buildDecorations(state, thisEditor, onEditDiagram);
          },
          apply(tr, oldSet, oldState, newState) {
            if (tr.docChanged || tr.selectionSet || tr.getMeta('mermaidThemeChange')) {
              return buildDecorations(newState, thisEditor, onEditDiagram);
            }
            return oldSet;
          },
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
      }),
    ];
  },
});

function buildDecorations(state, editor, onEditDiagram) {
  const { doc, selection } = state;
  const { from } = selection;
  const decorations = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== 'codeBlock' || node.attrs.language !== 'mermaid') {
      return;
    }

    const nodeEnd = pos + node.nodeSize;
    const cursorInside = from >= pos && from <= nodeEnd;
    const src = node.textContent.trim();

    if (cursorInside || !src) {
      return;
    }

    // Hide the code block
    decorations.push(
      Decoration.node(pos, nodeEnd, {
        class: 'mermaid-code-hidden',
      })
    );

    // Widget showing the rendered diagram
    const widget = Decoration.widget(nodeEnd, () => {
      const el = document.createElement('div');
      el.className = 'mermaid-preview-widget';
      el.contentEditable = 'false';

      // Toolbar with edit/code buttons
      const toolbar = document.createElement('div');
      toolbar.className = 'mermaid-widget-toolbar';

      if (onEditDiagram) {
        const editBtn = document.createElement('button');
        editBtn.className = 'mermaid-widget-btn';
        editBtn.title = 'Edit diagram shapes';
        editBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M11.5 1.5l3 3-9 9H2.5v-3z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg> Edit';
        editBtn.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          onEditDiagram(src, pos);
        });
        toolbar.appendChild(editBtn);
      }

      const codeBtn = document.createElement('button');
      codeBtn.className = 'mermaid-widget-btn';
      codeBtn.title = 'Edit mermaid code';
      codeBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M5 4L1.5 8 5 12M11 4l3.5 4L11 12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg> Code';
      codeBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        editor.chain().setTextSelection(pos + 1).focus().run();
      });
      toolbar.appendChild(codeBtn);

      // SVG container
      const svgContainer = document.createElement('div');
      svgContainer.className = 'mermaid-svg-container';

      // Try custom renderer first (sync), fall back to Mermaid (async)
      const customSvg = renderDiagram(src);
      if (customSvg) {
        svgContainer.innerHTML = customSvg;
      } else if (svgCache.has(src)) {
        svgContainer.innerHTML = svgCache.get(src);
      } else {
        svgContainer.innerHTML = '<div class="mermaid-loading">Rendering diagram...</div>';
        renderMermaidSvg(src).then(svg => {
          if (svg) {
            svgContainer.innerHTML = svg;
          } else {
            svgContainer.innerHTML = '<div class="mermaid-error">Diagram syntax error</div>';
          }
        });
      }

      el.appendChild(toolbar);
      el.appendChild(svgContainer);
      return el;
    }, {
      side: 1,
      key: `mermaid-${pos}`,
    });

    decorations.push(widget);
  });

  return DecorationSet.create(doc, decorations);
}
