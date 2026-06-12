/* ===================================================
   Smart Inventory — script.js
   All fetch/CRUD operations + UI logic
   =================================================== */

'use strict';

// ── State ──────────────────────────────────────────
let allItems = [];          // master list from server
let sortKey  = 'name';
let sortAsc  = true;
let editingId = null;       // null = add mode, string = edit mode

// ── DOM refs ──────────────────────────────────────
const $ = id => document.getElementById(id);

// ── Init ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadItems();
  loadStats();
  bindTableSortHeaders();
  bindForm();
  bindSearch();
  bindModal();
  setInterval(loadStats, 30_000); // refresh stats every 30 s
});

// ── API Helpers ───────────────────────────────────
async function api(url, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!data.success) throw new Error(data.message || 'Unknown error');
  return data;
}

// ── Load & render items ───────────────────────────
async function loadItems() {
  try {
    const data = await api('/get_items');
    allItems = data.items;
    renderTable();
    refreshSupplierFilter();
  } catch (e) {
    toast('Failed to load items: ' + e.message, 'error');
  }
}

async function loadStats() {
  try {
    const s = await api('/stats');
    $('stat-total').textContent   = s.total_items;
    $('stat-low').textContent     = s.low_stock;
    $('stat-out').textContent     = s.out_of_stock;
    $('stat-value').textContent   = '$' + s.total_value.toLocaleString('en-US', { minimumFractionDigits: 2 });
    $('stat-supp').textContent    = s.unique_suppliers;
  } catch { /* silent */ }
}

// ── Render Table ─────────────────────────────────
function renderTable() {
  const query    = ($('search-input').value || '').toLowerCase();
  const supplier = $('filter-supplier').value || '';

  let rows = allItems.filter(item => {
    const matchSearch   = !query || item.name.toLowerCase().includes(query)
                                  || item.supplier.toLowerCase().includes(query)
                                  || item.id.toLowerCase().includes(query);
    const matchSupplier = !supplier || item.supplier === supplier;
    return matchSearch && matchSupplier;
  });

  // Sort
  rows.sort((a, b) => {
    let va = a[sortKey], vb = b[sortKey];
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return sortAsc ? -1 : 1;
    if (va > vb) return sortAsc ?  1 : -1;
    return 0;
  });

  const tbody = $('inventory-body');

  if (rows.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="8">
        <div class="empty-state">
          <div class="empty-icon">📦</div>
          <p>No items found. Add some inventory to get started.</p>
        </div>
      </td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(item => `
    <tr id="row-${item.id}" class="item-row">
      <td class="td-id">${item.id}</td>
      <td class="td-name">${escHtml(item.name)}</td>
      <td class="td-supplier">${escHtml(item.supplier)}</td>
      <td class="td-qty" style="color:${qtyColor(item.quantity)}">${item.quantity}</td>
      <td class="td-price">$${parseFloat(item.price).toFixed(2)}</td>
      <td>${statusBadge(item.status)}</td>
      <td class="td-date">${formatDate(item.last_updated)}</td>
      <td class="td-actions">
        <button class="btn btn-edit" onclick="openEdit('${item.id}')">✎ Edit</button>
        <button class="btn btn-delete" onclick="deleteItem('${item.id}')">✕ Del</button>
      </td>
    </tr>
  `).join('');

  // Update visible count badge
  $('item-count').textContent = rows.length + ' item' + (rows.length !== 1 ? 's' : '');
}

// ── Supplier filter population ────────────────────
function refreshSupplierFilter() {
  const sel = $('filter-supplier');
  const cur = sel.value;
  const suppliers = [...new Set(allItems.map(i => i.supplier))].sort();
  sel.innerHTML = '<option value="">All Suppliers</option>'
    + suppliers.map(s => `<option value="${escHtml(s)}">${escHtml(s)}</option>`).join('');
  if (cur) sel.value = cur;
}

// ── Table sort bindings ───────────────────────────
function bindTableSortHeaders() {
  document.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (sortKey === key) {
        sortAsc = !sortAsc;
      } else {
        sortKey = key;
        sortAsc = true;
      }
      // Update header classes
      document.querySelectorAll('th[data-sort]').forEach(h => {
        h.classList.remove('active-sort');
        h.querySelector('.sort-icon').textContent = '⇅';
      });
      th.classList.add('active-sort');
      th.querySelector('.sort-icon').textContent = sortAsc ? '↑' : '↓';
      renderTable();
    });
  });
}

