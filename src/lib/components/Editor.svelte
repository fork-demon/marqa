<script>
  import { onMount, onDestroy } from 'svelte';
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import Placeholder from '@tiptap/extension-placeholder';
  import Typography from '@tiptap/extension-typography';
  import TaskList from '@tiptap/extension-task-list';
  import TaskItem from '@tiptap/extension-task-item';
  import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
  import Link from '@tiptap/extension-link';
  import Table from '@tiptap/extension-table';
  import TableRow from '@tiptap/extension-table-row';
  import TableCell from '@tiptap/extension-table-cell';
  import TableHeader from '@tiptap/extension-table-header';
  import Highlight from '@tiptap/extension-highlight';
  import { common, createLowlight } from 'lowlight';

  let {
    content = '',
    onUpdate = () => {},
    editable = true,
  } = $props();

  let element;
  let editor;
  const lowlight = createLowlight(common);

  onMount(() => {
    editor = new Editor({
      element,
      extensions: [
        StarterKit.configure({
          codeBlock: false, // We use CodeBlockLowlight instead
          heading: {
            levels: [1, 2, 3, 4, 5, 6],
          },
        }),
        Placeholder.configure({
          placeholder: 'Start writing...',
        }),
        Typography,
        TaskList,
        TaskItem.configure({
          nested: true,
        }),
        CodeBlockLowlight.configure({
          lowlight,
          defaultLanguage: 'plaintext',
        }),
        Link.configure({
          openOnClick: false,
          autolink: true,
        }),
        Table.configure({
          resizable: true,
        }),
        TableRow,
        TableCell,
        TableHeader,
        Highlight.configure({
          multicolor: true,
        }),
      ],
      content,
      editable,
      editorProps: {
        attributes: {
          class: 'marka-editor-content',
        },
      },
      onUpdate: ({ editor }) => {
        onUpdate(editor.getHTML());
      },
    });
  });

  onDestroy(() => {
    if (editor) {
      editor.destroy();
    }
  });

  // Update content from outside
  $effect(() => {
    if (editor && content !== undefined) {
      const currentContent = editor.getHTML();
      if (content !== currentContent && content !== '') {
        editor.commands.setContent(content, false);
      }
    }
  });

  export function getEditor() {
    return editor;
  }
</script>

<div class="editor-wrapper" bind:this={element}></div>

