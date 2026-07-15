function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

const HISAB_EXCEL_PDF_MAX_BYTES = 6 * 1024 * 1024;
const HISAB_EXCEL_PDF_MAX_LABEL = '6 MB';
const FIREBASE_SAFE_DATA_URL_BYTES = 9 * 1024 * 1024;

function formatFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} bytes`;
}

function getUtf8Size(value) {
  return new Blob([String(value || '')]).size;
}

function sanitizeOversizedHisabExcelPdfs(data = appData) {
  let removed = 0;
  (data.sales || []).forEach(entry => {
    const files = entry?.supportingFiles?.hisabExcelPdf;
    if (!Array.isArray(files) || !files.length) return;
    entry.supportingFiles.hisabExcelPdf = files.map(file => {
      if (!file?.dataUrl || getUtf8Size(file.dataUrl) <= FIREBASE_SAFE_DATA_URL_BYTES) return file;
      removed += 1;
      return {
        name: file.name || 'Hisabexcel.pdf',
        type: file.type || 'application/pdf',
        size: file.size || 0,
        uploadedAt: file.uploadedAt || '',
        cloudSkipped: true,
        note: `PDF removed from cloud sync because it exceeded Firebase file-size limit. Upload a PDF under ${HISAB_EXCEL_PDF_MAX_LABEL}.`
      };
    });
  });
  return removed;
}

async function handleSalesSupportUpload(field, input) {
  const files = Array.from(input.files || []);
  if (!SALES_SUPPORT_FIELDS[field] || !files.length) return;
  salesSupportFiles[field] = Array.isArray(salesSupportFiles[field]) ? salesSupportFiles[field] : [];
  let attached = 0;
  const rejected = [];
  for (const file of files) {
    const isPdfField = field === 'hisabExcelPdf';
    const isAllowed = isPdfField ? (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')) : file.type.startsWith('image/');
    if (!isAllowed) continue;
    if (isPdfField && file.size > HISAB_EXCEL_PDF_MAX_BYTES) {
      rejected.push(`${file.name || 'Hisabexcel.pdf'} (${formatFileSize(file.size)})`);
      continue;
    }
    const dataUrl = await readFileAsDataUrl(file);
    const extension = isPdfField ? 'pdf' : 'jpg';
    salesSupportFiles[field].push({
      name: file.name || `${field}_${Date.now()}.${extension}`,
      type: file.type || (isPdfField ? 'application/pdf' : 'image/jpeg'),
      size: file.size,
      uploadedAt: new Date().toISOString(),
      dataUrl
    });
    attached += 1;
  }
  input.value = '';
  if (!attached) {
    if (rejected.length) {
      showAlert(`Hisab Excel PDF is too large for cloud sync. Maximum allowed is ${HISAB_EXCEL_PDF_MAX_LABEL}. Please compress/scan smaller and upload again. Rejected: ${rejected.join(', ')}`, 'warning');
    } else {
      showAlert(`No valid ${field === 'hisabExcelPdf' ? 'PDF' : 'image'} file selected for ${SALES_SUPPORT_FIELDS[field]}.`, 'warning');
    }
    return;
  }
  showAlert(`${attached} supporting file(s) attached for ${SALES_SUPPORT_FIELDS[field]}.`, 'success');
  if (rejected.length) showAlert(`Some PDF files were skipped because they are above ${HISAB_EXCEL_PDF_MAX_LABEL}: ${rejected.join(', ')}`, 'warning');
  if (currentSalesDetailField === field) renderSalesSupportPreview(field);
  if (field === 'hisabExcelPdf') renderHisabExcelPdfPreview();
}

function renderHisabExcelPdfPreview() {
  const preview = document.getElementById('hisabExcelPdfPreview');
  if (!preview) return;
  const files = salesSupportFiles.hisabExcelPdf || [];
  preview.innerHTML = files.length
    ? `${files.length} PDF attached: ${files.map(f => f.name || 'Hisabexcel.pdf').join(', ')} <button type="button" class="btn btn-ghost btn-sm" onclick="openSalesSupportModalFromDraft('hisabExcelPdf')"><i class="fas fa-eye"></i> View</button>`
    : 'No Hisabexcel PDF attached.';
}

function getSalesSupportCount(entryOrFiles) {
  const source = entryOrFiles?.supportingFiles || entryOrFiles || {};
  return Object.values(SALES_SUPPORT_FIELDS).length && Object.keys(SALES_SUPPORT_FIELDS)
    .reduce((sum, field) => sum + ((source[field] || []).length || 0), 0);
}

function renderSalesSupportPreview(field) {
  const container = document.getElementById('salesSupportPreview');
  if (!container) return;
  if (!SALES_SUPPORT_FIELDS[field]) {
    container.innerHTML = '';
    return;
  }
  const files = salesSupportFiles[field] || [];
  container.innerHTML = `
    <div style="padding:10px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;">
      <strong>${SALES_SUPPORT_FIELDS[field]} Supporting Files:</strong> ${files.length}
      ${files.length ? `<button class="btn btn-ghost btn-sm" style="margin-left:8px;" onclick="openSalesSupportModalFromDraft('${field}')"><i class="fas fa-eye"></i> View</button>` : ''}
    </div>
  `;
}

function openSalesSupportModalFromDraft(field) {
  openSalesSupportModalForFiles(SALES_SUPPORT_FIELDS[field] || 'Supporting Images', salesSupportFiles[field] || []);
}

function openSalesSupportModal(id) {
  const entry = (appData.sales || []).find(s => String(s.id) === String(id));
  if (!entry) return;
  const files = Object.entries(SALES_SUPPORT_FIELDS).flatMap(([field, label]) =>
    (entry.supportingFiles?.[field] || []).map(file => ({ ...file, label }))
  );
  openSalesSupportModalForFiles(`${entry.trainName || 'Sales'} Supporting Files`, files);
}

function openSalesSupportModalForFiles(title, files) {
  document.getElementById('salesSupportModalTitle').textContent = title;
  const body = document.getElementById('salesSupportModalBody');
  body.innerHTML = files.length ? files.map(file => `
    <div style="border:1px solid #e2e8f0;border-radius:8px;padding:8px;background:#fff;">
      <div style="font-size:12px;font-weight:600;margin-bottom:6px;">${file.label || ''} ${file.name || ''}</div>
      ${file.cloudSkipped
        ? `<div style="background:#fff7ed;border:1px solid #fdba74;border-radius:6px;padding:12px;color:#9a3412;font-size:12px;">
            <i class="fas fa-triangle-exclamation"></i> ${file.note || `This PDF was too large for cloud sync. Upload a PDF under ${HISAB_EXCEL_PDF_MAX_LABEL}.`}
          </div>`
        : file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')
        ? `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:#f8fafc;border-radius:6px;padding:12px;">
            <span><i class="fas fa-file-pdf" style="color:#dc2626;"></i> ${file.name || 'PDF File'}</span>
            <a class="btn btn-ghost btn-sm" href="${file.dataUrl}" target="_blank" download="${file.name || 'hisabexcel.pdf'}"><i class="fas fa-download"></i> Open/Download</a>
          </div>`
        : `<img src="${file.dataUrl}" alt="${file.name || 'support'}" style="width:100%;max-height:260px;object-fit:contain;border-radius:6px;background:#f8fafc;">`}
    </div>
  `).join('') : '<p style="color:#64748b;">No supporting files attached.</p>';
  document.getElementById('salesSupportModal').classList.add('active');
}

function closeSalesSupportModal() {
  document.getElementById('salesSupportModal').classList.remove('active');
}

async function handleBankReceiptUpload(input) {
  const files = Array.from(input.files || []);
  if (!files.length) return;
  let attached = 0;
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    const dataUrl = await readFileAsDataUrl(file);
    bankReceiptFiles.push({
      name: file.name || `bank_receipt_${Date.now()}.jpg`,
      type: file.type,
      size: file.size,
      uploadedAt: new Date().toISOString(),
      dataUrl
    });
    attached += 1;
  }
  input.value = '';
  renderBankReceiptPreview();
  showAlert(`${attached} bank receipt image(s) attached.`, 'success');
}

function renderBankReceiptPreview() {
  const box = document.getElementById('bankReceiptPreview');
  if (!box) return;
  box.innerHTML = bankReceiptFiles.length
    ? `<strong>Receipt Images:</strong> ${bankReceiptFiles.length} <button class="btn btn-ghost btn-sm" onclick="openBankReceiptDraftModal()"><i class="fas fa-eye"></i> View</button>`
    : 'No bank receipt image attached.';
}

function openBankReceiptDraftModal() {
  openSalesSupportModalForFiles('Bank Deposit Receipts', bankReceiptFiles || []);
}

function openBankReceiptSavedModal(id) {
  const record = (appData.bankDeposits || []).find(r => String(r.id) === String(id));
  openSalesSupportModalForFiles('Bank Deposit Receipts', record?.receiptFiles || []);
}

window.readFileAsDataUrl = readFileAsDataUrl;
window.handleSalesSupportUpload = handleSalesSupportUpload;
window.renderHisabExcelPdfPreview = renderHisabExcelPdfPreview;
window.getSalesSupportCount = getSalesSupportCount;
window.renderSalesSupportPreview = renderSalesSupportPreview;
window.openSalesSupportModalFromDraft = openSalesSupportModalFromDraft;
window.openSalesSupportModal = openSalesSupportModal;
window.openSalesSupportModalForFiles = openSalesSupportModalForFiles;
window.closeSalesSupportModal = closeSalesSupportModal;
window.handleBankReceiptUpload = handleBankReceiptUpload;
window.renderBankReceiptPreview = renderBankReceiptPreview;
window.openBankReceiptDraftModal = openBankReceiptDraftModal;
window.openBankReceiptSavedModal = openBankReceiptSavedModal;
