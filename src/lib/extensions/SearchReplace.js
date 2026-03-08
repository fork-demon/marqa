import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const searchReplaceKey = new PluginKey('searchReplace');

/**
 * Custom search & replace extension for TipTap 3.
 * Creates inline decorations for all matches.
 */
export const SearchReplace = Extension.create({
  name: 'searchReplace',

  addStorage() {
    return {
      searchTerm: '',
      replaceTerm: '',
      caseSensitive: false,
      results: [],       // [{ from, to }]
      activeIndex: -1,
    };
  },

  addCommands() {
    return {
      setSearchTerm: (term) => ({ editor }) => {
        editor.storage.searchReplace.searchTerm = term;
        editor.storage.searchReplace.activeIndex = -1;
        // Trigger decoration rebuild
        editor.view.dispatch(editor.state.tr.setMeta(searchReplaceKey, { updateSearch: true }));
        return true;
      },

      setCaseSensitive: (val) => ({ editor }) => {
        editor.storage.searchReplace.caseSensitive = val;
        editor.storage.searchReplace.activeIndex = -1;
        editor.view.dispatch(editor.state.tr.setMeta(searchReplaceKey, { updateSearch: true }));
        return true;
      },

      nextSearchResult: () => ({ editor }) => {
        const { results, activeIndex } = editor.storage.searchReplace;
        if (results.length === 0) return false;
        const next = (activeIndex + 1) % results.length;
        editor.storage.searchReplace.activeIndex = next;
        scrollToResult(editor, results[next]);
        editor.view.dispatch(editor.state.tr.setMeta(searchReplaceKey, { updateIndex: true }));
        return true;
      },

      prevSearchResult: () => ({ editor }) => {
        const { results, activeIndex } = editor.storage.searchReplace;
        if (results.length === 0) return false;
        const prev = activeIndex <= 0 ? results.length - 1 : activeIndex - 1;
        editor.storage.searchReplace.activeIndex = prev;
        scrollToResult(editor, results[prev]);
        editor.view.dispatch(editor.state.tr.setMeta(searchReplaceKey, { updateIndex: true }));
        return true;
      },

      replaceCurrentResult: () => ({ editor }) => {
        const { results, activeIndex, replaceTerm } = editor.storage.searchReplace;
        if (results.length === 0 || activeIndex < 0 || activeIndex >= results.length) return false;
        const { from, to } = results[activeIndex];
        // Create a fresh transaction and dispatch it
        const tr = editor.state.tr;
        tr.insertText(replaceTerm, from, to);
        editor.view.dispatch(tr);
        // Re-search after replace
        setTimeout(() => {
          editor.commands.setSearchTerm(editor.storage.searchReplace.searchTerm);
          // Adjust active index
          const newResults = editor.storage.searchReplace.results;
          if (newResults.length > 0) {
            const idx = Math.min(activeIndex, newResults.length - 1);
            editor.storage.searchReplace.activeIndex = idx;
            editor.view.dispatch(editor.state.tr.setMeta(searchReplaceKey, { updateIndex: true }));
          }
        }, 0);
        return true;
      },

      replaceAllResults: () => ({ editor }) => {
        const { results, replaceTerm } = editor.storage.searchReplace;
        if (results.length === 0) return false;
        // Replace in reverse order to preserve positions
        const tr = editor.state.tr;
        for (let i = results.length - 1; i >= 0; i--) {
          tr.insertText(replaceTerm, results[i].from, results[i].to);
        }
        editor.view.dispatch(tr);
        // Re-search
        setTimeout(() => {
          editor.commands.setSearchTerm(editor.storage.searchReplace.searchTerm);
        }, 0);
        return true;
      },

      clearSearch: () => ({ editor }) => {
        editor.storage.searchReplace.searchTerm = '';
        editor.storage.searchReplace.replaceTerm = '';
        editor.storage.searchReplace.results = [];
        editor.storage.searchReplace.activeIndex = -1;
        editor.view.dispatch(editor.state.tr.setMeta(searchReplaceKey, { updateSearch: true }));
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    const extensionThis = this;

    return [
      new Plugin({
        key: searchReplaceKey,
        state: {
          init() {
            return DecorationSet.empty;
          },
          apply(tr, oldDecoSet, _oldState, newState) {
            const meta = tr.getMeta(searchReplaceKey);
            if (meta || tr.docChanged) {
              return buildDecorations(newState.doc, extensionThis.editor);
            }
            return oldDecoSet;
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

function buildDecorations(doc, editor) {
  const { searchTerm, caseSensitive } = editor.storage.searchReplace;
  const results = [];

  if (!searchTerm || searchTerm.length === 0) {
    editor.storage.searchReplace.results = [];
    return DecorationSet.empty;
  }

  const term = caseSensitive ? searchTerm : searchTerm.toLowerCase();

  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const text = caseSensitive ? node.text : node.text.toLowerCase();
    let idx = 0;
    while (idx < text.length) {
      const found = text.indexOf(term, idx);
      if (found === -1) break;
      results.push({ from: pos + found, to: pos + found + term.length });
      idx = found + 1;
    }
  });

  editor.storage.searchReplace.results = results;

  // Auto-advance to first result if none active
  if (results.length > 0 && editor.storage.searchReplace.activeIndex === -1) {
    editor.storage.searchReplace.activeIndex = 0;
  }
  // Clamp active index
  if (editor.storage.searchReplace.activeIndex >= results.length) {
    editor.storage.searchReplace.activeIndex = results.length > 0 ? 0 : -1;
  }

  const activeIdx = editor.storage.searchReplace.activeIndex;
  const decorations = results.map((r, i) =>
    Decoration.inline(r.from, r.to, {
      class: i === activeIdx ? 'search-highlight search-highlight-active' : 'search-highlight',
    })
  );

  return DecorationSet.create(doc, decorations);
}

function scrollToResult(editor, result) {
  if (!result) return;
  try {
    const { node } = editor.view.domAtPos(result.from);
    const el = node.nodeType === 3 ? node.parentElement : node;
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  } catch {}
}