<style>
  .editor-wrapper {
    flex: 1;
    overflow-y: auto;
    cursor: text;
  }

  /* TipTap ProseMirror editor styles */
  .editor-wrapper :global(.marka-editor-content) {
    padding: 32px 48px;
    max-width: 860px;
    margin: 0 auto;
    outline: none;
    min-height: 100%;
    font-family: var(--prose-font);
    font-size: 16px;
    line-height: 1.75;
    color: var(--text-primary);
  }

  /* Focus ring for the editor */
  .editor-wrapper :global(.marka-editor-content:focus) {
    outline: none;
  }

  /* Placeholder */
  .editor-wrapper :global(.tiptap p.is-editor-empty:first-child::before) {
    content: attr(data-placeholder);
    float: left;
    color: var(--text-muted);
    pointer-events: none;
    height: 0;
    font-style: italic;
  }

  /* Headings */
  .editor-wrapper :global(h1) {
    font-size: 2.2em;
    font-weight: 800;
    margin: 1.2em 0 0.4em;
    line-height: 1.2;
    color: var(--text-primary);
    letter-spacing: -0.03em;
  }

  .editor-wrapper :global(h2) {
    font-size: 1.65em;
    font-weight: 700;
    margin: 1.1em 0 0.4em;
    line-height: 1.25;
    color: var(--text-primary);
    letter-spacing: -0.02em;
  }

  .editor-wrapper :global(h3) {
    font-size: 1.3em;
    font-weight: 600;
    margin: 1em 0 0.35em;
    line-height: 1.3;
    color: var(--text-primary);
    letter-spacing: -0.01em;
  }

  .editor-wrapper :global(h4) {
    font-size: 1.1em;
    font-weight: 600;
    margin: 0.9em 0 0.3em;
    color: var(--text-primary);
  }

  .editor-wrapper :global(h5),
  .editor-wrapper :global(h6) {
    font-size: 1em;
    font-weight: 600;
    margin: 0.8em 0 0.25em;
    color: var(--text-secondary);
  }

  /* Paragraphs */
  .editor-wrapper :global(p) {
    margin: 0.5em 0;
  }

  /* Links */
  .editor-wrapper :global(a) {
    color: var(--accent);
    text-decoration: none;
    border-bottom: 1px solid transparent;
    transition: border-color 0.15s;
  }

  .editor-wrapper :global(a:hover) {
    border-bottom-color: var(--accent);
  }

  /* Bold & Italic */
  .editor-wrapper :global(strong) {
    font-weight: 700;
  }

  .editor-wrapper :global(em) {
    font-style: italic;
  }

  /* Inline code */
  .editor-wrapper :global(code) {
    font-family: var(--editor-font);
    font-size: 0.88em;
    padding: 2px 6px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: #e06c75;
  }

  [data-theme="dark"] .editor-wrapper :global(code) {
    color: #e5c07b;
  }

  /* Code blocks with syntax highlighting */
  .editor-wrapper :global(pre) {
    margin: 1.2em 0;
    padding: 18px 20px;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow-x: auto;
    position: relative;
  }

  .editor-wrapper :global(pre code) {
    padding: 0;
    background: none;
    border: none;
    color: var(--text-primary);
    font-size: 13.5px;
    line-height: 1.6;
    display: block;
  }

  /* Syntax highlighting — One Dark Pro inspired */
  .editor-wrapper :global(.hljs-keyword) { color: #c678dd; }
  .editor-wrapper :global(.hljs-string) { color: #98c379; }
  .editor-wrapper :global(.hljs-number) { color: #d19a66; }
  .editor-wrapper :global(.hljs-function) { color: #61afef; }
  .editor-wrapper :global(.hljs-title) { color: #61afef; }
  .editor-wrapper :global(.hljs-params) { color: #abb2bf; }
  .editor-wrapper :global(.hljs-comment) { color: #5c6370; font-style: italic; }
  .editor-wrapper :global(.hljs-built_in) { color: #e6c07b; }
  .editor-wrapper :global(.hljs-attr) { color: #d19a66; }
  .editor-wrapper :global(.hljs-tag) { color: #e06c75; }
  .editor-wrapper :global(.hljs-name) { color: #e06c75; }
  .editor-wrapper :global(.hljs-selector-class) { color: #d19a66; }
  .editor-wrapper :global(.hljs-selector-id) { color: #61afef; }
  .editor-wrapper :global(.hljs-literal) { color: #d19a66; }
  .editor-wrapper :global(.hljs-type) { color: #e6c07b; }
  .editor-wrapper :global(.hljs-symbol) { color: #56b6c2; }
  .editor-wrapper :global(.hljs-meta) { color: #61afef; }
  .editor-wrapper :global(.hljs-variable) { color: #e06c75; }
  .editor-wrapper :global(.hljs-template-variable) { color: #e06c75; }
  .editor-wrapper :global(.hljs-addition) { color: #98c379; background: rgba(152, 195, 121, 0.1); }
  .editor-wrapper :global(.hljs-deletion) { color: #e06c75; background: rgba(224, 108, 117, 0.1); }

  /* Blockquotes */
  .editor-wrapper :global(blockquote) {
    margin: 1em 0;
    padding: 0.6em 1.2em;
    border-left: 3px solid var(--accent);
    background: var(--accent-light);
    border-radius: 0 6px 6px 0;
    color: var(--text-secondary);
    font-style: italic;
  }

  .editor-wrapper :global(blockquote p) {
    margin: 0.3em 0;
  }

  /* Lists */
  .editor-wrapper :global(ul),
  .editor-wrapper :global(ol) {
    margin: 0.5em 0;
    padding-left: 1.5em;
  }

  .editor-wrapper :global(li) {
    margin: 0.2em 0;
  }

  .editor-wrapper :global(li p) {
    margin: 0.15em 0;
  }

  /* Task lists */
  .editor-wrapper :global(ul[data-type="taskList"]) {
    list-style: none;
    padding-left: 0;
  }

  .editor-wrapper :global(ul[data-type="taskList"] li) {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }

  .editor-wrapper :global(ul[data-type="taskList"] li label) {
    flex-shrink: 0;
    margin-top: 3px;
  }

  .editor-wrapper :global(ul[data-type="taskList"] li label input[type="checkbox"]) {
    width: 16px;
    height: 16px;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .editor-wrapper :global(ul[data-type="taskList"] li div) {
    flex: 1;
  }

  .editor-wrapper :global(ul[data-type="taskList"] li[data-checked="true"]) {
    text-decoration: line-through;
    color: var(--text-muted);
  }

  /* Horizontal rule */
  .editor-wrapper :global(hr) {
    margin: 2em 0;
    border: none;
    border-top: 2px solid var(--border);
  }

  /* Tables */
  .editor-wrapper :global(table) {
    width: 100%;
    margin: 1em 0;
    border-collapse: collapse;
    border-radius: 6px;
    overflow: hidden;
  }

  .editor-wrapper :global(th),
  .editor-wrapper :global(td) {
    padding: 10px 14px;
    border: 1px solid var(--border);
    text-align: left;
    min-width: 80px;
  }

  .editor-wrapper :global(th) {
    font-weight: 600;
    background: var(--bg-secondary);
    color: var(--text-primary);
  }

  .editor-wrapper :global(td) {
    background: var(--bg-primary);
  }

  .editor-wrapper :global(.selectedCell) {
    background: var(--accent-light);
  }

  /* Images */
  .editor-wrapper :global(img) {
    max-width: 100%;
    border-radius: 8px;
    margin: 0.5em 0;
  }

  /* Strikethrough */
  .editor-wrapper :global(s),
  .editor-wrapper :global(del) {
    text-decoration: line-through;
    color: var(--text-muted);
  }

  /* Highlight / Mark */
  .editor-wrapper :global(mark) {
    background: #fef3c7;
    padding: 1px 3px;
    border-radius: 2px;
  }

  [data-theme="dark"] .editor-wrapper :global(mark) {
    background: #78350f;
    color: #fef3c7;
  }

  /* Selection in the editor */
  .editor-wrapper :global(.ProseMirror-selectednode) {
    outline: 2px solid var(--accent);
    border-radius: 4px;
  }

  /* Gapcursor */
  .editor-wrapper :global(.ProseMirror-gapcursor:after) {
    border-top: 1px solid var(--text-primary);
  }
</style>
