<script>
  let { onSelect = () => {}, onClose = () => {}, position = { x: 0, y: 0 } } = $props();

  const colors = [
    { label: 'Default', value: null, bg: 'transparent' },
    { label: 'Red', value: '#fecaca', bg: '#fecaca' },
    { label: 'Orange', value: '#fed7aa', bg: '#fed7aa' },
    { label: 'Yellow', value: '#fef08a', bg: '#fef08a' },
    { label: 'Green', value: '#bbf7d0', bg: '#bbf7d0' },
    { label: 'Blue', value: '#bfdbfe', bg: '#bfdbfe' },
    { label: 'Purple', value: '#e9d5ff', bg: '#e9d5ff' },
    { label: 'Pink', value: '#fbcfe8', bg: '#fbcfe8' },
  ];

  const textColors = [
    { label: 'Default', value: null, color: 'var(--text)' },
    { label: 'Red', value: '#ef4444', color: '#ef4444' },
    { label: 'Orange', value: '#f97316', color: '#f97316' },
    { label: 'Green', value: '#22c55e', color: '#22c55e' },
    { label: 'Blue', value: '#3b82f6', color: '#3b82f6' },
    { label: 'Purple', value: '#a855f7', color: '#a855f7' },
  ];

  function handleBg(c) { onSelect('highlight', c); onClose(); }
  function handleText(c) { onSelect('textColor', c); onClose(); }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="backdrop" onclick={onClose} role="presentation"></div>
<div class="picker" style="left: {position.x}px; top: {position.y}px;">
  <div class="section">
    <div class="section-label">Highlight</div>
    <div class="swatches">
      {#each colors as c}
        <button class="swatch" style="background: {c.bg}; {c.value ? '' : 'border: 1.5px dashed var(--border-strong);'}" title={c.label} onclick={() => handleBg(c.value)}>
          {#if !c.value}<span class="clear-x">✕</span>{/if}
        </button>
      {/each}
    </div>
  </div>
  <div class="section">
    <div class="section-label">Text color</div>
    <div class="swatches">
      {#each textColors as c}
        <button class="swatch text-swatch" title={c.label} onclick={() => handleText(c.value)}>
          <span style="color: {c.color}; font-weight: 700; font-size: 14px;">A</span>
        </button>
      {/each}
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed; inset: 0; z-index: 99;
  }
  .picker {
    position: fixed; z-index: 100;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: var(--shadow-float);
    padding: 12px;
    min-width: 200px;
  }
  .section { margin-bottom: 8px; }
  .section:last-child { margin-bottom: 0; }
  .section-label {
    font-size: 10px; font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--text-muted);
    margin-bottom: 6px;
  }
  .swatches { display: flex; gap: 5px; flex-wrap: wrap; }
  .swatch {
    width: 26px; height: 26px;
    border-radius: 6px;
    border: 1px solid var(--border);
    cursor: pointer;
    transition: all 0.1s;
    display: flex; align-items: center; justify-content: center;
  }
  .swatch:hover { transform: scale(1.15); box-shadow: var(--shadow-sm); }
  .text-swatch { background: var(--bg-surface); }
  .clear-x { font-size: 9px; color: var(--text-muted); }
</style>
