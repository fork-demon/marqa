import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const tableControlsKey = new PluginKey('tableControls');

/**
 * TipTap extension: adds +/- controls around tables on hover.
 * Uses widget decorations keyed by table structure (rows x cols)
 * so handles refresh automatically when table changes.
 */
export const TableControls = Extension.create({
  name: 'tableControls',

  addProseMirrorPlugins() {
    const thisEditor = this.editor;

    return [
      new Plugin({
        key: tableControlsKey,
        state: {
          init(_, state) {
            return buildTableDecorations(state.doc, thisEditor);
          },
          apply(tr, oldSet, _oldState, newState) {
            if (tr.docChanged) {
              return buildTableDecorations(newState.doc, thisEditor);
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

function buildTableDecorations(doc, editor) {
  const decorations = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== 'table') return;

    const tableEnd = pos + node.nodeSize;

    // Parse table structure
    const rows = [];
    let colCount = 0;
    node.forEach((row, rowOffset) => {
      const cellPositions = [];
      row.forEach((cell, cellOffset) => {
        cellPositions.push(pos + 1 + rowOffset + 1 + cellOffset + 1);
      });
      if (cellPositions.length > colCount) colCount = cellPositions.length;
      rows.push({ pos: pos + 1 + rowOffset, cellPositions });
    });

    const rowCount = rows.length;

    // Key includes structure so widget is recreated when rows/cols change
    const widget = Decoration.widget(tableEnd, () => {
      const wrap = document.createElement('div');
      wrap.className = 'table-ctrl-wrap';
      wrap.contentEditable = 'false';

      // Find the table DOM element
      let tableEl = null;
      try {
        const domPos = editor.view.domAtPos(pos + 1);
        tableEl = domPos?.node?.parentElement?.closest?.('table') || domPos?.node?.closest?.('table');
      } catch {}

      if (!tableEl) return wrap;

      const wrapperEl = tableEl.closest('.tableWrapper');

      // Inject handles into .tableWrapper so they are inside the hover context
      queueMicrotask(() => {
        if (!wrapperEl) return;
        // Remove any previously injected handles
        wrapperEl.querySelectorAll('.tc-handle').forEach(el => el.remove());

        const tableRect = tableEl.getBoundingClientRect();
        const wrapRect = wrapperEl.getBoundingClientRect();
        const offX = tableRect.left - wrapRect.left;
        const offY = tableRect.top - wrapRect.top;

        // ── Column controls (at top) ──
        const firstRow = tableEl.rows[0];
        if (firstRow) {
          for (let c = 0; c < colCount; c++) {
            const cell = firstRow.cells[c];
            if (!cell) continue;
            const cr = cell.getBoundingClientRect();

            // "+" between columns
            if (c < colCount - 1) {
              const btn = makeHandle('+', 'tc-add', `Insert column after ${c + 1}`);
              btn.style.left = `${offX + cr.right - tableRect.left - 8}px`;
              btn.style.top = `${offY - 20}px`;
              btn.addEventListener('mousedown', (ev) => {
                ev.preventDefault(); ev.stopPropagation();
                const cp = rows[0]?.cellPositions[c];
                if (cp !== undefined) editor.chain().focus().setTextSelection(cp).addColumnAfter().run();
              });
              wrapperEl.appendChild(btn);
            }

            // "−" delete column
            const delBtn = makeHandle('−', 'tc-del', (colCount <= 1 && rowCount <= 1) ? 'Delete table' : `Delete col ${c + 1}`);
            delBtn.style.left = `${offX + (cr.left - tableRect.left) + cr.width / 2 - 8}px`;
            delBtn.style.top = `${offY - 20}px`;
            const colIdx = c;
            delBtn.addEventListener('mousedown', (ev) => {
              ev.preventDefault(); ev.stopPropagation();
              if (colCount <= 1) {
                editor.chain().focus().setTextSelection(pos + 1).deleteTable().run();
              } else {
                const cp = rows[0]?.cellPositions[colIdx];
                if (cp !== undefined) editor.chain().focus().setTextSelection(cp).deleteColumn().run();
              }
            });
            delBtn.addEventListener('mouseenter', () => {
              for (const tr of tableEl.rows) {
                if (tr.cells[colIdx]) tr.cells[colIdx].classList.add('col-highlight');
              }
            });
            delBtn.addEventListener('mouseleave', () => {
              for (const tr of tableEl.rows) {
                if (tr.cells[colIdx]) tr.cells[colIdx].classList.remove('col-highlight');
              }
            });
            wrapperEl.appendChild(delBtn);
          }

          // "+" append column at right edge
          const lastCell = firstRow.cells[colCount - 1];
          if (lastCell) {
            const lr = lastCell.getBoundingClientRect();
            const btn = makeHandle('+', 'tc-add', 'Add column');
            btn.style.left = `${offX + lr.right - tableRect.left + 4}px`;
            btn.style.top = `${offY - 20}px`;
            btn.addEventListener('mousedown', (ev) => {
              ev.preventDefault(); ev.stopPropagation();
              const cp = rows[rows.length - 1]?.cellPositions[colCount - 1];
              if (cp !== undefined) editor.chain().focus().setTextSelection(cp).addColumnAfter().run();
            });
            wrapperEl.appendChild(btn);
          }
        }

        // ── Row controls (on the left) ──
        for (let r = 0; r < rowCount; r++) {
          const rowEl = tableEl.rows[r];
          if (!rowEl) continue;
          const rr = rowEl.getBoundingClientRect();

          // "−" delete row
          const delBtn = makeHandle('−', 'tc-del', (rowCount <= 1 && colCount <= 1) ? 'Delete table' : `Delete row ${r + 1}`);
          delBtn.style.left = `${offX - 24}px`;
          delBtn.style.top = `${offY + rr.top - tableRect.top + rr.height / 2 - 8}px`;
          const rowIdx = r;
          delBtn.addEventListener('mousedown', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            if (rowCount <= 1) {
              editor.chain().focus().setTextSelection(pos + 1).deleteTable().run();
            } else {
              const cp = rows[rowIdx]?.cellPositions[0];
              if (cp !== undefined) editor.chain().focus().setTextSelection(cp).deleteRow().run();
            }
          });
          delBtn.addEventListener('mouseenter', () => {
            if (tableEl.rows[rowIdx]) tableEl.rows[rowIdx].classList.add('row-highlight');
          });
          delBtn.addEventListener('mouseleave', () => {
            if (tableEl.rows[rowIdx]) tableEl.rows[rowIdx].classList.remove('row-highlight');
          });
          wrapperEl.appendChild(delBtn);

          // "+" between rows
          if (r < rowCount - 1) {
            const btn = makeHandle('+', 'tc-add', 'Insert row');
            btn.style.left = `${offX - 24}px`;
            btn.style.top = `${offY + rr.bottom - tableRect.top - 8}px`;
            btn.addEventListener('mousedown', (ev) => {
              ev.preventDefault(); ev.stopPropagation();
              const cp = rows[rowIdx]?.cellPositions[0];
              if (cp !== undefined) editor.chain().focus().setTextSelection(cp).addRowAfter().run();
            });
            wrapperEl.appendChild(btn);
          }
        }

        // "+" append row at bottom
        const lastRow = tableEl.rows[rowCount - 1];
        if (lastRow) {
          const lr = lastRow.getBoundingClientRect();
          const btn = makeHandle('+', 'tc-add', 'Add row');
          btn.style.left = `${offX - 24}px`;
          btn.style.top = `${offY + lr.bottom - tableRect.top + 4}px`;
          btn.addEventListener('mousedown', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            const cp = rows[rowCount - 1]?.cellPositions[0];
            if (cp !== undefined) editor.chain().focus().setTextSelection(cp).addRowAfter().run();
          });
          wrapperEl.appendChild(btn);
        }
      });

      return wrap;
    }, { side: 1, key: `table-ctrl-${pos}-${rowCount}x${colCount}` });

    decorations.push(widget);
  });

  return DecorationSet.create(doc, decorations);
}

function makeHandle(text, cls, title) {
  const btn = document.createElement('button');
  btn.className = `tc-handle ${cls}`;
  btn.textContent = text;
  btn.title = title;
  btn.contentEditable = 'false';
  return btn;
}