// ── Search & Filter ───────────────────────────────
function bindSearch() {
  $('search-input').addEventListener('input', renderTable);
  $('filter-supplier').addEventListener('change', renderTable);
}

// ── Form (Add) ────────────────────────────────────
function bindForm() {
  $('add-form').addEventListener('submit', async e => {
    e.preventDefault();
    const payload = formPayload();
    try {
      const data = await api('/add_item', 'POST', payload);
      toast(data.message, 'success');
      allItems.push(data.item);
      renderTable();
      refreshSupplierFilter();
      loadStats();
      e.target.reset();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  $('clear-btn').addEventListener('click', () => {
    $('add-form').reset();
  });
}

function formPayload(prefix = '') {
  return {
    name:     $(prefix + 'f-name').value.trim(),
    supplier: $(prefix + 'f-supplier').value.trim(),
    quantity: $(prefix + 'f-quantity').value,
    price:    $(prefix + 'f-price').value
  };
}

// ── Delete ────────────────────────────────────────
async function deleteItem(id) {
  if (!confirm('Delete this item? This action cannot be undone.')) return;
  try {
    const data = await api(`/delete_item/${id}`, 'DELETE');
    toast(data.message, 'success');
    allItems = allItems.filter(i => i.id !== id);
    renderTable();
    refreshSupplierFilter();
    loadStats();
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── Edit Modal ────────────────────────────────────
function bindModal() {
  $('modal-close').addEventListener('click', closeModal);
  $('modal-overlay').addEventListener('click', e => {
    if (e.target === $('modal-overlay')) closeModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });
  $('edit-form').addEventListener('submit', async e => {
    e.preventDefault();
    const payload = {
      id:       editingId,
      name:     $('e-f-name').value.trim(),
      supplier: $('e-f-supplier').value.trim(),
      quantity: $('e-f-quantity').value,
      price:    $('e-f-price').value
    };
    try {
      const data = await api('/update_item', 'PUT', payload);
      toast(data.message, 'success');
      const idx = allItems.findIndex(i => i.id === editingId);
      if (idx !== -1) allItems[idx] = data.item;
      closeModal();
      renderTable();
      refreshSupplierFilter();
      loadStats();
      // Highlight updated row
      setTimeout(() => {
        const row = $('row-' + editingId);
        if (row) row.classList.add('highlight');
      }, 50);
    } catch (err) {
      toast(err.message, 'error');
    }
  });
}

function openEdit(id) {
  const item = allItems.find(i => i.id === id);
  if (!item) return;
  editingId = id;
  $('e-f-name').value     = item.name;
  $('e-f-supplier').value = item.supplier;
  $('e-f-quantity').value = item.quantity;
  $('e-f-price').value    = item.price;
  $('modal-overlay').classList.add('open');
  $('e-f-name').focus();
}

function closeModal() {
  $('modal-overlay').classList.remove('open');
  editingId = null;
  $('edit-form').reset();
}

// ── Toast ─────────────────────────────────────────
function toast(msg, type = 'info') {
  const icons = { success: '✔', error: '✖', warning: '⚠', info: 'ℹ' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type] || icons.info}</span><span>${escHtml(msg)}</span>`;
  $('toast-container').appendChild(el);
  setTimeout(() => {
    el.style.animation = 'slideOut 0.25s ease forwards';
    setTimeout(() => el.remove(), 260);
  }, 3500);
}

// ── Helpers ───────────────────────────────────────
function statusBadge(status) {
  const map = {
    'In Stock':     'badge-in-stock',
    'Low Stock':    'badge-low-stock',
    'Out of Stock': 'badge-out'
  };
  return `<span class="badge ${map[status] || ''}">${status}</span>`;
}

function qtyColor(q) {
  if (q === 0) return 'var(--danger)';
  if (q < 5)  return 'var(--warning)';
  return 'var(--success)';
}

function formatDate(iso) {
  if (!iso) return '—';
  return iso.replace('T', ' ').slice(0, 16);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
