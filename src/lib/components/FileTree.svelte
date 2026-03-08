<script>
  import FileTree from './FileTree.svelte';

  let { entries = [], onFileSelect, currentFile = '', onExpandDir, expandedPaths = new Set() } = $props();

  let expandedDirs = $state(new Set());

  function isExpanded(path) {
    return expandedDirs.has(path) || expandedPaths.has(path);
  }

  function toggleDir(path) {
    const next = new Set(expandedDirs);
    if (next.has(path)) {
      next.delete(path);
      // Also remove from expandedPaths if present (user manually collapsed)
    } else {
      next.add(path);
    }
    expandedDirs = next;
  }

  function handleFileClick(entry) {
    if (entry.is_dir) {
      const wasExpanded = isExpanded(entry.path);
      toggleDir(entry.path);
      // If we just expanded and children are empty, trigger lazy load
      if (!wasExpanded && entry.children && entry.children.length === 0) {
        onExpandDir?.(entry.path);
      }
    } else {
      onFileSelect?.(entry.path);
    }
  }

  function getFileType(entry) {
    if (entry.is_dir) return 'dir';
    const name = entry.name.toLowerCase();
    if (name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.mdx')) return 'markdown';
    if (name.endsWith('.txt') || name.endsWith('.log') || name.endsWith('.rst')) return 'text';
    if (name.endsWith('.json') || name.endsWith('.yaml') || name.endsWith('.yml') || name.endsWith('.toml') || name.endsWith('.xml')) return 'config';
    if (name.endsWith('.js') || name.endsWith('.ts') || name.endsWith('.svelte') || name.endsWith('.jsx') || name.endsWith('.tsx') || name.endsWith('.vue')) return 'code';
    if (name.endsWith('.css') || name.endsWith('.scss') || name.endsWith('.less')) return 'style';
    if (name.endsWith('.html') || name.endsWith('.htm')) return 'html';
    if (name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.gif') || name.endsWith('.svg') || name.endsWith('.webp') || name.endsWith('.ico')) return 'image';
    if (name.endsWith('.rs')) return 'rust';
    if (name.endsWith('.py')) return 'python';
    if (name.endsWith('.go')) return 'code';
    if (name.endsWith('.sh') || name.endsWith('.bash') || name.endsWith('.zsh')) return 'code';
    if (name.startsWith('.') || name.endsWith('.lock') || name.endsWith('.env')) return 'dotfile';
    return 'default';
  }

  function getFileIcon(entry) {
    if (entry.is_dir) {
      return isExpanded(entry.path)
        ? '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 4.5h5l1.5 1.5H14v7H2V4.5z" stroke="currentColor" stroke-width="1.1" fill="currentColor" fill-opacity="0.1" stroke-linejoin="round"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 4.5h5l1.5 1.5H14v7H2V4.5z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>';
    }
    const type = getFileType(entry);
    switch (type) {
      case 'markdown':
        // Bold down-arrow + line (markdown symbol)
        return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="1.5" rx="1.5" width="12" height="13" stroke="currentColor" stroke-width="1.1"/><path d="M5 7v3.5l1.5-2 1.5 2V7" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/><path d="M11 7v2l-1.2 1.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      case 'text':
        return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3.5 2h6l3 3v9h-9V2z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/><path d="M6 7h4M6 9.5h3M6 12h2" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/></svg>';
      case 'config':
        // Doc with clear {} brackets
        return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3.5 2h6l3 3v9h-9V2z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/><path d="M6.5 7C5.8 7 5.5 7.5 5.5 8v.5c0 .3-.3.5-.7.5.4 0 .7.2.7.5v.5c0 .5.3 1 1 1" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.5 7c.7 0 1 .5 1 1v.5c0 .3.3.5.7.5-.4 0-.7.2-.7.5v.5c0 .5-.3 1-1 1" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      case 'code':
        // Doc with bold angle brackets
        return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3.5 2h6l3 3v9h-9V2z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/><path d="M6.5 8l-2 1.5 2 1.5M9.5 8l2 1.5-2 1.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      case 'style':
        // Doc with # hash (CSS)
        return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3.5 2h6l3 3v9h-9V2z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/><path d="M6.5 8h3M6.5 10h3M7.5 7v4M9 7v4" stroke="currentColor" stroke-width="0.8" stroke-linecap="round"/></svg>';
      case 'html':
        return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3.5 2h6l3 3v9h-9V2z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/><path d="M5.5 8l2.5 3 2.5-3" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      case 'image':
        return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3.5 2h6l3 3v9h-9V2z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/><circle cx="7" cy="7.5" r="1.3" stroke="currentColor" stroke-width="0.9"/><path d="M4.5 13l2.5-3 1.5 1.5 2-2.5 2 3" stroke="currentColor" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      case 'rust':
        return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3.5 2h6l3 3v9h-9V2z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/><path d="M6.5 8h3M6.5 10h1.5" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>';
      case 'python':
        return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3.5 2h6l3 3v9h-9V2z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/><path d="M7 7.5v1.5c0 .5.5 1 1 1h1M9 11v-1.5c0-.5-.5-1-1-1H7" stroke="currentColor" stroke-width="0.9" stroke-linecap="round"/></svg>';
      case 'dotfile':
        return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3.5 2h6l3 3v9h-9V2z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/><circle cx="8" cy="9" r="1.5" stroke="currentColor" stroke-width="0.9"/></svg>';
      default:
        return '<svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3.5 2h6l3 3v9h-9V2z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/><path d="M9.5 2v3h3" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>';
    }
  }
</script>

<div class="file-tree">
  {#each entries as entry}
    <button
      class="tree-item"
      class:is-dir={entry.is_dir}
      class:is-active={entry.path === currentFile}
      class:is-expanded={isExpanded(entry.path)}
      onclick={() => handleFileClick(entry)}
    >
      <span class="tree-icon" data-filetype={getFileType(entry)}>{@html getFileIcon(entry)}</span>
      <span class="tree-name">{entry.name}</span>
    </button>
    {#if entry.is_dir && isExpanded(entry.path) && entry.children}
      <div class="tree-children">
        {#if entry.children.length === 0}
          <div class="tree-loading">Loading...</div>
        {:else}
          <FileTree entries={entry.children} {onFileSelect} {currentFile} {onExpandDir} {expandedPaths} />
        {/if}
      </div>
    {/if}
  {/each}
</div>

<style>
  .file-tree {
    user-select: none;
  }

  .tree-item {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 3px 10px;
    border: none;
    background: none;
    color: var(--text-secondary);
    font-family: var(--font-sans);
    font-size: 12.5px;
    cursor: pointer;
    text-align: left;
    border-radius: 5px;
    transition: all 0.08s;
  }

  .tree-item:hover {
    background: var(--bg-hover);
    color: var(--text);
  }

  .tree-item.is-active {
    background: var(--accent-soft);
    color: var(--accent);
  }

  .tree-item.is-dir {
    font-weight: 500;
    color: var(--text);
  }

  .tree-icon {
    flex-shrink: 0;
    width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
  }

  .tree-item.is-dir .tree-icon {
    color: var(--accent);
    opacity: 0.8;
  }

  .tree-item.is-active .tree-icon {
    color: var(--accent);
  }

  /* File type color tinting */
  .tree-icon[data-filetype="markdown"] { color: #6366f1; }
  .tree-icon[data-filetype="code"] { color: #22c55e; }
  .tree-icon[data-filetype="config"] { color: #eab308; }
  .tree-icon[data-filetype="style"] { color: #a855f7; }
  .tree-icon[data-filetype="html"] { color: #f97316; }
  .tree-icon[data-filetype="image"] { color: #ec4899; }
  .tree-icon[data-filetype="rust"] { color: #f97316; }
  .tree-icon[data-filetype="python"] { color: #3b82f6; }
  .tree-icon[data-filetype="dotfile"] { color: var(--text-muted); }

  .tree-item.is-active .tree-icon[data-filetype] {
    color: var(--accent);
  }

  .tree-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tree-children {
    padding-left: 12px;
  }

  .tree-loading {
    padding: 3px 10px;
    font-size: 11px;
    color: var(--text-muted);
    font-style: italic;
  }
</style>
