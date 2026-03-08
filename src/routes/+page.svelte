<script>
  import { invoke } from "@tauri-apps/api/core";
  import { open, save } from "@tauri-apps/plugin-dialog";
  import { onMount, onDestroy, tick } from 'svelte';
  import { Editor } from '@tiptap/core';
  import StarterKit from '@tiptap/starter-kit';
  import Placeholder from '@tiptap/extension-placeholder';
  import Typography from '@tiptap/extension-typography';
  import TaskList from '@tiptap/extension-task-list';
  import TaskItem from '@tiptap/extension-task-item';
  import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
  import { MermaidPreview, updateMermaidTheme } from '$lib/extensions/MermaidBlock.js';
  import Link from '@tiptap/extension-link';
  import { Table } from '@tiptap/extension-table';
  import { TableRow } from '@tiptap/extension-table-row';
  import { TableCell } from '@tiptap/extension-table-cell';
  import { TableHeader } from '@tiptap/extension-table-header';
  import Highlight from '@tiptap/extension-highlight';
  import { TextStyle } from '@tiptap/extension-text-style';
  import Color from '@tiptap/extension-color';
  import FileTree from "$lib/components/FileTree.svelte";
  import ColorPicker from "$lib/components/ColorPicker.svelte";
  import DiagramCanvas from "$lib/components/DiagramCanvas.svelte";
  import { mermaidToDiagram } from '$lib/utils/mermaidToDiagram.js';
  import { TableControls } from '$lib/extensions/TableControls.js';
  import { SearchReplace } from '$lib/extensions/SearchReplace.js';
  import { common, createLowlight } from 'lowlight';
  import TurndownService from 'turndown';
  import { gfm } from 'turndown-plugin-gfm';
  import mermaid from 'mermaid';

  // ── HTML → Markdown converter ──
  const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
    strongDelimiter: '**',
    hr: '---',
  });
  turndown.use(gfm);
  // Preserve mermaid/code fences from TipTap code blocks
  turndown.addRule('codeBlock', {
    filter: (node) => node.nodeName === 'PRE' && node.querySelector('code'),
    replacement: (content, node) => {
      const code = node.querySelector('code');
      const lang = code?.className?.replace('language-', '') || '';
      const text = code?.textContent || content;
      return `\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
    },
  });
  // Preserve task list items
  turndown.addRule('taskListItem', {
    filter: (node) => node.nodeName === 'LI' && node.hasAttribute('data-checked'),
    replacement: (content, node) => {
      const checked = node.getAttribute('data-checked') === 'true';
      return `${checked ? '[x]' : '[ ]'} ${content.trim()}\n`;
    },
  });

  // ── State ──
  let sidebar = $state(true);
  let sidePanel = $state('files'); // 'files' | 'agents' | null (rail only)
  let dark = $state(false);
  let filePath = $state('');
  let fileName = $state('Untitled');
  let mdSource = $state('');
  // ── Workspaces (multi-folder) ──
  let workspaces = $state([]); // [{ id, path, name, color, entries, agentFiles }]
  let activeWorkspaceId = $state(null);
  let wsCounter = $state(0);
  const wsColors = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899'];
  let entries = $derived(workspaces.find(w => w.id === activeWorkspaceId)?.entries || []);
  let folder = $derived(workspaces.find(w => w.id === activeWorkspaceId)?.path || '');
  let expandedPaths = $state(new Set());
  let modified = $state(false);
  let words = $state(0);
  let chars = $state(0);

  // ── Tabs ──
  let tabCounter = $state(1);
  let tabs = $state([{ id: 1, name: 'Untitled', filePath: '', content: '<p></p>', modified: false }]);
  let activeTabId = $state(1);
  let hasOpenTabs = $derived(tabs.length > 0);
  let editorEl;
  let editor;
  let source = $state(false);

  // Color picker state
  let showColorPicker = $state(false);
  let colorPickerPos = $state({ x: 0, y: 0 });

  // Presentation mode state
  let presentMode = $state(false);

  // Language selector state
  let showLangSelector = $state(false);
  let langSelectorPos = $state({ x: 0, y: 0 });
  let langSearch = $state('');
  let langSelectorRef;

  // Agent files state (derived from active workspace)
  let agentFiles = $derived(workspaces.find(w => w.id === activeWorkspaceId)?.agentFiles || []);
  let showAgentPanel = $state(false);

  // Search & Replace state
  let showSearch = $state(false);
  let showReplace = $state(false);
  let searchTerm = $state('');
  let replaceTerm = $state('');
  let searchCaseSensitive = $state(false);
  let searchInputRef;

  // Diagram canvas state
  let showDiagram = $state(false);
  let diagramEditData = $state(null);
  let diagramEditPos = $state(null);

  // Heading dropdown & table popover state
  let showHeadingMenu = $state(false);
  let showTableMenu = $state(false);
  let tableHoverR = $state(0);
  let tableHoverC = $state(0);
  let tableGridRows = $state(4);
  let tableGridCols = $state(4);

  const LANGUAGES = [
    'plaintext', 'javascript', 'typescript', 'python', 'rust', 'go', 'java',
    'c', 'cpp', 'csharp', 'ruby', 'php', 'swift', 'kotlin', 'scala',
    'html', 'css', 'scss', 'json', 'yaml', 'toml', 'xml', 'sql',
    'bash', 'shell', 'powershell', 'dockerfile', 'makefile',
    'markdown', 'latex', 'graphql', 'r', 'matlab', 'lua', 'perl',
    'elixir', 'erlang', 'haskell', 'clojure', 'dart', 'zig', 'nim',
  ];

  let filteredLangs = $derived(
    langSearch
      ? LANGUAGES.filter(l => l.includes(langSearch.toLowerCase()))
      : LANGUAGES
  );

  const lowlight = createLowlight(common);

  // Re-init mermaid theme when dark mode changes
  $effect(() => {
    void dark;
    updateMermaidTheme(dark);
    // Force ProseMirror to rebuild mermaid decorations with new theme
    if (editor && !editor.isDestroyed) {
      const tr = editor.state.tr.setMeta('mermaidThemeChange', true);
      editor.view.dispatch(tr);
    }
  });

  // ── Editor init ──
  onMount(() => {
    editor = new Editor({
      element: editorEl,
      extensions: [
        StarterKit.configure({ codeBlock: false, heading: { levels: [1,2,3,4,5,6] } }),
        Placeholder.configure({ placeholder: 'Start writing...', showOnlyWhenEditable: true, showOnlyCurrent: true }),
        Typography,
        TaskList,
        TaskItem.configure({ nested: true }),
        CodeBlockLowlight.configure({ lowlight, defaultLanguage: 'plaintext' }),
        MermaidPreview.configure({
          onEditDiagram(src, pos) {
            diagramEditData = mermaidToDiagram(src);
            diagramEditPos = pos;
            showDiagram = true;
          },
        }),
        Link.configure({ openOnClick: false, autolink: true }),
        Table.configure({ resizable: true }),
        TableRow, TableCell, TableHeader,
        TableControls,
        SearchReplace,
        Highlight.configure({ multicolor: true }),
        TextStyle,
        Color,
      ],
      content: '<p></p>',
      editorProps: { attributes: { class: 'prose-editor', spellcheck: 'false' } },
      onUpdate: ({ editor: e }) => {
        modified = true;
        countFromEditor(e);
        checkCodeBlock(e);
      },
    });
    editor.commands.focus();
  });

  onDestroy(() => editor?.destroy());

  function countFromEditor(e) {
    const t = (e || editor)?.state?.doc?.textContent || '';
    chars = t.length;
    words = t.trim() ? t.trim().split(/\s+/).length : 0;
  }

  function countFromText(t) {
    chars = t.length;
    words = t.trim() ? t.trim().split(/\s+/).length : 0;
  }

  // ── Code block language detection ──
  function checkCodeBlock(e) {
    if (!e) return;
    const { state } = e;
    const { selection } = state;
    const anchor = selection.$anchor;

    // Check if we just entered a code block
    const node = anchor.parent;
    if (node.type.name === 'codeBlock' && node.textContent === '' && !showLangSelector) {
      // Get position on screen for the language selector
      const coords = e.view.coordsAtPos(anchor.pos);
      langSelectorPos = { x: coords.left, y: coords.top + 24 };
      showLangSelector = true;
      langSearch = '';
      tick().then(() => {
        langSelectorRef?.focus();
      });
    } else if (node.type.name !== 'codeBlock' && showLangSelector) {
      showLangSelector = false;
    }
  }

  function selectLanguage(lang) {
    if (editor) {
      editor.chain().focus().updateAttributes('codeBlock', { language: lang }).run();
    }
    showLangSelector = false;
    langSearch = '';
  }

  function onLangKeydown(e) {
    if (e.key === 'Escape') {
      showLangSelector = false;
      editor?.commands.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredLangs.length > 0) {
        selectLanguage(filteredLangs[0]);
      }
    }
  }

  // ── Theme ──
  $effect(() => { document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light'); });

  // ── File ops ──
  async function doOpenFolder() {
    const sel = await open({ directory: true, multiple: false, title: 'Open Folder' });
    if (!sel) return;
    // Check if already open
    const existing = workspaces.find(w => w.path === sel);
    if (existing) {
      activeWorkspaceId = existing.id;
      sidePanel = 'files';
      return;
    }
    const id = ++wsCounter;
    const dirEntries = await invoke('read_directory', { path: sel }).catch(() => []);
    const agents = await invoke('detect_agent_files', { projectPath: sel }).catch(() => []);
    const name = sel.split('/').pop() || 'Folder';
    const color = wsColors[(workspaces.length) % wsColors.length];
    workspaces = [...workspaces, { id, path: sel, name, color, entries: dirEntries, agentFiles: agents }];
    activeWorkspaceId = id;
    sidePanel = 'files';
  }

  function closeWorkspace(wsId) {
    workspaces = workspaces.filter(w => w.id !== wsId);
    if (activeWorkspaceId === wsId) {
      activeWorkspaceId = workspaces.length > 0 ? workspaces[0].id : null;
    }
  }

  // ── Lazy-load directory children ──
  async function handleExpandDir(dirPath) {
    const children = await invoke('read_directory_children', { path: dirPath }).catch(() => []);
    if (children.length === 0) return;
    const wsIdx = workspaces.findIndex(w => w.id === activeWorkspaceId);
    if (wsIdx < 0) return;
    function updateChildren(entries) {
      return entries.map(e => {
        if (e.path === dirPath) return { ...e, children };
        if (e.is_dir && e.children) return { ...e, children: updateChildren(e.children) };
        return e;
      });
    }
    workspaces[wsIdx] = { ...workspaces[wsIdx], entries: updateChildren(workspaces[wsIdx].entries) };
    workspaces = [...workspaces];
  }

  // ── Auto-expand file tree to show a file's location ──
  async function expandPathToFile(filePath) {
    if (!filePath || !folder) return;
    if (!filePath.startsWith(folder)) return;
    const parts = filePath.split('/');
    const newPaths = new Set(expandedPaths);
    const ancestorsToLoad = [];
    for (let i = 1; i < parts.length; i++) {
      const ancestorPath = parts.slice(0, i).join('/');
      if (ancestorPath && ancestorPath.length >= folder.length && ancestorPath.startsWith(folder)) {
        newPaths.add(ancestorPath);
        ancestorsToLoad.push(ancestorPath);
      }
    }
    expandedPaths = newPaths;
    // Ensure ancestor directories have their children loaded
    for (const dirPath of ancestorsToLoad) {
      await handleExpandDir(dirPath);
    }
  }

  async function doOpenFile() {
    const sel = await open({ multiple: false, title: 'Open File', filters: [{ name: 'Markdown', extensions: ['md','markdown','mdx','txt'] }] });
    if (sel) await doLoad(sel);
  }

  async function doLoad(path) {
    const content = await invoke('read_file', { path }).catch(() => null);
    if (content === null) return;

    // Check if this file is already open in a tab
    const existingTab = tabs.find(t => t.filePath === path);
    if (existingTab) {
      switchToTab(existingTab.id);
      return;
    }

    filePath = path;
    fileName = path.split('/').pop() || 'Untitled';
    mdSource = content;
    modified = false;
    const html = await invoke('parse_markdown', { content });
    editor?.commands.setContent(html, false);
    countFromEditor(editor);

    // Update active tab or create new one if no tabs open
    const idx = tabs.findIndex(t => t.id === activeTabId);
    if (idx >= 0) {
      tabs[idx] = { ...tabs[idx], name: fileName, filePath, content: html, modified: false };
      tabs = [...tabs];
    } else {
      // No tabs — create a new one for this file
      const id = ++tabCounter;
      tabs = [{ id, name: fileName, filePath, content: html, modified: false }];
      activeTabId = id;
    }

    // Auto-expand file tree to show this file
    expandPathToFile(path);
  }

  async function doSave() {
    if (!hasOpenTabs) return;
    if (!filePath) {
      const p = await save({ title: 'Save File', defaultPath: 'untitled.md', filters: [{ name: 'Markdown', extensions: ['md'] }] });
      if (!p) return;
      filePath = p;
      fileName = p.split('/').pop() || 'Untitled';
    }
    const content = source ? mdSource : turndown.turndown(editor?.getHTML() || '');
    await invoke('write_file', { path: filePath, content });
    modified = false;

    // Update tab state
    const idx = tabs.findIndex(t => t.id === activeTabId);
    if (idx >= 0) {
      tabs[idx] = { ...tabs[idx], name: fileName, filePath, modified: false };
      tabs = [...tabs];
    }
  }

  function saveCurrentTabState() {
    const idx = tabs.findIndex(t => t.id === activeTabId);
    if (idx >= 0) {
      tabs[idx] = { ...tabs[idx], name: fileName, filePath, content: editor?.getHTML() || '<p></p>', modified };
      tabs = [...tabs];
    }
  }

  function isAgentFile(path) {
    if (!path) return false;
    const agentNames = ['CLAUDE.md', 'AGENTS.md', '.cursorrules', 'copilot-instructions.md', '.windsurfrules', 'GEMINI.md', '.github/copilot-instructions.md'];
    return agentNames.some(n => path.endsWith(n)) || path.includes('.cursor/rules');
  }

  function switchToTab(tabId) {
    if (tabId === activeTabId) return;
    // Auto-save agent files when switching away
    if (modified && filePath && isAgentFile(filePath)) {
      doSave();
    }
    saveCurrentTabState();
    activeTabId = tabId;
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;
    filePath = tab.filePath;
    fileName = tab.name;
    modified = tab.modified;
    editor?.commands.setContent(tab.content, false);
    countFromEditor(editor);
  }

  function closeTab(tabId) {
    const idx = tabs.findIndex(t => t.id === tabId);
    if (idx < 0) return;
    tabs = tabs.filter(t => t.id !== tabId);
    if (tabs.length === 0) {
      // Show empty state — do NOT create a new tab
      activeTabId = 0;
      filePath = ''; fileName = ''; mdSource = ''; modified = false;
      editor?.commands.setContent('', false);
      words = 0; chars = 0;
    } else if (activeTabId === tabId) {
      const newActive = tabs[Math.min(idx, tabs.length - 1)];
      switchToTab(newActive.id);
    }
  }

  function doNew() {
    saveCurrentTabState();
    const id = ++tabCounter;
    const newTab = { id, name: 'Untitled', filePath: '', content: '<p></p>', modified: false };
    tabs = [...tabs, newTab];
    activeTabId = id;
    filePath = ''; fileName = 'Untitled'; mdSource = ''; modified = false;
    editor?.commands.setContent('<p></p>', false);
    words = 0; chars = 0;
  }

  // ── Source/Rich toggle ──
  async function toggleSource() {
    if (!hasOpenTabs) return;
    if (source) {
      // Source → Rich: parse markdown to HTML and set editor content
      const html = await invoke('parse_markdown', { content: mdSource });
      editor?.commands.setContent(html, false);
      countFromEditor(editor);
      source = false;
      await tick();
      // Focus at start of document, not end
      editor?.chain().focus('start').run();
    } else {
      // Rich → Source: convert editor HTML to markdown
      const html = editor?.getHTML() || '';
      mdSource = turndown.turndown(html);
      source = true;
      countFromText(mdSource);
      await tick();
      const ta = document.querySelector('.source-wrap');
      if (ta) { ta.focus(); ta.setSelectionRange(0, 0); }
    }
  }

  function onSourceInput(e) {
    mdSource = e.target.value;
    modified = true;
    countFromText(mdSource);
  }

  // ── Color picker ──
  function openColorPicker(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    colorPickerPos = { x: rect.left, y: rect.bottom + 6 };
    showColorPicker = true;
  }

  function onColorSelect(type, value) {
    if (!editor) return;
    if (type === 'highlight') {
      if (value) {
        editor.chain().focus().toggleHighlight({ color: value }).run();
      } else {
        editor.chain().focus().unsetHighlight().run();
      }
    } else if (type === 'textColor') {
      if (value) {
        editor.chain().focus().setColor(value).run();
      } else {
        editor.chain().focus().unsetColor().run();
      }
    }
  }

  // ── Presentation mode ──
  function togglePresentation() {
    if (!hasOpenTabs) return;
    presentMode = !presentMode;
    if (presentMode) {
      tick().then(() => renderPresentationMermaid());
    }
  }

  function exitPresentation() {
    presentMode = false;
  }

  async function renderPresentationMermaid() {
    const container = document.querySelector('.present-article');
    if (!container) return;
    const codeBlocks = container.querySelectorAll('pre > code.language-mermaid');
    for (const code of codeBlocks) {
      const pre = code.parentElement;
      const src = code.textContent.trim();
      if (!src) continue;
      try {
        const wrapper = document.createElement('div');
        wrapper.className = 'mermaid-present-render';

        // Use custom SVG renderer if metadata present (preserves positions)
        const hasMetadata = src.includes('%% meta:');
        if (hasMetadata) {
          const data = mermaidToDiagram(src);
          if (data.nodes.length > 0) {
            const { renderDiagramSvg } = await import('$lib/utils/renderDiagramSvg.js');
            const svg = renderDiagramSvg(data);
            if (svg) {
              wrapper.innerHTML = svg;
              pre.replaceWith(wrapper);
              continue;
            }
          }
        }

        // Fallback to Mermaid
        const id = `present-mermaid-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const { svg } = await mermaid.render(id, src);
        wrapper.innerHTML = svg;
        pre.replaceWith(wrapper);
      } catch {
        // Leave code block as-is on error
      }
    }
  }

  // ── Diagram insert ──
  function onDiagramInsert(mermaidCode) {
    if (!editor) return;
    if (diagramEditPos !== null) {
      // Replace existing mermaid code block at the stored position
      const { state } = editor;
      const node = state.doc.nodeAt(diagramEditPos);
      if (node && node.type.name === 'codeBlock') {
        const tr = state.tr.replaceRangeWith(
          diagramEditPos,
          diagramEditPos + node.nodeSize,
          state.schema.nodes.codeBlock.create(
            { language: 'mermaid' },
            state.schema.text(mermaidCode)
          )
        );
        editor.view.dispatch(tr);
      }
      diagramEditPos = null;
      diagramEditData = null;
    } else {
      // Insert new code block
      editor.chain().focus().insertContent({
        type: 'codeBlock',
        attrs: { language: 'mermaid' },
        content: [{ type: 'text', text: mermaidCode }],
      }).run();
    }
  }

  function closeDiagram() {
    showDiagram = false;
    diagramEditData = null;
    diagramEditPos = null;
  }


  // ── Search helpers ──
  function openSearch(withReplace = true) {
    showSearch = true;
    showReplace = withReplace;
    tick().then(() => searchInputRef?.focus());
  }

  function closeSearch() {
    showSearch = false;
    showReplace = false;
    searchTerm = '';
    replaceTerm = '';
    editor?.commands.clearSearch();
  }

  function updateSearch(term) {
    searchTerm = term;
    editor?.commands.setSearchTerm(term);
  }

  // ── Keys ──
  function onKey(e) {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === 'f') { e.preventDefault(); openSearch(false); return; }
    if (mod && e.key === 'h') { e.preventDefault(); openSearch(true); return; }
    if (e.key === 'Escape' && showSearch) { e.preventDefault(); closeSearch(); return; }
    if (mod && e.key === 's') { e.preventDefault(); doSave(); }
    if (mod && e.key === 'o') { e.preventDefault(); doOpenFile(); }
    if (mod && e.key === 'n') { e.preventDefault(); doNew(); }
    if (mod && e.key === '\\') { e.preventDefault(); sidebar = !sidebar; }
    if (mod && e.key === '/') { e.preventDefault(); toggleSource(); }
    if (mod && e.key === 'd') { e.preventDefault(); showDiagram = true; }
    if (e.key === 'Escape' && presentMode) { exitPresentation(); }
  }

  // ── Formatting helper ──
  function f(cmd, opts) { editor?.chain().focus()[cmd](opts).run(); }

  function insertTable(rows, cols) {
    editor?.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
    showTableMenu = false;
    tableHoverR = 0; tableHoverC = 0;
    tableGridRows = 4; tableGridCols = 4;
  }

  function onTableCellHover(r, c) {
    tableHoverR = r; tableHoverC = c;
    // Auto-expand grid when hovering near edges (Confluence-style)
    if (r >= tableGridRows && tableGridRows < 10) tableGridRows = Math.min(10, r + 1);
    if (c >= tableGridCols && tableGridCols < 10) tableGridCols = Math.min(10, c + 1);
  }

  function setHeading(level) {
    if (level === 0) {
      editor?.chain().focus().setParagraph().run();
    } else {
      editor?.chain().focus().toggleHeading({ level }).run();
    }
    showHeadingMenu = false;
  }

  // Close dropdowns on any click outside the toolbar dropdown
  function handleGlobalClick(e) {
    if (showHeadingMenu || showTableMenu) {
      const wrap = e.target.closest('.tb-dropdown-wrap');
      if (!wrap) {
        showHeadingMenu = false;
        showTableMenu = false;
        tableHoverR = 0; tableHoverC = 0;
        tableGridRows = 4; tableGridCols = 4;
      }
    }
  }

  function currentHeadingLabel() {
    if (!editor) return 'Paragraph';
    for (let i = 1; i <= 6; i++) {
      if (editor.isActive('heading', { level: i })) return `H${i}`;
    }
    return 'Paragraph';
  }
</script>

<svelte:window onkeydown={onKey} onclick={handleGlobalClick} />

<!-- ═══ Presentation Mode ═══ -->
{#if presentMode}
  <div class="present-overlay" role="presentation">
    <div class="present-controls">
      <button class="present-close" onclick={exitPresentation} title="Exit (Esc)">
        <svg width="20" height="20" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
    </div>
    <div class="present-content">
      <article class="present-article">
        {@html editor?.getHTML() || '<p>Nothing to present</p>'}
      </article>
    </div>
  </div>
{/if}

<!-- ═══ Diagram Canvas ═══ -->
{#if showDiagram}
  <DiagramCanvas
    onInsert={onDiagramInsert}
    onClose={closeDiagram}
    initialData={diagramEditData}
  />
{/if}

<div class="app" class:present-hidden={presentMode}>
  <!-- ─── Sidebar ─── -->
  {#if sidebar}
    <aside class="sidebar">
      <!-- Icon rail -->
      <div class="side-rail">
        <!-- Workspace folder tabs -->
        {#each workspaces as ws (ws.id)}
          <button
            class="rail-icon ws-tab"
            class:active={activeWorkspaceId === ws.id && sidePanel === 'files'}
            onclick={() => { activeWorkspaceId = ws.id; sidePanel = 'files'; }}
            title={ws.name}
          >
            <span class="ws-letter" style="background:{ws.color}20;color:{ws.color}">{ws.name.charAt(0).toUpperCase()}</span>
          </button>
        {/each}
        <!-- Add folder -->
        <button class="rail-icon" onclick={doOpenFolder} title="Open folder">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </button>
        <div class="rail-divider"></div>
        <button class="rail-icon" onclick={doOpenFile} title="Open file (⌘O)">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M13 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2v-8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 3v6h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M9 15l2 2 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <div class="rail-spacer"></div>
        <button class="rail-icon" onclick={() => sidebar = false} title="Close sidebar (⌘\\)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M15 4l-8 8 8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>

      <!-- File panel (right of rail) -->
      {#if sidePanel}
        <div class="side-panel">
          {#if sidePanel === 'files'}
            <div class="side-header">
              <span class="side-title">{entries.length > 0 ? (folder.split('/').pop() || 'Files') : 'Explorer'}</span>
              <div class="side-actions">
                {#if activeWorkspaceId}
                  <button class="side-action-btn" onclick={() => closeWorkspace(activeWorkspaceId)} title="Close folder">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
                  </button>
                {/if}
              </div>
            </div>
            {#if entries.length > 0}
              <div class="side-files">
                <FileTree {entries} onFileSelect={doLoad} currentFile={filePath} onExpandDir={handleExpandDir} {expandedPaths} />
              </div>
            {:else}
              <div class="side-empty">
                <p>Open a folder</p>
              </div>
            {/if}
          {/if}
        </div>
      {/if}
    </aside>
  {/if}

  <!-- ─── Canvas ─── -->
  <main class="canvas">
    <!-- Tab bar -->
    <div class="tab-bar">
      <div class="tab-bar-left">
        {#if !sidebar}
          <button class="ghost-btn tab-sidebar-btn" onclick={() => sidebar = true} title="Open sidebar (⌘\\)">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M5 3l5 5-5 5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
        {/if}
        <div class="tab-list">
          {#each tabs as tab (tab.id)}
            <button
              class="tab-item"
              class:active={tab.id === activeTabId}
              onclick={() => switchToTab(tab.id)}
            >
              {#if isAgentFile(tab.filePath)}<span class="tab-agent-icon" title="Agent file"><svg width="10" height="10" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3.5" stroke="currentColor" stroke-width="1.5"/><path d="M8 2v3m0 6v3m6-6h-3M5 8H2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></span>{/if}
              <span class="tab-name">{tab.name}</span>
              {#if tab.modified}<span class="tab-dot"></span>{/if}
              <span
                class="tab-close"
                role="button"
                tabindex="-1"
                onclick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
              >&times;</span>
            </button>
          {/each}
          <button class="tab-add" onclick={doNew} title="New tab">+</button>
        </div>
      </div>
      <div class="top-right">
        <button class="ghost-btn" onclick={() => showDiagram = true} title="Diagram (Cmd+D)">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="5" height="4" rx="0.5" stroke="currentColor" stroke-width="1.2"/><rect x="10" y="11" width="5" height="4" rx="0.5" stroke="currentColor" stroke-width="1.2"/><path d="M6 3h3a1 1 0 011 1v7" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/><path d="M10 12.5l-1-1.5" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>
        </button>
        <button class="ghost-btn" onclick={togglePresentation} title="Present (Zen Mode)">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><rect x="1" y="2" width="14" height="9" rx="1.5" stroke="currentColor" stroke-width="1.2"/><path d="M7 5v4.5l3.5-2.25L7 5z" fill="currentColor"/><path d="M5 13h6" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/><path d="M8 11v2" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>
        </button>
        <button class="pill-btn" class:active={source} onclick={toggleSource} title={source ? 'Switch to Rich Text' : 'Switch to Markdown'}>
          {#if source}
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M5.5 3.5C4.5 3.5 4 4.2 4 5v1.5c0 .5-.5 1-1.5 1 1 0 1.5.5 1.5 1V10c0 .8.5 1.5 1.5 1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.5 3.5c1 0 1.5.7 1.5 1.5v1.5c0 .5.5 1 1.5 1-1 0-1.5.5-1.5 1V10c0 .8-.5 1.5-1.5 1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          {:else}
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 8s2.5-4 6-4 6 4 6 4-2.5 4-6 4-6-4-6-4z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="1.2"/></svg>
          {/if}
        </button>
        <button class="ghost-btn" onclick={() => dark = !dark}>
          {#if dark}
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="2.5" stroke="currentColor" stroke-width="1.2"/><path d="M8 2.5v1M8 12.5v1M2.5 8h1M12.5 8h1M4.2 4.2l.7.7M11.1 11.1l.7.7M4.2 11.8l.7-.7M11.1 4.9l.7-.7" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>
          {:else}
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M13 9.5a5 5 0 01-6.5-6.5 5 5 0 106.5 6.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>
          {/if}
        </button>
      </div>
    </div><!-- /tab-bar -->

    <!-- Floating format toolbar (Excalidraw style) -->
    {#if !source && hasOpenTabs}
      <div class="fmt-toolbar">
        <!-- Heading dropdown -->
        <div class="tb-dropdown-wrap">
          <button class="tb heading-select" onclick={() => { showHeadingMenu = !showHeadingMenu; showTableMenu = false; }} title="Heading style">
            <span>{currentHeadingLabel()}</span>
            <svg width="8" height="8" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          {#if showHeadingMenu}
            <div class="heading-menu">
              <button class="heading-item" class:on={!editor?.isActive('heading')} onclick={() => setHeading(0)}>
                <span class="hi-label">Paragraph</span>
                <span class="hi-preview" style="font-size:13px">Normal text</span>
              </button>
              {#each [1,2,3,4,5,6] as lvl}
                <button class="heading-item" class:on={editor?.isActive('heading',{level:lvl})} onclick={() => setHeading(lvl)}>
                  <span class="hi-label">Heading {lvl}</span>
                  <span class="hi-preview" style="font-size:{Math.max(10, 18 - lvl * 1.5)}px;font-weight:{lvl <= 3 ? 700 : 600}">H{lvl} preview</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
        <div class="tb-sep"></div>
        <button class="tb" class:on={editor?.isActive('bold')} onclick={() => f('toggleBold')} title="Bold"><b>B</b></button>
        <button class="tb i" class:on={editor?.isActive('italic')} onclick={() => f('toggleItalic')} title="Italic"><i>I</i></button>
        <button class="tb s" class:on={editor?.isActive('strike')} onclick={() => f('toggleStrike')} title="Strike"><s>S</s></button>
        <button class="tb code" class:on={editor?.isActive('code')} onclick={() => f('toggleCode')} title="Code">`</button>
        <div class="tb-sep"></div>
        <button class="tb" class:on={editor?.isActive('bulletList')} onclick={() => f('toggleBulletList')} title="Bullets">
          <svg width="14" height="14" viewBox="0 0 16 16"><circle cx="3" cy="4" r="1" fill="currentColor"/><circle cx="3" cy="8" r="1" fill="currentColor"/><circle cx="3" cy="12" r="1" fill="currentColor"/><path d="M6 4h8M6 8h8M6 12h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
        </button>
        <button class="tb" class:on={editor?.isActive('orderedList')} onclick={() => f('toggleOrderedList')} title="Numbered">
          <svg width="14" height="14" viewBox="0 0 16 16"><text x="0.5" y="5.5" font-size="5.5" fill="currentColor" font-weight="700" font-family="var(--font-sans)">1</text><text x="0.5" y="9.5" font-size="5.5" fill="currentColor" font-weight="700" font-family="var(--font-sans)">2</text><text x="0.5" y="13.5" font-size="5.5" fill="currentColor" font-weight="700" font-family="var(--font-sans)">3</text><path d="M6 4h8M6 8h8M6 12h8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
        </button>
        <button class="tb" onclick={() => f('toggleTaskList')} title="Tasks">
          <svg width="14" height="14" viewBox="0 0 16 16"><rect x="1.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.1"/><path d="M3 4l1.2 1.2L6.5 3" stroke="currentColor" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round"/><rect x="1.5" y="9.5" width="5" height="5" rx="1" stroke="currentColor" stroke-width="1.1"/><path d="M8.5 4h6M8.5 12h6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
        </button>
        <div class="tb-sep"></div>
        <button class="tb" class:on={editor?.isActive('blockquote')} onclick={() => f('toggleBlockquote')} title="Quote">
          <svg width="14" height="14" viewBox="0 0 16 16"><path d="M3 2.5v11" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M7 4.5h7M7 8h5M7 11.5h6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
        </button>
        <button class="tb" class:on={editor?.isActive('codeBlock')} onclick={() => f('toggleCodeBlock')} title="Code block">
          <svg width="14" height="14" viewBox="0 0 16 16"><path d="M5 4L1.5 8L5 12M11 4l3.5 4L11 12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <!-- Table insert with grid picker -->
        <div class="tb-dropdown-wrap">
          <button class="tb" class:on={editor?.isActive('table')} onclick={() => { showTableMenu = !showTableMenu; showHeadingMenu = false; }} title="Insert table">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="1.5" width="13" height="13" rx="1.5" stroke="currentColor" stroke-width="1.1"/><path d="M1.5 5.5h13M1.5 10.5h13M6 1.5v13M11 1.5v13" stroke="currentColor" stroke-width="0.8"/></svg>
          </button>
          {#if showTableMenu}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="table-menu" onmouseleave={() => { tableHoverR = 0; tableHoverC = 0; }}>
              <div class="table-menu-label">{tableHoverR > 0 ? `${tableHoverR} × ${tableHoverC}` : 'Insert Table'}</div>
              <div class="table-grid" style="grid-template-columns: repeat({tableGridCols}, 1fr);">
                {#each Array.from({length: tableGridRows}, (_, i) => i + 1) as r}
                  {#each Array.from({length: tableGridCols}, (_, i) => i + 1) as c}
                    <button
                      class="table-cell-btn"
                      class:highlighted={r <= tableHoverR && c <= tableHoverC}
                      onmouseenter={() => onTableCellHover(r, c)}
                      onclick={() => insertTable(r, c)}
                    ></button>
                  {/each}
                {/each}
              </div>
              <div class="table-menu-hint">{tableHoverR > 0 ? `${tableHoverR} × ${tableHoverC} table` : 'Hover to select size'}</div>
            </div>
          {/if}
        </div>
        <button class="tb" onclick={() => f('setHorizontalRule')} title="Divider">—</button>
        <div class="tb-sep"></div>
        <!-- Color picker button -->
        <button class="tb color-btn" onclick={openColorPicker} title="Colors">
          <svg width="14" height="14" viewBox="0 0 16 16"><text x="3" y="11" font-size="11" font-weight="700" fill="currentColor" font-family="var(--font-sans)">A</text><rect x="2" y="13" width="12" height="2.5" rx="0.5" fill="var(--accent)"/></svg>
        </button>
      </div>
    {/if}

    <!-- Color Picker Popover -->
    {#if showColorPicker}
      <ColorPicker
        onSelect={onColorSelect}
        onClose={() => showColorPicker = false}
        position={colorPickerPos}
      />
    {/if}

    <!-- Language Selector for Code Blocks -->
    {#if showLangSelector}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="lang-backdrop" onclick={() => { showLangSelector = false; }} role="presentation"></div>
      <div class="lang-selector" style="left: {langSelectorPos.x}px; top: {langSelectorPos.y}px;">
        <input
          class="lang-input"
          type="text"
          placeholder="Choose language..."
          bind:value={langSearch}
          bind:this={langSelectorRef}
          onkeydown={onLangKeydown}
        />
        <div class="lang-list">
          {#each filteredLangs as lang}
            <button class="lang-item" onclick={() => selectLanguage(lang)}>{lang}</button>
          {/each}
          {#if filteredLangs.length === 0}
            <div class="lang-empty">No matches</div>
          {/if}
        </div>
      </div>
    {/if}

    <!-- Editor surface -->
    <div class="editor-surface">
      {#if hasOpenTabs && showSearch}
        <div class="search-bar">
          <div class="search-row">
            <input
              class="search-input"
              type="text"
              placeholder="Find..."
              value={searchTerm}
              bind:this={searchInputRef}
              oninput={(e) => updateSearch(e.target.value)}
              onkeydown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); editor?.commands.nextSearchResult(); }
                if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); editor?.commands.prevSearchResult(); }
                if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
              }}
            />
            <span class="search-count">
              {#if editor?.storage.searchReplace.results?.length > 0}
                {(editor.storage.searchReplace.activeIndex ?? 0) + 1} / {editor.storage.searchReplace.results.length}
              {:else if searchTerm}
                0
              {/if}
            </span>
            <button class="search-btn" onclick={() => editor?.commands.prevSearchResult()} title="Previous (Shift+Enter)">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 10l4-4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button class="search-btn" onclick={() => editor?.commands.nextSearchResult()} title="Next (Enter)">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button class="search-btn" class:on={searchCaseSensitive} onclick={() => { searchCaseSensitive = !searchCaseSensitive; editor?.commands.setCaseSensitive(searchCaseSensitive); }} title="Case sensitive">
              Aa
            </button>
            <button class="search-btn replace-toggle" class:on={showReplace} onclick={() => showReplace = !showReplace} title="Toggle replace (⌘H)">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M11 3L5 8l6 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button class="search-btn" onclick={closeSearch} title="Close (Esc)">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </button>
          </div>
          {#if showReplace}
            <div class="search-row">
              <input
                class="search-input"
                type="text"
                placeholder="Replace..."
                value={replaceTerm}
                oninput={(e) => { replaceTerm = e.target.value; if (editor) editor.storage.searchReplace.replaceTerm = e.target.value; }}
                onkeydown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); editor?.commands.replaceCurrentResult(); }
                  if (e.key === 'Escape') { e.preventDefault(); closeSearch(); }
                }}
              />
              <button class="search-btn replace-btn" onclick={() => editor?.commands.replaceCurrentResult()} title="Replace">Replace</button>
              <button class="search-btn replace-btn" onclick={() => editor?.commands.replaceAllResults()} title="Replace all">All</button>
            </div>
          {/if}
        </div>
      {/if}
      <div class="rich-wrap" class:is-hidden={source || !hasOpenTabs} bind:this={editorEl}></div>
      <textarea
        class="source-wrap"
        class:is-hidden={!source || !hasOpenTabs}
        value={mdSource}
        oninput={onSourceInput}
        placeholder="Write markdown..."
        spellcheck="false"
      ></textarea>
      {#if !hasOpenTabs}
        <div class="empty-state">
          <div class="empty-state-content">
            <div class="empty-state-icon">
              <svg width="48" height="48" viewBox="0 0 16 16" fill="none">
                <path d="M3.5 2h6l3 3v9h-9V2z" stroke="currentColor" stroke-width="0.8" stroke-linejoin="round"/>
                <path d="M9.5 2v3h3" stroke="currentColor" stroke-width="0.8" stroke-linejoin="round"/>
              </svg>
            </div>
            <p class="empty-state-text">Open a file or create a new one</p>
            <div class="empty-state-shortcuts">
              <span class="shortcut-hint"><kbd>⌘</kbd><kbd>N</kbd> New file</span>
              <span class="shortcut-hint"><kbd>⌘</kbd><kbd>O</kbd> Open file</span>
            </div>
          </div>
        </div>
      {/if}
    </div>

    <!-- Bottom status -->
    <div class="status-bar">
      {#if hasOpenTabs}
        <span>{words} words</span>
        <span class="dim">&middot;</span>
        <span>{chars} chars</span>
        {#if filePath}
          <span class="dim">&middot;</span>
          <span class="path" title={filePath}>{filePath}</span>
        {/if}
        <span class="grow"></span>
        <span class="tag">{source ? 'Markdown' : 'Rich Text'}</span>
      {:else}
        <span class="grow"></span>
      {/if}
    </div>
  </main>
</div>

<style>
  /* ═══ Layout ═══ */
  .app { display: flex; height: 100vh; overflow: hidden; }
  .present-hidden { /* still flex but behind the overlay */ }

  /* ═══ Sidebar ═══ */
  .sidebar {
    display: flex;
    flex-direction: row;
    height: 100%;
    background: var(--bg-surface);
    border-right: 1px solid var(--border);
    flex-shrink: 0;
  }

  /* Icon rail (narrow left strip) */
  .side-rail {
    width: 42px;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 8px 0;
    gap: 2px;
    border-right: 1px solid var(--border);
    flex-shrink: 0;
  }

  .rail-icon {
    display: flex; align-items: center; justify-content: center;
    width: 32px; height: 32px;
    border: none; background: none;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: 8px;
    transition: all 0.12s;
    opacity: 0.6;
  }
  .rail-icon:hover {
    background: var(--bg-hover);
    color: var(--text);
    opacity: 1;
  }
  .rail-icon.active {
    color: var(--text);
    opacity: 1;
    background: var(--bg-hover);
  }

  .rail-spacer { flex: 1; }

  .rail-divider {
    width: 20px; height: 1px;
    background: var(--border);
    margin: 4px 0;
  }

  /* Workspace tab in rail */
  .ws-tab { position: relative; }
  .ws-letter {
    display: flex; align-items: center; justify-content: center;
    width: 26px; height: 26px;
    border-radius: 7px;
    font-size: 12px; font-weight: 700;
    font-family: var(--font-sans);
    transition: all 0.12s;
  }
  .ws-tab.active .ws-letter {
    box-shadow: 0 0 0 1.5px currentColor;
  }

  .side-actions {
    display: flex; align-items: center; gap: 2px;
  }

  /* File panel (right of rail) */
  .side-panel {
    width: 200px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .side-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 10px 6px;
    flex-shrink: 0;
  }

  .side-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--text-muted);
  }

  .side-action-btn {
    display: flex; align-items: center; justify-content: center;
    width: 24px; height: 24px;
    border: none; background: none;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: 5px;
    transition: all 0.12s;
    opacity: 0.6;
  }
  .side-action-btn:hover {
    background: var(--bg-hover);
    color: var(--text);
    opacity: 1;
  }

  .side-files {
    flex: 1;
    overflow-y: auto;
    padding: 0 6px;
  }

  .side-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    font-size: 11.5px;
    opacity: 0.5;
  }


  /* ═══ Canvas ═══ */
  .canvas {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
    background: var(--bg);
    position: relative;
  }

  /* ═══ Tab bar ═══ */
  .tab-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 40px;
    padding: 0 8px 0 8px;
    flex-shrink: 0;
    z-index: 10;
    border-bottom: 1px solid var(--border);
    background: var(--bg-surface);
  }

  .tab-bar-left {
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    flex: 1;
    overflow: hidden;
  }

  .tab-sidebar-btn {
    flex-shrink: 0;
  }

  .tab-list {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .tab-list::-webkit-scrollbar { display: none; }

  .tab-item {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    font-size: 12px;
    font-weight: 450;
    color: var(--text-secondary);
    background: none;
    border: none;
    border-radius: 5px 5px 0 0;
    cursor: pointer;
    white-space: nowrap;
    position: relative;
    transition: color 0.15s, background 0.15s;
    height: 32px;
    flex-shrink: 0;
  }
  .tab-item:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
  .tab-item.active {
    color: var(--text-primary);
    background: var(--bg);
    box-shadow: inset 0 -2px 0 var(--accent);
  }

  .tab-name {
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tab-agent-icon {
    display: flex; align-items: center; justify-content: center;
    color: var(--accent);
    opacity: 0.6;
    flex-shrink: 0;
  }

  .tab-dot {
    width: 5px; height: 5px;
    border-radius: 50%;
    background: var(--accent);
    flex-shrink: 0;
  }

  .tab-close {
    font-size: 14px;
    line-height: 1;
    color: var(--text-muted);
    opacity: 0;
    cursor: pointer;
    padding: 0 2px;
    border-radius: 3px;
    transition: opacity 0.15s, color 0.15s;
    flex-shrink: 0;
  }
  .tab-item:hover .tab-close { opacity: 0.6; }
  .tab-item.active .tab-close { opacity: 0.5; }
  .tab-close:hover { opacity: 1 !important; color: var(--text-primary); }

  .tab-add {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    font-size: 16px;
    font-weight: 300;
    color: var(--text-muted);
    background: none;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    flex-shrink: 0;
    transition: color 0.15s, background 0.15s;
  }
  .tab-add:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .top-right {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    margin-left: 8px;
  }

  /* Shared button styles */
  .ghost-btn {
    display: flex; align-items: center; justify-content: center;
    width: 32px; height: 32px;
    border: none; background: none;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: all 0.12s;
  }

  .ghost-btn:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .pill-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 5px 10px;
    border: 1px solid var(--border);
    background: var(--bg-panel);
    color: var(--text-muted);
    font-size: 12px; font-weight: 600;
    font-family: var(--font-mono);
    border-radius: 20px;
    cursor: pointer;
    transition: all 0.15s;
    box-shadow: var(--shadow-sm);
  }

  .pill-btn:hover {
    border-color: var(--border-strong);
    color: var(--text);
  }

  .pill-btn.active {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
    box-shadow: 0 2px 8px rgba(99, 102, 241, 0.25);
  }

  /* ═══ Floating format toolbar (Excalidraw-style) ═══ */
  .fmt-toolbar {
    position: absolute;
    top: 52px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 4px;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-float);
  }

  .tb {
    display: flex; align-items: center; justify-content: center;
    min-width: 30px; height: 30px;
    border: none; background: none;
    color: var(--text-secondary);
    font-size: 12px; font-weight: 600;
    font-family: var(--font-sans);
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: all 0.1s;
    padding: 0 4px;
  }

  .tb:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .tb.on {
    background: var(--accent);
    color: #fff;
  }

  .tb.code {
    font-family: var(--font-mono);
    font-size: 14px;
    font-weight: 400;
  }

  .tb-sep {
    width: 1px; height: 18px;
    background: var(--border);
    margin: 0 2px;
    flex-shrink: 0;
  }

  .color-btn {
    position: relative;
  }

  /* ═══ Language Selector ═══ */
  .lang-backdrop {
    position: fixed; inset: 0; z-index: 99;
  }

  .lang-selector {
    position: fixed;
    z-index: 100;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-float);
    width: 200px;
    overflow: hidden;
  }

  .lang-input {
    width: 100%;
    padding: 10px 12px;
    border: none;
    border-bottom: 1px solid var(--border);
    background: transparent;
    color: var(--text);
    font-size: 13px;
    font-family: var(--font-mono);
    outline: none;
  }

  .lang-input::placeholder { color: var(--text-muted); }

  .lang-list {
    max-height: 200px;
    overflow-y: auto;
    padding: 4px;
  }

  .lang-item {
    display: block;
    width: 100%;
    padding: 6px 10px;
    border: none;
    background: none;
    color: var(--text-secondary);
    font-size: 12px;
    font-family: var(--font-mono);
    text-align: left;
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.08s;
  }

  .lang-item:hover {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .lang-empty {
    padding: 12px;
    text-align: center;
    color: var(--text-muted);
    font-size: 12px;
  }

  /* ═══ Editor surface ═══ */
  .editor-surface {
    flex: 1;
    overflow: hidden;
    position: relative;
    display: flex;
    flex-direction: column;
  }

  /* ═══ Empty State ═══ */
  .empty-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .empty-state-content {
    text-align: center;
    color: var(--text-muted);
  }
  .empty-state-icon {
    opacity: 0.15;
    margin-bottom: 16px;
  }
  .empty-state-text {
    font-size: 14px;
    font-family: var(--font-sans);
    margin-bottom: 16px;
  }
  .empty-state-shortcuts {
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 12px;
  }
  .shortcut-hint {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
  }
  .shortcut-hint kbd {
    display: inline-block;
    padding: 2px 6px;
    font-size: 11px;
    font-family: var(--font-mono);
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    min-width: 20px;
    text-align: center;
  }

  /* ═══ Search & Replace ═══ */
  .search-bar {
    position: absolute;
    top: 8px;
    right: 12px;
    z-index: 30;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-float);
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 320px;
  }
  .search-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .search-input {
    flex: 1;
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--text);
    font-size: 13px;
    font-family: var(--font-sans);
    outline: none;
    min-width: 0;
  }
  .search-input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-soft);
  }
  .search-input::placeholder { color: var(--text-muted); }
  .search-count {
    font-size: 11px;
    color: var(--text-muted);
    font-family: var(--font-mono);
    min-width: 36px;
    text-align: center;
    flex-shrink: 0;
  }
  .search-btn {
    display: flex; align-items: center; justify-content: center;
    width: 26px; height: 26px;
    border: none; background: none;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: all 0.1s;
    flex-shrink: 0;
    font-size: 11px;
    font-weight: 600;
  }
  .search-btn:hover {
    background: var(--bg-hover);
    color: var(--text);
  }
  .search-btn.on {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .replace-btn {
    width: auto;
    padding: 0 8px;
    font-size: 11px;
    font-family: var(--font-sans);
  }
  .replace-toggle svg {
    transition: transform 0.15s;
    transform: rotate(-90deg);
  }
  .replace-toggle.on svg {
    transform: rotate(0deg);
  }

  /* Search highlights */
  .rich-wrap :global(.search-highlight) {
    background: #fef08a;
    border-radius: 2px;
  }
  .rich-wrap :global(.search-highlight-active) {
    background: #fb923c;
    color: #fff;
    border-radius: 2px;
  }

  .is-hidden {
    position: absolute !important;
    width: 1px !important; height: 1px !important;
    overflow: hidden !important;
    opacity: 0 !important;
    pointer-events: none !important;
    clip: rect(0,0,0,0);
  }

  .rich-wrap {
    height: 100%;
    overflow-y: auto;
  }

  .rich-wrap :global(.prose-editor) {
    padding: 80px 60px 60px;
    max-width: 720px;
    margin: 0 auto;
    outline: none;
    min-height: 100%;
    font-family: var(--font-sans);
    font-size: 16px;
    line-height: 1.65;
    color: var(--text);
  }

  .rich-wrap :global(.prose-editor:focus) { outline: none; }

  /* Placeholder */
  .rich-wrap :global(.tiptap p.is-editor-empty:first-child::before) {
    content: attr(data-placeholder);
    float: left;
    color: var(--text-muted);
    pointer-events: none;
    height: 0;
    opacity: 0.6;
  }

  /* ── Typography ── */
  .rich-wrap :global(h1) {
    font-size: 1.875em; font-weight: 800;
    margin: 1.8em 0 0.5em; line-height: 1.1;
    letter-spacing: -0.03em;
  }
  .rich-wrap :global(h1:first-child) { margin-top: 0; }
  .rich-wrap :global(h2) {
    font-size: 1.375em; font-weight: 700;
    margin: 1.6em 0 0.4em; line-height: 1.2;
    letter-spacing: -0.02em;
  }
  .rich-wrap :global(h3) {
    font-size: 1.125em; font-weight: 600;
    margin: 1.4em 0 0.35em; line-height: 1.3;
    letter-spacing: -0.01em;
  }
  .rich-wrap :global(h4) {
    font-size: 1em; font-weight: 600;
    margin: 1.2em 0 0.3em;
    color: var(--text-secondary);
  }
  .rich-wrap :global(h5),
  .rich-wrap :global(h6) {
    font-size: 0.85em; font-weight: 700;
    margin: 1em 0 0.25em;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .rich-wrap :global(p) { margin: 0.5em 0; }

  .rich-wrap :global(a) {
    color: var(--accent);
    text-decoration: underline;
    text-decoration-color: rgba(99, 102, 241, 0.3);
    text-underline-offset: 2px;
    transition: text-decoration-color 0.15s;
  }
  .rich-wrap :global(a:hover) { text-decoration-color: var(--accent); }

  .rich-wrap :global(strong) { font-weight: 700; }
  .rich-wrap :global(em) { font-style: italic; }

  /* Inline code */
  .rich-wrap :global(code) {
    font-family: var(--font-mono);
    font-size: 0.85em;
    padding: 2px 7px;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 5px;
    color: #d946ef;
  }
  [data-theme="dark"] .rich-wrap :global(code) { color: #e879f9; }

  /* Code blocks */
  .rich-wrap :global(pre) {
    margin: 1.2em 0;
    padding: 20px 24px;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow-x: auto;
    position: relative;
  }
  .rich-wrap :global(pre code) {
    padding: 0; background: none; border: none;
    color: var(--text);
    font-size: 13px; line-height: 1.7; display: block;
  }

  /* Syntax — One Dark Pro */
  .rich-wrap :global(.hljs-keyword) { color: #c678dd; }
  .rich-wrap :global(.hljs-string) { color: #98c379; }
  .rich-wrap :global(.hljs-number) { color: #d19a66; }
  .rich-wrap :global(.hljs-function),
  .rich-wrap :global(.hljs-title) { color: #61afef; }
  .rich-wrap :global(.hljs-comment) { color: #5c6370; font-style: italic; }
  .rich-wrap :global(.hljs-built_in),
  .rich-wrap :global(.hljs-type) { color: #e6c07b; }
  .rich-wrap :global(.hljs-tag),
  .rich-wrap :global(.hljs-name),
  .rich-wrap :global(.hljs-variable) { color: #e06c75; }
  .rich-wrap :global(.hljs-attr) { color: #d19a66; }
  .rich-wrap :global(.hljs-meta) { color: #61afef; }

  /* Blockquotes */
  .rich-wrap :global(blockquote) {
    margin: 1.2em 0;
    padding: 0.75em 1.4em;
    border-left: 3px solid var(--accent);
    background: var(--accent-soft);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    color: var(--text-secondary);
    font-style: italic;
  }
  .rich-wrap :global(blockquote p) { margin: 0.2em 0; }

  /* Lists */
  .rich-wrap :global(ul),
  .rich-wrap :global(ol) { margin: 0.5em 0; padding-left: 1.5em; }
  .rich-wrap :global(li) { margin: 0.15em 0; }
  .rich-wrap :global(li p) { margin: 0.15em 0; }

  /* Task lists */
  .rich-wrap :global(ul[data-type="taskList"]) { list-style: none; padding-left: 0; }
  .rich-wrap :global(ul[data-type="taskList"] li) { display: flex; align-items: flex-start; gap: 8px; }
  .rich-wrap :global(ul[data-type="taskList"] li label) { flex-shrink: 0; margin-top: 4px; }
  .rich-wrap :global(ul[data-type="taskList"] li label input[type="checkbox"]) {
    width: 16px; height: 16px; accent-color: var(--accent); cursor: pointer; border-radius: 4px;
  }
  .rich-wrap :global(ul[data-type="taskList"] li[data-checked="true"]) {
    text-decoration: line-through; color: var(--text-muted);
  }

  /* HR */
  .rich-wrap :global(hr) {
    margin: 2.5em auto;
    border: none;
    height: 1px;
    width: 100%;
    background: linear-gradient(to right, transparent, var(--border-strong), transparent);
  }

  /* Tables */
  .rich-wrap :global(table) { width: 100%; margin: 1em 0; border-collapse: collapse; }
  .rich-wrap :global(th), .rich-wrap :global(td) { padding: 10px 14px; border: 1px solid var(--border); text-align: left; }
  .rich-wrap :global(th) { font-weight: 600; background: var(--bg-surface); }
  .rich-wrap :global(.selectedCell) { background: var(--accent-soft); }

  .rich-wrap :global(s), .rich-wrap :global(del) { text-decoration: line-through; color: var(--text-muted); }
  .rich-wrap :global(mark) { background: #fef3c7; padding: 1px 3px; border-radius: 2px; }
  [data-theme="dark"] .rich-wrap :global(mark) { background: #78350f; color: #fef3c7; }
  .rich-wrap :global(img) { max-width: 100%; border-radius: var(--radius); }
  .rich-wrap :global(.ProseMirror-selectednode) { outline: 2px solid var(--accent); border-radius: 4px; }

  /* ═══ Source editor ═══ */
  .source-wrap {
    width: 100%; height: 100%;
    padding: 100px 60px 60px;
    max-width: 740px;
    margin: 0 auto; display: block;
    border: none; outline: none; resize: none;
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 14px; line-height: 1.8;
    tab-size: 2;
  }
  .source-wrap::placeholder { color: var(--text-muted); opacity: 0.5; }

  /* ═══ Status bar ═══ */
  .status-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 16px;
    flex-shrink: 0;
    font-size: 11px;
    color: var(--text-muted);
    background: var(--bg);
    border-top: 1px solid var(--border);
  }

  .dim { opacity: 0.3; }
  .path { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .grow { flex: 1; }
  .tag {
    font-size: 9px; font-weight: 700;
    letter-spacing: 0.6px; text-transform: uppercase;
    padding: 2px 7px;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 4px;
  }

  /* ═══ Presentation / Zen Mode ═══ */
  .present-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: var(--bg);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .present-controls {
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 1001;
    opacity: 0;
    transition: opacity 0.3s;
  }

  .present-overlay:hover .present-controls {
    opacity: 1;
  }

  .present-close {
    display: flex; align-items: center; justify-content: center;
    width: 40px; height: 40px;
    border: 1px solid var(--border);
    background: var(--bg-panel);
    color: var(--text-muted);
    cursor: pointer;
    border-radius: 50%;
    transition: all 0.15s;
    box-shadow: var(--shadow-md);
  }

  .present-close:hover {
    color: var(--text);
    background: var(--bg-surface);
    transform: scale(1.05);
  }

  .present-content {
    flex: 1;
    overflow-y: auto;
    display: flex;
    justify-content: center;
    padding: 80px 40px;
  }

  .present-article {
    max-width: 720px;
    width: 100%;
    font-family: var(--font-sans);
    font-size: 18px;
    line-height: 1.9;
    color: var(--text);
    animation: fadeUp 0.5s ease;
  }

  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(20px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* Presentation typography (larger, more spacious) */
  .present-article :global(h1) {
    font-size: 2.8em; font-weight: 800;
    margin: 0.8em 0 0.5em; line-height: 1.1;
    letter-spacing: -0.04em;
    background: linear-gradient(135deg, var(--text), var(--accent));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }
  .present-article :global(h2) {
    font-size: 1.8em; font-weight: 700;
    margin: 1.5em 0 0.4em; line-height: 1.2;
    letter-spacing: -0.03em;
  }
  .present-article :global(h3) {
    font-size: 1.4em; font-weight: 600;
    margin: 1.3em 0 0.35em; line-height: 1.3;
  }
  .present-article :global(p) { margin: 0.6em 0; }
  .present-article :global(a) {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .present-article :global(code) {
    font-family: var(--font-mono);
    font-size: 0.85em;
    padding: 3px 8px;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: 5px;
  }
  .present-article :global(pre) {
    margin: 1.5em 0;
    padding: 24px 28px;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }
  .present-article :global(pre code) {
    padding: 0; background: none; border: none;
    font-size: 14px; line-height: 1.7; display: block;
  }
  .present-article :global(blockquote) {
    margin: 1.2em 0;
    padding: 0.8em 1.6em;
    border-left: 4px solid var(--accent);
    background: var(--accent-soft);
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    font-size: 1.05em;
    font-style: italic;
  }
  .present-article :global(ul),
  .present-article :global(ol) { margin: 0.6em 0; padding-left: 1.5em; }
  .present-article :global(li) { margin: 0.25em 0; }
  .present-article :global(hr) { margin: 3em auto; border: none; width: 80px; border-top: 2px solid var(--border); }
  .present-article :global(table) { width: 100%; margin: 1.2em 0; border-collapse: collapse; }
  .present-article :global(th), .present-article :global(td) { padding: 12px 16px; border: 1px solid var(--border); }
  .present-article :global(th) { font-weight: 600; background: var(--bg-surface); }
  .present-article :global(mark) { background: #fef3c7; padding: 2px 4px; border-radius: 3px; }
  .present-article :global(img) { max-width: 100%; border-radius: var(--radius); margin: 1em 0; }
  .present-article :global(strong) { font-weight: 700; }

  /* Syntax highlighting in presentation */
  .present-article :global(.hljs-keyword) { color: #c678dd; }
  .present-article :global(.hljs-string) { color: #98c379; }
  .present-article :global(.hljs-number) { color: #d19a66; }
  .present-article :global(.hljs-function),
  .present-article :global(.hljs-title) { color: #61afef; }
  .present-article :global(.hljs-comment) { color: #5c6370; font-style: italic; }
  .present-article :global(.hljs-built_in),
  .present-article :global(.hljs-type) { color: #e6c07b; }
  .present-article :global(.hljs-tag),
  .present-article :global(.hljs-name),
  .present-article :global(.hljs-variable) { color: #e06c75; }
  .present-article :global(.hljs-attr) { color: #d19a66; }

  /* ═══ Mermaid Diagram Rendering ═══ */
  /* Hide the code block when preview is showing */
  .rich-wrap :global(.mermaid-code-hidden) {
    display: none !important;
  }
  /* Preview widget inserted by decoration */
  .rich-wrap :global(.mermaid-preview-widget) {
    padding: 24px;
    background: var(--bg-surface);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    cursor: pointer;
    transition: border-color 0.15s;
    display: flex;
    justify-content: center;
    overflow-x: auto;
    min-height: 80px;
    align-items: center;
    margin: 1em 0;
    user-select: none;
  }
  .rich-wrap :global(.mermaid-preview-widget:hover) {
    border-color: var(--accent);
  }
  .rich-wrap :global(.mermaid-preview-widget svg) {
    max-width: 100%;
    height: auto;
  }
  .rich-wrap :global(.mermaid-loading) {
    color: var(--text-muted);
    font-size: 13px;
    font-style: italic;
  }
  .rich-wrap :global(.mermaid-error) {
    color: #ef4444;
    font-size: 13px;
    font-style: italic;
  }

  /* Mermaid widget toolbar */
  .rich-wrap :global(.mermaid-widget-toolbar) {
    display: flex;
    gap: 4px;
    justify-content: flex-end;
    padding: 0 0 8px;
  }
  .rich-wrap :global(.mermaid-widget-btn) {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border: 1px solid var(--border);
    background: var(--bg-panel);
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 500;
    font-family: var(--font-sans);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.12s;
  }
  .rich-wrap :global(.mermaid-widget-btn:hover) {
    background: var(--bg-hover);
    color: var(--text);
    border-color: var(--border-strong);
  }
  .rich-wrap :global(.mermaid-svg-container) {
    display: flex;
    justify-content: center;
  }

  /* Mermaid in presentation mode */
  .present-article :global(.mermaid-present-render) {
    display: flex;
    justify-content: center;
    padding: 24px 0;
    margin: 1.2em 0;
  }
  .present-article :global(.mermaid-present-render svg) {
    max-width: 100%;
    height: auto;
  }

  /* ═══ Dropdown wrapper (shared by heading & table) ═══ */
  .tb-dropdown-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }

  /* ── Heading dropdown ── */
  .heading-select {
    gap: 4px;
    min-width: 58px;
    padding: 0 8px;
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
  }

  .heading-menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    z-index: 40;
    min-width: 180px;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-float);
    padding: 4px;
    overflow: hidden;
  }

  .heading-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    width: 100%;
    padding: 7px 10px;
    border: none;
    background: none;
    color: var(--text-secondary);
    font-size: 12px;
    font-family: var(--font-sans);
    text-align: left;
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: all 0.08s;
  }

  .heading-item:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .heading-item.on {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .hi-label {
    font-weight: 600;
    flex-shrink: 0;
  }

  .hi-preview {
    color: var(--text-muted);
    opacity: 0.6;
    text-align: right;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── Table grid picker (Confluence-style) ── */
  .table-menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 40;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-float);
    padding: 10px;
  }

  .table-menu-label {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-secondary);
    margin-bottom: 6px;
    text-align: center;
    min-height: 16px;
  }

  .table-grid {
    display: grid;
    gap: 3px;
  }

  .table-cell-btn {
    width: 20px;
    height: 20px;
    border: 1.5px solid var(--border);
    background: var(--bg-surface);
    border-radius: 3px;
    cursor: pointer;
    transition: all 0.06s;
    padding: 0;
  }

  .table-cell-btn.highlighted {
    background: var(--accent-soft);
    border-color: var(--accent);
  }

  .table-cell-btn:hover {
    border-color: var(--accent);
  }

  .table-menu-hint {
    font-size: 10px;
    color: var(--text-muted);
    text-align: center;
    margin-top: 6px;
    font-weight: 500;
  }

  /* ═══ Table controls ═══ */
  .rich-wrap :global(.tableWrapper) {
    position: relative;
    margin: 1em 0;
    padding: 24px 0 8px 28px;
  }
  .rich-wrap :global(.column-resize-handle) {
    background: var(--accent);
    width: 2px !important;
    pointer-events: none;
  }
  .rich-wrap :global(.resize-cursor) {
    cursor: col-resize;
  }

  /* Widget wrapper hidden — handles are injected into .tableWrapper */
  .rich-wrap :global(.table-ctrl-wrap) {
    display: none;
  }

  /* ── Hover highlights ── */
  .rich-wrap :global(.row-highlight td),
  .rich-wrap :global(.row-highlight th) {
    background: rgba(239, 68, 68, 0.06) !important;
  }
  .rich-wrap :global(.col-highlight) {
    background: rgba(239, 68, 68, 0.06) !important;
  }

  /* ── Handle buttons (inside .tableWrapper) ── */
  .rich-wrap :global(.tc-handle) {
    position: absolute;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border: 1px solid var(--border-strong);
    background: var(--bg-panel);
    color: var(--text-muted);
    font-size: 13px;
    font-weight: 600;
    line-height: 1;
    border-radius: 50%;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s, background 0.12s, color 0.12s, border-color 0.12s;
    z-index: 5;
    padding: 0;
    font-family: var(--font-sans);
    pointer-events: none;
  }
  .rich-wrap :global(.tableWrapper:hover) :global(.tc-handle),
  .rich-wrap :global(.tableWrapper.has-focus) :global(.tc-handle) {
    opacity: 0.55;
    pointer-events: auto;
  }
  .rich-wrap :global(.tc-handle:hover) {
    opacity: 1 !important;
    transform: scale(1.15);
  }

  /* Add (+) */
  .rich-wrap :global(.tc-add:hover) {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
  }

  /* Delete (−) */
  .rich-wrap :global(.tc-del:hover) {
    border-color: #ef4444;
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
  }
</style>
