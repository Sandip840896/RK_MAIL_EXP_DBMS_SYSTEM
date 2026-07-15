    // ==================== APP DATA & STATE ====================
    const DEFAULT_DATA = {
      users: [
        { id: 1, name: 'Super Admin', email: 'sandipnandi2000@gmail.com', password: 'Sanju@1234', role: 'super_admin', yard: 'ALL', active: true },
        { id: 2, name: 'Demo User', email: 'demo', password: 'Demo@1234', role: 'demo_viewer', yard: 'ALL', active: true }
      ],
      yards: ['Howrah', 'Sealdah', 'Kharagpur', 'Asansol', 'Malda', 'Siliguri'],
      clusterManagers: ['Manager A', 'Manager B', 'Manager C'],
      trainManagers: ['TM1', 'TM2', 'TM3', 'TM4', 'TM5'],
      rakeManagers: [],
      trainManagerHierarchy: {},
      rakeManagerHierarchy: {},
      trainMasters: [],
      targetMasters: [],
      itemRateMasters: [],
      sales: [],
      complaints: [],
      cash: [],
      bankDeposits: [],
      masterLogs: []
    };

    let appData = {};
    let currentUser = null;
    let editingId = null;
    let editingType = null;
    let charts = {};
    let salesBucketFilter = null;
    let gpBucketFilter = null;
    let chartFilter = { type: null, value: null };
    let compChartFilter = { type: null, value: null };
    let compChartFilters = [];
    let compDashSelectedTrains = [];
    let itemRateEditingId = null;
    let salesItemCategoryFilter = 'ALL';
    let pendingSalesEntry = null;
    let pendingSalesReopen = null;
    let salesCostDetails = {};
    let salesSalaryDetails = [];
    let currentSalesDetailField = '';
    let salesSupportFiles = {};
    let bankReceiptFiles = [];
    let salesMiscManual = false;
    const noDataPopupShown = { sales: false, complaints: false, cash: false };

    // ==================== INITIALIZATION ====================
    document.addEventListener('DOMContentLoaded', function() {
      initApp();
    });

    async function initApp() {
      initFirebase();
      await loadData();
      setupEventListeners();
      setDefaultDates();
    }

    async function loadData() {
      if (firebaseInitialized) {
        try {
          const snapshot = await firebaseDb.ref('rkGroupData').once('value');
          const cloudData = snapshot.val();
          if (cloudData) {
            const decodedCloudData = decodeCloudData(cloudData);
            appData = decodedCloudData;
            const localData = await getLocalAppData();
            if (localData) {
              try {
                normalizeAppData();
                appData = mergeCloudAndLocalData(decodedCloudData, localData);
              } catch (error) {
                console.warn('Could not merge local data with Firebase data.', error);
              }
            }
            normalizeAppData();
            saveLocalAppData(appData);
            autoSyncToCloud();
            return;
          }
        } catch (error) {
          console.warn('Could not load Firebase data. Using local data instead.', error);
        }
      }

      const savedData = await getLocalAppData();
      if (savedData) {
        appData = savedData;
        normalizeAppData();
      } else {
        appData = JSON.parse(JSON.stringify(DEFAULT_DATA));
        saveData();
      }
    }

    function mergeUsers(cloudUsers, localUsers) {
      const byEmail = new Map();
      [...cloudUsers, ...localUsers].forEach(user => {
        if (!user || !user.email) return;
        byEmail.set(String(user.email).toLowerCase(), user);
      });
      return [...byEmail.values()];
    }

    function normalizeAppData() {
      if (!appData || typeof appData !== 'object') appData = JSON.parse(JSON.stringify(DEFAULT_DATA));
      if (!appData.yards) appData.yards = DEFAULT_DATA.yards;
      if (!appData.clusterManagers) appData.clusterManagers = DEFAULT_DATA.clusterManagers;
      if (!appData.trainManagers) appData.trainManagers = DEFAULT_DATA.trainManagers;
      if (!appData.rakeManagers) appData.rakeManagers = DEFAULT_DATA.rakeManagers;
      if (!appData.trainManagerHierarchy) appData.trainManagerHierarchy = DEFAULT_DATA.trainManagerHierarchy;
      if (!appData.rakeManagerHierarchy) appData.rakeManagerHierarchy = DEFAULT_DATA.rakeManagerHierarchy;
      if (!appData.trainMasters) appData.trainMasters = DEFAULT_DATA.trainMasters;
      if (!appData.targetMasters) appData.targetMasters = [];
      if (!appData.itemRateMasters) appData.itemRateMasters = [];
      if (!appData.sales) appData.sales = DEFAULT_DATA.sales;
      if (!appData.complaints) appData.complaints = DEFAULT_DATA.complaints;
      if (!appData.cash) appData.cash = DEFAULT_DATA.cash;
      if (!appData.bankDeposits) appData.bankDeposits = [];
      if (!appData.masterLogs) appData.masterLogs = [];
      if (!appData.deletedRecords) appData.deletedRecords = {};
      if (!appData.users) appData.users = DEFAULT_DATA.users;
      hydrateManagerHierarchyFromMasters();
      ensureSystemUsers();
      saveLocalAppData(appData);
    }

    function hydrateManagerHierarchyFromMasters() {
      if (!appData.trainManagerHierarchy) appData.trainManagerHierarchy = {};
      if (!appData.rakeManagerHierarchy) appData.rakeManagerHierarchy = {};
      if (!Array.isArray(appData.rakeManagers)) appData.rakeManagers = [];
      (appData.trainMasters || []).forEach(t => {
        if (t.trainManager && t.clusterManager && !appData.trainManagerHierarchy[t.trainManager]) {
          appData.trainManagerHierarchy[t.trainManager] = t.clusterManager;
        }
        if (t.rakeManager && t.trainManager && !appData.rakeManagerHierarchy[t.rakeManager]) {
          appData.rakeManagerHierarchy[t.rakeManager] = t.trainManager;
        }
      });
      appData.rakeManagers = [...new Set([...(appData.rakeManagers || []), ...Object.keys(appData.rakeManagerHierarchy)])].sort();
    }

    function saveData(options = {}) {
      saveLocalAppData(appData);
      autoSyncToCloud(options); // Auto-sync to cloud if Firebase is configured
    }

    function resetToDefault() {
      if (!requireMasterDeleteKey('reset everything')) return;
      appData = JSON.parse(JSON.stringify(DEFAULT_DATA));
      saveData({ forceOverwrite: true });
      showAlert('Data reset to defaults', 'success');
      loadDashboard();
    }

    function requireMasterDeleteKey(actionLabel) {
      const key = prompt(`Enter master key to ${actionLabel}:`);
      if (key !== MASTER_DELETE_KEY) {
        showAlert('Invalid master key. Delete/reset cancelled.', 'error');
        return false;
      }
      return true;
    }

    function ensureSuperAdminDangerAction() {
      if ((currentUser?.role || '').toLowerCase() !== 'super_admin') {
        showAlert('Only Super Admin can use Danger Zone delete actions.', 'error');
        return false;
      }
      return true;
    }

    function getDangerDeleteRange() {
      const from = document.getElementById('dangerDeleteFromDate')?.value || '';
      const to = document.getElementById('dangerDeleteToDate')?.value || '';
      return { from, to, active: Boolean(from || to) };
    }

    function getRecordOperationDate(record) {
      return record?.date || record?.arrivalDate || record?.entryDate || record?.complaintDate || '';
    }

    function isRecordInDangerRange(record, range) {
      if (!range.active) return true;
      const date = getRecordOperationDate(record);
      if (!date) return false;
      if (range.from && date < range.from) return false;
      if (range.to && date > range.to) return false;
      return true;
    }

    function deleteRecordsByDangerRange(collectionName, label, reloadFns = []) {
      if (!ensureEditable(`delete ${label}`) || !ensureSuperAdminDangerAction()) return;
      const range = getDangerDeleteRange();
      const rangeText = range.active ? `${range.from || 'first date'} to ${range.to || 'last date'}` : 'ALL dates';
      if (!requireMasterDeleteKey(`delete ${label} for ${rangeText}`)) return;
      if (!confirm(`Delete ${label} for ${rangeText}? This cannot be undone!`)) return;
      const rows = appData[collectionName] || [];
      const keep = [];
      let deletedCount = 0;
      rows.forEach((row, index) => {
        if (isRecordInDangerRange(row, range)) {
          deletedCount++;
          if (row?.id) markRecordDeleted(collectionName, row.id);
          markRecordDeleted(collectionName, makeRecordKey(row, collectionName));
          markRecordDeleted(collectionName, makeRecordKey(row, index));
        } else {
          keep.push(row);
        }
      });
      appData[collectionName] = range.active ? keep : [];
      saveData({ forceOverwrite: true });
      showAlert(`${deletedCount} ${label} deleted`, 'success');
      reloadFns.forEach(fn => fn());
    }

    function deleteAllSalesData() {
      deleteRecordsByDangerRange('sales', 'sales records', [loadDashboard]);
    }

    function deleteAllComplaintData() {
      deleteRecordsByDangerRange('complaints', 'complaint records', [loadDashboard, loadComplaintDashboard]);
    }

    function deleteAllCashData() {
      deleteRecordsByDangerRange('cash', 'cash deposit records', [loadDashboard, loadCashDashboard]);
    }

    function deleteAllTrainMasters() {
      if (!ensureEditable('delete train manager master') || !requireMasterDeleteKey('delete all train manager master data')) return;
      if (!confirm('Delete ALL train manager master data? Existing sales, complaints and cash entries will remain.')) return;
      addMasterLog('Delete All Train Masters', {}, `${(appData.trainMasters || []).length} train master rows deleted`);
      appData.trainMasters = [];
      saveData({ forceOverwrite: true });
      showAlert('All train manager master data deleted', 'success');
      loadMastersPage();
    }

    function deleteAllTargetMasters() {
      if (!ensureEditable('delete target master') || !requireMasterDeleteKey('delete all sales and GP target master data')) return;
      if (!confirm('Delete ALL sales and GP target master data? Existing transaction entries will remain.')) return;
      addMasterLog('Delete All Target Masters', {}, `${(appData.targetMasters || []).length} target master rows deleted`);
      appData.targetMasters = [];
      saveData({ forceOverwrite: true });
      showAlert('All target master data deleted', 'success');
      loadMastersPage();
    }

    function setupEventListeners() {
      document.addEventListener('click', function(e) {
        if (!e.target.closest('.searchable-select')) {
          document.querySelectorAll('.searchable-dropdown').forEach(d => d.classList.remove('active'));
        }
      });
      document.getElementById('loginPassword')?.addEventListener('keypress', function(e) {
        if (e.key === 'Enter') handleLogin();
      });
    }

    function setDefaultDates() {
      const today = new Date().toISOString().split('T')[0];
      document.getElementById('salesDepartureDate') && (document.getElementById('salesDepartureDate').value = today);
      document.getElementById('salesDate') && (document.getElementById('salesDate').value = today);
      document.getElementById('complaintDate') && (document.getElementById('complaintDate').value = today);
      document.getElementById('cashDate') && (document.getElementById('cashDate').value = getLastCashEntryDate());
      document.getElementById('dashDateMode') && (document.getElementById('dashDateMode').value = 'single');
      document.getElementById('compDateMode') && (document.getElementById('compDateMode').value = 'single');
      const salesLastDate = getLatestDataDate(appData.sales);
      const complaintLastDate = getLatestDataDate(appData.complaints);
      const cashLastDate = getLatestDataDate(appData.cash);
      document.getElementById('dashSingleFromDate') && (document.getElementById('dashSingleFromDate').value = salesLastDate || today);
      document.getElementById('dashSingleToDate') && (document.getElementById('dashSingleToDate').value = salesLastDate || today);
      document.getElementById('compSingleFromDate') && (document.getElementById('compSingleFromDate').value = complaintLastDate || today);
      document.getElementById('compSingleToDate') && (document.getElementById('compSingleToDate').value = complaintLastDate || today);
      document.getElementById('cashDashFromDate') && (document.getElementById('cashDashFromDate').value = cashLastDate || today);
      document.getElementById('cashDashToDate') && (document.getElementById('cashDashToDate').value = cashLastDate || today);
    }

    function getLastCashEntryDate() {
      return localStorage.getItem('rkLastCashEntryDate') || new Date().toISOString().split('T')[0];
    }

    function rememberLastCashDate() {
      const date = document.getElementById('cashDate')?.value;
      if (date) localStorage.setItem('rkLastCashEntryDate', date);
    }

    // ==================== FIREBASE AUTHENTICATION ====================

// Login Function
function handleLogin() {
  const email = document.getElementById('loginEmail').value.trim().toLowerCase();
  const password = document.getElementById('loginPassword').value;
  const errorDiv = document.getElementById('loginError');

  if (!email || !password) {
    errorDiv.textContent = 'Please enter both email and password';
    errorDiv.classList.remove('hidden');
    return;
  }

  ensureSystemUsers();
  const user = (appData.users || []).find(u =>
    (u.email || '').toLowerCase() === email &&
    u.password === password &&
    u.active !== false
  );

  if (!user) {
    errorDiv.textContent = 'Invalid email or password';
    errorDiv.classList.remove('hidden');
    return;
  }

  currentUser = { ...user };
  errorDiv.classList.add('hidden');
  showApp();
}

// Demo Login: opens the app as the primary super admin requested by RK Group.
function useDemoLogin() {
  document.getElementById('loginEmail').value = 'sandipnandi2000@gmail.com';
  document.getElementById('loginPassword').value = 'Sanju@1234';
  handleLogin();
}

// Logout
function handleLogout() {
  currentUser = null;

  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('appContainer').style.display = 'none';

  document.getElementById('loginEmail').value = '';
  document.getElementById('loginPassword').value = '';

  closeSidebar();
}


// Show App
function showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appContainer').style.display = 'block';

  document.getElementById('userName').textContent = currentUser.name;
  document.getElementById('userRoleDisplay').textContent = ROLE_LABELS[currentUser.role] || currentUser.role;

  setupNavigation();
  setupReadOnlyUi();
  showPage(hasPageAccess('dashboard') ? 'dashboard' : getUserPageAccess()[0]);
}

    // ==================== DATE RANGE HELPERS ====================
    function setDefaultDateRanges() {
      const now = new Date();
      const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      
      // Calculate same period last month
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth() - 1, yesterday.getDate());
      
      // Set Period 1 (Current Month MTD)
      document.getElementById('dashFromDate1').value = currentMonthStart.toISOString().split('T')[0];
      document.getElementById('dashToDate1').value = yesterday.toISOString().split('T')[0];
      document.getElementById('dashSingleFromDate').value = currentMonthStart.toISOString().split('T')[0];
      document.getElementById('dashSingleToDate').value = yesterday.toISOString().split('T')[0];
      
      // Set Period 2 (Last Month same period)
      document.getElementById('dashFromDate2').value = lastMonthStart.toISOString().split('T')[0];
      document.getElementById('dashToDate2').value = lastMonthEnd.toISOString().split('T')[0];
      document.getElementById('dashDateMode').value = 'comparison';
      
      handleSalesDateModeChange();
      showAlert('Date ranges set: Current Month MTD vs Last Month same period', 'success');
    }

    function setDefaultCompDateRanges() {
      const now = new Date();
      const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      
      // Calculate same period last month
      const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastMonthEnd = new Date(now.getFullYear(), now.getMonth() - 1, yesterday.getDate());
      
      // Set Period 1 (Current Month MTD)
      document.getElementById('compFromDate1').value = currentMonthStart.toISOString().split('T')[0];
      document.getElementById('compToDate1').value = yesterday.toISOString().split('T')[0];
      document.getElementById('compSingleFromDate').value = currentMonthStart.toISOString().split('T')[0];
      document.getElementById('compSingleToDate').value = yesterday.toISOString().split('T')[0];
      
      // Set Period 2 (Last Month same period)
      document.getElementById('compFromDate2').value = lastMonthStart.toISOString().split('T')[0];
      document.getElementById('compToDate2').value = lastMonthEnd.toISOString().split('T')[0];
      document.getElementById('compDateMode').value = 'comparison';
      
      handleComplaintDateModeChange();
      showAlert('Date ranges set: Current Month MTD vs Last Month same period', 'success');
    }

    function getSalesDateMode() {
      return document.getElementById('dashDateMode')?.value || 'single';
    }

    function getComplaintDateMode() {
      return document.getElementById('compDateMode')?.value || 'single';
    }

    function handleSalesDateModeChange() {
      const mode = getSalesDateMode();
      const single = document.getElementById('dashSingleRangeSection');
      const p1 = document.getElementById('dashPeriod1Section');
      const p2 = document.getElementById('dashPeriod2Section');
      if (single) single.style.display = mode === 'single' ? 'block' : 'none';
      if (p1) p1.style.display = mode === 'comparison' ? 'block' : 'none';
      if (p2) p2.style.display = mode === 'comparison' ? 'block' : 'none';
      loadDashboard();
    }

    function handleComplaintDateModeChange() {
      const mode = getComplaintDateMode();
      const single = document.getElementById('compSingleRangeSection');
      const p1 = document.getElementById('compPeriod1Section');
      const p2 = document.getElementById('compPeriod2Section');
      if (single) single.style.display = mode === 'single' ? 'block' : 'none';
      if (p1) p1.style.display = mode === 'comparison' ? 'block' : 'none';
      if (p2) p2.style.display = mode === 'comparison' ? 'block' : 'none';
      loadComplaintDashboard();
    }

    // ==================== FILTER FUNCTIONS ====================
    function getFilteredSales(period) {
      let filtered = [...(appData.sales || [])];
      
      let fromDate, toDate;
      const mode = getSalesDateMode();

      if (mode === 'single') {
        if (period === 2) return [];
        if (period === 1) {
          fromDate = document.getElementById('dashSingleFromDate')?.value;
          toDate = document.getElementById('dashSingleToDate')?.value || fromDate;
        }
      } else {
        if (period === 1) {
          fromDate = document.getElementById('dashFromDate1')?.value;
          toDate = document.getElementById('dashToDate1')?.value;
        } else if (period === 2) {
          fromDate = document.getElementById('dashFromDate2')?.value;
          toDate = document.getElementById('dashToDate2')?.value;
        }
      }
      
      const trainFilter = document.getElementById('dashTrainFilter')?.value;
      const managerFilter = document.getElementById('dashManagerFilter')?.value;
      const yardFilter = document.getElementById('dashYardFilter')?.value;
      
      if (fromDate) filtered = filtered.filter(s => s.date >= fromDate);
      if (toDate) filtered = filtered.filter(s => s.date <= toDate);
      if (trainFilter) filtered = filtered.filter(s => s.trainName === trainFilter);
      if (managerFilter) filtered = filtered.filter(s => s.trainManager === managerFilter);
      if (yardFilter) filtered = filtered.filter(s => s.yard === yardFilter);

      // Chart click filter
      if (chartFilter.type && chartFilter.value) {
        if (chartFilter.type === 'yard') filtered = filtered.filter(s => s.yard === chartFilter.value);
        if (chartFilter.type === 'train') filtered = filtered.filter(s => s.trainName === chartFilter.value);
        if (chartFilter.type === 'manager') filtered = filtered.filter(s => s.trainManager === chartFilter.value);
        if (chartFilter.type === 'trainType') filtered = filtered.filter(s => s.trainType === chartFilter.value);
        if (chartFilter.type === 'date') filtered = filtered.filter(s => s.date === chartFilter.value);
      }

      // Bucket filters
      if (salesBucketFilter) {
        const bucketTrainKeys = getSalesTrainKeysForBucket(filtered, salesBucketFilter, 'sales');
        filtered = filtered.filter(s => bucketTrainKeys.has(buildTrainKey(s.trainNumber, s.trainName) || normalizeText(s.trainName) || String(s.trainId || s.id || '')));
      }
      if (gpBucketFilter) {
        const bucketTrainKeys = getSalesTrainKeysForBucket(filtered, gpBucketFilter, 'gp');
        filtered = filtered.filter(s => bucketTrainKeys.has(buildTrainKey(s.trainNumber, s.trainName) || normalizeText(s.trainName) || String(s.trainId || s.id || '')));
      }

      if (currentUser.yard !== 'ALL') {
        filtered = filtered.filter(s => s.yard === currentUser.yard);
      }

      return filtered;
    }

    function checkBucket(pct, bucket) {
      switch(bucket) {
        case 'Above 100%': return pct >= 100;
        case '90-100%': return pct >= 90 && pct < 100;
        case '80-90%': return pct >= 80 && pct < 90;
        case '70-80%': return pct >= 70 && pct < 80;
        case 'Below 70%': return pct < 70;
        default: return true;
      }
    }

    function aggregateSalesByUniqueTrain(sales) {
      const trainMap = {};
      (sales || []).forEach(s => {
        const key = buildTrainKey(s.trainNumber, s.trainName) || normalizeText(s.trainName) || String(s.trainId || s.id || '');
        if (!trainMap[key]) {
          trainMap[key] = {
            key,
            trainName: s.trainName || '',
            trainNumber: s.trainNumber || '',
            salesTarget: 0,
            salesAchievement: 0,
            gpTarget: 0,
            gpAchievement: 0,
            entries: 0
          };
        }
        trainMap[key].salesTarget += Number(s.salesTarget) || 0;
        trainMap[key].salesAchievement += Number(s.salesAchievement || s.totalSale) || 0;
        trainMap[key].gpTarget += Number(s.gpTarget) || 0;
        trainMap[key].gpAchievement += Number(s.gpAchievement) || 0;
        trainMap[key].entries += 1;
      });
      return Object.values(trainMap);
    }

    function getSalesTrainKeysForBucket(sales, bucket, metric) {
      return new Set(aggregateSalesByUniqueTrain(sales).filter(train => {
        const target = metric === 'gp' ? train.gpTarget : train.salesTarget;
        const actual = metric === 'gp' ? train.gpAchievement : train.salesAchievement;
        const pct = target > 0 ? (actual / target) * 100 : 0;
        return checkBucket(pct, bucket);
      }).map(train => train.key));
    }

    function getFilteredComplaints(period) {
      let filtered = [...(appData.complaints || [])];
      
      let fromDate, toDate;
      const mode = getComplaintDateMode();

      if (mode === 'single') {
        if (period === 2) return [];
        if (period === 1) {
          fromDate = document.getElementById('compSingleFromDate')?.value;
          toDate = document.getElementById('compSingleToDate')?.value || fromDate;
        }
      } else {
        if (period === 1) {
          fromDate = document.getElementById('compFromDate1')?.value;
          toDate = document.getElementById('compToDate1')?.value;
        } else if (period === 2) {
          fromDate = document.getElementById('compFromDate2')?.value;
          toDate = document.getElementById('compToDate2')?.value;
        }
      }
      
      const trainFilters = [...(compDashSelectedTrains || [])];
      const statusFilter = document.getElementById('compDashStatusFilter')?.value;
      const yardFilter = document.getElementById('compDashYardFilter')?.value;

      if (fromDate || toDate) filtered = filtered.filter(c => isCashEntryInDateRange(c, fromDate, toDate));
      if (trainFilters.length) filtered = filtered.filter(c => trainFilters.includes(c.trainName));
      if (statusFilter) filtered = filtered.filter(c => c.status === statusFilter);
      if (yardFilter) filtered = filtered.filter(c => c.yard === yardFilter);

      getActiveComplaintChartFilters().forEach(filter => {
        if (filter.type === 'train') filtered = filtered.filter(c => c.trainName === filter.value);
        if (filter.type === 'status') filtered = filtered.filter(c => c.status === filter.value);
        if (filter.type === 'source') filtered = filtered.filter(c => c.source === filter.value);
        if (filter.type === 'yard') filtered = filtered.filter(c => (c.yard || 'Unknown') === filter.value);
        if (filter.type === 'mobile') filtered = filtered.filter(c => normalizeMobileNo(c.mobileNo) === normalizeMobileNo(filter.value));
        if (filter.type === 'date') filtered = filtered.filter(c => c.date === filter.value);
        if (filter.type === 'nature') filtered = filtered.filter(c => (c.complainNature || c.complaintType || 'Unknown') === filter.value);
        if (filter.type === 'rakeManager') filtered = filtered.filter(c => getRakeManagerFromComplaint(c) === filter.value);
      });

      if (currentUser.yard !== 'ALL') {
        filtered = filtered.filter(c => c.yard === currentUser.yard);
      }

      return filtered;
    }

    function populateDashboardFilters() {
      const trains = [...new Set(appData.trainMasters.map(t => t.trainName))].sort();
      const managers = [...new Set(appData.trainMasters.map(t => t.trainManager))].filter(Boolean).sort();
      const yards = appData.yards || [];

      const trainSelect = document.getElementById('dashTrainFilter');
      if (trainSelect) trainSelect.innerHTML = '<option value="">All Trains</option>' + trains.map(t => `<option value="${t}">${t}</option>`).join('');

      const managerSelect = document.getElementById('dashManagerFilter');
      if (managerSelect) managerSelect.innerHTML = '<option value="">All Managers</option>' + managers.map(m => `<option value="${m}">${m}</option>`).join('');

      const yardSelect = document.getElementById('dashYardFilter');
      if (yardSelect) yardSelect.innerHTML = '<option value="">All Yards</option>' + yards.map(y => `<option value="${y}">${y}</option>`).join('');
    }

    function populateComplaintDashboardFilters() {
      const yards = appData.yards || [];

      renderCompDashTrainMultiSelect(document.getElementById('compDashTrainSearch')?.value || '');

      const yardSelect = document.getElementById('compDashYardFilter');
      if (yardSelect) yardSelect.innerHTML = '<option value="">All Yards</option>' + yards.map(y => `<option value="${y}">${y}</option>`).join('');
    }

    function getComplaintDashboardTrainOptions() {
      const names = [
        ...(appData.trainMasters || []).map(t => t.trainName),
        ...(appData.complaints || []).map(c => c.trainName)
      ].filter(Boolean);
      return [...new Set(names)].sort((a, b) => String(a).localeCompare(String(b)));
    }

    function renderCompDashTrainMultiSelect(query = '') {
      const selectedBox = document.getElementById('compDashTrainSelected');
      const dropdown = document.getElementById('compDashTrainDropdown');
      if (!selectedBox || !dropdown) return;

      const available = getComplaintDashboardTrainOptions();
      compDashSelectedTrains = compDashSelectedTrains.filter(t => available.includes(t));
      selectedBox.innerHTML = compDashSelectedTrains.length
        ? compDashSelectedTrains.map(t => `<span class="multi-filter-chip">${escapeHtml(t)} <button type="button" onclick="removeCompDashTrainFilter('${encodeURIComponent(t)}')">&times;</button></span>`).join('')
        : '<span class="multi-filter-placeholder">All Trains</span>';

      const q = normalizeText(query);
      const shown = available.filter(t => !q || normalizeText(t).includes(q)).slice(0, 80);
      dropdown.innerHTML = shown.length ? shown.map(t => {
        const checked = compDashSelectedTrains.includes(t) ? 'checked' : '';
        return `<div class="searchable-dropdown-item multi-filter-option" onclick="toggleCompDashTrainFilter('${encodeURIComponent(t)}')"><input type="checkbox" ${checked} readonly> <span>${escapeHtml(t)}</span></div>`;
      }).join('') : '<div class="searchable-dropdown-item">No train found</div>';
    }

    function showCompDashTrainDropdown() {
      renderCompDashTrainMultiSelect(document.getElementById('compDashTrainSearch')?.value || '');
      document.getElementById('compDashTrainDropdown')?.classList.add('active');
      document.getElementById('compDashTrainSearch')?.focus();
    }

    function toggleCompDashTrainFilter(encodedTrain) {
      const train = decodeURIComponent(encodedTrain);
      if (compDashSelectedTrains.includes(train)) {
        compDashSelectedTrains = compDashSelectedTrains.filter(t => t !== train);
      } else {
        compDashSelectedTrains.push(train);
      }
      renderCompDashTrainMultiSelect(document.getElementById('compDashTrainSearch')?.value || '');
      document.getElementById('compDashTrainDropdown')?.classList.add('active');
      loadComplaintDashboard();
    }

    function removeCompDashTrainFilter(encodedTrain) {
      const train = decodeURIComponent(encodedTrain);
      compDashSelectedTrains = compDashSelectedTrains.filter(t => t !== train);
      renderCompDashTrainMultiSelect(document.getElementById('compDashTrainSearch')?.value || '');
      loadComplaintDashboard();
    }

    function clearSalesFilters() {
      document.getElementById('dashDateMode').value = 'single';
      document.getElementById('dashSingleFromDate').value = '';
      document.getElementById('dashSingleToDate').value = '';
      document.getElementById('dashFromDate1').value = '';
      document.getElementById('dashToDate1').value = '';
      document.getElementById('dashFromDate2').value = '';
      document.getElementById('dashToDate2').value = '';
      document.getElementById('dashTrainFilter').value = '';
      document.getElementById('dashManagerFilter').value = '';
      document.getElementById('dashYardFilter').value = '';
      salesBucketFilter = null;
      gpBucketFilter = null;
      chartFilter = { type: null, value: null };
      handleSalesDateModeChange();
    }

    function clearChartFilter() {
      chartFilter = { type: null, value: null };
      loadDashboard();
    }

    function applyChartFilter(type, value) {
      chartFilter = { type, value: decodeURIComponent(value) };
      loadDashboard();
    }

    function clearComplaintFilters() {
      document.getElementById('compDateMode').value = 'single';
      document.getElementById('compSingleFromDate').value = '';
      document.getElementById('compSingleToDate').value = '';
      document.getElementById('compFromDate1').value = '';
      document.getElementById('compToDate1').value = '';
      document.getElementById('compFromDate2').value = '';
      document.getElementById('compToDate2').value = '';
      compDashSelectedTrains = [];
      if (document.getElementById('compDashTrainSearch')) document.getElementById('compDashTrainSearch').value = '';
      renderCompDashTrainMultiSelect('');
      document.getElementById('compDashStatusFilter').value = '';
      document.getElementById('compDashYardFilter').value = '';
      compChartFilter = { type: null, value: null };
      compChartFilters = [];
      handleComplaintDateModeChange();
    }

    function clearCompChartFilter() {
      compChartFilter = { type: null, value: null };
      compChartFilters = [];
      loadComplaintDashboard();
    }

    function getActiveComplaintChartFilters() {
      if (Array.isArray(compChartFilters) && compChartFilters.length) return compChartFilters;
      return compChartFilter.type && compChartFilter.value ? [compChartFilter] : [];
    }

    function toggleComplaintChartFilter(type, value) {
      const decoded = decodeURIComponent(value);
      const existingIndex = compChartFilters.findIndex(f => f.type === type && f.value === decoded);
      if (existingIndex >= 0) {
        compChartFilters.splice(existingIndex, 1);
      } else {
        compChartFilters = compChartFilters.filter(f => f.type !== type);
        compChartFilters.push({ type, value: decoded });
      }
      compChartFilter = compChartFilters.length ? compChartFilters[compChartFilters.length - 1] : { type: null, value: null };
      loadComplaintDashboard();
    }

    function filterByBucket(bucket, type) {
      if (type === 'sales') {
        salesBucketFilter = salesBucketFilter === bucket ? null : bucket;
        gpBucketFilter = null;
      } else {
        gpBucketFilter = gpBucketFilter === bucket ? null : bucket;
        salesBucketFilter = null;
      }
      loadDashboard();
    }

    // ==================== SALES DASHBOARD ====================
    function loadDashboard() {
      const dateMode = getSalesDateMode();
      // Get data for both periods
      const salesP1 = getFilteredSales(1);
      const salesP2 = getFilteredSales(2);
      
      // Get complaints for Period 1 date range
      const fromDate1 = dateMode === 'single' ? document.getElementById('dashSingleFromDate')?.value : document.getElementById('dashFromDate1')?.value;
      const toDate1 = dateMode === 'single' ? (document.getElementById('dashSingleToDate')?.value || fromDate1) : document.getElementById('dashToDate1')?.value;
      let complaints = [...(appData.complaints || [])];
      if (fromDate1) complaints = complaints.filter(c => c.date >= fromDate1);
      if (toDate1) complaints = complaints.filter(c => c.date <= toDate1);
      if (currentUser.yard !== 'ALL') complaints = complaints.filter(c => c.yard === currentUser.yard);
      
      let cash = [...(appData.cash || [])];
      if (fromDate1 || toDate1) cash = cash.filter(c => isCashEntryInDateRange(c, fromDate1, toDate1));
      if (currentUser.yard !== 'ALL') cash = cash.filter(c => c.yard === currentUser.yard);

      // Calculate KPIs for Period 1
      const salesTargetP1 = salesP1.reduce((sum, s) => sum + (Number(s.salesTarget) || 0), 0);
      const salesAchievementP1 = salesP1.reduce((sum, s) => sum + (Number(s.salesAchievement) || 0), 0);
      const gpTargetP1 = salesP1.reduce((sum, s) => sum + (Number(s.gpTarget) || 0), 0);
      const gpAchievementP1 = salesP1.reduce((sum, s) => sum + (Number(s.gpAchievement) || 0), 0);
      
      // Calculate KPIs for Period 2
      const salesAchievementP2 = salesP2.reduce((sum, s) => sum + (Number(s.salesAchievement) || 0), 0);
      const gpAchievementP2 = salesP2.reduce((sum, s) => sum + (Number(s.gpAchievement) || 0), 0);
      
      const openComplaints = complaints.filter(c => c.status === 'Open').length;
      const closedComplaints = complaints.filter(c => c.status === 'Closed').length;
      const totalComplaints = complaints.length;
      
      const bankDeposit = cash.reduce((sum, c) => sum + (Number(c.totalDeposit) || 0), 0);
      const cashCounter = cash.reduce((sum, c) => sum + (Number(c.cashDepositCounter) || 0), 0);
      const onlineDeposit = cash.reduce((sum, c) => sum + (Number(c.onlineDeposit) || 0), 0);

      // Update KPI cards - Period 1
      document.getElementById('kpiSalesTarget').textContent = formatCurrency(salesTargetP1);
      document.getElementById('kpiSalesTargetSub').textContent = salesP1.length + ' records';
      document.getElementById('kpiSalesAchievement').textContent = formatCurrency(salesAchievementP1);
      document.getElementById('kpiSalesAchievementSub').textContent = salesTargetP1 > 0 ? 
        Math.round((salesAchievementP1 / salesTargetP1) * 100) + '% achieved' : '0% achieved';
      document.getElementById('kpiSalesProgress').style.width = salesTargetP1 > 0 ? 
        Math.min((salesAchievementP1 / salesTargetP1) * 100, 100) + '%' : '0%';

      document.getElementById('kpiGpTarget').textContent = formatCurrency(gpTargetP1);
      document.getElementById('kpiGpAchievement').textContent = formatCurrency(gpAchievementP1);
      document.getElementById('kpiGpAchievementSub').textContent = gpTargetP1 > 0 ? 
        Math.round((gpAchievementP1 / gpTargetP1) * 100) + '% achieved' : '0% achieved';
      document.getElementById('kpiGpProgress').style.width = gpTargetP1 > 0 ? 
        Math.min((gpAchievementP1 / gpTargetP1) * 100, 100) + '%' : '0%';

      // Update Period 2 KPIs
      // Variance = P2 - P1 (Positive = growth = Good, Negative = decline = Bad)
      document.getElementById('kpiSalesAchievementP2').textContent = formatCurrency(salesAchievementP2);
      const salesVariance = salesAchievementP2 - salesAchievementP1;
      document.getElementById('kpiSalesVariance').textContent = dateMode === 'comparison'
        ? 'Variance (P2-P1): ' + (salesVariance >= 0 ? '+' : '') + formatCurrency(salesVariance)
        : 'Comparison disabled in single period mode';
      document.getElementById('kpiSalesVariance').className = dateMode === 'comparison'
        ? (salesVariance >= 0 ? 'kpi-sub comparison-positive' : 'kpi-sub comparison-negative')
        : 'kpi-sub';
      
      document.getElementById('kpiGpAchievementP2').textContent = formatCurrency(gpAchievementP2);
      const gpVariance = gpAchievementP2 - gpAchievementP1;
      document.getElementById('kpiGpVariance').textContent = dateMode === 'comparison'
        ? 'Variance (P2-P1): ' + (gpVariance >= 0 ? '+' : '') + formatCurrency(gpVariance)
        : 'Comparison disabled in single period mode';
      document.getElementById('kpiGpVariance').className = dateMode === 'comparison'
        ? (gpVariance >= 0 ? 'kpi-sub comparison-positive' : 'kpi-sub comparison-negative')
        : 'kpi-sub';

      document.getElementById('kpiOpenComplaints').textContent = openComplaints;
      document.getElementById('kpiComplaintSub').textContent = closedComplaints + ' closed | ' + totalComplaints + ' total';
      document.getElementById('kpiBankDeposit').textContent = formatCurrency(bankDeposit);
      document.getElementById('kpiCashBankSub').textContent = 'Counter: ' + formatCurrency(cashCounter);

      // Render buckets
      renderSalesBuckets(salesP1);
      renderGpBuckets(salesP1);

      // Render charts
      renderSalesTrendChart(salesP1);
      renderGpTrendChart(salesP1);
      renderYardSalesChart(salesP1);
      renderTopTrainsChart(salesP1);
      renderBottomTrainsChart(salesP1);
      renderManagerChart(salesP1);
      renderTrainTypeChart(salesP1);

      // Render tables
      renderTopBottomTables(salesP1);
      renderManagerRankingTables(salesP1, complaints);
      renderTrainManagerSalesSummary(salesP1);
      if (dateMode === 'comparison') {
        renderPeriodComparisonTable(salesP1, salesP2);
      } else {
        document.getElementById('momTableBody').innerHTML = `
          <tr>
            <td colspan="7" style="text-align:center; color:#64748b;">Enable Comparison Mode to view P1 vs P2 table.</td>
          </tr>
        `;
      }
      renderRankTable(salesP1, complaints, cash);

      // Update filter displays
      updateActiveFiltersDisplay();
      updateChartFilterDisplay();
      if (!(appData.sales || []).length && !noDataPopupShown.sales) {
        noDataPopupShown.sales = true;
        showAlert('No sales data uploaded.', 'warning');
      }
    }

    function updateActiveFiltersDisplay() {
      const dateMode = getSalesDateMode();
      const fromDate1 = document.getElementById('dashFromDate1')?.value;
      const toDate1 = document.getElementById('dashToDate1')?.value;
      const fromDate2 = document.getElementById('dashFromDate2')?.value;
      const toDate2 = document.getElementById('dashToDate2')?.value;
      const singleFrom = document.getElementById('dashSingleFromDate')?.value;
      const singleTo = document.getElementById('dashSingleToDate')?.value || singleFrom;
      
      const filters = [];
      if (dateMode === 'single') {
        if (singleFrom) filters.push('Single: ' + singleFrom + (singleTo && singleTo !== singleFrom ? ' to ' + singleTo : ''));
      } else {
        if (fromDate1 && toDate1) filters.push('P1: ' + fromDate1 + ' to ' + toDate1);
        if (fromDate2 && toDate2) filters.push('P2: ' + fromDate2 + ' to ' + toDate2);
      }
      
      const display = document.getElementById('activeFilters');
      if (display) display.innerHTML = filters.length > 0 ? '<strong>Active Date Ranges:</strong> ' + filters.join(' | ') : '';
    }

    function updateChartFilterDisplay() {
      const display = document.getElementById('chartFilterDisplay');
      const text = document.getElementById('chartFilterText');
      if (chartFilter.type && chartFilter.value) {
        display.style.display = 'block';
        text.textContent = `Filtered by ${chartFilter.type}: ${chartFilter.value}`;
      } else {
        display.style.display = 'none';
      }
    }

    function renderSalesBuckets(sales) {
      const buckets = { 'Above 100%': 0, '90-100%': 0, '80-90%': 0, '70-80%': 0, 'Below 70%': 0 };
      const colors = { 'Above 100%': 'success', '90-100%': 'success', '80-90%': 'success', '70-80%': 'warning', 'Below 70%': 'danger' };

      aggregateSalesByUniqueTrain(sales).forEach(s => {
        const pct = s.salesTarget > 0 ? (s.salesAchievement / s.salesTarget) * 100 : 0;
        if (pct >= 100) buckets['Above 100%']++;
        else if (pct >= 90) buckets['90-100%']++;
        else if (pct >= 80) buckets['80-90%']++;
        else if (pct >= 70) buckets['70-80%']++;
        else buckets['Below 70%']++;
      });

      document.getElementById('salesBuckets').innerHTML = Object.entries(buckets).map(([label, count]) => `
        <div class="tile ${colors[label]} ${salesBucketFilter === label ? 'active' : ''}" onclick="filterByBucket('${label}', 'sales')">
          <div class="tile-value">${count}</div>
          <div class="tile-label">${label}</div>
        </div>
      `).join('');
    }

    function renderGpBuckets(sales) {
      const buckets = { 'Above 100%': 0, '90-100%': 0, '80-90%': 0, '70-80%': 0, 'Below 70%': 0 };
      const colors = { 'Above 100%': 'success', '90-100%': 'success', '80-90%': 'success', '70-80%': 'warning', 'Below 70%': 'danger' };

      aggregateSalesByUniqueTrain(sales).forEach(s => {
        const pct = s.gpTarget > 0 ? (s.gpAchievement / s.gpTarget) * 100 : 0;
        if (pct >= 100) buckets['Above 100%']++;
        else if (pct >= 90) buckets['90-100%']++;
        else if (pct >= 80) buckets['80-90%']++;
        else if (pct >= 70) buckets['70-80%']++;
        else buckets['Below 70%']++;
      });

      document.getElementById('gpBuckets').innerHTML = Object.entries(buckets).map(([label, count]) => `
        <div class="tile ${colors[label]} ${gpBucketFilter === label ? 'active' : ''}" onclick="filterByBucket('${label}', 'gp')">
          <div class="tile-value">${count}</div>
          <div class="tile-label">${label}</div>
        </div>
      `).join('');
    }


    // ==================== CHART RENDERING ====================
    function renderSalesTrendChart(sales) {
      const ctx = document.getElementById('salesTrendChart');
      if (!ctx) return;

      const dateMap = {};
      sales.forEach(s => { if (s.date) dateMap[s.date] = (dateMap[s.date] || 0) + (Number(s.salesAchievement) || 0); });
      const sortedDates = Object.keys(dateMap).sort();

      if (charts.salesTrend) charts.salesTrend.destroy();
      charts.salesTrend = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: sortedDates,
          datasets: [{
            label: 'Sales Achievement',
            data: sortedDates.map(d => dateMap[d]),
            backgroundColor: '#0ea5e9',
            borderRadius: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          onClick: (e, elements) => {
            if (elements.length > 0) {
              const index = elements[0].index;
              const date = sortedDates[index];
              chartFilter = { type: 'date', value: date };
              loadDashboard();
            }
          },
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, grid: { color: '#e2e8f0' }, ticks: { color: '#64748b', font: { size: 10 } } },
            x: { grid: { display: false }, ticks: { color: '#64748b', font: { size: 10 } } }
          }
        },
        plugins: [makeBarValueLabelsPlugin('salesTrendValueLabels')]
      });
    }

    function renderGpTrendChart(sales) {
      const ctx = document.getElementById('gpTrendChart');
      if (!ctx) return;

      const dateMap = {};
      sales.forEach(s => {
        const date = s.date || s.arrivalDate || '';
        if (date) dateMap[date] = (dateMap[date] || 0) + (Number(s.gpAchievement) || 0);
      });
      const sortedDates = Object.keys(dateMap).sort();

      if (charts.gpTrend) charts.gpTrend.destroy();
      charts.gpTrend = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: sortedDates,
          datasets: [{
            label: 'GP Achievement',
            data: sortedDates.map(d => dateMap[d]),
            backgroundColor: '#22c55e',
            borderRadius: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          onClick: (e, elements) => {
            if (elements.length > 0) {
              const index = elements[0].index;
              chartFilter = { type: 'date', value: sortedDates[index] };
              loadDashboard();
            }
          },
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, grace: '12%', grid: { color: '#e2e8f0' }, ticks: { color: '#64748b', font: { size: 10 } } },
            x: { grid: { display: false }, ticks: { color: '#64748b', font: { size: 10 } } }
          }
        },
        plugins: [makeBarValueLabelsPlugin('gpTrendValueLabels')]
      });
    }

    function renderYardSalesChart(sales) {
      const ctx = document.getElementById('yardSalesChart');
      if (!ctx) return;

      const yardMap = {};
      sales.forEach(s => {
        if (s.yard) {
          if (!yardMap[s.yard]) yardMap[s.yard] = { target: 0, achievement: 0 };
          yardMap[s.yard].target += Number(s.salesTarget) || 0;
          yardMap[s.yard].achievement += Number(s.salesAchievement) || 0;
        }
      });

      const yards = Object.keys(yardMap);

      if (charts.yardSales) charts.yardSales.destroy();
      charts.yardSales = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: yards,
          datasets: [
            { label: 'Target', data: yards.map(y => yardMap[y].target), backgroundColor: '#f59e0b', borderRadius: 4 },
            { label: 'Achievement', data: yards.map(y => yardMap[y].achievement), backgroundColor: '#0ea5e9', borderRadius: 4 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          onClick: (e, elements) => {
            if (elements.length > 0) {
              const index = elements[0].index;
              chartFilter = { type: 'yard', value: yards[index] };
              loadDashboard();
            }
          },
          plugins: { legend: { labels: { color: '#64748b', font: { size: 10 } } } },
          scales: {
            y: { beginAtZero: true, grace: '12%', grid: { color: '#e2e8f0' }, ticks: { color: '#64748b', font: { size: 10 } } },
            x: { grid: { display: false }, ticks: { color: '#64748b', font: { size: 10 } } }
          }
        }
      });
    }

    function renderTopTrainsChart(sales) {
      const ctx = document.getElementById('topTrainsChart');
      if (!ctx) return;

      const trainMap = {};
      sales.forEach(s => {
        if (s.trainName) {
          if (!trainMap[s.trainName]) trainMap[s.trainName] = { target: 0, achievement: 0 };
          trainMap[s.trainName].target += Number(s.salesTarget) || 0;
          trainMap[s.trainName].achievement += Number(s.salesAchievement) || 0;
        }
      });

      const trainPerformance = Object.entries(trainMap)
        .map(([name, data]) => ({ name, pct: data.target > 0 ? (data.achievement / data.target) * 100 : 0 }))
        .sort((a, b) => b.pct - a.pct).slice(0, 10);

      if (charts.topTrains) charts.topTrains.destroy();
      charts.topTrains = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: trainPerformance.map(t => t.name),
          datasets: [{
            label: 'Achievement %',
            data: trainPerformance.map(t => Math.round(t.pct)),
            backgroundColor: '#22c55e',
            borderRadius: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          onClick: (e, elements) => {
            if (elements.length > 0) {
              const index = elements[0].index;
              chartFilter = { type: 'train', value: trainPerformance[index].name };
              loadDashboard();
            }
          },
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, max: 120, grid: { color: '#e2e8f0' }, ticks: { color: '#64748b', font: { size: 10 } } },
            x: { grid: { display: false }, ticks: { color: '#64748b', font: { size: 10 } } }
          }
        }
      });
    }

    function renderBottomTrainsChart(sales) {
      const ctx = document.getElementById('bottomTrainsChart');
      if (!ctx) return;

      const trainMap = {};
      sales.forEach(s => {
        if (s.trainName) {
          if (!trainMap[s.trainName]) trainMap[s.trainName] = { target: 0, achievement: 0 };
          trainMap[s.trainName].target += Number(s.salesTarget) || 0;
          trainMap[s.trainName].achievement += Number(s.salesAchievement) || 0;
        }
      });

      const trainPerformance = Object.entries(trainMap)
        .map(([name, data]) => ({ name, pct: data.target > 0 ? (data.achievement / data.target) * 100 : 0 }))
        .sort((a, b) => a.pct - b.pct).slice(0, 10);

      if (charts.bottomTrains) charts.bottomTrains.destroy();
      charts.bottomTrains = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: trainPerformance.map(t => t.name),
          datasets: [{
            label: 'Achievement %',
            data: trainPerformance.map(t => Math.round(t.pct)),
            backgroundColor: '#ef4444',
            borderRadius: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          onClick: (e, elements) => {
            if (elements.length > 0) {
              const index = elements[0].index;
              chartFilter = { type: 'train', value: trainPerformance[index].name };
              loadDashboard();
            }
          },
          plugins: { legend: { display: false } },
          scales: {
            y: { beginAtZero: true, max: 120, grid: { color: '#e2e8f0' }, ticks: { color: '#64748b', font: { size: 10 } } },
            x: { grid: { display: false }, ticks: { color: '#64748b', font: { size: 10 } } }
          }
        }
      });
    }

    function renderManagerChart(sales) {
      const ctx = document.getElementById('managerChart');
      if (!ctx) return;

      const managerMap = {};
      const managerCollectKeys = {};
      sales.forEach(s => { if (s.trainManager) managerMap[s.trainManager] = (managerMap[s.trainManager] || 0) + (Number(s.gpAchievement) || 0); });

      const managers = Object.keys(managerMap);
      const managerTotal = managers.reduce((sum, manager) => sum + managerMap[manager], 0);
      const managerLabels = managers.map(manager => `${manager} (${managerTotal ? Math.round((managerMap[manager] / managerTotal) * 100) : 0}%)`);

      if (charts.manager) charts.manager.destroy();
      charts.manager = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: managerLabels,
          datasets: [{
            data: managers.map(m => managerMap[m]),
            backgroundColor: ['#0ea5e9', '#f59e0b', '#22c55e', '#ef4444', '#8b5cf6', '#06b6d4']
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          onClick: (e, elements) => {
            if (elements.length > 0) {
              const index = elements[0].index;
              chartFilter = { type: 'manager', value: managers[index] };
              loadDashboard();
            }
          },
          plugins: {
            legend: { position: 'bottom', labels: { color: '#64748b', font: { size: 10 } } },
            tooltip: {
              callbacks: {
                label: function(context) {
                  const value = context.raw;
                  const total = context.dataset.data.reduce((a, b) => a + b, 0);
                  const pct = total ? Math.round((value / total) * 100) : 0;
                  return `${managers[context.dataIndex] || context.label}: ${formatCurrency(value)} (${pct}%)`;
                }
              }
            }
          }
        }
      });
    }

    function renderTrainTypeChart(sales) {
      const ctx = document.getElementById('trainTypeChart');
      if (!ctx) return;

      const typeMap = {};
      sales.forEach(s => { const type = s.trainType || 'Unknown'; typeMap[type] = (typeMap[type] || 0) + (Number(s.salesAchievement) || 0); });

      const types = Object.keys(typeMap);
      const typeTotal = types.reduce((sum, type) => sum + typeMap[type], 0);
      const typeLabels = types.map(type => `${type} (${typeTotal ? Math.round((typeMap[type] / typeTotal) * 100) : 0}%)`);

      if (charts.trainType) charts.trainType.destroy();
      charts.trainType = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: typeLabels,
          datasets: [{
            data: types.map(t => typeMap[t]),
            backgroundColor: ['#0ea5e9', '#f59e0b', '#22c55e', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6']
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          onClick: (e, elements) => {
            if (elements.length > 0) {
              const index = elements[0].index;
              chartFilter = { type: 'trainType', value: types[index] };
              loadDashboard();
            }
          },
          plugins: {
            legend: { position: 'bottom', labels: { color: '#64748b', font: { size: 10 } } },
            tooltip: {
              callbacks: {
                label: function(context) {
                  const value = context.raw;
                  const total = context.dataset.data.reduce((a, b) => a + b, 0);
                  const pct = total ? Math.round((value / total) * 100) : 0;
                  return `${types[context.dataIndex] || context.label}: ${formatCurrency(value)} (${pct}%)`;
                }
              }
            }
          }
        }
      });
    }

    function renderTopBottomTables(sales) {
      const trainMap = {};
      sales.forEach(s => {
        if (s.trainName) {
          if (!trainMap[s.trainName]) trainMap[s.trainName] = { salesTarget: 0, salesAchievement: 0, gpTarget: 0, gpAchievement: 0 };
          trainMap[s.trainName].salesTarget += Number(s.salesTarget) || 0;
          trainMap[s.trainName].salesAchievement += Number(s.salesAchievement) || 0;
          trainMap[s.trainName].gpTarget += Number(s.gpTarget) || 0;
          trainMap[s.trainName].gpAchievement += Number(s.gpAchievement) || 0;
        }
      });

      const trainPerformance = Object.entries(trainMap).map(([name, data]) => ({
        name,
        salesPct: data.salesTarget > 0 ? Math.round((data.salesAchievement / data.salesTarget) * 100) : 0,
        gpPct: data.gpTarget > 0 ? Math.round((data.gpAchievement / data.gpTarget) * 100) : 0,
        salesAmount: data.salesAchievement,
        gpAmount: data.gpAchievement
      })).sort((a, b) => b.salesPct - a.salesPct);

      const top10 = trainPerformance.slice(0, 10);
      const bottom10 = [...trainPerformance].reverse().slice(0, 10);

      // Calculate totals
      const top10TotalSales = top10.reduce((sum, t) => sum + t.salesAmount, 0);
      const top10TotalGP = top10.reduce((sum, t) => sum + t.gpAmount, 0);
      const bottom10TotalSales = bottom10.reduce((sum, t) => sum + t.salesAmount, 0);
      const bottom10TotalGP = bottom10.reduce((sum, t) => sum + t.gpAmount, 0);

      document.getElementById('topTrainTableBody').innerHTML = 
        `<tr class="table-total-row">
          <td><strong>Total (Top 10)</strong></td>
          <td>-</td>
          <td>-</td>
          <td><strong>${formatCurrency(top10TotalSales)}</strong></td>
          <td><strong>${formatCurrency(top10TotalGP)}</strong></td>
        </tr>` +
        top10.map(t => `
        <tr style="cursor:pointer;" onclick="applyChartFilter('train','${encodeURIComponent(t.name)}')">
          <td>${t.name}</td>
          <td>${t.salesPct}%</td>
          <td>${t.gpPct}%</td>
          <td>${formatCurrency(t.salesAmount)}</td>
          <td>${formatCurrency(t.gpAmount)}</td>
        </tr>
      `).join('');

      document.getElementById('bottomTrainTableBody').innerHTML = 
        `<tr class="table-total-row">
          <td><strong>Total (Bottom 10)</strong></td>
          <td>-</td>
          <td>-</td>
          <td><strong>${formatCurrency(bottom10TotalSales)}</strong></td>
          <td><strong>${formatCurrency(bottom10TotalGP)}</strong></td>
        </tr>` +
        bottom10.map(t => `
        <tr style="cursor:pointer;" onclick="applyChartFilter('train','${encodeURIComponent(t.name)}')">
          <td>${t.name}</td>
          <td>${t.salesPct}%</td>
          <td>${t.gpPct}%</td>
          <td>${formatCurrency(t.salesAmount)}</td>
          <td>${formatCurrency(t.gpAmount)}</td>
        </tr>
      `).join('');
    }

    function renderPeriodComparisonTable(salesP1, salesP2) {
      // Create a map of all trains from both periods
      const trainMap = {};
      
      salesP1.forEach(s => {
        if (!trainMap[s.trainName]) trainMap[s.trainName] = { p1Sales: 0, p2Sales: 0, p1GP: 0, p2GP: 0 };
        trainMap[s.trainName].p1Sales += Number(s.salesAchievement) || 0;
        trainMap[s.trainName].p1GP += Number(s.gpAchievement) || 0;
      });
      
      salesP2.forEach(s => {
        if (!trainMap[s.trainName]) trainMap[s.trainName] = { p1Sales: 0, p2Sales: 0, p1GP: 0, p2GP: 0 };
        trainMap[s.trainName].p2Sales += Number(s.salesAchievement) || 0;
        trainMap[s.trainName].p2GP += Number(s.gpAchievement) || 0;
      });

      // Sort by GP variance (highest growth first)
      // Variance = P2 - P1 (Positive = growth = Good/Green, Negative = decline = Bad/Red)
      const rows = Object.entries(trainMap).map(([name, data]) => ({
        name, 
        p1Sales: data.p1Sales, 
        p2Sales: data.p2Sales,
        salesVariance: data.p2Sales - data.p1Sales,
        p1GP: data.p1GP, 
        p2GP: data.p2GP,
        gpVariance: data.p2GP - data.p1GP
      })).sort((a, b) => b.gpVariance - a.gpVariance);

      // Calculate totals
      const totalP1Sales = rows.reduce((sum, r) => sum + r.p1Sales, 0);
      const totalP2Sales = rows.reduce((sum, r) => sum + r.p2Sales, 0);
      const totalSalesVar = totalP2Sales - totalP1Sales;
      const totalP1GP = rows.reduce((sum, r) => sum + r.p1GP, 0);
      const totalP2GP = rows.reduce((sum, r) => sum + r.p2GP, 0);
      const totalGPVar = totalP2GP - totalP1GP;

      document.getElementById('momTableBody').innerHTML = 
        // Total row first
        `<tr class="table-total-row">
          <td><strong>Total (${rows.length} Trains)</strong></td>
          <td><strong>${formatCurrency(totalP1Sales)}</strong></td>
          <td><strong>${formatCurrency(totalP2Sales)}</strong></td>
          <td class="${totalSalesVar >= 0 ? 'comparison-positive' : 'comparison-negative'}"><strong>${totalSalesVar >= 0 ? '+' : ''}${formatCurrency(totalSalesVar)}</strong></td>
          <td><strong>${formatCurrency(totalP1GP)}</strong></td>
          <td><strong>${formatCurrency(totalP2GP)}</strong></td>
          <td class="${totalGPVar >= 0 ? 'comparison-positive' : 'comparison-negative'}"><strong>${totalGPVar >= 0 ? '+' : ''}${formatCurrency(totalGPVar)}</strong></td>
        </tr>` +
        rows.map(r => `
        <tr>
          <td>${r.name}</td>
          <td>${formatCurrency(r.p1Sales)}</td>
          <td>${formatCurrency(r.p2Sales)}</td>
          <td class="${r.salesVariance >= 0 ? 'comparison-positive' : 'comparison-negative'}">${r.salesVariance >= 0 ? '+' : ''}${formatCurrency(r.salesVariance)}</td>
          <td>${formatCurrency(r.p1GP)}</td>
          <td>${formatCurrency(r.p2GP)}</td>
          <td class="${r.gpVariance >= 0 ? 'comparison-positive' : 'comparison-negative'}">${r.gpVariance >= 0 ? '+' : ''}${formatCurrency(r.gpVariance)}</td>
        </tr>
      `).join('');
    }

    function renderManagerRankingTables(sales, complaints) {
      const buildRows = (field) => {
        const groups = {};
        sales.forEach(s => {
          const name = s[field] || 'Unassigned';
          if (!groups[name]) groups[name] = { salesTarget: 0, salesAchievement: 0, gpTarget: 0, gpAchievement: 0, complaints: 0 };
          groups[name].salesTarget += Number(s.salesTarget) || 0;
          groups[name].salesAchievement += Number(s.salesAchievement) || 0;
          groups[name].gpTarget += Number(s.gpTarget) || 0;
          groups[name].gpAchievement += Number(s.gpAchievement) || 0;
        });
        complaints.forEach(c => {
          const name = field === 'trainManager' ? (c.trainManager || getManagerFromTrainNumber(c.trainNo, c.trainName)) : getRakeManagerFromComplaint(c);
          if (!groups[name]) groups[name] = { salesTarget: 0, salesAchievement: 0, gpTarget: 0, gpAchievement: 0, complaints: 0 };
          groups[name].complaints++;
        });
        return Object.entries(groups).map(([name, data]) => {
          const salesPct = data.salesTarget > 0 ? (data.salesAchievement / data.salesTarget) * 100 : 0;
          const gpPct = data.gpTarget > 0 ? (data.gpAchievement / data.gpTarget) * 100 : 0;
          const complaintScore = Math.max(0, 100 - (data.complaints * 10));
          const score = (salesPct * 0.4) + (gpPct * 0.4) + (complaintScore * 0.2);
          return { name, salesPct, gpPct, complaints: data.complaints, score };
        }).sort((a, b) => b.score - a.score).slice(0, 10);
      };
      const render = (tbodyId, rows) => {
        const tbody = document.getElementById(tbodyId);
        if (!tbody) return;
        tbody.innerHTML = rows.length ? rows.map((r, i) => `
          <tr>
            <td>${i + 1}</td>
            <td>${r.name}</td>
            <td>${Math.round(r.salesPct)}%</td>
            <td>${Math.round(r.gpPct)}%</td>
            <td>${r.complaints}</td>
            <td><strong>${r.score.toFixed(1)}</strong></td>
          </tr>
        `).join('') : '<tr><td colspan="6" style="text-align:center;color:#64748b;">No ranking data available.</td></tr>';
      };
      render('trainManagerRankTableBody', buildRows('trainManager'));
      render('rakeManagerRankTableBody', buildRows('rakeManager'));
    }

    function renderTrainManagerSalesSummary(sales) {
      const tbody = document.getElementById('trainManagerSalesSummaryBody');
      if (!tbody) return;
      const getBank = (manager, phone) => getRakeManagerBankDetails(manager, phone);
      const groups = {};
      sales.forEach(s => {
        const manager = s.rakeManager || 'Unassigned';
        if (!groups[manager]) {
          groups[manager] = { phone: s.rakeManagerPhone || s.rakeManagerContact || '', trains: new Set(), entries: 0, totalSale: 0, totalGp: 0, managerSalary: 0 };
        }
        if (!groups[manager].phone) groups[manager].phone = s.rakeManagerPhone || s.rakeManagerContact || '';
        if (s.trainName) groups[manager].trains.add(s.trainName);
        groups[manager].entries += 1;
        groups[manager].totalSale += Number(s.salesAchievement || s.totalSale) || 0;
        groups[manager].totalGp += Number(s.gpAchievement) || 0;
        const salaryLines = Array.isArray(s.salaryDetails) ? s.salaryDetails : [];
        const mainSalary = salaryLines.length
          ? salaryLines.filter(line => line.post !== 'Assistant Rack Manager').reduce((sum, line) => sum + (Number(line.actualSalary) || 0), 0)
          : Number(s.managerSalary) || 0;
        groups[manager].managerSalary += mainSalary;
        salaryLines.filter(line => line.post === 'Assistant Rack Manager' && line.managerName).forEach(line => {
          const assistant = line.managerName || 'Assistant Rack Manager';
          if (!groups[assistant]) groups[assistant] = { phone: line.phone || '', trains: new Set(), entries: 0, totalSale: 0, totalGp: 0, managerSalary: 0 };
          if (!groups[assistant].phone) groups[assistant].phone = line.phone || '';
          if (s.trainName) groups[assistant].trains.add(s.trainName);
          groups[assistant].entries += 1;
          groups[assistant].managerSalary += Number(line.actualSalary) || 0;
        });
      });
      const rows = Object.entries(groups)
        .map(([manager, data]) => ({ manager, ...data, trainCount: data.trains.size }))
        .sort((a, b) => b.totalSale - a.totalSale);
      if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;color:#64748b;">No sales data available for selected period.</td></tr>';
        return;
      }
      const totalTrainSet = new Set();
      rows.forEach(r => r.trains.forEach(train => totalTrainSet.add(train)));
      const totalRow = rows.reduce((total, r) => ({
        trainCount: totalTrainSet.size,
        entries: total.entries + r.entries,
        totalSale: total.totalSale + r.totalSale,
        totalGp: total.totalGp + r.totalGp,
        managerSalary: total.managerSalary + r.managerSalary
      }), { trainCount: 0, entries: 0, totalSale: 0, totalGp: 0, managerSalary: 0 });
      tbody.innerHTML = `
        <tr class="summary-total-row">
          <td>Total</td>
          <td>-</td>
          <td>-</td>
          <td>-</td>
          <td>-</td>
          <td>-</td>
          <td>${totalRow.trainCount}</td>
          <td>${totalRow.entries}</td>
          <td>${formatCurrency(totalRow.totalSale)}</td>
          <td>${formatCurrency(totalRow.totalGp)}</td>
          <td>${formatCurrency(totalRow.managerSalary)}</td>
        </tr>
      ` + rows.map(r => `
        ${(() => {
          const bank = getBank(r.manager, r.phone);
          return `
        <tr>
          <td>${r.manager}</td>
          <td>${r.phone || '-'}</td>
          <td>${bank.aadhar || '-'}</td>
          <td>${bank.account || '-'}</td>
          <td>${bank.ifsc || '-'}</td>
          <td>${bank.bank || '-'}</td>
          <td>${r.trainCount}</td>
          <td>${r.entries}</td>
          <td>${formatCurrency(r.totalSale)}</td>
          <td>${formatCurrency(r.totalGp)}</td>
          <td>${formatCurrency(r.managerSalary)}</td>
        </tr>
          `;
        })()}
      `).join('');
    }

    function getRakeManagerBankDetails(managerName, phone = '') {
      const nameKey = normalizeText(managerName);
      const phoneKey = String(phone || '').replace(/\D/g, '');
      const match = (appData.trainMasters || []).find(t => {
        const masterName = normalizeText(t.rakeManager);
        const masterPhone = String(t.rakeManagerContact || t.rakeManagerPhone || '').replace(/\D/g, '');
        return masterName && masterName === nameKey && (!phoneKey || !masterPhone || masterPhone === phoneKey);
      }) || (appData.trainMasters || []).find(t => normalizeText(t.rakeManager) === nameKey);
      return {
        aadhar: match?.rakeManagerAadhar || '',
        account: match?.rakeManagerAccount || '',
        ifsc: match?.rakeManagerIfsc || '',
        bank: match?.rakeManagerBank || ''
      };
    }

    function renderRankTable(sales, complaints, cash) {
      const trainMap = {};
      
      sales.forEach(s => {
        if (!trainMap[s.trainName]) trainMap[s.trainName] = { salesTarget: 0, salesAchievement: 0, gpTarget: 0, gpAchievement: 0, complaints: 0, cashDeposited: 0 };
        trainMap[s.trainName].salesTarget += Number(s.salesTarget) || 0;
        trainMap[s.trainName].salesAchievement += Number(s.salesAchievement) || 0;
        trainMap[s.trainName].gpTarget += Number(s.gpTarget) || 0;
        trainMap[s.trainName].gpAchievement += Number(s.gpAchievement) || 0;
      });

      complaints.forEach(c => { if (trainMap[c.trainName]) trainMap[c.trainName].complaints++; });
      cash.forEach(c => { if (trainMap[c.trainName]) trainMap[c.trainName].cashDeposited += Number(c.totalDeposit) || 0; });

      const ranked = Object.entries(trainMap).map(([name, data]) => {
        const salesPct = data.salesTarget > 0 ? (data.salesAchievement / data.salesTarget) * 100 : 0;
        const gpPct = data.gpTarget > 0 ? (data.gpAchievement / data.gpTarget) * 100 : 0;
        const cashVsGpPct = data.gpAchievement > 0 ? (data.cashDeposited / data.gpAchievement) * 100 : 0;
        const complaintPenaltyFactor = Math.min(data.complaints, 10);

        // Weighted scoring model (100 points total)
        const salesScore = Math.max(0, Math.min(40, (salesPct / 100) * 40));
        const gpScore = Math.max(0, Math.min(35, (gpPct / 100) * 35));
        const cashScore = Math.max(0, Math.min(15, (cashVsGpPct / 100) * 15));
        const complaintScore = Math.max(0, 10 - complaintPenaltyFactor);
        const totalScore = salesScore + gpScore + cashScore + complaintScore;

        return {
          name,
          salesPct,
          gpPct,
          cashVsGpPct,
          complaintCount: data.complaints,
          salesScore,
          gpScore,
          cashScore,
          complaintScore,
          totalScore
        };
      }).sort((a, b) => b.totalScore - a.totalScore);

      document.getElementById('rankTableBody').innerHTML = ranked.map((t, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${t.name}</td>
          <td>${Math.round(t.salesPct)}%</td>
          <td>${Math.round(t.gpPct)}%</td>
          <td>${Math.round(t.cashVsGpPct)}%</td>
          <td>${t.complaintCount}</td>
          <td>${t.salesScore.toFixed(1)}</td>
          <td>${t.gpScore.toFixed(1)}</td>
          <td>${t.cashScore.toFixed(1)}</td>
          <td>${t.complaintScore.toFixed(1)}</td>
          <td><strong>${t.totalScore.toFixed(1)}</strong></td>
        </tr>
      `).join('');
    }

    function findExistingTrainMasterForImport(train) {
      const incomingTrainKey = buildTrainKey(train.trainNumber, train.trainName);
      const incomingRakeNumber = normalizeText(train.rakeNumber);
      const incomingRakeManager = normalizeText(train.rakeManager);
      const incomingTrainManager = normalizeText(train.trainManager);
      return (appData.trainMasters || []).find(t =>
        buildTrainKey(t.trainNumber, t.trainName) === incomingTrainKey &&
        normalizeText(t.rakeNumber) === incomingRakeNumber &&
        normalizeText(t.rakeManager) === incomingRakeManager &&
        normalizeText(t.trainManager) === incomingTrainManager
      );
    }

    function mergeImportedMasterRow(existing, incoming) {
      const merged = { ...existing, ...incoming, id: existing.id };
      Object.keys(incoming).forEach(key => {
        if (key === 'id') return;
        const value = incoming[key];
        if (value === '' || value === null || value === undefined) merged[key] = existing[key] ?? value;
      });
      return merged;
    }

    function findExistingTargetForImport(target) {
      const targetKey = buildTrainKey(target.trainNumber, target.trainName);
      const sameTrainTargets = (appData.targetMasters || []).filter(t =>
        buildTrainKey(t.trainNumber, t.trainName) === targetKey
      );
      if (!sameTrainTargets.length) return null;
      return sameTrainTargets.find(t =>
        (t.validFrom || '') === (target.validFrom || '') &&
        (t.validTo || '') === (target.validTo || '')
      ) || sameTrainTargets.sort((a, b) => String(b.validFrom || '').localeCompare(String(a.validFrom || '')))[0];
    }

    function getRakeOptionsForTrainRack(trainNumber, trainName, rakeNumber, dateValue) {
      const rakeKey = normalizeText(rakeNumber);
      let options = getRakeOptionsForTrain(trainNumber, trainName, dateValue);
      if (rakeKey) options = options.filter(t => normalizeText(t.rakeNumber) === rakeKey);
      if (!options.length && rakeKey) {
        options = getPreferredTrainMasterMatches(trainNumber, trainName)
          .filter(t => normalizeText(t.rakeNumber) === rakeKey)
          .filter(t => t.rakeManager || t.rakeNumber);
      }
      const seen = new Set();
      return options.filter(t => {
        const key = `${normalizeText(t.rakeNumber)}|${normalizeText(t.rakeManager)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).sort((a, b) => String(a.rakeManager || '').localeCompare(String(b.rakeManager || '')));
    }

    function getRakeManagerFromComplaint(c) {
      if (c.rakeManager) return c.rakeManager;
      const effective = getEffectiveMaster(c.trainNo, c.trainName, c.date, c.rakeManager, c.rakeNumber);
      return effective?.rakeManager || 'Unassigned';
    }

    function getRakeManagerPhoneFromEntry(entry) {
      if (entry?.rakeManagerContact || entry?.rakeManagerPhone) return entry.rakeManagerContact || entry.rakeManagerPhone;
      const effective = getEffectiveMaster(entry?.trainNumber || entry?.trainNo, entry?.trainName, entry?.date, entry?.rakeManager, entry?.rakeNumber);
      return effective?.rakeManagerContact || effective?.rakeManagerPhone || '';
    }

    function refreshSalesTargetForDate() {
      const trainId = document.getElementById('salesTrainId')?.value;
      const saleDate = document.getElementById('salesDate')?.value;
      if (!trainId || !saleDate) return;
      const selected = (appData.trainMasters || []).find(t => t.id == trainId);
      if (!selected) return;
      const effective = getEffectiveMaster(selected.trainNumber, selected.trainName, saleDate, selected.rakeManager, selected.rakeNumber) || selected;
      document.getElementById('salesTarget').value = getTrainSalesTarget(selected.trainNumber, selected.trainName, saleDate);
      document.getElementById('salesGpTarget').value = getTrainGpTarget(selected.trainNumber, selected.trainName, saleDate);
      document.getElementById('salesClusterManager').value = effective.clusterManager || '';
      document.getElementById('salesTrainManager').value = effective.trainManager || '';
      populateSalesRakeManagers(effective, effective.rakeManager || selected.rakeManager || '');
      checkExistingSalesForSelectedTrain();
      calculateSalesPct();
      calculateGpPct();
    }


    // ==================== HELPER: Get Manager from Train Number (first 5 digits) ====================
    function getManagerFromTrainNumber(trainNo, trainName) {
      if (!trainNo && !trainName) return 'Unassigned';
      
      // Extract first 5 digits from train number
      const trainNum5 = trainNo ? String(trainNo).replace(/\D/g, '').substring(0, 5) : '';
      
      // First try to find in train master data using first 5 digits
      if (trainNum5) {
        const trainMaster = appData.trainMasters.find(t => {
          const masterNum5 = String(t.trainNumber).replace(/\D/g, '').substring(0, 5);
          return masterNum5 === trainNum5;
        });
        
        if (trainMaster && trainMaster.trainManager && trainMaster.trainManager !== 'Unassigned') {
          return trainMaster.trainManager;
        }
      }
      
      // Try matching by train name
      if (trainName) {
        const trainByName = appData.trainMasters.find(t => 
          t.trainName && t.trainName.toLowerCase() === trainName.toLowerCase()
        );
        if (trainByName && trainByName.trainManager && trainByName.trainManager !== 'Unassigned') {
          return trainByName.trainManager;
        }
      }
      
      // If not found in master, try to get from sales data
      if (trainNum5) {
        const salesEntry = appData.sales.find(s => {
          const salesNum5 = String(s.trainNumber).replace(/\D/g, '').substring(0, 5);
          return salesNum5 === trainNum5;
        });
        
        if (salesEntry && salesEntry.trainManager && salesEntry.trainManager !== 'Unassigned') {
          return salesEntry.trainManager;
        }
      }
      
      // Try sales data by train name
      if (trainName) {
        const salesByName = appData.sales.find(s => 
          s.trainName && s.trainName.toLowerCase() === trainName.toLowerCase()
        );
        if (salesByName && salesByName.trainManager && salesByName.trainManager !== 'Unassigned') {
          return salesByName.trainManager;
        }
      }
      
      return 'Unassigned';
    }

    // ==================== COMPLAINT DASHBOARD ====================
    function loadComplaintDashboard() {
      const dateMode = getComplaintDateMode();
      // Get data for both periods
      const complaintsP1 = getFilteredComplaints(1); // Current/Period 1
      const complaintsP2 = getFilteredComplaints(2); // Previous/Period 2
      
      // Variance = P1 - P2. Positive means recent/current complaints increased, which is bad.
      const variance = complaintsP1.length - complaintsP2.length;

      // Get date ranges for display
      const fromDate1 = dateMode === 'single' ? document.getElementById('compSingleFromDate')?.value : document.getElementById('compFromDate1')?.value;
      const toDate1 = dateMode === 'single' ? (document.getElementById('compSingleToDate')?.value || fromDate1) : document.getElementById('compToDate1')?.value;
      const fromDate2 = document.getElementById('compFromDate2')?.value;
      const toDate2 = document.getElementById('compToDate2')?.value;
      
      document.getElementById('compKpiCurrent').textContent = complaintsP1.length;
      document.getElementById('compKpiCurrentRange').textContent = fromDate1 && toDate1 ? 
        `${fromDate1} to ${toDate1}` : 'Period 1';
      
      document.getElementById('compKpiPrevious').textContent = complaintsP2.length;
      document.getElementById('compKpiPreviousRange').textContent = fromDate2 && toDate2 ? 
        `${fromDate2} to ${toDate2}` : (dateMode === 'single' ? 'Comparison disabled' : 'Period 2');
      
      document.getElementById('compKpiVariance').textContent = (variance >= 0 ? '+' : '') + variance;
      
      const varianceCard = document.getElementById('compKpiVarianceCard');
      const varianceSub = document.getElementById('compKpiVarianceSub');
      if (dateMode === 'single') {
        varianceCard.className = 'kpi-card info';
        varianceSub.textContent = 'Comparison disabled in single period mode';
      } else if (variance > 0) {
        varianceCard.className = 'kpi-card danger';
        varianceSub.textContent = 'Complaints increased';
      } else if (variance < 0) {
        varianceCard.className = 'kpi-card success';
        varianceSub.textContent = 'Complaints reduced';
      } else {
        varianceCard.className = 'kpi-card info';
        varianceSub.textContent = 'No change';
      }

      renderComplaintTrendChart(complaintsP1, complaintsP2);
      renderComplaintTrainChart(complaintsP1, complaintsP2);
      renderComplaintSourceChart(complaintsP1);
      renderComplaintYardChart(complaintsP1, complaintsP2);
      renderManagerComplaintChart(complaintsP1, complaintsP2);
      renderNatureAnalysisChart(complaintsP1, complaintsP2);

      renderTopTrainsTable(complaintsP1, complaintsP2);
      renderRepeatComplainantTable(complaintsP1);
      renderComplaintFeedbackTable(complaintsP1);
      
      renderComplaintComparisonTables(complaintsP1, complaintsP2);
      updateCompChartFilterDisplay();
      if (!(appData.complaints || []).length && !noDataPopupShown.complaints) {
        noDataPopupShown.complaints = true;
        showAlert('No complaint data uploaded.', 'warning');
      }
    }

    function updateCompChartFilterDisplay() {
      const display = document.getElementById('compChartFilterDisplay');
      const text = document.getElementById('compChartFilterText');
      const filters = getActiveComplaintChartFilters();
      if (filters.length) {
        display.style.display = 'block';
        text.textContent = filters.map(f => `${f.type}: ${f.value}`).join(' + ');
      } else {
        display.style.display = 'none';
      }
    }

    function makeBarValueLabelsPlugin(pluginId = 'barValueLabels') {
      return {
        id: pluginId,
        afterDatasetsDraw(chart) {
          drawBarValueLabels(chart);
        }
      };
    }

    function drawBarValueLabels(chart) {
      if (!chart || !chart.ctx || !chart.chartArea) return;
      const { ctx } = chart;
      ctx.save();
      ctx.font = '700 11px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      chart.data.datasets.forEach((dataset, datasetIndex) => {
        const meta = chart.getDatasetMeta(datasetIndex);
        if (meta.hidden) return;
        meta.data.forEach((bar, index) => {
          const value = Number(dataset.data[index]) || 0;
          if (!value) return;
          const props = typeof bar.getProps === 'function' ? bar.getProps(['x', 'y', 'base'], true) : bar;
          const x = props.x;
          const y = props.y;
          const base = props.base || chart.chartArea.bottom;
          const barHeight = Math.abs(base - y);
          const drawInside = barHeight > 18;
          ctx.fillStyle = drawInside ? '#fff' : (Array.isArray(dataset.backgroundColor) ? dataset.backgroundColor[index] : dataset.backgroundColor) || dataset.borderColor || '#1e293b';
          ctx.fillText(String(value), x, drawInside ? y + 12 : y - 10);
        });
      });
      ctx.restore();
    }

    function renderComplaintTrendChart(current, prev) {
      const ctx = document.getElementById('complaintTrendChart');
      if (!ctx) return;

      const currentByDate = {}; current.forEach(c => { currentByDate[c.date] = (currentByDate[c.date] || 0) + 1; });
      const prevByDate = {}; prev.forEach(c => { prevByDate[c.date] = (prevByDate[c.date] || 0) + 1; });
      const allDates = [...new Set([...Object.keys(currentByDate), ...Object.keys(prevByDate)])].sort();
      const complaintValueLabels = {
        id: 'complaintValueLabels',
        afterDatasetsDraw(chart) {
          const { ctx } = chart;
          ctx.save();
          ctx.font = '600 10px Arial';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          chart.data.datasets.forEach((dataset, datasetIndex) => {
            const meta = chart.getDatasetMeta(datasetIndex);
            if (meta.hidden) return;
            meta.data.forEach((point, index) => {
              const value = Number(dataset.data[index]) || 0;
              if (!value) return;
              ctx.fillStyle = dataset.borderColor || '#1e293b';
              ctx.fillText(String(value), point.x, point.y - 8);
            });
          });
          ctx.restore();
        }
      };

      if (charts.complaintTrend) charts.complaintTrend.destroy();
      charts.complaintTrend = new Chart(ctx, {
        type: 'line',
        data: {
          labels: allDates,
          datasets: [
            { label: 'Period 1', data: allDates.map(d => currentByDate[d] || 0), borderColor: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.1)', fill: true, tension: 0.4 },
            { label: 'Period 2', data: allDates.map(d => prevByDate[d] || 0), borderColor: '#22c55e', backgroundColor: 'rgba(34, 197, 94, 0.1)', fill: true, tension: 0.4 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          onClick: (e, elements) => {
            if (elements.length > 0) {
              const index = elements[0].index;
              toggleComplaintChartFilter('date', allDates[index]);
            }
          },
          plugins: { legend: { labels: { color: '#64748b', font: { size: 10 } } } },
          scales: {
            y: { beginAtZero: true, grid: { color: '#e2e8f0' }, ticks: { color: '#64748b', font: { size: 10 } } },
            x: { grid: { display: false }, ticks: { color: '#64748b', font: { size: 10 } } }
          }
        },
        plugins: [complaintValueLabels]
      });
    }

    function renderComplaintStatusChart(current, prev) {
      const ctx = document.getElementById('complaintStatusChart');
      if (!ctx) return;

      const statuses = ['Open', 'In Progress', 'Closed'];
      const currentCounts = statuses.map(s => current.filter(c => c.status === s).length);
      const prevCounts = statuses.map(s => prev.filter(c => c.status === s).length);

      if (charts.complaintStatus) charts.complaintStatus.destroy();
      charts.complaintStatus = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: statuses,
          datasets: [
            { label: 'Period 1', data: currentCounts, backgroundColor: '#0ea5e9', borderRadius: 4 },
            { label: 'Period 2', data: prevCounts, backgroundColor: '#f59e0b', borderRadius: 4 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          onClick: (e, elements) => {
            if (elements.length > 0) {
              const index = elements[0].index;
              toggleComplaintChartFilter('status', statuses[index]);
            }
          },
          plugins: { legend: { labels: { color: '#64748b', font: { size: 10 } } } },
          scales: {
            y: { beginAtZero: true, grace: '12%', grid: { color: '#e2e8f0' }, ticks: { color: '#64748b', font: { size: 10 } } },
            x: { grid: { display: false }, ticks: { color: '#64748b', font: { size: 10 } } }
          }
        }
      });
    }

    function renderComplaintTrainChart(current, prev) {
      const ctx = document.getElementById('complaintTrainChart');
      if (!ctx) return;

      const trainMap = {};
      [...current, ...prev].forEach(c => { if (!trainMap[c.trainName]) trainMap[c.trainName] = { current: 0, prev: 0 }; });
      current.forEach(c => { if (trainMap[c.trainName]) trainMap[c.trainName].current++; });
      prev.forEach(c => { if (trainMap[c.trainName]) trainMap[c.trainName].prev++; });

      const sorted = Object.entries(trainMap).sort((a, b) => (b[1].current + b[1].prev) - (a[1].current + a[1].prev)).slice(0, 12);

      if (charts.complaintTrain) charts.complaintTrain.destroy();
      charts.complaintTrain = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: sorted.map(t => t[0]),
          datasets: [
            { label: 'P1', data: sorted.map(t => t[1].current), backgroundColor: '#ef4444', borderRadius: 4 },
            { label: 'P2', data: sorted.map(t => t[1].prev), backgroundColor: '#22c55e', borderRadius: 4 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          onClick: (e, elements) => {
            if (elements.length > 0) {
              const index = elements[0].index;
              toggleComplaintChartFilter('train', sorted[index][0]);
            }
          },
          plugins: { legend: { labels: { color: '#64748b', font: { size: 10 } } } },
          scales: {
            y: { beginAtZero: true, grace: '12%', grid: { color: '#e2e8f0' }, ticks: { color: '#64748b', font: { size: 10 } } },
            x: { grid: { display: false }, ticks: { color: '#64748b', font: { size: 10 } } }
          }
        },
        plugins: [makeBarValueLabelsPlugin('complaintTrainValueLabels')]
      });
      setTimeout(() => drawBarValueLabels(charts.complaintTrain), 80);
    }

    function renderComplaintSourceChart(complaints) {
      const ctx = document.getElementById('complaintSourceChart');
      if (!ctx) return;

      const sourceMap = {};
      complaints.forEach(c => { const source = c.source || 'Unknown'; sourceMap[source] = (sourceMap[source] || 0) + 1; });

      if (charts.complaintSource) charts.complaintSource.destroy();
      charts.complaintSource = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: Object.keys(sourceMap),
          datasets: [{
            data: Object.values(sourceMap),
            backgroundColor: ['#0ea5e9', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4']
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          onClick: (e, elements) => {
            if (elements.length > 0) {
              const index = elements[0].index;
              toggleComplaintChartFilter('source', Object.keys(sourceMap)[index]);
            }
          },
          plugins: {
            legend: { position: 'right', labels: { color: '#64748b', font: { size: 10 } } }
          }
        }
      });
    }

    function renderComplaintYardChart(current, prev) {
      const ctx = document.getElementById('complaintYardChart');
      if (!ctx) return;

      const yardMap = {};
      [...current, ...prev].forEach(c => {
        const yard = c.yard || 'Unknown';
        if (!yardMap[yard]) yardMap[yard] = { p1: 0, p2: 0 };
      });
      current.forEach(c => { yardMap[c.yard || 'Unknown'].p1++; });
      prev.forEach(c => { yardMap[c.yard || 'Unknown'].p2++; });

      const yards = Object.keys(yardMap);
      if (charts.complaintYard) charts.complaintYard.destroy();
      charts.complaintYard = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: yards,
          datasets: [
            { label: 'P1', data: yards.map(y => yardMap[y].p1), backgroundColor: '#0ea5e9', borderRadius: 4 },
            { label: 'P2', data: yards.map(y => yardMap[y].p2), backgroundColor: '#f59e0b', borderRadius: 4 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          onClick: (e, elements) => {
            if (elements.length > 0) {
              const index = elements[0].index;
              toggleComplaintChartFilter('yard', yards[index]);
            }
          },
          plugins: { legend: { position: 'top', labels: { color: '#64748b', font: { size: 10 } } } },
          scales: {
            y: { beginAtZero: true, grid: { color: '#e2e8f0' }, ticks: { color: '#64748b', font: { size: 10 } } },
            x: { grid: { display: false }, ticks: { color: '#64748b', font: { size: 10 } } }
          }
        }
      });
    }

    function renderManagerComplaintChart(current, prev) {
      const ctx = document.getElementById('managerComplaintChart');
      if (!ctx) return;

      const managerMap = {};
      
      current.forEach(c => {
        const manager = getRakeManagerFromComplaint(c);
        if (!managerMap[manager]) managerMap[manager] = { current: 0, prev: 0 };
        managerMap[manager].current++;
      });

      prev.forEach(c => {
        const manager = getRakeManagerFromComplaint(c);
        if (!managerMap[manager]) managerMap[manager] = { current: 0, prev: 0 };
        managerMap[manager].prev++;
      });

      // Filter out 'Unassigned' if there are actual managers, otherwise keep it
      let managers = Object.keys(managerMap);
      const hasRealManagers = managers.some(m => m !== 'Unassigned');
      if (hasRealManagers) {
        managers = managers.filter(m => m !== 'Unassigned');
      }
      managers.sort((a, b) => managerMap[b].current - managerMap[a].current);
      
      const totalCurrent = current.length || 1;
      
      // Red only when current complaints are higher than the previous comparison period.
      const colors = managers.map((m, i) => managerMap[m].current > managerMap[m].prev ? '#ef4444' : ['#0ea5e9', '#f59e0b', '#22c55e', '#8b5cf6', '#06b6d4', '#ec4899'][i % 6]);

      if (charts.managerComplaint) charts.managerComplaint.destroy();
      charts.managerComplaint = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: managers,
          datasets: [{
            data: managers.map(m => managerMap[m].current),
            backgroundColor: colors,
            borderWidth: 2,
            borderColor: '#fff'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '60%',
          onClick: (e, elements) => {
            if (elements.length > 0) {
              const index = elements[0].index;
              toggleComplaintChartFilter('rakeManager', managers[index]);
            }
          },
          plugins: { 
            legend: { 
              position: 'bottom', 
              labels: { 
                color: '#64748b', 
                font: { size: 10 },
                generateLabels: function(chart) {
                  const data = chart.data;
                  return data.labels.map((label, i) => ({
                    text: `${label} (${Math.round((data.datasets[0].data[i] / totalCurrent) * 100)}%)`,
                    fillStyle: data.datasets[0].backgroundColor[i],
                    hidden: false,
                    index: i
                  }));
                }
              } 
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  const manager = managers[context.dataIndex];
                  const count = managerMap[manager].current;
                  const pct = Math.round((count / totalCurrent) * 100);
                  return `${manager}: ${count} complaints (${pct}%)`;
                }
              }
            }
          }
        }
      });
    }

    function renderNatureAnalysisChart(current, prev) {
      const ctx = document.getElementById('natureAnalysisChart');
      if (!ctx) return;

      // Use complaintType or complainNature - whichever has data
      const natureMap = {};
      
      // Initialize map with all unique values from both periods
      [...current, ...prev].forEach(c => {
        // Use complainNature first, fallback to complaintType, then to 'Unknown'
        const nature = c.complainNature || c.complaintType || 'Unknown';
        if (nature) {
          if (!natureMap[nature]) natureMap[nature] = { current: 0, prev: 0 };
        }
      });

      // Count Period 1 complaints
      current.forEach(c => {
        const nature = c.complainNature || c.complaintType || 'Unknown';
        if (natureMap[nature] !== undefined) {
          natureMap[nature].current++;
        }
      });

      // Count Period 2 complaints
      prev.forEach(c => {
        const nature = c.complainNature || c.complaintType || 'Unknown';
        if (natureMap[nature] !== undefined) {
          natureMap[nature].prev++;
        }
      });

      // Sort by Period 1 count (descending) and take top 15
      const sortedNatures = Object.entries(natureMap)
        .filter(([name, data]) => data.current > 0 || data.prev > 0) // Only show natures with complaints
        .sort((a, b) => b[1].current - a[1].current)
        .slice(0, 15);
      
      const natures = sortedNatures.map(n => n[0]);
      
      // If no natures found, show a message
      if (natures.length === 0) {
        if (charts.natureAnalysis) charts.natureAnalysis.destroy();
        return;
      }

      if (charts.natureAnalysis) charts.natureAnalysis.destroy();
      charts.natureAnalysis = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: natures,
          datasets: [
            { label: 'Period 1', data: natures.map(n => natureMap[n].current), backgroundColor: '#ef4444', borderRadius: 4 },
            { label: 'Period 2', data: natures.map(n => natureMap[n].prev), backgroundColor: '#22c55e', borderRadius: 4 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          onClick: (e, elements) => {
            if (elements.length > 0) {
              const index = elements[0].index;
              toggleComplaintChartFilter('nature', natures[index]);
            }
          },
          plugins: { legend: { labels: { color: '#64748b', font: { size: 10 } } } },
          scales: {
            y: { beginAtZero: true, grid: { color: '#e2e8f0' }, ticks: { color: '#64748b', font: { size: 10 } } },
            x: { grid: { display: false }, ticks: { color: '#64748b', font: { size: 9 }, maxRotation: 45, minRotation: 45 } }
          }
        },
        plugins: [makeBarValueLabelsPlugin('natureAnalysisValueLabels')]
      });
    }

    // ==================== NEW COMPLAINT ANALYSIS CHARTS ====================
    
    function renderComplaintTypeChart(current, prev) {
      const ctx = document.getElementById('complaintTypeChart');
      if (!ctx) return;

      // Combine all complaints and count by type
      const allComplaints = [...current, ...prev];
      const typeMap = {};
      
      allComplaints.forEach(c => {
        const type = c.complaintType || 'Unknown';
        typeMap[type] = (typeMap[type] || 0) + 1;
      });

      const types = Object.keys(typeMap);
      const counts = Object.values(typeMap);
      
      // Colors for pie chart
      const colors = ['#0ea5e9', '#f59e0b', '#22c55e', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#14b8a6'];

      if (charts.complaintType) charts.complaintType.destroy();
      charts.complaintType = new Chart(ctx, {
        type: 'pie',
        data: {
          labels: types,
          datasets: [{
            data: counts,
            backgroundColor: colors,
            borderWidth: 2,
            borderColor: '#fff'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { 
              position: 'right', 
              labels: { 
                color: '#64748b', 
                font: { size: 10 },
                generateLabels: function(chart) {
                  const data = chart.data;
                  const total = data.datasets[0].data.reduce((a, b) => a + b, 0);
                  return data.labels.map((label, i) => ({
                    text: `${label} (${data.datasets[0].data[i]}) - ${Math.round((data.datasets[0].data[i]/total)*100)}%`,
                    fillStyle: data.datasets[0].backgroundColor[i],
                    hidden: false,
                    index: i
                  }));
                }
              } 
            },
            tooltip: {
              callbacks: {
                label: function(context) {
                  const total = context.dataset.data.reduce((a, b) => a + b, 0);
                  const value = context.dataset.data[context.dataIndex];
                  const pct = Math.round((value / total) * 100);
                  return `${context.label}: ${value} (${pct}%)`;
                }
              }
            }
          }
        }
      });
    }

    function renderManagerResolutionChart(current, prev) {
      const ctx = document.getElementById('managerResolutionChart');
      if (!ctx) return;

      // Combine all complaints
      const allComplaints = [...current, ...prev];
      
      // Build manager resolution map
      const managerMap = {};
      
      allComplaints.forEach(c => {
        const manager = getManagerFromTrainNumber(c.trainNo, c.trainName);
        if (!managerMap[manager]) {
          managerMap[manager] = { open: 0, closed: 0, inProgress: 0 };
        }
        if (c.status === 'Open') managerMap[manager].open++;
        else if (c.status === 'Closed') managerMap[manager].closed++;
        else if (c.status === 'In Progress') managerMap[manager].inProgress++;
      });

      // Filter out unassigned if there are real managers
      let managers = Object.keys(managerMap);
      const hasRealManagers = managers.some(m => m !== 'Unassigned');
      if (hasRealManagers) {
        managers = managers.filter(m => m !== 'Unassigned');
      }

      if (charts.managerResolution) charts.managerResolution.destroy();
      charts.managerResolution = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: managers,
          datasets: [
            { label: 'Open', data: managers.map(m => managerMap[m].open), backgroundColor: '#ef4444', borderRadius: 4 },
            { label: 'In Progress', data: managers.map(m => managerMap[m].inProgress), backgroundColor: '#f59e0b', borderRadius: 4 },
            { label: 'Closed', data: managers.map(m => managerMap[m].closed), backgroundColor: '#22c55e', borderRadius: 4 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { labels: { color: '#64748b', font: { size: 10 } } } },
          scales: {
            y: { beginAtZero: true, stacked: true, grid: { color: '#e2e8f0' }, ticks: { color: '#64748b', font: { size: 10 } } },
            x: { stacked: true, grid: { display: false }, ticks: { color: '#64748b', font: { size: 9 } } }
          }
        }
      });
    }

    function renderSourceTrendChart(current, prev) {
      const ctx = document.getElementById('sourceTrendChart');
      if (!ctx) return;

      // Combine all complaints
      const allComplaints = [...current, ...prev];
      
      // Get unique sources
      const sources = [...new Set(allComplaints.map(c => c.source || 'Unknown'))];
      
      // Get all unique dates
      const allDates = [...new Set(allComplaints.map(c => c.date))].sort();
      
      // Build datasets for each source
      const datasets = sources.map((source, index) => {
        const colors = ['#0ea5e9', '#f59e0b', '#22c55e', '#ef4444', '#8b5cf6', '#06b6d4'];
        const data = allDates.map(date => {
          return allComplaints.filter(c => c.date === date && (c.source || 'Unknown') === source).length;
        });
        
        return {
          label: source,
          data: data,
          borderColor: colors[index % colors.length],
          backgroundColor: colors[index % colors.length] + '20',
          fill: false,
          tension: 0.4,
          pointRadius: 3
        };
      });

      if (charts.sourceTrend) charts.sourceTrend.destroy();
      charts.sourceTrend = new Chart(ctx, {
        type: 'line',
        data: {
          labels: allDates,
          datasets: datasets
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { labels: { color: '#64748b', font: { size: 10 } } } },
          scales: {
            y: { beginAtZero: true, grid: { color: '#e2e8f0' }, ticks: { color: '#64748b', font: { size: 10 } } },
            x: { grid: { display: false }, ticks: { color: '#64748b', font: { size: 9 } } }
          }
        }
      });
    }


    function renderRepeatComplainantTable(complaints) {
      const tbody = document.getElementById('repeatComplaintTableBody');
      if (!tbody) return;

      const grouped = {};
      (complaints || []).forEach(c => {
        const mobile = normalizeMobileNo(c.mobileNo);
        if (!mobile) return;
        if (!grouped[mobile]) grouped[mobile] = [];
        grouped[mobile].push(c);
      });

      const rows = Object.entries(grouped)
        .map(([mobile, list]) => {
          const sorted = list.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
          const latest = sorted[0] || {};
          const openCount = list.filter(c => c.status === 'Open' || c.status === 'In Progress').length;
          return { mobile, count: list.length, openCount, latest };
        })
        .sort((a, b) => b.count - a.count || new Date(b.latest.date || 0) - new Date(a.latest.date || 0))
        .slice(0, 20);

      tbody.innerHTML = rows.length ? rows.map(r => `
        <tr style="cursor:pointer;" onclick="applyComplaintFilter('mobile', encodeURIComponent('${r.mobile}'))">
          <td>${r.mobile}</td>
          <td>${r.count}</td>
          <td>${r.openCount}</td>
          <td>${formatDate(r.latest.date)}</td>
          <td>${r.latest.trainName || '-'}</td>
          <td>${r.latest.complainNature || '-'}</td>
        </tr>
      `).join('') : '<tr><td colspan="6" style="text-align:center;color:#64748b;">No mobile number data in this period</td></tr>';
    }


    function getComplaintRakeManagerPhone(complaint) {
      if (complaint?.rakeManagerContact || complaint?.rakeManagerPhone) return complaint.rakeManagerContact || complaint.rakeManagerPhone;
      const effective = getEffectiveMaster(complaint?.trainNo || complaint?.trainNumber, complaint?.trainName, complaint?.date, complaint?.rakeManager, complaint?.rakeNumber);
      return effective?.rakeManagerContact || effective?.rakeManagerPhone || '';
    }

    function renderComplaintFeedbackTable(complaints) {
      const tbody = document.getElementById('complaintFeedbackTableBody');
      if (!tbody) return;

      const rows = (complaints || [])
        .slice()
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 200);

      tbody.innerHTML = rows.length ? rows.map(c => {
        const trainDetail = `${c.trainName || '-'}${c.trainNo || c.trainNumber ? ' (' + (c.trainNo || c.trainNumber) + ')' : ''}${c.rakeNumber ? ' / Rake ' + c.rakeNumber : ''}`;
        return `
          <tr>
            <td>${formatDate(c.date)}</td>
            <td><span class="badge badge-${c.status === 'Closed' ? 'success' : c.status === 'In Progress' ? 'warning' : 'danger'}">${c.status || 'Open'}</span></td>
            <td>${c.rakeManager || '-'}</td>
            <td>${getComplaintRakeManagerPhone(c) || '-'}</td>
            <td>${c.mobileNo || '-'}</td>
            <td>${trainDetail}</td>
            <td>${c.complainNature || '-'}</td>
            <td>${c.referenceNo || '-'}</td>
          </tr>
        `;
      }).join('') : '<tr><td colspan="8" style="text-align:center;color:#64748b;">No complaint data in this period</td></tr>';
    }

    function renderTopTrainsTable(current, prev) {
      const tbody = document.getElementById('topTrainsTableBody');
      if (!tbody) return;

      const table = document.getElementById('topTrainsTable');
      if (table) {
        const headerRow = table.querySelector('thead tr');
        if (headerRow) {
          headerRow.innerHTML = `
            <th>Rank</th>
            <th>Rake Manager</th>
            <th>Linked Trains</th>
            <th>Current</th>
            <th>Previous</th>
            <th>Increase</th>
            <th>Open</th>
            <th>Closed</th>
          `;
        }
      }

      const managerMap = {};
      prev.forEach(c => {
        const manager = getRakeManagerFromComplaint(c);
        if (!managerMap[manager]) {
          managerMap[manager] = {
            total: 0,
            previous: 0,
            open: 0,
            closed: 0,
            inProgress: 0,
            trains: new Set()
          };
        }
        managerMap[manager].previous++;
      });
      current.forEach(c => {
        const manager = getRakeManagerFromComplaint(c);
        if (!managerMap[manager]) {
          managerMap[manager] = {
            total: 0,
            previous: 0,
            open: 0,
            closed: 0,
            inProgress: 0,
            trains: new Set()
          };
        }
        managerMap[manager].total++;
        if (c.trainName) managerMap[manager].trains.add(c.trainName);
        if (c.status === 'Open') managerMap[manager].open++;
        else if (c.status === 'Closed') managerMap[manager].closed++;
        else if (c.status === 'In Progress') managerMap[manager].inProgress++;
      });

      const sortedManagers = Object.entries(managerMap)
        .sort((a, b) => b[1].total - a[1].total);

      tbody.innerHTML = sortedManagers.map(([name, data], index) => `
        <tr class="${data.total > data.previous ? 'high-complaint' : ''}">
          <td>${index + 1}</td>
          <td>${name}</td>
          <td>${[...data.trains].slice(0, 5).join(', ') || '-'}</td>
          <td><strong>${data.total}</strong></td>
          <td>${data.previous}</td>
          <td class="${data.total > data.previous ? 'complaint-variance-positive' : 'complaint-variance-neutral'}">${data.total - data.previous > 0 ? '+' : ''}${data.total - data.previous}</td>
          <td><span class="badge badge-danger">${data.open}</span></td>
          <td><span class="badge badge-success">${data.closed}</span></td>
        </tr>
      `).join('');
    }

    function renderComplaintComparisonTables(current, prev) {
      // Get date ranges for table headers
      const fromDate1 = document.getElementById('compFromDate1')?.value;
      const toDate1 = document.getElementById('compToDate1')?.value;
      const fromDate2 = document.getElementById('compFromDate2')?.value;
      const toDate2 = document.getElementById('compToDate2')?.value;
      
      // Format date ranges for display
      const mode = getComplaintDateMode();
      const p1Label = fromDate1 && toDate1 ? `${formatShortDate(fromDate1)}-${formatShortDate(toDate1)}` : 'Period 1';
      const p2Label = mode === 'single'
        ? 'Comparison Disabled'
        : (fromDate2 && toDate2 ? `${formatShortDate(fromDate2)}-${formatShortDate(toDate2)}` : 'Period 2');
      
      // Update table headers
      const trainTable = document.getElementById('compTrainTable');
      if (trainTable) {
        const headerRow = trainTable.querySelector('thead tr');
        if (headerRow) {
          headerRow.innerHTML = `
            <th>Train Name</th>
            <th>${p1Label}</th>
            <th>${p2Label}</th>
            <th>Increase (P1-P2)</th>
          `;
        }
      }
      
      const natureTable = document.getElementById('compNatureTable');
      if (natureTable) {
        const headerRow = natureTable.querySelector('thead tr');
        if (headerRow) {
          headerRow.innerHTML = `
            <th>Complaint Nature</th>
            <th>${p1Label}</th>
            <th>${p2Label}</th>
            <th>Increase (P1-P2)</th>
          `;
        }
      }

      if (mode === 'single') {
        const noCompareRow = `<tr><td colspan="4" style="text-align:center; color:#64748b;">Enable Comparison Mode to view P1 vs P2 variance.</td></tr>`;
        document.getElementById('compTrainTableBody').innerHTML = noCompareRow;
        document.getElementById('compNatureTableBody').innerHTML = noCompareRow;
        return;
      }
      
      const trainMap = {};
      [...current, ...prev].forEach(c => { 
        if (!trainMap[c.trainName]) trainMap[c.trainName] = { current: 0, prev: 0 }; 
      });
      current.forEach(c => { if (trainMap[c.trainName]) trainMap[c.trainName].current++; });
      prev.forEach(c => { if (trainMap[c.trainName]) trainMap[c.trainName].prev++; });

      const trainRows = Object.entries(trainMap)
        .map(([name, data]) => ({ 
          name, 
          current: data.current, 
          prev: data.prev, 
          diff: data.current - data.prev  // P1 - P2; positive is a warning
        }))
        .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
      
      // Calculate totals
      const totalCurrent = trainRows.reduce((sum, r) => sum + r.current, 0);
      const totalPrev = trainRows.reduce((sum, r) => sum + r.prev, 0);
      const totalDiff = totalCurrent - totalPrev;

      document.getElementById('compTrainTableBody').innerHTML = 
        // Total row first
        `<tr class="table-total-row summary">
          <td><strong>Total (${trainRows.length} Trains)</strong></td>
          <td><strong>${totalCurrent}</strong></td>
          <td><strong>${totalPrev}</strong></td>
          <td class="${totalDiff > 0 ? 'complaint-variance-positive' : 'complaint-variance-neutral'}">
            <strong>${totalDiff > 0 ? '+' : ''}${totalDiff}</strong>
          </td>
        </tr>` +
        trainRows.map(r => `
        <tr>
          <td>${r.name}</td>
          <td>${r.current}</td>
          <td>${r.prev}</td>
          <td class="${r.diff > 0 ? 'complaint-variance-positive' : 'complaint-variance-neutral'}">
            ${r.diff > 0 ? '+' : ''}${r.diff}
          </td>
        </tr>
      `).join('');

      // Nature-wise comparison - same logic
      const natureMap = {};
      [...current, ...prev].forEach(c => { 
        const nature = c.complainNature || c.complaintType || 'Unknown'; 
        if (nature) {
          if (!natureMap[nature]) natureMap[nature] = { current: 0, prev: 0 }; 
        }
      });
      current.forEach(c => { 
        const nature = c.complainNature || c.complaintType || 'Unknown';
        if (natureMap[nature] !== undefined) natureMap[nature].current++; 
      });
      prev.forEach(c => { 
        const nature = c.complainNature || c.complaintType || 'Unknown';
        if (natureMap[nature] !== undefined) natureMap[nature].prev++; 
      });

      const natureRows = Object.entries(natureMap)
        .filter(([name, data]) => data.current > 0 || data.prev > 0)
        .map(([name, data]) => ({ 
          name, 
          ...data, 
          diff: data.current - data.prev  // P1 - P2; positive is a warning
        }))
        .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
      
      // Calculate totals
      const natureTotalCurrent = natureRows.reduce((sum, r) => sum + r.current, 0);
      const natureTotalPrev = natureRows.reduce((sum, r) => sum + r.prev, 0);
      const natureTotalDiff = natureTotalCurrent - natureTotalPrev;

      document.getElementById('compNatureTableBody').innerHTML = 
        // Total row first
        `<tr class="table-total-row summary">
          <td><strong>Total (${natureRows.length} Categories)</strong></td>
          <td><strong>${natureTotalCurrent}</strong></td>
          <td><strong>${natureTotalPrev}</strong></td>
          <td class="${natureTotalDiff > 0 ? 'complaint-variance-positive' : 'complaint-variance-neutral'}">
            <strong>${natureTotalDiff > 0 ? '+' : ''}${natureTotalDiff}</strong>
          </td>
        </tr>` +
        natureRows.map(r => `
        <tr>
          <td>${r.name}</td>
          <td>${r.current}</td>
          <td>${r.prev}</td>
          <td class="${r.diff > 0 ? 'complaint-variance-positive' : 'complaint-variance-neutral'}">
            ${r.diff > 0 ? '+' : ''}${r.diff}
          </td>
        </tr>
      `).join('');
    }
    
    // Helper function to format short date (DD MMM)
    function formatShortDate(dateStr) {
      if (!dateStr) return '';
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    }

    // ==================== CASH DASHBOARD ====================
    function loadCashDashboard() {
      const fromDate = document.getElementById('cashDashFromDate')?.value;
      const toDate = document.getElementById('cashDashToDate')?.value;
      const yardFilter = document.getElementById('cashDashYardFilter')?.value;
      const managerFilter = document.getElementById('cashDashManagerFilter')?.value;

      let cashData = [...(appData.cash || [])];
      let salesData = [...(appData.sales || [])];

      if (fromDate || toDate) { cashData = cashData.filter(c => isCashReportEntryInDateRange(c, fromDate, toDate)); }
      if (fromDate) { salesData = salesData.filter(s => getSalesCashDate(s) >= fromDate); }
      if (toDate) { salesData = salesData.filter(s => getSalesCashDate(s) <= toDate); }
      if (yardFilter) {
        const yardKey = normalizeText(yardFilter);
        cashData = cashData.filter(c => normalizeText(c.yard) === yardKey);
        salesData = salesData.filter(s => normalizeText(s.yard) === yardKey);
      }
      if (managerFilter) {
        const managerKey = normalizeText(managerFilter);
        cashData = cashData.filter(c => normalizeText(getCashEntryManager(c)) === managerKey);
        salesData = salesData.filter(s => normalizeText(s.trainManager) === managerKey);
      }

      const collectFromCashEntries = cashData.reduce((sum, c) => sum + getCashCollectableAmount(c), 0);
      const collectFromSalesEntries = salesData.reduce((sum, s) => sum + getSaleCollectableAmount(s), 0);
      const gpCollected = cashData.length ? collectFromCashEntries : collectFromSalesEntries;
      const totalDeposit = cashData.reduce((sum, c) => sum + (Number(c.totalDeposit) || 0), 0);
      const cashCounter = cashData.reduce((sum, c) => sum + (Number(c.cashDepositCounter) || 0), 0);
      const onlineDeposit = cashData.reduce((sum, c) => sum + (Number(c.onlineDeposit) || 0), 0);
      const difference = gpCollected - totalDeposit;
      const pendingShortage = salesData.filter(s => getPendingAmountForSalesEntry(s) > 0).length;

      document.getElementById('cashKpiGpCollected').textContent = formatCurrency(gpCollected);
      document.getElementById('cashKpiTotalDeposit').textContent = formatCurrency(totalDeposit);
      document.getElementById('cashKpiDepositSub').textContent = `Cash: ${formatCurrency(cashCounter)} | Online: ${formatCurrency(onlineDeposit)}`;
      document.getElementById('cashKpiCashCounter').textContent = formatCurrency(cashCounter);
      document.getElementById('cashKpiOnlineDeposit').textContent = formatCurrency(onlineDeposit);
      document.getElementById('cashKpiCount').textContent = cashData.length;
      document.getElementById('cashKpiPendingShortage').textContent = pendingShortage;

      const shortageCard = document.getElementById('shortageCard');
      const excessCard = document.getElementById('excessCard');

      if (difference > 0) {
        shortageCard.style.display = 'block';
        excessCard.style.display = 'none';
        document.getElementById('cashKpiShortage').textContent = formatCurrency(difference);
      } else if (difference < 0) {
        shortageCard.style.display = 'none';
        excessCard.style.display = 'block';
        document.getElementById('cashKpiExcess').textContent = formatCurrency(Math.abs(difference));
      } else {
        shortageCard.style.display = 'none';
        excessCard.style.display = 'none';
      }

      renderCashCollectionTable(cashData, salesData);
      renderManagerCashTable(cashData, salesData);
      renderPendingDepositTable(cashData, salesData);
      if (!(appData.cash || []).length && !noDataPopupShown.cash) {
        noDataPopupShown.cash = true;
        showAlert('No cash deposit data uploaded.', 'warning');
      }
    }

    function getCashDashboardDate(entry) {
      return getComparableDate(entry?.arrivalDate || entry?.date || entry?.entryDate || '');
    }

    function getCashEntryDate(entry) {
      return getComparableDate(entry?.entryDate || entry?.depositDate || entry?.date || entry?.arrivalDate || '');
    }

    function getCashReportDate(entry) {
      return getComparableDate(entry?.date || entry?.arrivalDate || entry?.entryDate || entry?.depositDate || '');
    }

    function isCashReportEntryInDateRange(entry, fromDate = '', toDate = '') {
      const date = getCashReportDate(entry);
      if (!date) return false;
      return (!fromDate || date >= fromDate) && (!toDate || date <= toDate);
    }

    function getCashEntryDateCandidates(entry) {
      return [...new Set([
        getComparableDate(entry?.entryDate || ''),
        getComparableDate(entry?.depositDate || ''),
        getComparableDate(entry?.date || ''),
        getComparableDate(entry?.arrivalDate || '')
      ].filter(Boolean))];
    }

    function isCashEntryInDateRange(entry, fromDate = '', toDate = '') {
      const dates = getCashEntryDateCandidates(entry);
      if (!dates.length) return false;
      return dates.some(date => (!fromDate || date >= fromDate) && (!toDate || date <= toDate));
    }

    function getSalesCashDate(entry) {
      return getComparableDate(entry?.arrivalDate || entry?.date || '');
    }

    function getSaleCollectableAmount(sale) {
      return Number(sale?.amountToCollect || sale?.salesAchievement || sale?.totalSale) || 0;
    }

    function getDepositedAmountForSalesEntry(sale, excludeCashId = null) {
      if (!sale) return 0;
      return (appData.cash || [])
        .filter(c => String(c.id) !== String(excludeCashId || '') && isSameTrainForCashSale(c, sale))
        .reduce((sum, c) => sum + (Number(c.totalDeposit) || 0), 0);
    }

    function getPendingAmountForSalesEntry(sale, excludeCashId = null) {
      const amountToCollect = getSaleCollectableAmount(sale);
      const deposited = getDepositedAmountForSalesEntry(sale, excludeCashId);
      return Math.max(amountToCollect - deposited, 0);
    }

    function getCashCollectableAmount(cashEntry) {
      return Number(cashEntry?.amountToCollect || cashEntry?.gpFromSales || cashEntry?.gpCollected) || 0;
    }

    function getCashSaleCollectionKey(cashEntry) {
      if (cashEntry?.salesEntryId) return `sale:${cashEntry.salesEntryId}`;
      return [
        getSalesCashDate(cashEntry),
        buildTrainKey(cashEntry?.trainNumber, cashEntry?.trainName),
        normalizeText(cashEntry?.rakeNumber),
        normalizeText(cashEntry?.rakeManager)
      ].join('|');
    }

    function sumUniqueCashCollectable(cashEntries) {
      const map = {};
      (cashEntries || []).forEach(c => {
        const key = getCashSaleCollectionKey(c);
        map[key] = Math.max(map[key] || 0, getCashCollectableAmount(c));
      });
      return Object.values(map).reduce((sum, value) => sum + value, 0);
    }

    function getCashEntryManager(cashEntry) {
      if (cashEntry?.trainManager) return cashEntry.trainManager;
      const train = (appData.trainMasters || []).find(t => buildTrainKey(t.trainNumber, t.trainName) === buildTrainKey(cashEntry?.trainNumber, cashEntry?.trainName));
      return train?.trainManager || 'Unassigned';
    }

    function renderCashCollectionTable(cashData, salesData) {
      const tbody = document.getElementById('cashCollectionTableBody');
      if (!tbody) return;
      const dates = [...new Set([...(salesData || []).map(getSalesCashDate), ...(cashData || []).map(getCashReportDate)].filter(Boolean))].sort();
      const rows = dates.map(date => {
        const daySales = (salesData || []).filter(s => getSalesCashDate(s) === date);
        const dayCash = (cashData || []).filter(c => getCashReportDate(c) === date);
        const amountToCollect = dayCash.length
          ? dayCash.reduce((sum, c) => sum + getCashCollectableAmount(c), 0)
          : daySales.reduce((sum, s) => sum + getSaleCollectableAmount(s), 0);
        const cashDeposit = dayCash.reduce((sum, c) => sum + (Number(c.cashDepositCounter) || 0), 0);
        const onlineDeposit = dayCash.reduce((sum, c) => sum + (Number(c.onlineDeposit) || 0), 0);
        const totalDeposit = dayCash.reduce((sum, c) => sum + (Number(c.totalDeposit) || 0), 0);
        const pendingNoDeposit = daySales.reduce((sum, s) => {
          const matchingDeposits = (appData.cash || []).filter(c => isSameTrainForCashSale(c, s));
          return matchingDeposits.length ? sum : sum + getSaleCollectableAmount(s);
        }, 0);
        const pendingShort = daySales.reduce((sum, s) => {
          const matchingDeposits = (appData.cash || []).filter(c => isSameTrainForCashSale(c, s));
          if (!matchingDeposits.length) return sum;
          const deposited = matchingDeposits.reduce((total, c) => total + (Number(c.totalDeposit) || 0), 0);
          return sum + Math.max(getSaleCollectableAmount(s) - deposited, 0);
        }, 0);
        return { date, salesCount: daySales.length, cashCount: dayCash.length, amountToCollect, cashDeposit, onlineDeposit, totalDeposit, pendingNoDeposit, pendingShort, totalPending: pendingNoDeposit + pendingShort };
      }).sort((a, b) => b.date.localeCompare(a.date));

      const totals = rows.reduce((acc, r) => {
        acc.salesCount += r.salesCount;
        acc.cashCount += r.cashCount;
        acc.amountToCollect += r.amountToCollect;
        acc.cashDeposit += r.cashDeposit;
        acc.onlineDeposit += r.onlineDeposit;
        acc.totalDeposit += r.totalDeposit;
        acc.pendingNoDeposit += r.pendingNoDeposit;
        acc.pendingShort += r.pendingShort;
        acc.totalPending += r.totalPending;
        return acc;
      }, { salesCount: 0, cashCount: 0, amountToCollect: 0, cashDeposit: 0, onlineDeposit: 0, totalDeposit: 0, pendingNoDeposit: 0, pendingShort: 0, totalPending: 0 });

      tbody.innerHTML = rows.length ? `
        <tr class="table-total-row">
          <td><strong>Total</strong></td>
          <td><strong>${totals.salesCount}</strong></td>
          <td><strong>${totals.cashCount}</strong></td>
          <td><strong>${formatCurrency(totals.amountToCollect)}</strong></td>
          <td><strong>${formatCurrency(totals.cashDeposit)}</strong></td>
          <td><strong>${formatCurrency(totals.onlineDeposit)}</strong></td>
          <td><strong>${formatCurrency(totals.totalDeposit)}</strong></td>
          <td><strong>${formatCurrency(totals.pendingNoDeposit)}</strong></td>
          <td><strong>${formatCurrency(totals.pendingShort)}</strong></td>
          <td><strong>${formatCurrency(totals.totalPending)}</strong></td>
        </tr>
      ` + rows.map(r => `
        <tr>
          <td>${formatDate(r.date)}</td>
          <td>${r.salesCount}</td>
          <td>${r.cashCount}</td>
          <td>${formatCurrency(r.amountToCollect)}</td>
          <td>${formatCurrency(r.cashDeposit)}</td>
          <td>${formatCurrency(r.onlineDeposit)}</td>
          <td>${formatCurrency(r.totalDeposit)}</td>
          <td>${formatCurrency(r.pendingNoDeposit)}</td>
          <td>${formatCurrency(r.pendingShort)}</td>
          <td><strong>${formatCurrency(r.totalPending)}</strong></td>
        </tr>
      `).join('') : '<tr><td colspan="10" style="text-align:center;color:#64748b;">No cash/sales data for selected filters.</td></tr>';
    }

    function renderManagerCashTable(cashData, salesData) {
      const managerMap = {};
      
      if (!(cashData || []).length) {
        salesData.forEach(s => {
          const manager = s.trainManager || 'Unassigned';
          if (!managerMap[manager]) managerMap[manager] = { gpAchievement: 0, cashDeposit: 0, onlineDeposit: 0, totalDeposit: 0 };
          managerMap[manager].gpAchievement += getSaleCollectableAmount(s);
        });
      }

      cashData.forEach(c => {
        const manager = getCashEntryManager(c);
        if (!managerMap[manager]) managerMap[manager] = { gpAchievement: 0, cashDeposit: 0, onlineDeposit: 0, totalDeposit: 0 };
        managerMap[manager].gpAchievement += getCashCollectableAmount(c);
        managerMap[manager].cashDeposit += Number(c.cashDepositCounter) || 0;
        managerMap[manager].onlineDeposit += Number(c.onlineDeposit) || 0;
        managerMap[manager].totalDeposit += Number(c.totalDeposit) || 0;
      });

      const rows = Object.entries(managerMap).map(([name, data]) => ({
        name, ...data, difference: data.gpAchievement - data.totalDeposit
      })).sort((a, b) => b.gpAchievement - a.gpAchievement);
      
      // Calculate totals
      const totalGP = rows.reduce((sum, r) => sum + r.gpAchievement, 0);
      const totalCash = rows.reduce((sum, r) => sum + r.cashDeposit, 0);
      const totalOnline = rows.reduce((sum, r) => sum + r.onlineDeposit, 0);
      const totalDeposit = rows.reduce((sum, r) => sum + r.totalDeposit, 0);
      const totalDiff = totalGP - totalDeposit;

      document.getElementById('managerCashTableBody').innerHTML = 
        // Total row first
        `<tr class="table-total-row">
          <td><strong>Total (${rows.length} Managers)</strong></td>
          <td><strong>${formatCurrency(totalGP)}</strong></td>
          <td><strong>${formatCurrency(totalCash)}</strong></td>
          <td><strong>${formatCurrency(totalOnline)}</strong></td>
          <td><strong>${formatCurrency(totalDeposit)}</strong></td>
          <td class="${totalDiff > 0 ? 'comparison-negative' : totalDiff < 0 ? 'comparison-positive' : ''}"><strong>${totalDiff > 0 ? '-' : totalDiff < 0 ? '+' : ''}${formatCurrency(Math.abs(totalDiff))}</strong></td>
          <td><span class="badge badge-${totalDiff > 0 ? 'danger' : totalDiff < 0 ? 'success' : 'info'}"><strong>${totalDiff > 0 ? 'Short' : totalDiff < 0 ? 'Excess' : 'Match'}</strong></span></td>
        </tr>` +
        rows.map(r => `
        <tr>
          <td>${r.name}</td>
          <td>${formatCurrency(r.gpAchievement)}</td>
          <td>${formatCurrency(r.cashDeposit)}</td>
          <td>${formatCurrency(r.onlineDeposit)}</td>
          <td>${formatCurrency(r.totalDeposit)}</td>
          <td class="${r.difference > 0 ? 'comparison-negative' : r.difference < 0 ? 'comparison-positive' : ''}">${r.difference > 0 ? '-' : r.difference < 0 ? '+' : ''}${formatCurrency(Math.abs(r.difference))}</td>
          <td><span class="badge badge-${r.difference > 0 ? 'danger' : r.difference < 0 ? 'success' : 'info'}">${r.difference > 0 ? 'Short' : r.difference < 0 ? 'Excess' : 'Match'}</span></td>
        </tr>
      `).join('');
    }

    function isSameTrainForCashSale(cashEntry, saleEntry) {
      if (!cashEntry || !saleEntry) return false;
      if (cashEntry.salesEntryId && saleEntry.id && String(cashEntry.salesEntryId) === String(saleEntry.id)) return true;
      const cashSaleDate = getSalesCashDate(cashEntry);
      const saleDate = getSalesCashDate(saleEntry);
      if (cashSaleDate && saleDate && cashSaleDate !== saleDate) return false;
      const sameTrain = buildTrainKey(cashEntry.trainNumber, cashEntry.trainName) === buildTrainKey(saleEntry.trainNumber, saleEntry.trainName);
      const sameMasterId = cashEntry.trainId && saleEntry.trainId && String(cashEntry.trainId) === String(saleEntry.trainId);
      const cashRake = normalizeText(cashEntry.rakeNumber);
      const saleRake = normalizeText(saleEntry.rakeNumber);
      const cashManager = normalizeText(cashEntry.rakeManager);
      const saleManager = normalizeText(saleEntry.rakeManager);
      const sameRake = cashRake && saleRake ? cashRake === saleRake : true;
      const sameRakeManager = cashManager && saleManager ? cashManager === saleManager : true;
      return (sameMasterId || sameTrain) && sameRake && sameRakeManager;
    }

    function renderPendingDepositTable(cashData, salesData) {
      const table = document.getElementById('pendingDepositTable');
      if (table) {
        const headerRow = table.querySelector('thead tr');
        if (headerRow) headerRow.innerHTML = `
          <th>Train Manager</th>
          <th>Rake Manager</th>
          <th>Train</th>
          <th>Train Number</th>
          <th>Rake Number</th>
          <th>Date</th>
          <th>Amount To Collect</th>
          <th>Total Deposited</th>
          <th>Amount Pending</th>
          <th>Action</th>
        `;
      }
      const tbody = document.getElementById('pendingDepositTableBody');
      if (!tbody) return;
      const rows = salesData.map(s => {
        const matchingDeposits = (appData.cash || []).filter(c => isSameTrainForCashSale(c, s));
        const deposited = matchingDeposits.reduce((sum, c) => sum + (Number(c.totalDeposit) || 0), 0);
        const totalSale = getSaleCollectableAmount(s);
        const latestCash = matchingDeposits.sort((a, b) => Number(b.id || 0) - Number(a.id || 0))[0];
        return {
          salesId: s.id || '',
          rakeManager: latestCash?.rakeManager || s.rakeManager || 'Unassigned',
          trainManager: latestCash?.trainManager || s.trainManager || 'Unassigned',
          trainName: s.trainName || latestCash?.trainName || '-',
          trainNumber: normalizeTrainNo(s.trainNumber || latestCash?.trainNumber) || s.trainNumber || latestCash?.trainNumber || '-',
          rakeNumber: latestCash?.rakeNumber || s.rakeNumber || '-',
          date: getCashDashboardDate(s) || s.date || '',
          totalSale,
          deposited,
          pending: totalSale - deposited
        };
      }).filter(r => r.pending > 0).sort((a, b) => b.pending - a.pending);
      const totals = rows.reduce((acc, r) => {
        acc.totalSale += r.totalSale;
        acc.deposited += r.deposited;
        acc.pending += r.pending;
        return acc;
      }, { totalSale: 0, deposited: 0, pending: 0 });
      tbody.innerHTML = rows.length ? `
        <tr class="table-total-row">
          <td colspan="6"><strong>Total (${rows.length} Pending)</strong></td>
          <td><strong>${formatCurrency(totals.totalSale)}</strong></td>
          <td><strong>${formatCurrency(totals.deposited)}</strong></td>
          <td><strong>${formatCurrency(totals.pending)}</strong></td>
          <td></td>
        </tr>
      ` + rows.map(r => `
        <tr>
          <td>${r.trainManager}</td>
          <td>${r.rakeManager}</td>
          <td>${r.trainName}</td>
          <td>${r.trainNumber}</td>
          <td>${r.rakeNumber}</td>
          <td>${formatDate(r.date)}</td>
          <td>${formatCurrency(r.totalSale)}</td>
          <td>${formatCurrency(r.deposited)}</td>
          <td><strong>${formatCurrency(r.pending)}</strong></td>
          <td><button class="btn btn-primary btn-sm" onclick="startPendingCashDeposit('${r.salesId}')">Add Deposit</button></td>
        </tr>
      `).join('') : '<tr><td colspan="10" style="text-align:center;color:#64748b;">No pending deposits for selected filters.</td></tr>';
    }

    function startPendingCashDeposit(salesId) {
      if (!ensureEditable('save entries')) return;
      const sale = (appData.sales || []).find(s => String(s.id) === String(salesId));
      if (!sale) {
        showAlert('Related sales entry was not found.', 'error');
        return;
      }
      const amountToCollect = getSaleCollectableAmount(sale);
      const deposited = getDepositedAmountForSalesEntry(sale);
      const pending = Math.max(amountToCollect - deposited, 0);
      if (pending <= 0 && !confirm('This sales entry has no pending balance. Add another deposit anyway?')) return;

      editingId = null;
      editingType = null;
      document.getElementById('cashSalesEntryId') && (document.getElementById('cashSalesEntryId').value = sale.id || '');
      document.getElementById('cashDate').value = getLastCashEntryDate() || new Date().toISOString().split('T')[0];
      document.getElementById('cashArrivalDate') && (document.getElementById('cashArrivalDate').value = sale.arrivalDate || sale.date || '');
      document.getElementById('cashYard').value = sale.yard || '';
      document.getElementById('cashTrainId').value = sale.trainId || '';
      document.getElementById('cashTrainSearch').value = sale.trainName || '';
      document.getElementById('cashTrainNo').value = sale.trainNumber || '';
      document.getElementById('cashTrainManager').value = sale.trainManager || '';
      document.getElementById('cashRakeManager').value = sale.rakeManager || '';
      document.getElementById('cashGpFromSales').value = pending || amountToCollect || '';
      document.getElementById('cashBalanceDue') && (document.getElementById('cashBalanceDue').value = pending);
      document.getElementById('cashDepositCounter').value = '';
      document.getElementById('cashOnlineDeposit').value = '';
      document.getElementById('cashTotalDeposit').value = '';
      document.getElementById('cashShortageReason').value = '';
      document.getElementById('cashRemarks').value = pending > 0 ? `Pending deposit against arrival date ${formatDate(sale.arrivalDate || sale.date || '')}` : '';
      checkShortage();
      switchCashTab('entry');
      showAlert(`Pending amount loaded: ${formatCurrency(pending)}. Enter cash/online deposit and save.`, 'info');
    }

    function findSalesEntryForCash(date, trainId, trainNumber, trainName, rakeManager = '', rakeNumber = '') {
      const day = getComparableDate(date);
      const selectedRake = normalizeText(rakeNumber);
      const selectedManager = normalizeText(rakeManager);
      return (appData.sales || []).find(s => {
        const saleDates = [getSalesCashDate(s), getComparableDate(s.date || '')].filter(Boolean);
        if (day && !saleDates.includes(day)) return false;
        const sameMaster = trainId && s.trainId && String(s.trainId) === String(trainId);
        const sameTrain = buildTrainKey(s.trainNumber, s.trainName) === buildTrainKey(trainNumber, trainName);
        const sameTrainName = normalizeText(s.trainName) && normalizeText(trainName) && normalizeText(s.trainName) === normalizeText(trainName);
        const sameTrainNo = normalizeTrainNo(s.trainNumber) && normalizeTrainNo(trainNumber) && normalizeTrainNo(s.trainNumber) === normalizeTrainNo(trainNumber);
        if (!sameMaster && !sameTrain && !sameTrainName && !sameTrainNo) return false;
        const saleRake = normalizeText(s.rakeNumber);
        const saleManager = normalizeText(s.rakeManager);
        if (selectedRake && saleRake && selectedRake !== saleRake) return false;
        if (selectedManager && saleManager && selectedManager !== saleManager) return false;
        if (trainId && s.trainId) return String(s.trainId) === String(trainId);
        return selectedRake || selectedManager ? true : sameTrain;
      });
    }

    function clearCashDashFilters() {
      document.getElementById('cashDashFromDate').value = '';
      document.getElementById('cashDashToDate').value = '';
      document.getElementById('cashDashYardFilter').value = '';
      document.getElementById('cashDashManagerFilter').value = '';
      loadCashDashboard();
    }

    function updateCashGPFromSales() {
      const date = document.getElementById('cashDate').value;
      const trainId = document.getElementById('cashTrainId').value;
      const trainNumber = document.getElementById('cashTrainNo')?.value || '';
      const trainName = document.getElementById('cashTrainSearch')?.value || '';
      const forcedSalesEntryId = document.getElementById('cashSalesEntryId')?.value || '';
      const selected = trainId ? (appData.trainMasters || []).find(t => String(t.id) === String(trainId)) : null;
      const salesEntry = forcedSalesEntryId
        ? (appData.sales || []).find(s => String(s.id) === String(forcedSalesEntryId))
        : date && (trainId || trainNumber || trainName)
        ? findSalesEntryForCash(date, trainId, trainNumber, trainName, selected?.rakeManager || '', selected?.rakeNumber || '')
        : null;
      if (salesEntry) {
        document.getElementById('cashSalesEntryId') && (document.getElementById('cashSalesEntryId').value = salesEntry.id || '');
        const pendingAmount = getPendingAmountForSalesEntry(salesEntry, editingType === 'cash' ? editingId : null);
        document.getElementById('cashGpFromSales').value = pendingAmount || 0;
        document.getElementById('cashTrainManager').value = salesEntry.trainManager || '';
        document.getElementById('cashRakeManager').value = salesEntry.rakeManager || '';
        const arrivalInput = document.getElementById('cashArrivalDate');
        if (arrivalInput) arrivalInput.value = salesEntry.arrivalDate || salesEntry.date || '';
        if (salesEntry.yard) document.getElementById('cashYard').value = salesEntry.yard;
      } else if (date && (trainId || trainNumber || trainName)) {
        document.getElementById('cashGpFromSales').value = '';
        document.getElementById('cashTrainManager').value = selected?.trainManager || '';
        document.getElementById('cashRakeManager').value = selected?.rakeManager || '';
        const arrivalInput = document.getElementById('cashArrivalDate');
        if (arrivalInput) arrivalInput.value = '';
        showAlert('Sales entry is required for the same train, same rake manager and date before cash deposit.', 'warning');
      }
      checkShortage();
    }

    function checkShortage() {
      const gp = Number(document.getElementById('cashGpFromSales').value) || 0;
      const cash = Number(document.getElementById('cashDepositCounter').value) || 0;
      const online = Number(document.getElementById('cashOnlineDeposit').value) || 0;
      const total = cash + online;
      
      const shortageAlert = document.getElementById('shortageAlert');
      const shortageReasonRow = document.getElementById('shortageReasonRow');
      const shortageReason = document.getElementById('cashShortageReason');
      const balanceInput = document.getElementById('cashBalanceDue');
      if (balanceInput) balanceInput.value = Math.max(gp - total, 0);

      if (gp > 0 && total < gp) {
        shortageAlert.classList.remove('hidden');
        shortageReasonRow.style.display = 'grid';
        shortageReason.classList.add('required-field');
      } else {
        shortageAlert.classList.add('hidden');
        shortageReasonRow.style.display = 'none';
        shortageReason.classList.remove('required-field');
        shortageReason.value = '';
      }
    }


    // ==================== SALES PAGE FUNCTIONS ====================
    function loadSalesPage() {
      populateTrainDropdowns();
      populateYardSelects();
      populateFilterSelects();
      loadSalesList();
    }

    function populateTrainDropdowns() {
      const trains = getSortedTrainMastersForSelection();
      const dropdown = document.getElementById('trainDropdown');
      dropdown.innerHTML = trains.map(t => `
        <div class="searchable-dropdown-item" onclick="selectTrain('${t.id}', '${t.trainName}', '${t.trainNumber}')">
          ${t.trainName} (${t.trainNumber})${t.rakeNumber ? ' - ' + t.rakeNumber : ''}${t.rakeManager ? ' - ' + t.rakeManager : ''}
        </div>
      `).join('');
    }

    function populateFilterSelects() {
      const trains = [...new Set(appData.trainMasters.map(t => t.trainName))].sort();
      const managers = [...new Set(appData.trainMasters.map(t => t.trainManager))].filter(Boolean).sort();
      const yards = appData.yards || [];

      document.getElementById('salesFilterTrain').innerHTML = '<option value="">All Trains</option>' + trains.map(t => `<option value="${t}">${t}</option>`).join('');
      document.getElementById('salesFilterManager').innerHTML = '<option value="">All Managers</option>' + managers.map(m => `<option value="${m}">${m}</option>`).join('');
      document.getElementById('salesFilterYard').innerHTML = '<option value="">All Yards</option>' + yards.map(y => `<option value="${y}">${y}</option>`).join('');
    }

    function populateYardSelects() {
      const yards = appData.yards || [];
      ['complaintYard', 'cashYard', 'cashFilterYard', 'masterYard', 'cashDashYardFilter'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.innerHTML = yards.map(y => `<option value="${y}">${y}</option>`).join('');
      });
      const managers = [...new Set(appData.trainMasters.map(t => t.trainManager))].filter(Boolean).sort();
      const managerSelect = document.getElementById('cashDashManagerFilter');
      if (managerSelect) managerSelect.innerHTML = '<option value="">All Managers</option>' + managers.map(m => `<option value="${m}">${m}</option>`).join('');
      const clusterSelect = document.getElementById('newTrainManagerCluster');
      if (clusterSelect) clusterSelect.innerHTML = '<option value="">Select Cluster</option>' + (appData.clusterManagers || []).map(c => `<option value="${c}">${c}</option>`).join('');
      const trainMgrSelect = document.getElementById('newRakeManagerTrain');
      const allTrainManagers = [...new Set([...(appData.trainManagers || []), ...Object.keys(appData.trainManagerHierarchy || {})])].sort();
      if (trainMgrSelect) trainMgrSelect.innerHTML = '<option value="">Select Train Manager</option>' + allTrainManagers.map(m => `<option value="${m}">${m}</option>`).join('');
    }

    function filterTrains(query) {
      const items = document.querySelectorAll('#trainDropdown .searchable-dropdown-item');
      items.forEach(item => { item.style.display = item.textContent.toLowerCase().includes(query.toLowerCase()) ? 'block' : 'none'; });
    }

    function showTrainDropdown() { document.getElementById('trainDropdown').classList.add('active'); }

    function selectTrain(id, name, number) {
      editingId = null;
      editingType = null;
      document.getElementById('salesTrainId').value = id;
      document.getElementById('salesTrainSearch').value = name;
      document.getElementById('trainDropdown').classList.remove('active');
      
      const train = appData.trainMasters.find(t => t.id == id);
      if (train) {
        const saleDate = document.getElementById('salesDate')?.value || '';
        const effective = resolveSelectedTrainMaster(id, train.trainNumber, train.trainName, saleDate) || train;
        const effectiveNumber = effective.trainNumber || train.trainNumber || '';
        const effectiveName = effective.trainName || train.trainName || '';
        document.getElementById('salesTrainNo').value = normalizeTrainNo(effectiveNumber) || effectiveNumber;
        document.getElementById('salesYard').value = effective.yard || train.yard || '';
        document.getElementById('salesClusterManager').value = effective.clusterManager || train.clusterManager || '';
        document.getElementById('salesTrainManager').value = effective.trainManager || train.trainManager || '';
        populateSalesRakeManagers(effective, effective.rakeManager || train.rakeManager || '');
        document.getElementById('salesTrainType').value = effective.trainType || train.trainType || '';
        document.getElementById('salesTarget').value = getTrainSalesTarget(effectiveNumber, effectiveName, saleDate);
        document.getElementById('salesGpTarget').value = getTrainGpTarget(effectiveNumber, effectiveName, saleDate);
        refreshSalesTargetForDate();
      }
    }

    function populateSalesRakeManagers(master, selectedRakeManager = '') {
      const select = document.getElementById('salesRakeManager');
      if (!select) return;
      if (!master) {
        select.innerHTML = '<option value="">Select train first</option>';
        return;
      }
      const date = document.getElementById('salesDate')?.value || '';
      let options = getRakeOptionsForTrainRack(master.trainNumber, master.trainName, master.rakeNumber, date);
      const selectedKey = normalizeText(selectedRakeManager);
      const selectedRakeKey = normalizeText(master.rakeNumber);
      const hasSelectedManager = options.some(t =>
        normalizeText(t.rakeManager) === selectedKey &&
        (!selectedRakeKey || normalizeText(t.rakeNumber) === selectedRakeKey)
      );
      if (hasRakeInfo(master) && (!hasSelectedManager || !options.some(t => String(t.id) === String(master.id)))) {
        const savedOption = { ...master };
        if (selectedRakeManager) {
          savedOption.id = hasSelectedManager ? savedOption.id : '';
          savedOption.rakeManager = selectedRakeManager;
        }
        options = [savedOption, ...options.filter(t =>
          !(normalizeText(t.rakeManager) === normalizeText(savedOption.rakeManager) &&
            normalizeText(t.rakeNumber) === normalizeText(savedOption.rakeNumber))
        )];
      }
      if (!options.length) {
        select.innerHTML = '<option value="">No rake manager found</option>';
        return;
      }
      select.innerHTML = options.map(t => {
        const label = `${t.rakeManager || 'Unassigned'}${t.rakeNumber ? ' - ' + t.rakeNumber : ''}${getMasterValidityLabel(t, date)}`;
        const phone = t.rakeManagerContact || t.rakeManagerPhone || '';
        return `<option value="${t.rakeManager || ''}" data-master-id="${t.id || ''}" data-rake-number="${t.rakeNumber || ''}" data-phone="${phone}">${label}</option>`;
      }).join('');
      if (selectedRakeManager) {
        const match = Array.from(select.options).find(o => normalizeText(o.value) === normalizeText(selectedRakeManager));
        if (match) select.value = match.value;
      }
      if (!select.value && options.length) select.value = options[0].rakeManager || '';
      onSalesRakeManagerChange();
    }

    function onSalesRakeManagerChange() {
      const select = document.getElementById('salesRakeManager');
      if (!select) return;
      const selectedOption = select.selectedOptions?.[0];
      const masterId = selectedOption?.dataset?.masterId || '';
      const trainNo = document.getElementById('salesTrainNo')?.value || '';
      const trainName = document.getElementById('salesTrainSearch')?.value || '';
      const date = document.getElementById('salesDate')?.value || '';
      const rakeManager = select.value || '';
      const rakeNumber = selectedOption?.dataset?.rakeNumber || '';
      if (!editingId || editingType !== 'sales') salesSalaryDetails = [];
      const editingEntry = editingId && editingType === 'sales' ? (appData.sales || []).find(s => String(s.id) === String(editingId)) : null;
      if (editingEntry && normalizeText(editingEntry.rakeManager) === normalizeText(rakeManager)) {
        document.getElementById('salesYard').value = editingEntry.yard || document.getElementById('salesYard').value;
        document.getElementById('salesClusterManager').value = editingEntry.clusterManager || document.getElementById('salesClusterManager').value;
        document.getElementById('salesTrainManager').value = editingEntry.trainManager || document.getElementById('salesTrainManager').value;
        document.getElementById('salesTrainType').value = editingEntry.trainType || document.getElementById('salesTrainType').value;
        const editingMaster = getEffectiveMaster(trainNo, trainName, date, rakeManager, rakeNumber);
        warnIfMasterValidityIssue(editingMaster, 'Rake manager');
        calculateSalesCostsAndGp();
        return;
      }
      const master = (masterId ? (appData.trainMasters || []).find(t => String(t.id) === String(masterId)) : null)
        || getEffectiveMaster(trainNo, trainName, date, rakeManager, rakeNumber);
      if (!master) return;
      warnIfMasterValidityIssue(master, 'Rake manager');
      document.getElementById('salesTrainId').value = master.id || document.getElementById('salesTrainId').value;
      document.getElementById('salesYard').value = master.yard || '';
      document.getElementById('salesClusterManager').value = master.clusterManager || '';
      document.getElementById('salesTrainManager').value = master.trainManager || '';
      document.getElementById('salesTrainType').value = master.trainType || '';
      calculateSalesCostsAndGp();
    }

    function calculateSalesPct() {
      const target = Number(document.getElementById('salesTarget').value) || 0;
      const achievement = Number(document.getElementById('salesAchievement').value) || 0;
      const pct = target > 0 ? Math.round((achievement / target) * 100) : 0;
      document.getElementById('salesAchievementPct').value = pct + '%';
    }

    function findSalesEntryByDateTrain(date, trainNumber, trainName, trainId = '', excludeId = null, rakeManager = '', rakeNumber = '') {
      const day = getComparableDate(date);
      const selectedManager = normalizeText(rakeManager);
      const selectedRake = normalizeText(rakeNumber);
      return (appData.sales || []).find(s => {
        if (s.id == excludeId || getSalesEntryArrivalDate(s) !== day) return false;
        const sameTrain = buildTrainKey(s.trainNumber, s.trainName) === buildTrainKey(trainNumber, trainName);
        const sameMaster = trainId && s.trainId && String(s.trainId) === String(trainId);
        if (!sameTrain && !sameMaster) return false;
        if (selectedManager && normalizeText(s.rakeManager) !== selectedManager) return false;
        if (selectedRake && normalizeText(s.rakeNumber) !== selectedRake) return false;
        return true;
      });
    }

    function getCashEntriesForSalesEntry(sale) {
      if (!sale) return [];
      return (appData.cash || []).filter(c => getCashDashboardDate(c) === getSalesEntryArrivalDate(sale) && isSameTrainForCashSale(c, sale));
    }

    function getCashDepositStatusForSale(sale) {
      const amountToCollect = Number(sale?.amountToCollect || sale?.salesAchievement || sale?.totalSale) || 0;
      const deposited = getCashEntriesForSalesEntry(sale).reduce((sum, c) => sum + (Number(c.totalDeposit) || 0), 0);
      return { amountToCollect, deposited, pending: Math.max(amountToCollect - deposited, 0), completed: amountToCollect > 0 && deposited >= amountToCollect };
    }

    function setSalesEntryFieldsDisabled(disabled) {
      ['salesDepartureDate','salesDate','salesRakeManager','salesAchievement','salesStoreBill','salesBaseExpense','salesCreditExpense','salesCashExpense','salesMiscExpense','salesStaffSalary','salesManagerSalary','salesECatering','salesRemarks','supportHisabExcelPdf'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = disabled;
      });
    }

    function loadSalesEntryIntoForm(entry, options = {}) {
      editingId = entry.id;
      editingType = 'sales';
      document.getElementById('salesTrainId').value = entry.trainId || '';
      document.getElementById('salesTrainSearch').value = entry.trainName || '';
      document.getElementById('salesDepartureDate').value = entry.departureDate || entry.date || '';
      document.getElementById('salesDate').value = entry.arrivalDate || entry.date || '';
      salesCostDetails = JSON.parse(JSON.stringify(entry.detailLines || entry.salesCostDetails || {}));
      salesSalaryDetails = JSON.parse(JSON.stringify(entry.salaryDetails || []));
      salesSupportFiles = JSON.parse(JSON.stringify(entry.supportingFiles || {}));
      salesMiscManual = true;
      document.getElementById('salesTrainNo').value = entry.trainNumber || '';
      document.getElementById('salesYard').value = entry.yard || '';
      document.getElementById('salesClusterManager').value = entry.clusterManager || '';
      document.getElementById('salesTrainManager').value = entry.trainManager || '';
      const selectedMaster = getEffectiveMaster(entry.trainNumber, entry.trainName, entry.arrivalDate || entry.date, entry.rakeManager, entry.rakeNumber);
      populateSalesRakeManagers(selectedMaster || {
        trainNumber: entry.trainNumber,
        trainName: entry.trainName,
        yard: entry.yard,
        clusterManager: entry.clusterManager,
        trainManager: entry.trainManager,
        rakeNumber: entry.rakeNumber,
        rakeManager: entry.rakeManager,
        trainType: entry.trainType,
        id: entry.trainId
      }, entry.rakeManager || '');
      document.getElementById('salesTrainType').value = entry.trainType || '';
      document.getElementById('salesTarget').value = entry.salesTarget || '';
      document.getElementById('salesAchievement').value = entry.salesAchievement || entry.totalSale || '';
      document.getElementById('salesAchievementPct').value = entry.salesTarget > 0 ? Math.round((entry.salesAchievement / entry.salesTarget) * 100) + '%' : '0%';
      document.getElementById('salesStoreBill').value = entry.storeBill || entry.rationExpense || '';
      document.getElementById('salesBaseExpense').value = entry.baseExpense || '';
      document.getElementById('salesCreditExpense').value = entry.creditExpense || '';
      document.getElementById('salesCashExpense').value = entry.cashExpense || '';
      document.getElementById('salesMiscExpense').value = entry.miscExpense || '';
      document.getElementById('salesCashCommission').value = entry.cashCommission || Math.round((Number(entry.salesAchievement || entry.totalSale) || 0) * 0.10);
      document.getElementById('salesStaffSalary').value = entry.staffSalary || '';
      document.getElementById('salesManagerSalary').value = entry.managerSalary || '';
      document.getElementById('salesECatering').value = entry.eCatering || '';
      document.getElementById('salesGpTarget').value = entry.gpTarget || '';
      document.getElementById('salesGpAchievement').value = entry.gpAchievement || '';
      document.getElementById('salesGpAchievementPct').value = entry.gpTarget > 0 ? Math.round((entry.gpAchievement / entry.gpTarget) * 100) + '%' : '0%';
      document.getElementById('salesRemarks').value = entry.remarks || '';
      renderHisabExcelPdfPreview();
      setSalesEntryFieldsDisabled(!!options.locked);
    }

    function userCanApproveSalesReopen(user) {
      return !!user && ['admin', 'super_admin', 'ops_manager'].includes(user.role) && user.active !== false;
    }

    function requestSalesReopenApproval(entry) {
      pendingSalesReopen = entry;
      setSalesEntryFieldsDisabled(true);
      document.getElementById('salesReopenApproverId').value = '';
      document.getElementById('salesReopenApproverPassword').value = '';
      document.getElementById('salesReopenApprovalModal').classList.add('active');
    }

    function confirmSalesReopenApproval() {
      const id = document.getElementById('salesReopenApproverId').value.trim().toLowerCase();
      const password = document.getElementById('salesReopenApproverPassword').value;
      const approver = (appData.users || []).find(u => ((u.email || '').toLowerCase() === id || String(u.id) === id) && u.password === password && userCanApproveSalesReopen(u));
      if (!approver) { showAlert('Approval failed. Use Admin, Super Admin, or Ops Manager ID/password.', 'error'); return; }
      const idx = appData.sales.findIndex(s => s.id == pendingSalesReopen?.id);
      if (idx >= 0) {
        appData.sales[idx].salesReopenedAfterCash = true;
        appData.sales[idx].salesReopenApprovedBy = approver.email || approver.name || approver.id;
        appData.sales[idx].salesReopenApprovedAt = new Date().toISOString();
        saveData();
        loadSalesEntryIntoForm(appData.sales[idx], { locked: false });
      }
      closeSalesReopenApprovalModal();
      showAlert('Sales entry reopened for editing.', 'success');
    }

    function closeSalesReopenApprovalModal() {
      document.getElementById('salesReopenApprovalModal').classList.remove('active');
      pendingSalesReopen = null;
    }

    function checkExistingSalesForSelectedTrain() {
      const trainId = document.getElementById('salesTrainId')?.value;
      const date = document.getElementById('salesDate')?.value;
      if (!trainId || !date) return;
      const train = (appData.trainMasters || []).find(t => t.id == trainId);
      if (!train) return;
      const selectedOption = document.getElementById('salesRakeManager')?.selectedOptions?.[0];
      const selectedRakeManager = document.getElementById('salesRakeManager')?.value || train.rakeManager || '';
      const selectedRakeNumber = selectedOption?.dataset?.rakeNumber || train.rakeNumber || '';
      const selectedMasterId = selectedOption?.dataset?.masterId || trainId;
      const existing = findSalesEntryByDateTrain(date, train.trainNumber, train.trainName, selectedMasterId, editingType === 'sales' ? editingId : null, selectedRakeManager, selectedRakeNumber);
      if (!existing) {
        if (editingType === 'sales') {
          editingId = null;
          editingType = null;
        }
        setSalesEntryFieldsDisabled(false);
        return;
      }
      const cashStatus = getCashDepositStatusForSale(existing);
      loadSalesEntryIntoForm(existing, { locked: cashStatus.completed });
      showAlert(cashStatus.completed ? 'Sales entry already exists and cash deposit is completed. Approval required to edit.' : 'Sales entry already exists. Existing data loaded for editing.', cashStatus.completed ? 'warning' : 'info');
      if (cashStatus.completed) requestSalesReopenApproval(existing);
    }

    const SALES_DETAIL_CONFIG = {
      totalSale: { inputId: 'salesAchievement', label: 'Total Sale' },
      storeBill: { inputId: 'salesStoreBill', label: 'Store Bill' },
      baseExpense: { inputId: 'salesBaseExpense', label: 'Base Expenses' },
      creditExpense: { inputId: 'salesCreditExpense', label: 'Credit Expenses' },
      cashExpense: { inputId: 'salesCashExpense', label: 'Cash Expenses' },
      miscExpense: { inputId: 'salesMiscExpense', label: 'MISC Expenses' },
      eCatering: { inputId: 'salesECatering', label: 'E-Catering' }
    };
    const DEFAULT_MISC_EXPENSE_LINES = [
      { item: 'POOJA', rate: 51, qty: 1, amount: 51 },
      { item: 'AUTO', rate: 200, qty: 1, amount: 200 },
      { item: 'RPF', rate: 200, qty: 1, amount: 200 },
      { item: 'ICE', rate: 760, qty: 1, amount: 760 },
      { item: 'FREE', rate: 750, qty: 1, amount: 750 },
      { item: 'JAR', rate: 200, qty: 1, amount: 200 },
      { item: 'Room', rate: 0, qty: 1, amount: 0 },
      { item: 'Irctc', rate: 500, qty: 1, amount: 500 },
      { item: 'P.Car', rate: 500, qty: 1, amount: 500 }
    ];

    const SALES_SUPPORT_FIELDS = {
      storeBill: 'Store Bill',
      baseExpense: 'Base Expenses',
      creditExpense: 'Credit Expenses',
      cashExpense: 'Cash Expenses',
      hisabExcelPdf: 'Hisab Excel PDF'
    };

    function getMiscLimitAmount() {
      const totalSale = Number(document.getElementById('salesAchievement')?.value) || 0;
      return Math.round(totalSale * 0.01);
    }

    function syncAutoMiscExpense() {
      const miscInput = document.getElementById('salesMiscExpense');
      const hint = document.getElementById('salesMiscLimitHint');
      if (!miscInput) return;
      const limit = getMiscLimitAmount();
      if (!salesMiscManual) miscInput.value = limit || '';
      const value = Number(miscInput.value) || 0;
      if (hint) {
        const diff = value - limit;
        hint.textContent = diff
          ? `Auto 1%: ${formatCurrency(limit)} | Difference: ${diff > 0 ? '+' : '-'}${formatCurrency(Math.abs(diff))}`
          : `Auto 1%: ${formatCurrency(limit)} | Matched`;
        hint.style.color = diff ? '#dc2626' : '#64748b';
      }
    }

    function onSalesDatesChange() {
      refreshSalesTargetForDate();
      if (salesSalaryDetails.length) {
        recalcSalaryDetails();
        document.getElementById('salesManagerSalary').value = Math.round(salesSalaryDetails.reduce((sum, row) => sum + (Number(row.actualSalary) || 0), 0));
      }
      calculateSalesCostsAndGp();
    }

    function getSalesTripDays() {
      const dep = document.getElementById('salesDepartureDate')?.value;
      const arr = document.getElementById('salesDate')?.value;
      if (!dep || !arr) return 1;
      const start = new Date(dep);
      const end = new Date(arr);
      const diff = Math.round((end - start) / 86400000);
      return Math.max(diff + 1, 1);
    }

    function getAutoStaffSalary(totalSale) {
      const trainType = normalizeText(document.getElementById('salesTrainType')?.value);
      return trainType === normalizeText('WCB') ? Math.round((Number(totalSale) || 0) * 0.03) : 0;
    }

    function openSalesDetailModal(field) {
      currentSalesDetailField = field;
      const config = SALES_DETAIL_CONFIG[field];
      if (!config) return;
      salesCostDetails[field] = Array.isArray(salesCostDetails[field]) ? salesCostDetails[field] : [];
      if (field === 'miscExpense' && !salesCostDetails[field].length) {
        salesCostDetails[field] = JSON.parse(JSON.stringify(DEFAULT_MISC_EXPENSE_LINES));
      }
      if (field !== 'totalSale' && !salesCostDetails[field].length) salesCostDetails[field].push({ item: '', rate: 0, qty: 1, amount: 0 });
      document.getElementById('salesDetailModalTitle').textContent = `${config.label} Detail`;
      renderSalesItemMasterDatalist();
      const picker = document.getElementById('salesItemPickerPanel');
      if (picker) picker.classList.toggle('active', field === 'totalSale');
      if (field === 'totalSale') {
        salesItemCategoryFilter = 'ALL';
        if (document.getElementById('salesItemSearch')) document.getElementById('salesItemSearch').value = '';
        renderSalesItemPicker();
      }
      renderSalesDetailLines();
      renderSalesSupportPreview(field);
      document.getElementById('salesDetailModal').classList.add('active');
    }

    function closeSalesDetailModal() {
      document.getElementById('salesDetailModal').classList.remove('active');
      currentSalesDetailField = '';
    }

    function renderSalesDetailLines() {
      const rows = salesCostDetails[currentSalesDetailField] || [];
      const tbody = document.getElementById('salesDetailLinesBody');
      const useItemMaster = currentSalesDetailField === 'totalSale';
      tbody.innerHTML = rows.map((line, index) => `
        <tr>
          <td><input class="item-input" ${useItemMaster ? 'list="salesItemMasterList"' : ''} value="${escapeHtml(line.item || '')}" oninput="updateSalesDetailLine(${index}, 'item', this.value)" placeholder="${useItemMaster ? 'Search item master...' : 'Item'}"></td>
          <td><input type="number" value="${Number(line.rate) || 0}" oninput="updateSalesDetailLine(${index}, 'rate', this.value)"></td>
          <td><input type="number" value="${Number(line.qty) || 0}" oninput="updateSalesDetailLine(${index}, 'qty', this.value)"></td>
          <td><input type="number" value="${Number(line.amount) || 0}" oninput="updateSalesDetailLine(${index}, 'amount', this.value)"></td>
          <td><button class="btn-icon delete" onclick="removeSalesDetailLine(${index})"><i class="fas fa-trash"></i></button></td>
        </tr>
      `).join('');
      document.getElementById('salesDetailTotal').textContent = formatCurrency(getSalesDetailTotal(currentSalesDetailField));
    }

    function renderSalesItemMasterDatalist() {
      const list = document.getElementById('salesItemMasterList');
      if (!list) return;
      list.innerHTML = getAvailableSalesItemRates().map(item => `<option value="${escapeHtml(item.itemName || '')}" label="${escapeHtml(`${item.category || 'Item'} | ${item.trainType || 'ALL'} | ${formatCurrency(item.saleRate || 0)}`)}"></option>`).join('');
    }

    function renderSalesItemPicker() {
      const categoryBox = document.getElementById('salesItemCategoryList');
      const productGrid = document.getElementById('salesItemProductGrid');
      if (!categoryBox || !productGrid) return;
      const items = getAvailableSalesItemRates();
      const categories = ['ALL', ...new Set(items.map(item => item.category || 'Uncategorized'))].sort((a, b) => a === 'ALL' ? -1 : b === 'ALL' ? 1 : a.localeCompare(b));
      if (!categories.includes(salesItemCategoryFilter)) salesItemCategoryFilter = 'ALL';
      categoryBox.innerHTML = categories.map(category => `
        <button type="button" class="sales-item-category ${category === salesItemCategoryFilter ? 'active' : ''}" onclick="selectSalesItemCategory('${encodeURIComponent(category)}')">
          ${escapeHtml(category)}${category === 'ALL' ? ` (${items.length})` : ''}
        </button>
      `).join('');
      const query = normalizeText(document.getElementById('salesItemSearch')?.value || '');
      const filtered = items.filter(item =>
        (salesItemCategoryFilter === 'ALL' || (item.category || 'Uncategorized') === salesItemCategoryFilter) &&
        (!query || normalizeText(`${item.itemName || ''} ${item.category || ''} ${item.trainType || ''}`).includes(query))
      );
      productGrid.innerHTML = filtered.length ? filtered.map(item => `
        <button type="button" class="sales-item-product" onclick="addSalesItemFromMaster('${item.id}')">
          <strong>${escapeHtml(item.itemName || '')}</strong>
          <span>${escapeHtml(item.category || 'Uncategorized')} | ${escapeHtml(item.trainType || 'ALL')}</span>
          <span>Sale Rate: ${formatCurrency(item.saleRate || 0)}</span>
        </button>
      `).join('') : '<div style="color:#64748b;padding:12px;">No item found for this category/search.</div>';
    }

    function selectSalesItemCategory(encodedCategory) {
      salesItemCategoryFilter = decodeURIComponent(encodedCategory || 'ALL');
      renderSalesItemPicker();
    }

    function addSalesItemFromMaster(id) {
      const item = (appData.itemRateMasters || []).find(row => String(row.id) === String(id));
      if (!item) return;
      if (!salesCostDetails.totalSale) salesCostDetails.totalSale = [];
      const existing = salesCostDetails.totalSale.find(line => normalizeText(line.item) === normalizeText(item.itemName) && Number(line.rate) === Number(item.saleRate || 0));
      if (existing) {
        existing.qty = (Number(existing.qty) || 0) + 1;
        existing.amount = Math.round((Number(existing.rate) || 0) * (Number(existing.qty) || 0));
      } else {
        salesCostDetails.totalSale.push({
          item: item.itemName || '',
          category: item.category || '',
          trainType: item.trainType || 'ALL',
          rate: Number(item.saleRate) || 0,
          purchaseRate: Number(item.purchaseRate) || 0,
          eCateringRate: Number(item.eCateringRate) || 0,
          qty: 1,
          amount: Math.round(Number(item.saleRate) || 0)
        });
      }
      renderSalesDetailLines();
    }

    function updateSalesDetailLine(index, key, value) {
      const rows = salesCostDetails[currentSalesDetailField] || [];
      if (!rows[index]) return;
      rows[index][key] = key === 'item' ? value : Number(value) || 0;
      if (currentSalesDetailField === 'totalSale' && key === 'item') {
        const masterItem = getItemRateByName(value);
        if (masterItem) {
          rows[index].category = masterItem.category || '';
          rows[index].trainType = masterItem.trainType || 'ALL';
          rows[index].purchaseRate = Number(masterItem.purchaseRate) || 0;
          rows[index].eCateringRate = Number(masterItem.eCateringRate) || 0;
          rows[index].rate = Number(masterItem.saleRate) || 0;
          rows[index].amount = Math.round((Number(rows[index].rate) || 0) * (Number(rows[index].qty) || 0));
          const inputs = document.querySelectorAll('#salesDetailLinesBody tr')[index]?.querySelectorAll('input');
          if (inputs?.[1]) inputs[1].value = rows[index].rate;
          if (inputs?.[3]) inputs[3].value = rows[index].amount;
        }
      }
      if (key === 'rate' || key === 'qty') {
        rows[index].amount = Math.round((Number(rows[index].rate) || 0) * (Number(rows[index].qty) || 0));
        const amountInput = document.querySelectorAll('#salesDetailLinesBody tr')[index]?.querySelectorAll('input')[3];
        if (amountInput) amountInput.value = rows[index].amount;
      }
      document.getElementById('salesDetailTotal').textContent = formatCurrency(getSalesDetailTotal(currentSalesDetailField));
    }

    function addSalesDetailLine() {
      if (!salesCostDetails[currentSalesDetailField]) salesCostDetails[currentSalesDetailField] = [];
      salesCostDetails[currentSalesDetailField].push({ item: '', rate: 0, qty: 1, amount: 0 });
      renderSalesDetailLines();
    }

    function removeSalesDetailLine(index) {
      salesCostDetails[currentSalesDetailField].splice(index, 1);
      if (!salesCostDetails[currentSalesDetailField].length) salesCostDetails[currentSalesDetailField].push({ item: '', rate: 0, qty: 1, amount: 0 });
      renderSalesDetailLines();
    }

    function getSalesDetailTotal(field) {
      return (salesCostDetails[field] || []).reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
    }

    function getTotalSaleDetailDifference() {
      const detailTotal = Math.round(getSalesDetailTotal('totalSale'));
      const enteredTotal = Math.round(Number(document.getElementById('salesAchievement')?.value) || 0);
      return { detailTotal, enteredTotal, difference: enteredTotal - detailTotal };
    }

    function applySalesDetailModal() {
      const config = SALES_DETAIL_CONFIG[currentSalesDetailField];
      if (!config) return;
      document.getElementById(config.inputId).value = Math.round(getSalesDetailTotal(currentSalesDetailField));
      if (currentSalesDetailField === 'miscExpense') salesMiscManual = true;
      closeSalesDetailModal();
      calculateSalesCostsAndGp();
    }

    function buildDefaultSalaryDetails() {
      const select = document.getElementById('salesRakeManager');
      const selected = select?.selectedOptions?.[0];
      const days = getSalesTripDays();
      const salaryToDeposit = Math.round((25000 / 30) * days);
      return [{
        managerName: select?.value || '',
        phone: selected?.dataset?.phone || '',
        post: 'Rack Manager',
        monthSalary: 25000,
        salaryToDeposit,
        actualSalary: salaryToDeposit,
        manualActual: false
      }];
    }

    function recalcSalaryDetails() {
      const days = getSalesTripDays();
      salesSalaryDetails = (salesSalaryDetails || []).map(row => {
        const monthSalary = row.post === 'Assistant Rack Manager' ? 21100 : 25000;
        const salaryToDeposit = Math.round((monthSalary / 30) * days);
        return {
          ...row,
          monthSalary,
          salaryToDeposit,
          actualSalary: row.manualActual ? (Number(row.actualSalary) || 0) : salaryToDeposit
        };
      });
    }

    function openSalaryDetailModal() {
      if (!salesSalaryDetails.length) salesSalaryDetails = buildDefaultSalaryDetails();
      recalcSalaryDetails();
      renderSalaryDetailLines();
      document.getElementById('salaryDetailModal').classList.add('active');
    }

    function closeSalaryDetailModal() {
      document.getElementById('salaryDetailModal').classList.remove('active');
    }

    function renderSalaryDetailLines() {
      recalcSalaryDetails();
      const tbody = document.getElementById('salaryDetailLinesBody');
      tbody.innerHTML = salesSalaryDetails.map((line, index) => `
        <tr>
          <td><input value="${line.managerName || ''}" ${index === 0 ? 'readonly' : ''} oninput="updateSalaryDetailLine(${index}, 'managerName', this.value)"></td>
          <td><input value="${line.phone || ''}" oninput="updateSalaryDetailLine(${index}, 'phone', this.value)"></td>
          <td>
            <select onchange="updateSalaryDetailLine(${index}, 'post', this.value)">
              <option ${line.post === 'Rack Manager' ? 'selected' : ''}>Rack Manager</option>
              <option ${line.post === 'Assistant Rack Manager' ? 'selected' : ''}>Assistant Rack Manager</option>
            </select>
          </td>
          <td><input type="number" value="${Number(line.monthSalary) || 0}" readonly></td>
          <td><input type="number" value="${Number(line.salaryToDeposit) || 0}" readonly></td>
          <td><input type="number" value="${Number(line.actualSalary) || 0}" oninput="updateSalaryDetailLine(${index}, 'actualSalary', this.value)"></td>
          <td>${index === 0 ? '' : `<button class="btn-icon delete" onclick="removeSalaryDetailLine(${index})"><i class="fas fa-trash"></i></button>`}</td>
        </tr>
      `).join('');
      const total = salesSalaryDetails.reduce((sum, row) => sum + (Number(row.actualSalary) || 0), 0);
      const shortage = salesSalaryDetails.some(row => (Number(row.actualSalary) || 0) < (Number(row.salaryToDeposit) || 0));
      document.getElementById('salaryDetailTotal').textContent = formatCurrency(total);
      document.getElementById('salaryDetailWarning').classList.toggle('hidden', !shortage);
    }

    function updateSalaryDetailLine(index, key, value) {
      if (!salesSalaryDetails[index]) return;
      salesSalaryDetails[index][key] = key === 'actualSalary' ? Number(value) || 0 : value;
      if (key === 'actualSalary') salesSalaryDetails[index].manualActual = true;
      if (key === 'post') salesSalaryDetails[index].manualActual = false;
      if (key === 'post') {
        renderSalaryDetailLines();
        return;
      }
      const total = salesSalaryDetails.reduce((sum, row) => sum + (Number(row.actualSalary) || 0), 0);
      const shortage = salesSalaryDetails.some(row => (Number(row.actualSalary) || 0) < (Number(row.salaryToDeposit) || 0));
      document.getElementById('salaryDetailTotal').textContent = formatCurrency(total);
      document.getElementById('salaryDetailWarning').classList.toggle('hidden', !shortage);
    }

    function addSalaryDetailLine() {
      const salaryToDeposit = Math.round((21100 / 30) * getSalesTripDays());
      salesSalaryDetails.push({ managerName: '', phone: '', post: 'Assistant Rack Manager', monthSalary: 21100, salaryToDeposit, actualSalary: salaryToDeposit, manualActual: false });
      renderSalaryDetailLines();
    }

    function removeSalaryDetailLine(index) {
      salesSalaryDetails.splice(index, 1);
      renderSalaryDetailLines();
    }

    function applySalaryDetailModal() {
      const total = salesSalaryDetails.reduce((sum, row) => sum + (Number(row.actualSalary) || 0), 0);
      document.getElementById('salesManagerSalary').value = Math.round(total);
      closeSalaryDetailModal();
      calculateSalesCostsAndGp();
    }

    function getCurrentSalesCostValues() {
      const totalSale = Number(document.getElementById('salesAchievement')?.value) || 0;
      syncAutoMiscExpense();
      const storeBill = Number(document.getElementById('salesStoreBill')?.value) || 0;
      const baseExpense = Number(document.getElementById('salesBaseExpense')?.value) || 0;
      const creditExpense = Number(document.getElementById('salesCreditExpense')?.value) || 0;
      const cashExpense = Number(document.getElementById('salesCashExpense')?.value) || 0;
      const miscExpense = Number(document.getElementById('salesMiscExpense')?.value) || 0;
      const commission = Math.round(totalSale * 0.10);
      const staffSalary = getAutoStaffSalary(totalSale);
      const staffSalaryInput = document.getElementById('salesStaffSalary');
      if (staffSalaryInput) staffSalaryInput.value = staffSalary;
      const managerSalary = Number(document.getElementById('salesManagerSalary')?.value) || 0;
      const eCatering = Number(document.getElementById('salesECatering')?.value) || 0;
      const gpAchievement = Math.round(totalSale - (storeBill + baseExpense + creditExpense + cashExpense + miscExpense + commission + staffSalary + managerSalary));
      const amountToCollect = Math.round((gpAchievement + storeBill + baseExpense + creditExpense + managerSalary) - eCatering);
      return { totalSale, storeBill, baseExpense, creditExpense, cashExpense, miscExpense, commission, staffSalary, managerSalary, eCatering, gpAchievement, amountToCollect };
    }

    function calculateSalesCostsAndGp() {
      const values = getCurrentSalesCostValues();
      const commissionInput = document.getElementById('salesCashCommission');
      if (commissionInput) commissionInput.value = values.commission;
      const gpInput = document.getElementById('salesGpAchievement');
      if (gpInput) gpInput.value = values.gpAchievement;
      calculateSalesPct();
      calculateGpPct();
    }

    function calculateGpPct() {
      const target = Number(document.getElementById('salesGpTarget').value) || 0;
      const achievement = Number(document.getElementById('salesGpAchievement').value) || 0;
      const pct = target > 0 ? Math.round((achievement / target) * 100) : 0;
      document.getElementById('salesGpAchievementPct').value = pct + '%';
      
      const remarksRequired = document.getElementById('remarksRequired');
      if (pct < 100) {
        remarksRequired.style.display = 'inline';
      } else {
        remarksRequired.style.display = 'none';
      }
    }

    function validateAndSaveSalesEntry() {
      if (!ensureEditable('save entries')) return;
      const trainId = document.getElementById('salesTrainId').value;
      const departureDate = document.getElementById('salesDepartureDate')?.value;
      const date = document.getElementById('salesDate').value;
      const salesAchievement = document.getElementById('salesAchievement').value;
      calculateSalesCostsAndGp();
      const gpAchievement = document.getElementById('salesGpAchievement').value;
      const gpTarget = Number(document.getElementById('salesGpTarget').value) || 0;
      const remarks = document.getElementById('salesRemarks').value.trim();

      if (!trainId || !departureDate || !date || !salesAchievement) {
        showAlert('Please fill train, departure date, arrival date and total sale', 'error');
        return;
      }

      const gpPct = gpTarget > 0 ? (Number(gpAchievement) / gpTarget) * 100 : 0;

      if (gpPct < 95) {
        document.getElementById('gpWarningPct').textContent = Math.round(gpPct) + '%';
        document.getElementById('gpApprovedBy').value = '';
        document.getElementById('gpApprovalRemarks').value = '';
        document.getElementById('gpWarningModal').classList.add('active');
        
        const train = appData.trainMasters.find(t => t.id == trainId);
        pendingSalesEntry = { trainId, date, salesAchievement, gpAchievement, train, remarks };
        return;
      }

      if (gpPct < 100 && !remarks) {
        showAlert('Remarks are required when GP Achievement is below 100%', 'error');
        document.getElementById('salesRemarks').focus();
        return;
      }

      saveSalesEntryDirect();
    }

    function confirmGpApproval() {
      const approvedBy = document.getElementById('gpApprovedBy').value.trim();
      const approvalRemarks = document.getElementById('gpApprovalRemarks').value.trim();

      if (!approvedBy) { showAlert('Please enter approver name', 'error'); return; }
      if (!approvalRemarks) { showAlert('Please enter approval remarks', 'error'); return; }

      const originalRemarks = pendingSalesEntry.remarks;
      const combinedRemarks = originalRemarks + (originalRemarks ? ' | ' : '') + 
        `Approved by: ${approvedBy} - ${approvalRemarks}`;
      document.getElementById('salesRemarks').value = combinedRemarks;

      closeGpWarningModal();
      saveSalesEntryDirect();
    }

    function closeGpWarningModal() {
      document.getElementById('gpWarningModal').classList.remove('active');
      pendingSalesEntry = null;
    }

    function saveSalesEntryDirect() {
      if (!ensureEditable('save entries')) return;
      const trainId = document.getElementById('salesTrainId').value;
      const departureDate = document.getElementById('salesDepartureDate')?.value || document.getElementById('salesDate').value;
      const date = document.getElementById('salesDate').value;
      const salesAchievement = document.getElementById('salesAchievement').value;
      const gpAchievement = document.getElementById('salesGpAchievement').value;

      const train = appData.trainMasters.find(t => t.id == trainId);
      if (!train) { showAlert('Train not found', 'error'); return; }
      const selectedRakeManager = document.getElementById('salesRakeManager')?.value || '';
      const selectedRakeNumber = document.getElementById('salesRakeManager')?.selectedOptions?.[0]?.dataset?.rakeNumber || train.rakeNumber || '';
      const selectedMasterId = document.getElementById('salesRakeManager')?.selectedOptions?.[0]?.dataset?.masterId || '';
      const effectiveTrain = (selectedMasterId ? (appData.trainMasters || []).find(t => String(t.id) === String(selectedMasterId)) : null)
        || getEffectiveMaster(train.trainNumber, train.trainName, date, selectedRakeManager, selectedRakeNumber)
        || resolveSelectedTrainMaster(trainId, train.trainNumber, train.trainName, date)
        || train;
      const duplicate = findDuplicateEntry(appData.sales, date, train.trainNumber, train.trainName, editingId, selectedRakeManager, selectedRakeNumber);
      if (duplicate && !confirm('Sales data is already available for same train number and date. Overwrite existing entry?')) return;
      const existingForEdit = editingId ? (appData.sales || []).find(s => s.id == editingId) : null;
      if (existingForEdit && getCashDepositStatusForSale(existingForEdit).completed && !existingForEdit.salesReopenedAfterCash) {
        requestSalesReopenApproval(existingForEdit);
        return;
      }
      const salesCosts = getCurrentSalesCostValues();
      const miscAutoAmount = getMiscLimitAmount();
      const miscDifference = Math.round((Number(document.getElementById('salesMiscExpense')?.value) || 0) - miscAutoAmount);
      if (miscDifference !== 0) {
        showAlert(`MISC Expenses differs from 1% auto amount by ${miscDifference > 0 ? '+' : '-'}${formatCurrency(Math.abs(miscDifference))}. Manual amount will be saved.`, 'warning');
      }
      const saleDetailCheck = getTotalSaleDetailDifference();
      if (saleDetailCheck.detailTotal > 0 && saleDetailCheck.difference !== 0) {
        showAlert(`Total Sale differs from item detail total by ${saleDetailCheck.difference > 0 ? '+' : '-'}${formatCurrency(Math.abs(saleDetailCheck.difference))}. Manual Total Sale will be saved.`, 'warning');
      }

      const entry = {
        id: editingId || Date.now(),
        date: date,
        departureDate: departureDate,
        arrivalDate: date,
        month: new Date(date).toLocaleString('en-US', { month: 'short' }),
        trainId: effectiveTrain.id || trainId,
        trainName: effectiveTrain.trainName || train.trainName,
        trainNumber: normalizeTrainNo(effectiveTrain.trainNumber || train.trainNumber) || effectiveTrain.trainNumber || train.trainNumber || '',
        yard: effectiveTrain.yard || train.yard,
        clusterManager: effectiveTrain.clusterManager || '',
        trainManager: effectiveTrain.trainManager || '',
        rakeManager: effectiveTrain.rakeManager || '',
        rakeManagerContact: effectiveTrain.rakeManagerContact || effectiveTrain.rakeManagerPhone || '',
        rakeManagerPhone: effectiveTrain.rakeManagerContact || effectiveTrain.rakeManagerPhone || '',
        rakeNumber: effectiveTrain.rakeNumber || '',
        businessHead: effectiveTrain.businessHead || '',
        vp: effectiveTrain.vp || '',
        trainType: effectiveTrain.trainType || train.trainType,
        salesTarget: getTrainSalesTarget(train.trainNumber, train.trainName, date),
        salesAchievement: Math.round(Number(salesAchievement)),
        totalSale: Math.round(Number(salesAchievement)),
        itemSaleDetailTotal: saleDetailCheck.detailTotal,
        itemSaleDifference: saleDetailCheck.detailTotal > 0 ? saleDetailCheck.difference : 0,
        itemSaleWarning: saleDetailCheck.detailTotal > 0 && saleDetailCheck.difference !== 0,
        storeBill: Math.round(salesCosts.storeBill),
        baseExpense: Math.round(salesCosts.baseExpense),
        creditExpense: Math.round(salesCosts.creditExpense),
        cashExpense: Math.round(salesCosts.cashExpense),
        miscExpense: Math.round(salesCosts.miscExpense),
        miscAutoAmount: miscAutoAmount,
        miscDifference: miscDifference,
        miscWarning: miscDifference !== 0,
        cashCommission: Math.round(salesCosts.commission),
        staffSalary: Math.round(salesCosts.staffSalary),
        managerSalary: Math.round(salesCosts.managerSalary),
        eCatering: Math.round(salesCosts.eCatering),
        amountToCollect: Math.round(salesCosts.amountToCollect),
        detailLines: JSON.parse(JSON.stringify(salesCostDetails || {})),
        salaryDetails: JSON.parse(JSON.stringify(salesSalaryDetails || [])),
        supportingFiles: JSON.parse(JSON.stringify(salesSupportFiles || {})),
        salesReopenedAfterCash: existingForEdit?.salesReopenedAfterCash || false,
        salesReopenApprovedBy: existingForEdit?.salesReopenApprovedBy || '',
        salesReopenApprovedAt: existingForEdit?.salesReopenApprovedAt || '',
        gpTarget: getTrainGpTarget(train.trainNumber, train.trainName, date),
        gpAchievement: Math.round(Number(gpAchievement)),
        remarks: document.getElementById('salesRemarks').value
      };

      if (editingId && editingType === 'sales') {
        const index = appData.sales.findIndex(s => s.id == editingId);
        if (index >= 0) appData.sales[index] = entry;
      } else if (duplicate) {
        const index = appData.sales.findIndex(s => s.id == duplicate.id);
        if (index >= 0) appData.sales[index] = { ...entry, id: duplicate.id };
      } else {
        appData.sales.push(entry);
      }

      saveData();
      clearSalesForm();
      showAlert('Sales entry saved successfully', 'success');
      loadSalesList();
      loadDashboard();
    }

    function clearSalesForm() {
      editingId = null;
      editingType = null;
      pendingSalesEntry = null;
      pendingSalesReopen = null;
      salesCostDetails = {};
      salesSalaryDetails = [];
      salesSupportFiles = {};
      currentSalesDetailField = '';
      salesMiscManual = false;
      setSalesEntryFieldsDisabled(false);
      document.getElementById('salesTrainId').value = '';
      document.getElementById('salesTrainSearch').value = '';
      document.getElementById('salesDepartureDate').value = new Date().toISOString().split('T')[0];
      document.getElementById('salesDate').value = new Date().toISOString().split('T')[0];
      document.getElementById('salesTrainNo').value = '';
      document.getElementById('salesYard').value = '';
      document.getElementById('salesClusterManager').value = '';
      document.getElementById('salesTrainManager').value = '';
      document.getElementById('salesRakeManager').innerHTML = '<option value="">Select train first</option>';
      document.getElementById('salesTrainType').value = '';
      document.getElementById('salesTarget').value = '';
      document.getElementById('salesAchievement').value = '';
      document.getElementById('salesAchievementPct').value = '';
      document.getElementById('salesStoreBill').value = '';
      document.getElementById('salesBaseExpense').value = '';
      document.getElementById('salesCreditExpense').value = '';
      document.getElementById('salesCashExpense').value = '';
      document.getElementById('salesMiscExpense').value = '';
      document.getElementById('salesCashCommission').value = '';
      document.getElementById('salesStaffSalary').value = '';
      document.getElementById('salesManagerSalary').value = '';
      document.getElementById('salesECatering').value = '';
      document.getElementById('salesGpTarget').value = '';
      document.getElementById('salesGpAchievement').value = '';
      document.getElementById('salesGpAchievementPct').value = '';
      document.getElementById('salesRemarks').value = '';
      document.getElementById('remarksRequired').style.display = 'none';
      renderHisabExcelPdfPreview();
    }

    function getFilteredSalesEntriesFromListFilters() {
      const fromDate = document.getElementById('salesFilterFrom').value;
      const toDate = document.getElementById('salesFilterTo').value;
      const trainFilter = document.getElementById('salesFilterTrain').value;
      const yardFilter = document.getElementById('salesFilterYard').value;
      const managerFilter = document.getElementById('salesFilterManager').value;

      let filtered = [...(appData.sales || [])];
      
      if (fromDate) filtered = filtered.filter(s => getSalesEntryArrivalDate(s) >= fromDate);
      if (toDate) filtered = filtered.filter(s => getSalesEntryArrivalDate(s) <= toDate);
      if (trainFilter) filtered = filtered.filter(s => s.trainName === trainFilter);
      if (yardFilter) filtered = filtered.filter(s => s.yard === yardFilter);
      if (managerFilter) filtered = filtered.filter(s => s.trainManager === managerFilter);

      if (currentUser.yard !== 'ALL') filtered = filtered.filter(s => s.yard === currentUser.yard);

      filtered.sort((a, b) => new Date(getSalesEntryArrivalDate(b)) - new Date(getSalesEntryArrivalDate(a)));
      return filtered;
    }

    function getSalesEntryArrivalDate(entry) {
      return getComparableDate(entry?.arrivalDate || entry?.date || '');
    }

    function getSalesEntryDepartureDate(entry) {
      return getComparableDate(entry?.departureDate || entry?.entryDate || entry?.date || '');
    }

    function loadSalesList() {
      const filtered = getFilteredSalesEntriesFromListFilters();
      const rowActions = (id) => {
        const safeId = String(id).replace(/'/g, "\\'");
        return isReadOnlyUser()
          ? '<span style="font-size:11px;color:#64748b;">View only</span>'
          : `<button class="btn-icon edit" onclick="editSalesEntry('${safeId}')"><i class="fas fa-edit"></i></button>
             <button class="btn-icon delete" onclick="deleteSalesEntry('${safeId}')"><i class="fas fa-trash"></i></button>`;
      };

      document.getElementById('salesTableBody').innerHTML = filtered.map(s => `
        <tr>
          <td>${formatDate(getSalesEntryArrivalDate(s))}</td>
          <td>${formatDate(getSalesEntryDepartureDate(s))}</td>
          <td>${s.trainName}</td>
          <td>${s.yard}</td>
          <td>${formatCurrency(s.salesAchievement)}</td>
          <td>${formatCurrency(s.gpAchievement)}</td>
          <td>${getSalesSupportCount(s) ? `<button class="btn btn-ghost btn-sm" onclick="openSalesSupportModal('${s.id}')"><i class="fas fa-paperclip"></i> ${getSalesSupportCount(s)}</button>` : '-'}</td>
          <td>${s.remarks || '-'}</td>
          <td>
            ${rowActions(s.id)}
          </td>
        </tr>
      `).join('');
    }

    function applyComplaintFilter(type, value) {
      toggleComplaintChartFilter(type, value);
    }

    function editSalesEntry(id) {
      if (!ensureEditable('edit entries')) return;
      const entry = appData.sales.find(s => s.id == id);
      if (!entry) return;

      editingId = id;
      editingType = 'sales';
      
      const cashStatus = getCashDepositStatusForSale(entry);
      loadSalesEntryIntoForm(entry, { locked: cashStatus.completed && !entry.salesReopenedAfterCash });
      if (cashStatus.completed && !entry.salesReopenedAfterCash) requestSalesReopenApproval(entry);

      switchSalesTab('entry');
    }

    function deleteSalesEntry(id) {
      if (!ensureEditable('delete entries')) return;
      const entry = (appData.sales || []).find(s => String(s.id) === String(id));
      if (!entry) { showAlert('Sales entry not found. Please refresh and try again.', 'error'); return; }
      if (!confirm('Are you sure you want to delete this entry?')) return;
      markRecordDeleted('sales', entry.id);
      markRecordDeleted('sales', makeRecordKey(entry, 'sales'));
      appData.sales = appData.sales.filter(s => String(s.id) !== String(id));
      saveData();
      loadSalesList();
      loadDashboard();
      showAlert('Entry deleted', 'success');
    }

    // ==================== COMPLAINT PAGE FUNCTIONS ====================
    function loadComplaintsPage() {
      populateYardSelects();
      populateComplaintTrainDropdown();
      
      const trains = [...new Set(appData.complaints.map(c => c.trainName))].filter(Boolean).sort();
      document.getElementById('complaintFilterTrain').innerHTML = '<option value="">All Trains</option>' + trains.map(t => `<option value="${t}">${t}</option>`).join('');
      document.getElementById('complaintFilterYard').innerHTML = '<option value="">All Yards</option>' + (appData.yards || []).map(y => `<option value="${y}">${y}</option>`).join('');
      
      loadComplaintList();
      loadOpenComplaintQueue();
    }

    function populateComplaintTrainDropdown() {
      const trains = getSortedTrainMastersForSelection();
      const dropdown = document.getElementById('complaintTrainDropdown');
      dropdown.innerHTML = trains.map(t => `
        <div class="searchable-dropdown-item" onclick="selectComplaintTrain('${t.id}', '${t.trainName}', '${t.trainNumber}', '${t.trainType || ''}', '${t.yard || ''}')">
          ${t.trainName} (${t.trainNumber})${t.rakeNumber ? ' - ' + t.rakeNumber : ''}${t.rakeManager ? ' - ' + t.rakeManager : ''}
        </div>
      `).join('');
    }

    function filterComplaintTrains(query) {
      const items = document.querySelectorAll('#complaintTrainDropdown .searchable-dropdown-item');
      items.forEach(item => { item.style.display = item.textContent.toLowerCase().includes(query.toLowerCase()) ? 'block' : 'none'; });
    }

    function showComplaintTrainDropdown() { document.getElementById('complaintTrainDropdown').classList.add('active'); }

    function selectComplaintTrain(id, name, number, type, yard) {
      const date = document.getElementById('complaintDate')?.value || '';
      const selected = (appData.trainMasters || []).find(t => t.id == id);
      const effective = (hasRakeInfo(selected) ? selected : null) || resolveSelectedTrainMaster(id, number, name, date);
      const effectiveNumber = effective?.trainNumber || number || '';
      const effectiveName = effective?.trainName || name || '';
      const effectiveRakeManager = effective?.rakeManager || '';
      document.getElementById('complaintTrainName').value = effectiveName;
      document.getElementById('complaintTrainSearch').value = effectiveName;
      document.getElementById('complaintTrainDropdown').classList.remove('active');
      document.getElementById('complaintTrainNo').value = normalizeTrainNo(effectiveNumber) || effectiveNumber;
      document.getElementById('complaintTrainType').value = effective?.trainType || type || '';
      if (effective?.yard || yard) document.getElementById('complaintYard').value = effective?.yard || yard;
      populateComplaintRakeManagers(effectiveNumber, effectiveName, effectiveRakeManager, id, effective?.rakeNumber || '');
      onComplaintRakeManagerChange();
    }

    function populateComplaintRakeManagers(trainNumber, trainName, selectedRakeManager = '', selectedTrainId = '', selectedRakeNumber = '') {
      const select = document.getElementById('complaintRakeManager');
      if (!select) return;
      const date = document.getElementById('complaintDate')?.value || '';
      const selectedMaster = resolveSelectedTrainMaster(selectedTrainId, trainNumber, trainName, date);
      const rakeScope = selectedMaster?.rakeNumber || selectedRakeNumber || '';
      let options = rakeScope ? getRakeOptionsForTrainRack(trainNumber, trainName, rakeScope, date) : getRakeOptionsForTrain(trainNumber, trainName, date);
      if (hasRakeInfo(selectedMaster) && !options.some(t => String(t.id) === String(selectedMaster.id))) {
        options = [selectedMaster, ...options];
      }
      if (!options.length && selectedMaster && (selectedMaster.rakeManager || selectedMaster.rakeNumber)) options = [selectedMaster];
      if (!options.length) options = getPreferredTrainMasterMatches(trainNumber, trainName).filter(t => hasRakeInfo(t) && (!rakeScope || normalizeText(t.rakeNumber) === normalizeText(rakeScope)));
      if (!options.length) {
        select.innerHTML = '<option value="">No rake manager found in master</option>';
        document.getElementById('complaintRakeNumber').value = '';
        document.getElementById('complaintRakeManagerPhone').value = '';
        document.getElementById('complaintTrainManager').value = '';
        document.getElementById('complaintTrainManagerPhone').value = '';
        document.getElementById('complaintBusinessHead').value = '';
        document.getElementById('complaintVp').value = '';
        return;
      }
      select.innerHTML = '<option value="">Select Rake Manager</option>' + options.map(t => {
        const label = `${t.rakeManager || 'Unassigned'}${t.rakeNumber ? ' - ' + t.rakeNumber : ''}${getMasterValidityLabel(t, date)}`;
        return `<option value="${t.rakeManager || ''}" data-master-id="${t.id || ''}" data-rake-number="${t.rakeNumber || ''}">${label}</option>`;
      }).join('');
      if (selectedRakeManager) select.value = selectedRakeManager;
      if (!select.value && selectedMaster?.rakeManager) select.value = selectedMaster.rakeManager || '';
      if (!select.value && options.length === 1) select.value = options[0].rakeManager || '';
    }

    function onComplaintRakeManagerChange() {
      const trainNo = document.getElementById('complaintTrainNo')?.value || '';
      const trainName = document.getElementById('complaintTrainName')?.value || '';
      const rakeManager = document.getElementById('complaintRakeManager')?.value || '';
      const rakeNumber = document.getElementById('complaintRakeManager')?.selectedOptions?.[0]?.dataset?.rakeNumber || '';
      const masterId = document.getElementById('complaintRakeManager')?.selectedOptions?.[0]?.dataset?.masterId || '';
      const effective = (masterId ? (appData.trainMasters || []).find(t => String(t.id) === String(masterId)) : null)
        || getEffectiveMaster(trainNo, trainName, document.getElementById('complaintDate')?.value, rakeManager, rakeNumber);
      warnIfMasterValidityIssue(effective, 'Rake manager');
      document.getElementById('complaintRakeNumber').value = effective?.rakeNumber || rakeNumber || '';
      document.getElementById('complaintRakeManagerPhone').value = effective?.rakeManagerContact || effective?.rakeManagerPhone || '';
      document.getElementById('complaintTrainManager').value = effective?.trainManager || '';
      document.getElementById('complaintTrainManagerPhone').value = effective?.trainManagerContact || effective?.trainManagerPhone || '';
      if (!effective && rakeManager) {
        const optionMaster = (appData.trainMasters || []).find(t => normalizeText(t.trainName) === normalizeText(trainName) && normalizeText(t.rakeManager) === normalizeText(rakeManager));
        if (optionMaster) {
          document.getElementById('complaintRakeNumber').value = optionMaster.rakeNumber || rakeNumber || '';
          document.getElementById('complaintRakeManagerPhone').value = optionMaster.rakeManagerContact || optionMaster.rakeManagerPhone || '';
          document.getElementById('complaintTrainManager').value = optionMaster.trainManager || '';
          document.getElementById('complaintTrainManagerPhone').value = optionMaster.trainManagerContact || optionMaster.trainManagerPhone || '';
          document.getElementById('complaintBusinessHead').value = optionMaster.businessHead || '';
          document.getElementById('complaintVp').value = optionMaster.vp || '';
          if (optionMaster.yard) document.getElementById('complaintYard').value = optionMaster.yard;
          if (optionMaster.trainType) document.getElementById('complaintTrainType').value = optionMaster.trainType;
          warnIfMasterValidityIssue(optionMaster, 'Rake manager');
          return;
        }
      }
      document.getElementById('complaintBusinessHead').value = effective?.businessHead || '';
      document.getElementById('complaintVp').value = effective?.vp || '';
      if (effective?.yard) document.getElementById('complaintYard').value = effective.yard;
      if (effective?.trainType) document.getElementById('complaintTrainType').value = effective.trainType;
    }

    function findDuplicateComplaint(referenceNo, complaintId, excludeId = null) {
      const refKey = normalizeText(referenceNo);
      const idKey = normalizeText(complaintId);
      if (!refKey && !idKey) return null;
      return (appData.complaints || []).find(c => c.id != excludeId && (
        (refKey && normalizeText(c.referenceNo || c.complaintRefNo) === refKey) ||
        (idKey && normalizeText(c.complaintId) === idKey)
      ));
    }

    function saveComplaint() {
      if (!ensureEditable('save entries')) return;
      const date = document.getElementById('complaintDate').value;
      const trainName = document.getElementById('complaintTrainName').value;
      const nature = document.getElementById('complaintNature').value;
      const rakeManager = document.getElementById('complaintRakeManager').value;
      const mobileNo = document.getElementById('complaintMobile').value.trim();
      const referenceNo = document.getElementById('complaintReferenceNo').value.trim();
      const pnrNo = document.getElementById('complaintPnr').value.trim();
      const coachNo = document.getElementById('complaintCoachNo').value.trim();
      const details = document.getElementById('complaintDetails').value.trim();

      if (!date || !trainName || !rakeManager || !nature || !mobileNo || !referenceNo || !pnrNo || !coachNo || !details) {
        showAlert('Please fill mandatory fields: train, rake manager, mobile, reference no, PNR/UTS, coach no, nature and description.', 'error');
        return;
      }

      const isEdit = editingId && editingType === 'complaint';
      const trainNoForComplaint = document.getElementById('complaintTrainNo').value;
      const effective = getEffectiveMaster(trainNoForComplaint, trainName, date, rakeManager, document.getElementById('complaintRakeNumber').value);
      if (!effective) { showAlert('Complaint train must be listed in Train Manager Master.', 'error'); return; }
      const duplicate = findDuplicateComplaint(referenceNo, document.getElementById('complaintId').value, editingId);
      if (duplicate && !confirm('Complaint with same Reference No / Complaint ID already exists. Overwrite existing complaint?')) return;
      const complaint = {
        id: editingId || Date.now(),
        date: date,
        complaintId: document.getElementById('complaintId').value || 'CMP' + Date.now(),
        source: document.getElementById('complaintSource').value,
        status: isEdit ? document.getElementById('complaintStatus').value : 'Open',
        trainNo: normalizeTrainNo(document.getElementById('complaintTrainNo').value),
        trainName: trainName,
        trainType: document.getElementById('complaintTrainType').value,
        yard: document.getElementById('complaintYard').value,
        rakeManager: rakeManager,
        rakeNumber: document.getElementById('complaintRakeNumber').value || effective?.rakeNumber || '',
        rakeManagerContact: document.getElementById('complaintRakeManagerPhone').value || effective?.rakeManagerContact || effective?.rakeManagerPhone || '',
        trainManager: document.getElementById('complaintTrainManager').value || effective?.trainManager || '',
        trainManagerContact: document.getElementById('complaintTrainManagerPhone').value || effective?.trainManagerContact || effective?.trainManagerPhone || '',
        businessHead: document.getElementById('complaintBusinessHead').value || effective?.businessHead || '',
        vp: document.getElementById('complaintVp').value || effective?.vp || '',
        complainantName: document.getElementById('complaintName').value,
        email: document.getElementById('complaintEmail').value,
        mobileNo: mobileNo,
        referenceNo: referenceNo,
        pnrNo: pnrNo,
        coachNo: coachNo,
        physicalCoachNo: document.getElementById('complaintPhysicalCoachNo').value,
        berthNo: document.getElementById('complaintBerthNo').value,
        commencementDateTime: document.getElementById('complaintCommencementDateTime').value,
        complaintType: document.getElementById('complaintType').value,
        complainNature: nature,
        details: details,
        actionTaken1: document.getElementById('complaintAction1').value,
        actionTaken2: document.getElementById('complaintAction2').value,
        actionTaken3: document.getElementById('complaintAction3').value,
        actionTaken4: document.getElementById('complaintAction4').value,
        actionTaken5: document.getElementById('complaintAction5').value,
        remarks: document.getElementById('complaintRemarks').value
      };

      if (editingId && editingType === 'complaint') {
        const index = appData.complaints.findIndex(c => c.id == editingId);
        if (index >= 0) appData.complaints[index] = complaint;
      } else if (duplicate) {
        const index = appData.complaints.findIndex(c => c.id == duplicate.id);
        if (index >= 0) appData.complaints[index] = { ...complaint, id: duplicate.id };
      } else {
        appData.complaints.push(complaint);
      }

      saveData();
      clearComplaintForm();
      showAlert('Complaint saved successfully', 'success');
      loadComplaintList();
      loadOpenComplaintQueue();
      loadDashboard();
    }

    function clearComplaintForm() {
      editingId = null;
      editingType = null;
      document.getElementById('complaintDate').value = new Date().toISOString().split('T')[0];
      document.getElementById('complaintId').value = '';
      document.getElementById('complaintSource').value = 'Helpline-139';
      document.getElementById('complaintStatus').value = 'Open';
      document.getElementById('complaintTrainNo').value = '';
      document.getElementById('complaintTrainName').value = '';
      document.getElementById('complaintTrainSearch').value = '';
      document.getElementById('complaintTrainType').value = '';
      document.getElementById('complaintYard').value = appData.yards[0] || '';
      document.getElementById('complaintRakeManager').innerHTML = '<option value="">Select train first</option>';
      document.getElementById('complaintRakeNumber').value = '';
      document.getElementById('complaintRakeManagerPhone').value = '';
      document.getElementById('complaintTrainManager').value = '';
      document.getElementById('complaintTrainManagerPhone').value = '';
      document.getElementById('complaintBusinessHead').value = '';
      document.getElementById('complaintVp').value = '';
      document.getElementById('complaintName').value = '';
      document.getElementById('complaintEmail').value = '';
      document.getElementById('complaintMobile').value = '';
      document.getElementById('complaintReferenceNo').value = '';
      document.getElementById('complaintPnr').value = '';
      document.getElementById('complaintCoachNo').value = '';
      document.getElementById('complaintPhysicalCoachNo').value = '';
      document.getElementById('complaintBerthNo').value = '';
      document.getElementById('complaintCommencementDateTime').value = '';
      document.getElementById('complaintType').value = '';
      document.getElementById('complaintNature').value = '';
      document.getElementById('complaintDetails').value = '';
      ['complaintAction1','complaintAction2','complaintAction3','complaintAction4','complaintAction5'].forEach(id => document.getElementById(id).value = '');
      document.getElementById('complaintRemarks').value = '';
    }

    function getFilteredComplaintEntriesFromListFilters() {
      const fromDate = document.getElementById('complaintFilterFrom').value;
      const toDate = document.getElementById('complaintFilterTo').value;
      const statusFilter = document.getElementById('complaintFilterStatus').value;
      const trainFilter = document.getElementById('complaintFilterTrain').value;
      const yardFilter = document.getElementById('complaintFilterYard').value;

      let filtered = [...(appData.complaints || [])];
      
      if (fromDate) filtered = filtered.filter(c => c.date >= fromDate);
      if (toDate) filtered = filtered.filter(c => c.date <= toDate);
      if (statusFilter) filtered = filtered.filter(c => c.status === statusFilter);
      if (trainFilter) filtered = filtered.filter(c => c.trainName === trainFilter);
      if (yardFilter) filtered = filtered.filter(c => c.yard === yardFilter);

      if (currentUser.yard !== 'ALL') filtered = filtered.filter(c => c.yard === currentUser.yard);

      filtered.sort((a, b) => new Date(getCashEntryDate(b)) - new Date(getCashEntryDate(a)));
      return filtered;
    }

    function loadComplaintList() {
      const filtered = getFilteredComplaintEntriesFromListFilters();
      const rowActions = (id) => isReadOnlyUser()
        ? '<span style="font-size:11px;color:#64748b;">View only</span>'
        : `<button class="btn-icon edit" onclick="editComplaint(${id})"><i class="fas fa-edit"></i></button>
           <button class="btn-icon delete" onclick="deleteComplaint(${id})"><i class="fas fa-trash"></i></button>`;

      document.getElementById('complaintTableBody').innerHTML = filtered.map(c => `
        <tr>
          <td>${formatDate(c.date)}</td>
          <td>${c.complaintId}</td>
          <td>${c.trainName}</td>
          <td>${c.mobileNo || '-'}</td>
          <td>${c.referenceNo || '-'}</td>
          <td><span class="nature-tag nature-${getNatureCategory(c.complainNature)}">${c.complainNature}</span></td>
          <td><span class="badge badge-${c.status === 'Open' ? 'danger' : c.status === 'In Progress' ? 'warning' : 'success'}">${c.status}</span></td>
          <td>
            ${rowActions(c.id)}
          </td>
        </tr>
      `).join('');
    }

    function loadOpenComplaintQueue() {
      const tbody = document.getElementById('openComplaintQueueBody');
      if (!tbody) return;
      let rows = [...(appData.complaints || [])].filter(c => c.status === 'Open' || c.status === 'In Progress');
      if (currentUser.yard !== 'ALL') rows = rows.filter(c => c.yard === currentUser.yard);
      rows.sort((a, b) => new Date(b.date) - new Date(a.date));
      tbody.innerHTML = rows.slice(0, 100).map(c => `
        <tr>
          <td>${formatDate(c.date)}</td>
          <td>${c.complaintId || '-'}</td>
          <td>${c.trainName || '-'}</td>
          <td>${c.mobileNo || '-'}</td>
          <td>${c.referenceNo || '-'}</td>
          <td>${c.complainNature || c.complaintType || '-'}</td>
          <td><span class="badge badge-${c.status === 'Open' ? 'danger' : 'warning'}">${c.status}</span></td>
          <td>${isReadOnlyUser() ? '<span style="font-size:11px;color:#64748b;">View only</span>' : `<button class="btn-icon edit" onclick="editComplaint(${c.id})"><i class="fas fa-edit"></i></button>`}</td>
        </tr>
      `).join('');
    }

    function normalizeMobileNo(value) {
      return String(value || '').replace(/\D/g, '');
    }

    function checkPreviousComplaintsByMobile() {
      const mobile = normalizeMobileNo(document.getElementById('complaintMobile')?.value);
      if (!mobile) return;
      const currentId = editingType === 'complaint' ? editingId : null;
      const matches = (appData.complaints || []).filter(c => normalizeMobileNo(c.mobileNo) === mobile && c.id != currentId);
      if (!matches.length) return;
      document.getElementById('previousComplaintsTitle').textContent = `${matches.length} previous complaint(s) found for ${mobile}`;
      document.getElementById('previousComplaintsContent').innerHTML = `
        <div class="table-container">
          <table>
            <thead><tr><th>Date</th><th>ID</th><th>Train</th><th>Nature</th><th>Status</th><th>Description</th></tr></thead>
            <tbody>
              ${matches.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 20).map(c => `
                <tr>
                  <td>${formatDate(c.date)}</td>
                  <td>${c.complaintId || '-'}</td>
                  <td>${c.trainName || '-'}</td>
                  <td>${c.complainNature || '-'}</td>
                  <td><span class="badge badge-${c.status === 'Closed' ? 'success' : c.status === 'In Progress' ? 'warning' : 'danger'}">${c.status || 'Open'}</span></td>
                  <td>${c.details || '-'}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
      document.getElementById('previousComplaintsModal').classList.add('active');
    }

    function closePreviousComplaintsModal() {
      document.getElementById('previousComplaintsModal').classList.remove('active');
    }

    function getNatureCategory(nature) {
      const category = COMPLAINT_NATURE_CATEGORIES[nature] || 'Other';
      return category.toLowerCase().replace(/\s/g, '-');
    }

    function editComplaint(id) {
      if (!ensureEditable('edit entries')) return;
      const c = appData.complaints.find(x => x.id == id);
      if (!c) return;

      editingId = id;
      editingType = 'complaint';
      
      document.getElementById('complaintDate').value = c.date;
      document.getElementById('complaintId').value = c.complaintId;
      document.getElementById('complaintSource').value = c.source;
      document.getElementById('complaintStatus').value = c.status;
      document.getElementById('complaintTrainNo').value = c.trainNo || '';
      document.getElementById('complaintTrainName').value = c.trainName;
      document.getElementById('complaintTrainSearch').value = c.trainName;
      document.getElementById('complaintTrainType').value = c.trainType || '';
      document.getElementById('complaintYard').value = c.yard;
      populateComplaintRakeManagers(c.trainNo, c.trainName, c.rakeManager || '', '', c.rakeNumber || '');
      document.getElementById('complaintRakeManager').value = c.rakeManager || '';
      document.getElementById('complaintRakeNumber').value = c.rakeNumber || '';
      document.getElementById('complaintRakeManagerPhone').value = c.rakeManagerContact || c.rakeManagerPhone || '';
      if (!document.getElementById('complaintRakeManagerPhone').value) onComplaintRakeManagerChange();
      document.getElementById('complaintTrainManager').value = c.trainManager || '';
      document.getElementById('complaintTrainManagerPhone').value = c.trainManagerContact || c.trainManagerPhone || '';
      if (!document.getElementById('complaintTrainManagerPhone').value) onComplaintRakeManagerChange();
      document.getElementById('complaintBusinessHead').value = c.businessHead || '';
      document.getElementById('complaintVp').value = c.vp || '';
      document.getElementById('complaintName').value = c.complainantName || '';
      document.getElementById('complaintEmail').value = c.email || '';
      document.getElementById('complaintMobile').value = c.mobileNo || '';
      document.getElementById('complaintReferenceNo').value = c.referenceNo || c.complaintRefNo || '';
      document.getElementById('complaintPnr').value = c.pnrNo || '';
      document.getElementById('complaintCoachNo').value = c.coachNo || '';
      document.getElementById('complaintPhysicalCoachNo').value = c.physicalCoachNo || '';
      document.getElementById('complaintBerthNo').value = c.berthNo || '';
      document.getElementById('complaintCommencementDateTime').value = c.commencementDateTime || '';
      document.getElementById('complaintType').value = c.complaintType || '';
      document.getElementById('complaintNature').value = c.complainNature;
      document.getElementById('complaintDetails').value = c.details || '';
      document.getElementById('complaintAction1').value = c.actionTaken1 || '';
      document.getElementById('complaintAction2').value = c.actionTaken2 || '';
      document.getElementById('complaintAction3').value = c.actionTaken3 || '';
      document.getElementById('complaintAction4').value = c.actionTaken4 || '';
      document.getElementById('complaintAction5').value = c.actionTaken5 || '';
      document.getElementById('complaintRemarks').value = c.remarks || '';

      switchComplaintTab('entry');
    }

    function deleteComplaint(id) {
      if (!ensureEditable('delete entries')) return;
      if (!confirm('Are you sure you want to delete this complaint?')) return;
      appData.complaints = appData.complaints.filter(c => c.id != id);
      markRecordDeleted('complaints', id);
      saveData();
      loadComplaintList();
      loadOpenComplaintQueue();
      loadDashboard();
      showAlert('Complaint deleted', 'success');
    }

    // ==================== CASH PAGE FUNCTIONS ====================
    function loadCashPage() {
      populateYardSelects();
      loadCashDashboard();
      
      const dropdown = document.getElementById('cashTrainDropdown');
      const trains = getSortedTrainMastersForSelection();
      dropdown.innerHTML = trains.map(t => `
        <div class="searchable-dropdown-item" onclick="selectCashTrain('${t.id}', '${t.trainName}', '${t.trainNumber}')">
          ${t.trainName} (${t.trainNumber})${t.rakeNumber ? ' - ' + t.rakeNumber : ''}${t.rakeManager ? ' - ' + t.rakeManager : ''}
        </div>
      `).join('');

      document.getElementById('cashFilterYard').innerHTML = '<option value="">All Yards</option>' + (appData.yards || []).map(y => `<option value="${y}">${y}</option>`).join('');
      document.getElementById('cashFilterTrain').innerHTML = '<option value="">All Trains</option>' + trains.map(t => `<option value="${t.trainName}">${t.trainName}</option>`).join('');
      
      loadCashList();
      loadBankDepositList();
    }

    function filterCashTrains(query) {
      const items = document.querySelectorAll('#cashTrainDropdown .searchable-dropdown-item');
      items.forEach(item => { item.style.display = item.textContent.toLowerCase().includes(query.toLowerCase()) ? 'block' : 'none'; });
    }

    function showCashTrainDropdown() { document.getElementById('cashTrainDropdown').classList.add('active'); }

    function selectCashTrain(id, name, number) {
      document.getElementById('cashTrainId').value = id;
      document.getElementById('cashSalesEntryId') && (document.getElementById('cashSalesEntryId').value = '');
      document.getElementById('cashTrainSearch').value = name;
      document.getElementById('cashTrainNo').value = normalizeTrainNo(number) || number || '';
      document.getElementById('cashTrainDropdown').classList.remove('active');
      const date = document.getElementById('cashDate').value;
      const selected = (appData.trainMasters || []).find(t => t.id == id);
      const effective = resolveSelectedTrainMaster(id, number, name, date) || selected;
      document.getElementById('cashTrainManager').value = effective?.trainManager || '';
      document.getElementById('cashRakeManager').value = effective?.rakeManager || '';
      updateCashGPFromSales();
    }

    function clearBankDepositForm() {
      document.getElementById('bankDepositDate').value = '';
      document.getElementById('bankCollectionDate').value = '';
      document.getElementById('bankDepositAmount').value = '';
      document.getElementById('bankDepositRemarks').value = '';
      bankReceiptFiles = [];
      renderBankReceiptPreview();
    }

    function saveBankDepositEntry() {
      if (!ensureEditable('save bank deposit')) return;
      const depositDate = document.getElementById('bankDepositDate').value;
      const collectionDate = document.getElementById('bankCollectionDate').value;
      const amount = Number(document.getElementById('bankDepositAmount').value) || 0;
      if (!depositDate || amount <= 0) {
        showAlert('Please enter bank deposit date and amount.', 'error');
        return;
      }
      appData.bankDeposits = appData.bankDeposits || [];
      appData.bankDeposits.push({
        id: Date.now(),
        depositDate,
        collectionDate,
        amount,
        receiptFiles: JSON.parse(JSON.stringify(bankReceiptFiles || [])),
        remarks: document.getElementById('bankDepositRemarks').value || '',
        createdAt: new Date().toISOString(),
        createdBy: currentUser?.email || ''
      });
      saveData();
      clearBankDepositForm();
      loadBankDepositList();
      showAlert('Bank deposit saved successfully.', 'success');
    }

    function loadBankDepositList() {
      const tbody = document.getElementById('bankDepositTableBody');
      if (!tbody) return;
      const rows = [...(appData.bankDeposits || [])].sort((a, b) => String(b.depositDate || '').localeCompare(String(a.depositDate || '')));
      const total = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
      tbody.innerHTML = rows.length ? `
        <tr class="table-total-row">
          <td colspan="2"><strong>Total (${rows.length} Entries)</strong></td>
          <td><strong>${formatCurrency(total)}</strong></td>
          <td colspan="3"></td>
        </tr>
      ` + rows.map(r => `
        <tr>
          <td>${formatDate(r.depositDate)}</td>
          <td>${formatDate(r.collectionDate)}</td>
          <td>${formatCurrency(r.amount)}</td>
          <td>${(r.receiptFiles || []).length ? `<button class="btn btn-ghost btn-sm" onclick="openBankReceiptSavedModal('${r.id}')"><i class="fas fa-image"></i> ${(r.receiptFiles || []).length}</button>` : '-'}</td>
          <td>${r.remarks || '-'}</td>
          <td>${isReadOnlyUser() ? '-' : `<button class="btn-icon delete" onclick="deleteBankDepositEntry(${r.id})"><i class="fas fa-trash"></i></button>`}</td>
        </tr>
      `).join('') : '<tr><td colspan="6" style="text-align:center;color:#64748b;">No bank deposit entries saved.</td></tr>';
    }

    function deleteBankDepositEntry(id) {
      if (!ensureEditable('delete bank deposit')) return;
      if (!confirm('Delete this bank deposit entry?')) return;
      appData.bankDeposits = (appData.bankDeposits || []).filter(r => String(r.id) !== String(id));
      saveData();
      loadBankDepositList();
      showAlert('Bank deposit entry deleted.', 'success');
    }

    function downloadBankDepositEntries() {
      const rows = (appData.bankDeposits || []).map(r => ({
        'Bank Deposit Date': r.depositDate || '',
        'Cash Collection Date': r.collectionDate || '',
        'Amount': r.amount || 0,
        'Receipt Count': (r.receiptFiles || []).length,
        'Receipt Names': (r.receiptFiles || []).map(f => f.name).join(', '),
        'Remarks': r.remarks || '',
        'Created By': r.createdBy || '',
        'Created At': r.createdAt || ''
      }));
      downloadExcel(rows, `bank_deposit_entries_${new Date().toISOString().split('T')[0]}.xlsx`);
    }

    function calculateTotalDeposit() {
      const cash = Number(document.getElementById('cashDepositCounter').value) || 0;
      const online = Number(document.getElementById('cashOnlineDeposit').value) || 0;
      document.getElementById('cashTotalDeposit').value = cash + online;
      checkShortage();
    }

    function saveCashEntry() {
      if (!ensureEditable('save entries')) return;
      const date = document.getElementById('cashDate').value;
      const yard = document.getElementById('cashYard').value;
      const cashDeposit = Number(document.getElementById('cashDepositCounter').value) || 0;
      const onlineDeposit = Number(document.getElementById('cashOnlineDeposit').value) || 0;
      const gpFromSales = Number(document.getElementById('cashGpFromSales').value) || 0;
      const shortageReason = document.getElementById('cashShortageReason').value;

      const trainId = document.getElementById('cashTrainId').value;
      const forcedSalesEntryId = document.getElementById('cashSalesEntryId')?.value || '';
      const typedTrainName = document.getElementById('cashTrainSearch')?.value || '';
      const typedTrainNumber = document.getElementById('cashTrainNo')?.value || '';
      if (!date || !yard || !(trainId || typedTrainName || typedTrainNumber || forcedSalesEntryId)) { showAlert('Please select date, yard and train', 'error'); return; }
      const train = trainId ? appData.trainMasters.find(t => t.id == trainId) : null;
      const salesEntry = forcedSalesEntryId
        ? (appData.sales || []).find(s => String(s.id) === String(forcedSalesEntryId))
        : findSalesEntryForCash(
            date,
            trainId,
            train?.trainNumber || typedTrainNumber,
            train?.trainName || typedTrainName,
            train?.rakeManager || document.getElementById('cashRakeManager')?.value || '',
            train?.rakeNumber || ''
          );
      if (!salesEntry) { showAlert('Cash deposit can be saved only after a sales entry exists for this exact train and rake manager.', 'error'); return; }

      if (gpFromSales > 0 && (cashDeposit + onlineDeposit) < gpFromSales && !shortageReason) {
        showAlert('Please select a shortage reason. Cash + Online deposit is less than amount to be collected.', 'error');
        document.getElementById('cashShortageReason').focus();
        return;
      }

      const effective = salesEntry || (train ? (resolveSelectedTrainMaster(trainId, train.trainNumber, train.trainName, date) || train) : null);
      const previousDeposits = (appData.cash || []).filter(c => String(c.id) !== String(editingId || '') && isSameTrainForCashSale(c, salesEntry));
      const previousTotalDeposit = previousDeposits.reduce((sum, c) => sum + (Number(c.totalDeposit) || 0), 0);
      const salesCollectable = Number(salesEntry?.amountToCollect || salesEntry?.salesAchievement || salesEntry?.totalSale || gpFromSales) || 0;
      const pendingBeforeThisDeposit = Math.max(salesCollectable - previousTotalDeposit, 0);
      if (!editingId && pendingBeforeThisDeposit <= 0 && !confirm('This sales entry already appears fully deposited. Save one more deposit record anyway?')) return;
      if ((cashDeposit + onlineDeposit) > pendingBeforeThisDeposit && pendingBeforeThisDeposit > 0 && !confirm(`Deposit is more than pending amount (${formatCurrency(pendingBeforeThisDeposit)}). Save anyway?`)) return;

      const entry = {
        id: editingId || Date.now(),
        date: date,
        entryDate: date,
        arrivalDate: salesEntry?.arrivalDate || salesEntry?.date || date,
        salesEntryId: salesEntry?.id || forcedSalesEntryId || '',
        yard: yard,
        trainId: salesEntry?.trainId || trainId,
        trainName: salesEntry?.trainName || (train ? train.trainName : ''),
        trainNumber: salesEntry?.trainNumber || (train ? (normalizeTrainNo(train.trainNumber) || train.trainNumber || '') : ''),
        trainManager: effective?.trainManager || '',
        rakeManager: effective?.rakeManager || '',
        rakeManagerContact: effective?.rakeManagerContact || effective?.rakeManagerPhone || '',
        rakeManagerPhone: effective?.rakeManagerContact || effective?.rakeManagerPhone || '',
        rakeNumber: effective?.rakeNumber || '',
        businessHead: effective?.businessHead || '',
        vp: effective?.vp || '',
        gpFromSales: salesCollectable || gpFromSales,
        amountToCollect: salesCollectable || gpFromSales,
        gpCollected: salesCollectable || gpFromSales,
        cashDepositCounter: cashDeposit,
        onlineDeposit: onlineDeposit,
        totalDeposit: cashDeposit + onlineDeposit,
        shortageReason: shortageReason,
        remarks: document.getElementById('cashRemarks').value
      };

      if (editingId && editingType === 'cash') {
        const index = appData.cash.findIndex(c => c.id == editingId);
        if (index >= 0) appData.cash[index] = entry;
      } else {
        appData.cash.push(entry);
      }

      rememberLastCashDate();
      saveData();
      clearCashForm();
      showAlert('Cash entry saved successfully', 'success');
      loadCashList();
      loadCashDashboard();
      loadDashboard();
    }

    function clearCashForm() {
      editingId = null;
      editingType = null;
      document.getElementById('cashDate').value = getLastCashEntryDate();
      document.getElementById('cashArrivalDate') && (document.getElementById('cashArrivalDate').value = '');
      document.getElementById('cashYard').value = appData.yards[0] || '';
      document.getElementById('cashTrainId').value = '';
      document.getElementById('cashSalesEntryId') && (document.getElementById('cashSalesEntryId').value = '');
      document.getElementById('cashTrainSearch').value = '';
      document.getElementById('cashTrainNo').value = '';
      document.getElementById('cashTrainManager').value = '';
      document.getElementById('cashRakeManager').value = '';
      document.getElementById('cashGpFromSales').value = '';
      document.getElementById('cashGpCollected') && (document.getElementById('cashGpCollected').value = '');
      document.getElementById('cashBalanceDue') && (document.getElementById('cashBalanceDue').value = '');
      document.getElementById('cashDepositCounter').value = '';
      document.getElementById('cashOnlineDeposit').value = '';
      document.getElementById('cashTotalDeposit').value = '';
      document.getElementById('cashShortageReason').value = '';
      document.getElementById('cashRemarks').value = '';
      document.getElementById('shortageAlert').classList.add('hidden');
      document.getElementById('shortageReasonRow').style.display = 'none';
    }

    function getFilteredCashEntriesFromListFilters() {
      const fromDate = document.getElementById('cashFilterFrom').value;
      const toDate = document.getElementById('cashFilterTo').value;
      const yardFilter = document.getElementById('cashFilterYard').value;
      const trainFilter = document.getElementById('cashFilterTrain').value;

      let filtered = [...(appData.cash || [])];
      
      if (fromDate) filtered = filtered.filter(c => getCashReportDate(c) >= fromDate);
      if (toDate) filtered = filtered.filter(c => getCashReportDate(c) <= toDate);
      if (yardFilter) {
        const yardKey = normalizeText(yardFilter);
        filtered = filtered.filter(c => normalizeText(c.yard) === yardKey);
      }
      if (trainFilter) {
        const trainKey = normalizeText(trainFilter);
        filtered = filtered.filter(c => normalizeText(c.trainName) === trainKey);
      }

      if (currentUser.yard !== 'ALL') {
        const userYardKey = normalizeText(currentUser.yard);
        filtered = filtered.filter(c => normalizeText(c.yard) === userYardKey);
      }

      filtered.sort((a, b) => new Date(getCashReportDate(b)) - new Date(getCashReportDate(a)));
      return filtered;
    }

    function loadCashList() {
      const filtered = getFilteredCashEntriesFromListFilters();
      const rowActions = (id) => isReadOnlyUser()
        ? '<span style="font-size:11px;color:#64748b;">View only</span>'
        : `<button class="btn-icon edit" onclick="editCashEntry(${id})"><i class="fas fa-edit"></i></button>
           <button class="btn-icon delete" onclick="deleteCashEntry(${id})"><i class="fas fa-trash"></i></button>`;

      document.getElementById('cashTableBody').innerHTML = filtered.map(c => `
        <tr>
          <td>${formatDate(c.date)}</td>
          <td>${c.yard}</td>
          <td>${c.trainName || '-'}</td>
          <td>${formatCurrency(c.amountToCollect || c.gpFromSales || c.gpCollected)}</td>
          <td>${formatCurrency(c.cashDepositCounter)}</td>
          <td>${formatCurrency(c.onlineDeposit)}</td>
          <td>${formatCurrency(c.totalDeposit)}</td>
          <td>${c.shortageReason || '-'}</td>
          <td>
            ${rowActions(c.id)}
          </td>
        </tr>
      `).join('');
    }

    function editCashEntry(id) {
      if (!ensureEditable('edit entries')) return;
      const c = appData.cash.find(x => x.id == id);
      if (!c) return;
      const relatedSale = findSalesEntryForCash(c.date, c.trainId, c.trainNumber, c.trainName);
      const amountToCollect = Number(c.amountToCollect || c.gpFromSales || c.gpCollected) || Number(relatedSale?.amountToCollect || relatedSale?.salesAchievement || relatedSale?.totalSale) || 0;
      const pending = Math.max(amountToCollect - (Number(c.totalDeposit) || 0), 0);
      const completed = amountToCollect > 0 && (Number(c.totalDeposit) || 0) >= amountToCollect;
      if (completed && !relatedSale?.salesReopenedAfterCash) {
        showAlert('Cash deposit is completed. It can be edited only after the related sales entry is reopened/edited.', 'warning');
        return;
      }

      editingId = id;
      editingType = 'cash';
      
      document.getElementById('cashDate').value = c.date;
      document.getElementById('cashArrivalDate') && (document.getElementById('cashArrivalDate').value = c.arrivalDate || relatedSale?.arrivalDate || relatedSale?.date || c.date || '');
      document.getElementById('cashYard').value = c.yard;
      document.getElementById('cashTrainId').value = c.trainId || '';
      document.getElementById('cashSalesEntryId') && (document.getElementById('cashSalesEntryId').value = c.salesEntryId || relatedSale?.id || '');
      document.getElementById('cashTrainSearch').value = c.trainName || '';
      document.getElementById('cashTrainNo').value = c.trainNumber || '';
      document.getElementById('cashTrainManager').value = c.trainManager || '';
      document.getElementById('cashRakeManager').value = c.rakeManager || '';
      document.getElementById('cashGpFromSales').value = c.amountToCollect || c.gpFromSales || c.gpCollected || '';
      if (document.getElementById('cashGpCollected')) document.getElementById('cashGpCollected').value = c.gpCollected || '';
      document.getElementById('cashDepositCounter').value = c.cashDepositCounter || '';
      document.getElementById('cashOnlineDeposit').value = c.onlineDeposit || '';
      document.getElementById('cashTotalDeposit').value = c.totalDeposit || '';
      document.getElementById('cashBalanceDue') && (document.getElementById('cashBalanceDue').value = Math.max((Number(c.amountToCollect || c.gpFromSales || c.gpCollected) || 0) - (Number(c.totalDeposit) || 0), 0));
      document.getElementById('cashShortageReason').value = c.shortageReason || '';
      document.getElementById('cashRemarks').value = c.remarks || '';

      checkShortage();
      switchCashTab('entry');
    }

    function deleteCashEntry(id) {
      if (!ensureEditable('delete entries')) return;
      if (!confirm('Are you sure you want to delete this entry?')) return;
      appData.cash = appData.cash.filter(c => c.id != id);
      markRecordDeleted('cash', id);
      saveData();
      loadCashList();
      loadCashDashboard();
      loadDashboard();
      showAlert('Entry deleted', 'success');
    }


    // ==================== MASTERS PAGE FUNCTIONS ====================
    function loadMastersPage() {
      populateYardSelects();
      const clusters = appData.clusterManagers || [];
      document.getElementById('masterClusterManagerList').innerHTML = clusters.map(m => `<option value="${m}"></option>`).join('');
      const allTrainManagers = [...new Set([...(appData.trainManagers || []), ...Object.keys(appData.trainManagerHierarchy || {})])].sort();
      document.getElementById('masterTrainManagerList').innerHTML = allTrainManagers.map(m => `<option value="${m}"></option>`).join('');
      const allRakeManagers = [...new Set([...(appData.rakeManagers || []), ...Object.keys(appData.rakeManagerHierarchy || {})])].sort();
      document.getElementById('masterRakeManagerList').innerHTML = allRakeManagers.map(m => `<option value="${m}"></option>`).join('');
      onMasterClusterChange();
      onMasterTrainManagerChange();
      
      updateMasterTargetDisplay();
      loadTargetMasterTable();
      loadItemRateMasterTable();
      
      const hasData = appData.trainMasters && appData.trainMasters.length > 0;
      document.getElementById('noMasterDataWarning').classList.toggle('hidden', hasData);
      
      loadMasterTable();
      loadMasterAuditLog();
    }

    function inferItemTrainType(category, itemName) {
      const text = normalizeText(`${category || ''} ${itemName || ''}`);
      if (text.includes('tsv')) return 'TSV';
      if (text.includes('wcb')) return 'WCB';
      return 'ALL';
    }

    function getItemRateKey(item) {
      return `${normalizeText(item.trainType || 'ALL')}|${normalizeText(item.category || '')}|${normalizeText(item.itemName || '')}`;
    }

    function findExistingItemRateMaster(item) {
      const key = getItemRateKey(item);
      return (appData.itemRateMasters || []).find(row => getItemRateKey(row) === key);
    }

    function clearItemRateMasterForm() {
      itemRateEditingId = null;
      ['itemRateCategory', 'itemRateName', 'itemRateSaleRate', 'itemRatePurchaseRate', 'itemRateECateringRate'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
      });
      if (document.getElementById('itemRateTrainType')) document.getElementById('itemRateTrainType').value = 'ALL';
      if (document.getElementById('itemRateActive')) document.getElementById('itemRateActive').value = 'true';
    }

    function saveItemRateMaster() {
      if (!ensureEditable('save item rate master')) return;
      const item = {
        id: itemRateEditingId || Date.now() + Math.random(),
        category: document.getElementById('itemRateCategory')?.value.trim() || '',
        itemName: document.getElementById('itemRateName')?.value.trim() || '',
        trainType: document.getElementById('itemRateTrainType')?.value || 'ALL',
        saleRate: Number(document.getElementById('itemRateSaleRate')?.value) || 0,
        purchaseRate: Number(document.getElementById('itemRatePurchaseRate')?.value) || 0,
        eCateringRate: Number(document.getElementById('itemRateECateringRate')?.value) || 0,
        active: document.getElementById('itemRateActive')?.value !== 'false'
      };
      if (!item.itemName || !item.saleRate) {
        showAlert('Please enter item name and sale rate.', 'error');
        return;
      }
      const existing = findExistingItemRateMaster(item);
      if (existing && String(existing.id) !== String(item.id)) {
        if (!confirm('Item already exists for same train type, category and item name. Update existing item rate?')) return;
        item.id = existing.id;
      }
      const index = (appData.itemRateMasters || []).findIndex(row => String(row.id) === String(item.id));
      if (index >= 0) appData.itemRateMasters[index] = item;
      else appData.itemRateMasters.push(item);
      addMasterLog(itemRateEditingId ? 'Edit Item Rate Master' : 'Add Item Rate Master', item, 'Item rate master saved');
      saveData();
      clearItemRateMasterForm();
      loadItemRateMasterTable();
      showAlert('Item rate saved successfully', 'success');
    }

    function loadItemRateMasterTable() {
      const tbody = document.getElementById('itemRateMasterTableBody');
      if (!tbody) return;
      const canEdit = currentUser && (currentUser.role === 'admin' || currentUser.role === 'super_admin');
      const search = normalizeText(document.getElementById('itemRateSearch')?.value || '');
      const rows = [...(appData.itemRateMasters || [])]
        .filter(item => !search || [item.category, item.itemName, item.trainType, item.saleRate, item.purchaseRate, item.eCateringRate].some(v => normalizeText(v).includes(search)))
        .sort((a, b) => String(a.trainType || '').localeCompare(String(b.trainType || '')) || String(a.category || '').localeCompare(String(b.category || '')) || String(a.itemName || '').localeCompare(String(b.itemName || '')));
      tbody.innerHTML = rows.length ? rows.map(item => `
        <tr>
          <td>${escapeHtml(item.category || '-')}</td>
          <td>${escapeHtml(item.itemName || '-')}</td>
          <td>${escapeHtml(item.trainType || 'ALL')}</td>
          <td>${formatCurrency(item.saleRate || 0)}</td>
          <td>${formatCurrency(item.purchaseRate || 0)}</td>
          <td>${formatCurrency(item.eCateringRate || 0)}</td>
          <td>${item.active === false ? 'Inactive' : 'Active'}</td>
          <td>${canEdit ? `<button class="btn-icon edit" onclick="editItemRateMaster('${item.id}')"><i class="fas fa-edit"></i></button><button class="btn-icon delete" onclick="deleteItemRateMaster('${item.id}')"><i class="fas fa-trash"></i></button>` : '<span style="font-size:11px;color:#64748b;">View</span>'}</td>
        </tr>
      `).join('') : '<tr><td colspan="8" style="text-align:center;color:#64748b;">No item rate master uploaded.</td></tr>';
    }

    function editItemRateMaster(id) {
      const item = (appData.itemRateMasters || []).find(row => String(row.id) === String(id));
      if (!item) return;
      itemRateEditingId = item.id;
      document.getElementById('itemRateCategory').value = item.category || '';
      document.getElementById('itemRateName').value = item.itemName || '';
      document.getElementById('itemRateTrainType').value = item.trainType || 'ALL';
      document.getElementById('itemRateSaleRate').value = item.saleRate || '';
      document.getElementById('itemRatePurchaseRate').value = item.purchaseRate || '';
      document.getElementById('itemRateECateringRate').value = item.eCateringRate || '';
      document.getElementById('itemRateActive').value = item.active === false ? 'false' : 'true';
      document.getElementById('itemRateName').focus();
    }

    function deleteItemRateMaster(id) {
      if (!ensureEditable('delete item rate master')) return;
      const item = (appData.itemRateMasters || []).find(row => String(row.id) === String(id));
      if (!item) return;
      if (!confirm(`Delete item rate?\n\n${item.itemName || ''}`)) return;
      markRecordDeleted('itemRateMasters', item.id);
      markRecordDeleted('itemRateMasters', makeRecordKey(item, 'itemRateMasters'));
      appData.itemRateMasters = (appData.itemRateMasters || []).filter(row => String(row.id) !== String(id));
      addMasterLog('Delete Item Rate Master', item, 'Item rate master deleted');
      saveData({ forceOverwrite: true });
      if (String(itemRateEditingId) === String(id)) clearItemRateMasterForm();
      loadItemRateMasterTable();
      showAlert('Item rate deleted', 'success');
    }

    function getAvailableSalesItemRates() {
      const trainType = normalizeText(document.getElementById('salesTrainType')?.value || '');
      return (appData.itemRateMasters || []).filter(item => {
        if (item.active === false) return false;
        const itemType = normalizeText(item.trainType || 'ALL');
        if (!trainType || !['wcb', 'tsv'].includes(trainType)) return true;
        return itemType === 'all' || itemType === trainType;
      }).sort((a, b) => String(a.category || '').localeCompare(String(b.category || '')) || String(a.itemName || '').localeCompare(String(b.itemName || '')));
    }

    function getItemRateByName(itemName) {
      const key = normalizeText(itemName);
      if (!key) return null;
      return getAvailableSalesItemRates().find(item => normalizeText(item.itemName) === key) || null;
    }

    function updateMasterTargetDisplay() {
      const now = new Date();
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
      document.getElementById('currentMonthName').textContent = monthNames[now.getMonth()] + ' ' + now.getFullYear();
      
      const targetRows = (appData.targetMasters || []).length ? appData.targetMasters : appData.trainMasters;
      const totalSalesTarget = targetRows.reduce((sum, t) => sum + (Number(t.salesTarget) || 0), 0);
      const totalGpTarget = targetRows.reduce((sum, t) => sum + (Number(t.gpTarget) || 0), 0);
      
      document.getElementById('totalSalesTarget').textContent = formatCurrency(totalSalesTarget);
      document.getElementById('totalGpTarget').textContent = formatCurrency(totalGpTarget);
      document.getElementById('totalTrainsCount').textContent = appData.trainMasters.length;
      document.getElementById('yardsCount').textContent = appData.yards.length;
    }

    function onMasterClusterChange() {
      const trainManagerList = document.getElementById('masterTrainManagerList');
      if (!trainManagerList) return;
      const allTrainManagers = [...new Set([...(appData.trainManagers || []), ...Object.keys(appData.trainManagerHierarchy || {})])].sort();
      trainManagerList.innerHTML = allTrainManagers.map(tm => `<option value="${tm}"></option>`).join('');
      onMasterTrainManagerChange();
    }

    function onMasterTrainManagerChange() {
      const trainManager = document.getElementById('masterTrainManager')?.value || '';
      const rakeList = document.getElementById('masterRakeManagerList');
      if (!rakeList) return;
      const allRakes = [...new Set([...(appData.rakeManagers || []), ...Object.keys(appData.rakeManagerHierarchy || {})])].sort();
      rakeList.innerHTML = allRakes.map(rm => `<option value="${rm}"></option>`).join('');
    }

    function saveTrainMaster() {
      if (!ensureEditable('save master data')) return;
      const name = document.getElementById('masterTrainName').value.trim();
      const number = normalizeTrainNo(document.getElementById('masterTrainNumber').value.trim());
      const rakeNumber = document.getElementById('masterRakeNumber').value.trim();
      const yard = document.getElementById('masterYard').value;
      const clusterManager = document.getElementById('masterClusterManager').value.trim();
      const trainManager = document.getElementById('masterTrainManager').value.trim();
      const trainManagerContact = document.getElementById('masterTrainManagerPhone').value.trim();
      const rakeManager = document.getElementById('masterRakeManager').value.trim();
      const rakeManagerContact = document.getElementById('masterRakeManagerPhone').value.trim();
      const rakeManagerAadhar = document.getElementById('masterRakeManagerAadhar').value.trim();
      const rakeManagerAccount = document.getElementById('masterRakeManagerAccount').value.trim();
      const rakeManagerIfsc = document.getElementById('masterRakeManagerIfsc').value.trim().toUpperCase();
      const rakeManagerBank = document.getElementById('masterRakeManagerBank').value.trim().toUpperCase();
      const businessHead = document.getElementById('masterBusinessHead').value.trim();
      const vp = document.getElementById('masterVp').value.trim();
      const validFrom = document.getElementById('masterValidFrom').value;
      let validTo = document.getElementById('masterValidTo').value;
      const validDays = Number(document.getElementById('masterValidDays').value) || 0;

      if (!name || !number || !rakeNumber || !yard || !validFrom) { showAlert('Please fill all required fields including rake number and validity start date', 'error'); return; }
      if (!validTo && validDays > 0) {
        const d = new Date(validFrom);
        d.setDate(d.getDate() + validDays - 1);
        validTo = d.toISOString().split('T')[0];
      }
      if (validTo && validTo < validFrom) { showAlert('Validity end date cannot be before start date', 'error'); return; }
      ensureYardExists(yard);

      const train = {
        id: editingId || Date.now(),
        trainName: name,
        trainNumber: number,
        rakeNumber: rakeNumber,
        yard: yard,
        trainType: document.getElementById('masterTrainType').value,
        clusterManager: clusterManager,
        trainManager: trainManager,
        trainManagerContact: trainManagerContact,
        rakeManager: rakeManager,
        rakeManagerContact: rakeManagerContact,
        rakeManagerPhone: rakeManagerContact,
        rakeManagerAadhar: rakeManagerAadhar,
        rakeManagerAccount: rakeManagerAccount,
        rakeManagerIfsc: rakeManagerIfsc,
        rakeManagerBank: rakeManagerBank,
        businessHead: businessHead,
        vp: vp,
        salesTarget: Math.round(Number(document.getElementById('masterSalesTarget').value)) || 0,
        gpTarget: Math.round(Number(document.getElementById('masterGpTarget').value)) || 0,
        validFrom: validFrom,
        validTo: validTo || ''
      };

      if (clusterManager && !appData.clusterManagers.includes(clusterManager)) appData.clusterManagers.push(clusterManager);
      if (trainManager && !appData.trainManagers.includes(trainManager)) appData.trainManagers.push(trainManager);
      if (trainManager && clusterManager && !appData.trainManagerHierarchy[trainManager]) appData.trainManagerHierarchy[trainManager] = clusterManager;
      if (rakeManager && trainManager && !appData.rakeManagerHierarchy[rakeManager]) appData.rakeManagerHierarchy[rakeManager] = trainManager;
      if (rakeManager && !appData.rakeManagers.includes(rakeManager)) appData.rakeManagers.push(rakeManager);

      const isEdit = editingId && editingType === 'master';
      if (isEdit) {
        const index = appData.trainMasters.findIndex(t => t.id == editingId);
        if (index >= 0) appData.trainMasters[index] = train;
      } else {
        const dupe = appData.trainMasters.find(t =>
          (normalizeTrainNo(t.trainNumber) === number) &&
          (normalizeText(t.rakeNumber) === normalizeText(rakeNumber)) &&
          (normalizeText(t.rakeManager) === normalizeText(rakeManager)) &&
          (t.validFrom || '') === validFrom &&
          (t.validTo || '') === (validTo || '')
        );
        if (dupe) {
          showAlert('A manager master already exists for this train, rake number, rake manager and validity period. Please edit that entry.', 'error');
          return;
        }
        appData.trainMasters.push(train);
      }

      addMasterLog(isEdit ? 'Edit Train Master' : 'Add Train Master', train, isEdit ? 'Manual master row updated' : 'Manual master row created');

      applyGpTargetToTrain(number, name, train.gpTarget);

      saveData();
      clearMasterForm();
      showAlert('Train master saved successfully', 'success');
      loadMasterTable();
      loadMasterAuditLog();
      updateMasterTargetDisplay();
      document.getElementById('noMasterDataWarning').classList.add('hidden');
    }

    function loadTargetMasterTable() {
      const tbody = document.getElementById('targetMasterTableBody');
      if (!tbody) return;
      const search = String(document.getElementById('targetMasterSearch')?.value || '').toLowerCase().trim();
      const rows = [...(appData.targetMasters || [])]
        .filter(t => {
          if (!search) return true;
          return [
            t.trainName,
            t.trainNumber,
            t.validFrom,
            t.validTo,
            t.validDays,
            t.salesTarget,
            t.gpTarget
          ].some(v => String(v || '').toLowerCase().includes(search));
        })
        .sort((a, b) => (a.trainName || '').localeCompare(b.trainName || '') || (b.validFrom || '').localeCompare(a.validFrom || ''));
      tbody.innerHTML = rows.length ? rows.map(t => `
        <tr>
          <td>${t.trainName || '-'}</td>
          <td>${t.trainNumber || '-'}</td>
          <td>${formatDate(t.validFrom)}</td>
          <td>${formatDate(t.validTo)}</td>
          <td>${t.validDays || '-'}</td>
          <td>${formatCurrency(t.salesTarget)}</td>
          <td>${formatCurrency(t.gpTarget)}</td>
        </tr>
      `).join('') : '<tr><td colspan="7" style="text-align:center;color:#64748b;">No Sales and GP Target Master uploaded.</td></tr>';
    }

    function clearMasterForm() {
      editingId = null;
      editingType = null;
      document.getElementById('masterTrainName').value = '';
      document.getElementById('masterTrainNumber').value = '';
      document.getElementById('masterRakeNumber').value = '';
      document.getElementById('masterYard').value = appData.yards[0] || '';
      document.getElementById('masterTrainType').value = 'WCB';
      document.getElementById('masterClusterManager').value = '';
      onMasterClusterChange();
      document.getElementById('masterTrainManager').value = '';
      onMasterTrainManagerChange();
      document.getElementById('masterTrainManagerPhone').value = '';
      document.getElementById('masterRakeManager').value = '';
      document.getElementById('masterRakeManagerPhone').value = '';
      document.getElementById('masterRakeManagerAadhar').value = '';
      document.getElementById('masterRakeManagerAccount').value = '';
      document.getElementById('masterRakeManagerIfsc').value = '';
      document.getElementById('masterRakeManagerBank').value = '';
      document.getElementById('masterBusinessHead').value = '';
      document.getElementById('masterVp').value = '';
      document.getElementById('masterSalesTarget').value = '';
      document.getElementById('masterGpTarget').value = '';
      document.getElementById('masterValidFrom').value = '';
      document.getElementById('masterValidTo').value = '';
      document.getElementById('masterValidDays').value = '';
    }

    function updateMasterFilterOptions(rows) {
      const fill = (id, values) => {
        const el = document.getElementById(id);
        if (!el) return;
        const current = el.value;
        el.innerHTML = '<option value="">All</option>' + [...new Set(values.filter(Boolean))].sort().map(v => `<option value="${v}">${v}</option>`).join('');
        if ([...el.options].some(o => o.value === current)) el.value = current;
      };
      fill('masterFilterYard', rows.map(t => t.yard || ''));
      fill('masterFilterType', rows.map(t => t.trainType || ''));
      fill('masterFilterCluster', rows.map(t => t.clusterManager || ''));
      fill('masterFilterManager', rows.map(t => t.trainManager || ''));
      fill('masterFilterRakeManager', rows.map(t => t.rakeManager || ''));
    }

    function clearMasterTableFilters() {
      ['masterFilterTrain','masterFilterNumber','masterFilterRakeNo','masterFilterBusinessHead','masterFilterVp','masterFilterValidFrom','masterFilterValidTo'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      ['masterFilterYard','masterFilterType','masterFilterCluster','masterFilterManager','masterFilterRakeManager'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      loadMasterTable();
    }

    function addMasterLog(action, row = {}, detail = '') {
      if (!Array.isArray(appData.masterLogs)) appData.masterLogs = [];
      appData.masterLogs.unshift({
        id: Date.now() + Math.floor(Math.random() * 1000),
        timestamp: new Date().toISOString(),
        user: currentUser?.email || currentUser?.name || 'Unknown',
        action,
        trainName: row.trainName || '',
        trainNumber: normalizeTrainNo(row.trainNumber) || row.trainNumber || '',
        rakeNumber: row.rakeNumber || '',
        rakeManager: row.rakeManager || '',
        detail
      });
      appData.masterLogs = appData.masterLogs.slice(0, 500);
    }

    function loadMasterAuditLog() {
      const card = document.getElementById('masterAuditLogCard');
      const tbody = document.getElementById('masterAuditLogTableBody');
      if (!card || !tbody) return;
      const canSee = currentUser && currentUser.role === 'super_admin';
      card.classList.toggle('hidden', !canSee);
      if (!canSee) return;
      const rows = [...(appData.masterLogs || [])].sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
      tbody.innerHTML = rows.length ? rows.map(log => `
        <tr>
          <td>${log.timestamp ? new Date(log.timestamp).toLocaleString() : '-'}</td>
          <td>${log.user || '-'}</td>
          <td>${log.action || '-'}</td>
          <td>${log.trainName || '-'}</td>
          <td>${log.trainNumber || '-'}</td>
          <td>${log.rakeNumber || '-'}</td>
          <td>${log.rakeManager || '-'}</td>
          <td>${log.detail || '-'}</td>
        </tr>
      `).join('') : '<tr><td colspan="8" style="text-align:center;color:#64748b;">No master log available.</td></tr>';
    }

    function loadMasterTable() {
      const canEdit = currentUser && (currentUser.role === 'admin' || currentUser.role === 'super_admin');
      const allRows = [...(appData.trainMasters || [])];
      updateMasterFilterOptions(allRows);
      const includes = (value, filter) => !filter || String(value || '').toLowerCase().includes(String(filter || '').toLowerCase());
      const exact = (value, filter) => !filter || String(value || '') === String(filter || '');
      const sorted = allRows.filter(t =>
        includes(t.trainName, document.getElementById('masterFilterTrain')?.value) &&
        includes(normalizeTrainNo(t.trainNumber) || t.trainNumber, document.getElementById('masterFilterNumber')?.value) &&
        includes(t.rakeNumber, document.getElementById('masterFilterRakeNo')?.value) &&
        exact(t.yard, document.getElementById('masterFilterYard')?.value) &&
        exact(t.trainType, document.getElementById('masterFilterType')?.value) &&
        exact(t.clusterManager, document.getElementById('masterFilterCluster')?.value) &&
        exact(t.trainManager, document.getElementById('masterFilterManager')?.value) &&
        exact(t.rakeManager, document.getElementById('masterFilterRakeManager')?.value) &&
        includes(t.businessHead, document.getElementById('masterFilterBusinessHead')?.value) &&
        includes(t.vp, document.getElementById('masterFilterVp')?.value) &&
        (!document.getElementById('masterFilterValidFrom')?.value || (t.validFrom || '') >= document.getElementById('masterFilterValidFrom').value) &&
        (!document.getElementById('masterFilterValidTo')?.value || (t.validTo || '') <= document.getElementById('masterFilterValidTo').value)
      ).sort((a, b) => {
        const n = String(a.trainName || '').localeCompare(String(b.trainName || ''));
        if (n !== 0) return n;
        return String(b.validFrom || '').localeCompare(String(a.validFrom || ''));
      });
      document.getElementById('masterTableBody').innerHTML = sorted.map(t => `
        <tr ${canEdit ? `ondblclick="editMasterRow(${t.id})" style="cursor:pointer;"` : ''}>
          <td>${t.trainName}</td>
          <td>${normalizeTrainNo(t.trainNumber) || t.trainNumber || ''}</td>
          <td>${t.rakeNumber || '-'}</td>
          <td>${t.yard}</td>
          <td>${t.trainType}</td>
          <td>${t.clusterManager || '-'}</td>
          <td>${t.trainManager || '-'}</td>
          <td>${t.trainManagerContact || t.trainManagerPhone || '-'}</td>
          <td>${t.rakeManager || '-'}</td>
          <td>${t.rakeManagerContact || t.rakeManagerPhone || '-'}</td>
          <td>${t.rakeManagerAadhar || '-'}</td>
          <td>${t.rakeManagerAccount || '-'}</td>
          <td>${t.rakeManagerIfsc || '-'}</td>
          <td>${t.rakeManagerBank || '-'}</td>
          <td>${t.businessHead || '-'}</td>
          <td>${t.vp || '-'}</td>
          <td>${t.validFrom || '-'}</td>
          <td>${t.validTo || 'Open'}</td>
          <td>${formatCurrency(t.salesTarget)}</td>
          <td>${formatCurrency(t.gpTarget)}</td>
          <td>${canEdit ? `<button class="btn-icon edit" onclick="editMasterRow(${t.id})"><i class="fas fa-edit"></i></button><button class="btn-icon delete" onclick="deleteMasterRow(${t.id})"><i class="fas fa-trash"></i></button>` : '<span style="font-size:11px;color:#64748b;">View</span>'}</td>
        </tr>
      `).join('');
    }

    function deleteMasterRow(id) {
      const canEdit = currentUser && (currentUser.role === 'admin' || currentUser.role === 'super_admin');
      if (!canEdit) {
        showAlert('Only Admin and Super Admin can delete train master rows.', 'warning');
        return;
      }
      const row = (appData.trainMasters || []).find(t => String(t.id) === String(id));
      if (!row) {
        showAlert('Train master row not found. Please refresh and try again.', 'error');
        return;
      }
      const label = `${row.trainName || ''} ${row.trainNumber || ''} ${row.rakeNumber || ''} ${row.rakeManager || ''}`.trim();
      if (!confirm(`Delete this Train Manager Master row?\n\n${label}\n\nExisting sales, complaint and cash data will remain.`)) return;
      markRecordDeleted('trainMasters', row.id);
      markRecordDeleted('trainMasters', makeRecordKey(row, 'trainMasters'));
      appData.trainMasters = (appData.trainMasters || []).filter(t => String(t.id) !== String(id));
      addMasterLog('Delete Train Master', row, 'Manual master row deleted');
      saveData({ forceOverwrite: true });
      if (editingType === 'master' && String(editingId) === String(id)) clearMasterForm();
      loadMasterTable();
      loadMasterAuditLog();
      updateMasterTargetDisplay();
      showAlert('Train master row deleted', 'success');
    }

    function editMasterRow(id) {
      const canEdit = currentUser && (currentUser.role === 'admin' || currentUser.role === 'super_admin');
      if (!canEdit) {
        showAlert('Only Admin and Super Admin can edit train master.', 'warning');
        return;
      }
      const t = (appData.trainMasters || []).find(x => x.id == id);
      if (!t) return;
      editingId = id;
      editingType = 'master';
      document.getElementById('masterTrainName').value = t.trainName || '';
      document.getElementById('masterTrainNumber').value = normalizeTrainNo(t.trainNumber) || t.trainNumber || '';
      document.getElementById('masterRakeNumber').value = t.rakeNumber || '';
      document.getElementById('masterYard').value = t.yard || (appData.yards[0] || '');
      document.getElementById('masterTrainType').value = t.trainType || 'WCB';
      document.getElementById('masterClusterManager').value = t.clusterManager || '';
      onMasterClusterChange();
      document.getElementById('masterTrainManager').value = t.trainManager || '';
      onMasterTrainManagerChange();
      document.getElementById('masterTrainManagerPhone').value = t.trainManagerContact || t.trainManagerPhone || '';
      document.getElementById('masterRakeManager').value = t.rakeManager || '';
      document.getElementById('masterRakeManagerPhone').value = t.rakeManagerContact || t.rakeManagerPhone || '';
      document.getElementById('masterRakeManagerAadhar').value = t.rakeManagerAadhar || '';
      document.getElementById('masterRakeManagerAccount').value = t.rakeManagerAccount || '';
      document.getElementById('masterRakeManagerIfsc').value = t.rakeManagerIfsc || '';
      document.getElementById('masterRakeManagerBank').value = t.rakeManagerBank || '';
      document.getElementById('masterBusinessHead').value = t.businessHead || '';
      document.getElementById('masterVp').value = t.vp || '';
      document.getElementById('masterSalesTarget').value = Math.round(Number(t.salesTarget) || 0);
      document.getElementById('masterGpTarget').value = Math.round(Number(t.gpTarget) || 0);
      document.getElementById('masterValidFrom').value = t.validFrom || '';
      document.getElementById('masterValidTo').value = t.validTo || '';
      document.getElementById('masterValidDays').value = '';
      showAlert('Master loaded for editing. Update and click Save Train.', 'success');
    }

    function addYard() {
      if (!ensureEditable('add master data')) return;
      const yard = document.getElementById('newYard').value.trim();
      if (!yard) return;
      if (!appData.yards.includes(yard)) {
        appData.yards.push(yard);
        saveData();
        populateYardSelects();
        document.getElementById('newYard').value = '';
        showAlert('Yard added', 'success');
      }
    }

    function addClusterManager() {
      if (!ensureEditable('add master data')) return;
      const manager = document.getElementById('newClusterManager').value.trim();
      if (!manager) return;
      if (!appData.clusterManagers.includes(manager)) {
        appData.clusterManagers.push(manager);
        saveData();
        loadMastersPage();
        document.getElementById('newClusterManager').value = '';
        showAlert('Cluster manager added', 'success');
      }
    }

    function addTrainManager() {
      if (!ensureEditable('add master data')) return;
      const manager = document.getElementById('newTrainManager').value.trim();
      if (!manager) { showAlert('Enter train manager name', 'error'); return; }
      if (!appData.trainManagers.includes(manager)) {
        appData.trainManagers.push(manager);
      }
      saveData();
      loadMastersPage();
      document.getElementById('newTrainManager').value = '';
      showAlert('Train manager added to suggestion list', 'success');
    }

    function addRakeManager() {
      if (!ensureEditable('add master data')) return;
      const name = document.getElementById('newRakeManager').value.trim();
      if (!name) { showAlert('Enter rake manager name', 'error'); return; }
      if (!appData.rakeManagers.includes(name)) appData.rakeManagers.push(name);
      saveData();
      loadMastersPage();
      document.getElementById('newRakeManager').value = '';
      showAlert('Rake manager added to suggestion list', 'success');
    }

    // ==================== USERS PAGE FUNCTIONS ====================
    function loadUsersPage() {
      document.getElementById('userYard').innerHTML = '<option value="ALL">All Yards</option>' + (appData.yards || []).map(y => `<option value="${y}">${y}</option>`).join('');
      renderUserAccessControls();
      loadUsersTable();
    }

    function renderUserAccessControls(pageAccess = null, editAccess = null) {
      const role = document.getElementById('userRole')?.value || 'csd_entry';
      const viewPages = pageAccess || getDefaultPageAccess(role);
      const editPages = editAccess || getDefaultEditAccess(role);
      const makeCheckbox = (type, page, checked) => `
        <label style="display: flex; align-items: center; gap: 8px; font-size: 12px; color: #334155;">
          <input type="checkbox" class="${type}" value="${page}" ${checked ? 'checked' : ''}>
          ${PAGE_LABELS[page]}
        </label>
      `;
      const viewBox = document.getElementById('userPageAccess');
      const editBox = document.getElementById('userEditAccess');
      if (viewBox) viewBox.innerHTML = PAGE_ORDER.map(page => makeCheckbox('user-page-access', page, viewPages.includes(page))).join('');
      if (editBox) editBox.innerHTML = PAGE_ORDER.map(page => makeCheckbox('user-edit-access', page, editPages.includes(page))).join('');
    }

    function getCheckedUserAccess(className) {
      return [...document.querySelectorAll(`.${className}:checked`)].map(input => input.value);
    }

    function onRoleChange() {
      const role = document.getElementById('userRole').value;
      const warning = document.getElementById('superAdminWarning');
      
      if (role === 'super_admin' && currentUser.email !== 'sandipnandi2000@gmail.com') {
        warning.classList.remove('hidden');
        document.getElementById('userRole').value = 'admin';
      } else {
        warning.classList.add('hidden');
      }
      const selectedRole = document.getElementById('userRole').value;
      renderUserAccessControls(getDefaultPageAccess(selectedRole), getDefaultEditAccess(selectedRole));
    }

    function saveUser() {
      if (!ensureEditable('manage users')) return;
      const name = document.getElementById('userFullName').value.trim();
      const email = document.getElementById('userEmail').value.trim().toLowerCase();
      const password = document.getElementById('userPassword').value;
      const confirmPassword = document.getElementById('userConfirmPassword').value;
      const role = document.getElementById('userRole').value;
      const yard = document.getElementById('userYard').value;
      let pageAccess = getCheckedUserAccess('user-page-access');
      let editAccess = getCheckedUserAccess('user-edit-access');

      if (!name || !email || !password) { showAlert('Please fill all required fields', 'error'); return; }
      if (password.length < 6) { showAlert('Password must be at least 6 characters', 'error'); return; }
      if (password !== confirmPassword) { showAlert('Passwords do not match', 'error'); return; }
      if (role === 'super_admin' && currentUser.email !== 'sandipnandi2000@gmail.com') { showAlert('Only the primary super admin can create super admin accounts', 'error'); return; }
      if (role === 'super_admin') {
        pageAccess = [...PAGE_ORDER];
        editAccess = [...PAGE_ORDER];
      }
      if (!pageAccess.length) { showAlert('Select at least one page the user can open', 'error'); return; }
      editAccess = editAccess.filter(page => pageAccess.includes(page));

      const existingIndex = appData.users.findIndex(u => u.email.toLowerCase() === email);
      
      const user = {
        id: existingIndex >= 0 ? appData.users[existingIndex].id : Date.now(),
        name: name,
        email: email,
        password: password,
        role: role,
        yard: yard,
        pageAccess: pageAccess,
        editAccess: editAccess,
        active: true
      };

      if (existingIndex >= 0) {
        appData.users[existingIndex] = user;
        showAlert('User updated successfully', 'success');
      } else {
        appData.users.push(user);
        showAlert('User created successfully', 'success');
      }

      saveData();
      clearUserForm();
      loadUsersTable();
    }

    function clearUserForm() {
      document.getElementById('userFullName').value = '';
      document.getElementById('userEmail').value = '';
      document.getElementById('userPassword').value = '';
      document.getElementById('userConfirmPassword').value = '';
      document.getElementById('userRole').value = 'csd_entry';
      document.getElementById('userYard').value = 'ALL';
      document.getElementById('superAdminWarning').classList.add('hidden');
      renderUserAccessControls(getDefaultPageAccess('csd_entry'), getDefaultEditAccess('csd_entry'));
    }

    function loadUsersTable() {
      const isAdmin = currentUser.role === 'admin';
      const primaryEmail = 'sandipnandi2000@gmail.com';
      const isPrimary = (currentUser.email || '').toLowerCase() === primaryEmail;
      const formatPages = pages => (pages || []).map(page => PAGE_LABELS[page] || page).join(', ') || '-';
      
      document.getElementById('usersTableBody').innerHTML = (appData.users || []).map(u => {
        if (!isPrimary && (u.email || '').toLowerCase() === primaryEmail) {
          return '';
        }
        if (isAdmin && u.role === 'super_admin' && u.email !== currentUser.email) {
          return `
            <tr>
              <td>${u.name}</td>
              <td><em>Hidden (Super Admin)</em></td>
              <td>${ROLE_LABELS[u.role] || u.role}</td>
              <td>${u.yard}</td>
              <td>${formatPages(getUserPageAccess(u))}</td>
              <td>${formatPages(getUserEditAccess(u))}</td>
              <td><span class="badge badge-${u.active ? 'success' : 'danger'}">${u.active ? 'Active' : 'Inactive'}</span></td>
              <td>-</td>
            </tr>
          `;
        }
        
        return `
          <tr>
            <td>${u.name}</td>
            <td>${u.email}</td>
            <td>${ROLE_LABELS[u.role] || u.role}</td>
            <td>${u.yard}</td>
            <td>${formatPages(getUserPageAccess(u))}</td>
            <td>${formatPages(getUserEditAccess(u))}</td>
            <td><span class="badge badge-${u.active ? 'success' : 'danger'}">${u.active ? 'Active' : 'Inactive'}</span></td>
            <td>
              <button class="btn-icon edit" onclick="editUser(${u.id})"><i class="fas fa-edit"></i></button>
              <button class="btn-icon delete" onclick="deleteUser(${u.id})"><i class="fas fa-trash"></i></button>
            </td>
          </tr>
        `;
      }).join('');
    }

    function editUser(id) {
      const u = appData.users.find(x => x.id == id);
      if (!u) return;
      if ((u.email || '').toLowerCase() === 'sandipnandi2000@gmail.com' && (currentUser.email || '').toLowerCase() !== 'sandipnandi2000@gmail.com') {
        showAlert('Primary super admin account is hidden.', 'error');
        return;
      }

      document.getElementById('userFullName').value = u.name;
      document.getElementById('userEmail').value = u.email;
      document.getElementById('userPassword').value = u.password;
      document.getElementById('userConfirmPassword').value = u.password;
      document.getElementById('userRole').value = u.role;
      document.getElementById('userYard').value = u.yard;
      renderUserAccessControls(getUserPageAccess(u), getUserEditAccess(u));
      document.getElementById('superAdminWarning').classList.toggle('hidden', !(u.role === 'super_admin' && currentUser.email !== 'sandipnandi2000@gmail.com'));
    }

    function deleteUser(id) {
      if (!ensureEditable('manage users')) return;
      if (!confirm('Are you sure you want to delete this user?')) return;
      
      const user = appData.users.find(u => u.id == id);
      if (user && user.email === 'sandipnandi2000@gmail.com') { showAlert('Cannot delete the primary super admin account', 'error'); return; }
      
      appData.users = appData.users.filter(u => u.id != id);
      markRecordDeleted('users', id);
      saveData();
      loadUsersTable();
      showAlert('User deleted', 'success');
    }

    // ==================== ADMIN PAGE FUNCTIONS ====================
    function loadAdminPage() {
      document.getElementById('summaryUsers').textContent = (appData.users || []).length;
      document.getElementById('summaryTrains').textContent = (appData.trainMasters || []).length;
      document.getElementById('summarySales').textContent = (appData.sales || []).length;
      document.getElementById('summaryComplaints').textContent = (appData.complaints || []).length;
      document.getElementById('summaryCash').textContent = (appData.cash || []).length;
      document.getElementById('summaryYards').textContent = (appData.yards || []).length;
      const primaryDownloads = document.getElementById('primaryAdminDownloads');
      if (primaryDownloads) primaryDownloads.classList.toggle('hidden', (currentUser.email || '').toLowerCase() !== 'sandipnandi2000@gmail.com');
      
      // Update cloud status
      updateCloudStatus();
    }

    function updateCloudStatus() {
      const statusDiv = document.getElementById('cloudStatus');
      if (!statusDiv) return;
      
      if (!firebaseInitialized) {
        const isConfigured = FIREBASE_CONFIG.apiKey !== "YOUR_API_KEY_HERE" && FIREBASE_CONFIG.apiKey !== "";
        if (isConfigured) {
          // Try to initialize
          initFirebase();
        }
      }
      
      if (firebaseInitialized) {
        statusDiv.innerHTML = '<span style="color: #22c55e;"><i class="fas fa-check-circle"></i> Firebase Connected</span>';
      } else {
        const isConfigured = FIREBASE_CONFIG.apiKey !== "YOUR_API_KEY_HERE" && FIREBASE_CONFIG.apiKey !== "";
        if (isConfigured) {
          statusDiv.innerHTML = '<span style="color: #f59e0b;"><i class="fas fa-exclamation-triangle"></i> Firebase Configured but not connected</span>';
        } else {
          statusDiv.innerHTML = '<span style="color: #ef4444;"><i class="fas fa-times-circle"></i> Firebase Not Configured - Update FIREBASE_CONFIG in code</span>';
        }
      }
    }

    // ==================== IMPORT/EXPORT FUNCTIONS ====================
    function normalizeTrainNo(trainNo) {
      return String(trainNo || '').replace(/\D/g, '').substring(0, 5);
    }

    function getLatestDataDate(rows) {
      return (rows || []).map(r => getComparableDate(r.date)).filter(Boolean).sort().pop() || '';
    }

    function findDuplicateEntry(rows, date, trainNumber, trainName, excludeId = null, rakeManager = '', rakeNumber = '') {
      const day = getComparableDate(date);
      const key = buildTrainKey(trainNumber, trainName);
      const selectedManager = normalizeText(rakeManager);
      const selectedRake = normalizeText(rakeNumber);
      return (rows || []).find(row => {
        if (row.id == excludeId || getComparableDate(row.arrivalDate || row.date) !== day) return false;
        if (buildTrainKey(row.trainNumber || row.trainNo, row.trainName) !== key) return false;
        if (selectedManager && normalizeText(row.rakeManager) !== selectedManager) return false;
        if (selectedRake && normalizeText(row.rakeNumber) !== selectedRake) return false;
        return true;
      });
    }

    function pushOrOverwriteEntry(collectionName, entry, overwriteState) {
      const duplicate = findDuplicateEntry(appData[collectionName], entry.date, entry.trainNumber || entry.trainNo, entry.trainName);
      if (duplicate) {
        if (overwriteState.value === null) {
          overwriteState.value = confirm('Data is already available for same train number and date. Overwrite matching entries from this upload?');
        }
        if (!overwriteState.value) return false;
        const index = appData[collectionName].findIndex(row => row.id == duplicate.id);
        if (index >= 0) appData[collectionName][index] = { ...entry, id: duplicate.id };
        return true;
      }
      appData[collectionName].push(entry);
      return true;
    }

    function ensureYardExists(yard) {
      const clean = String(yard || '').trim();
      if (!clean) return;
      if (!appData.yards.includes(clean)) {
        appData.yards.push(clean);
      }
    }

    function findTrainByKey(trainNumber, trainName) {
      const targetNo5 = normalizeTrainNo(trainNumber);
      const targetName = normalizeText(trainName);
      return appData.trainMasters.find(t => {
        const masterNo5 = normalizeTrainNo(t.trainNumber);
        if (targetNo5 && masterNo5 && targetNo5 === masterNo5) return true;
        if (!targetNo5 && targetName && normalizeText(t.trainName) === targetName) return true;
        return false;
      });
    }

    async function importSalesExcel(input) {
      if (!ensureEditable('import data')) { input.value = ''; return; }
      const file = input.files[0];
      if (!file) return;

      try {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array', cellDates: true, dateNF: 'yyyy-mm-dd' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

        if (!rows.length) { showAlert('No data found in the Excel file', 'error'); return; }

        let imported = 0;
        let skipped = 0;
        const overwriteState = { value: null };

        rows.forEach(row => {
          const trainName = getColumnValue(row, ['Train Name', 'trainname', 'train', 'Train']);
          const trainNumber = getColumnValue(row, ['Train Number', 'trainnumber', 'trainno', 'TrainNo']);
          const dateValue = getColumnValue(row, ['Arrival Date', 'arrivaldate', 'date', 'Date']);
          const salesAchievement = Number(getColumnValue(row, ['Total Sale', 'totalsale', 'Sales Achievement', 'salesachievement', 'achievement'])) || 0;
          const storeBill = Math.round(Number(getColumnValue(row, ['Store Bill', 'storebill', 'Ration Expense', 'rationexpense']))) || 0;
          const baseExpense = Math.round(Number(getColumnValue(row, ['Base Expenses', 'baseexpenses', 'Base Expense']))) || 0;
          const creditExpense = Math.round(Number(getColumnValue(row, ['Credit Expenses', 'creditexpenses', 'Credit Expense']))) || 0;
          const cashExpense = Math.round(Number(getColumnValue(row, ['Cash Expenses', 'cashexpenses', 'Cash Expense']))) || 0;
          const miscExpense = Math.round(Number(getColumnValue(row, ['MISC Expenses', 'MISC Expense', 'miscexpense', 'Misc Expense']))) || 0;
          const cashCommission = Math.round(Number(getColumnValue(row, ['Commission', 'Cash Commission', 'cashcommission']))) || Math.round(salesAchievement * 0.10);
          const staffSalary = Math.round(Number(getColumnValue(row, ['Staff Salary', 'staffsalary']))) || 0;
          const managerSalary = Math.round(Number(getColumnValue(row, ['Rake Manager Salary', 'rakemanagersalary', 'Manager Salary', 'managersalary']))) || 0;
          const eCatering = Math.round(Number(getColumnValue(row, ['E-Catering', 'ECatering', 'eCatering']))) || 0;
          const importedGp = Number(getColumnValue(row, ['Gross Profit Achievement', 'grossprofitachievement', 'gpachievement'])) || 0;
          const gpAchievement = importedGp || (salesAchievement - (storeBill + baseExpense + creditExpense + cashExpense + miscExpense + cashCommission + staffSalary + managerSalary));
          const amountToCollect = Math.round((gpAchievement + storeBill + baseExpense + creditExpense + managerSalary) - eCatering);

          let parsedDate = parseExcelDate(dateValue);

          if (!trainName || !parsedDate) { skipped++; return; }

          const normalizedTrainNo = normalizeTrainNo(trainNumber);
          const stableTrainNo = normalizedTrainNo || String(trainNumber || '').trim();

          let train = findTrainByKey(stableTrainNo, trainName);
          const effective = getEffectiveMaster(stableTrainNo, trainName, parsedDate) || train;
          if (!effective) { skipped++; return; }

          const entry = {
            id: Date.now() + Math.random(),
            date: parsedDate,
            month: new Date(parsedDate).toLocaleString('en-US', { month: 'short' }),
            trainId: effective.id,
            trainName: effective.trainName || trainName,
            trainNumber: stableTrainNo,
            yard: effective.yard || '',
            clusterManager: effective.clusterManager || '',
            trainManager: effective.trainManager || '',
            rakeManager: effective.rakeManager || '',
            rakeNumber: effective.rakeNumber || '',
            businessHead: effective.businessHead || '',
            vp: effective.vp || '',
            trainType: effective.trainType || '',
            salesTarget: getTrainSalesTarget(stableTrainNo, trainName, parsedDate),
            salesAchievement: Math.round(salesAchievement),
            totalSale: Math.round(salesAchievement),
            storeBill,
            baseExpense,
            creditExpense,
            cashExpense,
            miscExpense,
            cashCommission,
            staffSalary,
            managerSalary,
            eCatering,
            amountToCollect,
            gpTarget: getTrainGpTarget(stableTrainNo, trainName, parsedDate),
            gpAchievement: Math.round(gpAchievement),
            remarks: 'Imported from Excel'
          };

          if (pushOrOverwriteEntry('sales', entry, overwriteState)) imported++;
          else skipped++;
        });

        saveData();
        input.value = '';
        showAlert(`Import complete: ${imported} entries imported, ${skipped} skipped`, 'success');
        loadSalesList();
        loadDashboard();

      } catch (error) {
        console.error('Import error:', error);
        showAlert('Import failed: ' + error.message, 'error');
      }
    }

    async function importComplaintExcel(input) {
      if (!ensureEditable('import data')) { input.value = ''; return; }
      const file = input.files[0];
      if (!file) return;

      try {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

        let imported = 0;
        let skipped = 0;
        const overwriteState = { value: null };

        rows.forEach(row => {
          const date = parseExcelDate(getColumnValue(row, ['Date', 'date', 'Complaint Date']));
          const trainNo = normalizeTrainNo(getColumnValue(row, ['Train No', 'trainno', 'Train Number']) || '');
          const trainName = getColumnValue(row, ['Train Name', 'trainname', 'Train']) || '';
          const rakeManager = getColumnValue(row, ['Rake Manager', 'rakemanager']) || '';
          const rakeNumber = getColumnValue(row, ['Rake Number', 'rakeno', 'rakenumber']) || '';
          const options = getRakeOptionsForTrain(trainNo, trainName, date);
          const effective = getEffectiveMaster(trainNo, trainName, date, rakeManager, rakeNumber) || (options.length === 1 ? options[0] : null);
          const finalRakeManager = rakeManager || effective?.rakeManager || '';
          if (!date || !trainNo || !effective || !finalRakeManager) { skipped++; return; }

          const complaint = {
            id: Date.now() + Math.random(),
            date: date,
            complaintId: getColumnValue(row, ['Complaint ID', 'complaintid', 'ID']) || 'CMP' + Date.now(),
            source: getColumnValue(row, ['Source', 'source', 'Complaint Source']) || 'Other',
            status: getColumnValue(row, ['Status', 'status']) || 'Open',
            trainNo: trainNo,
            trainNumber: trainNo,
            trainName: effective?.trainName || trainName,
            trainType: effective?.trainType || getColumnValue(row, ['Train Type', 'traintype']) || '',
            yard: effective?.yard || getColumnValue(row, ['Yard', 'yard']) || appData.yards[0] || '',
            rakeManager: finalRakeManager,
            rakeNumber: rakeNumber || effective?.rakeNumber || '',
            rakeManagerContact: getColumnValue(row, ['Rake Manager Phone', 'Rake Manager Contact', 'CONTACT NO', 'Contact No']) || effective?.rakeManagerContact || '',
            trainManager: effective?.trainManager || '',
            businessHead: effective?.businessHead || '',
            vp: effective?.vp || '',
            complainantName: getColumnValue(row, ['Complainant Details', 'Complainant Name', 'complainantname', 'Name']) || '',
            email: getColumnValue(row, ['Email', 'Email ID', 'email']) || '',
            mobileNo: getColumnValue(row, ['Mobile No', 'Mobile Number', 'mobileno', 'Mobile']) || '',
            referenceNo: getColumnValue(row, ['Reference No', 'Reference Number', 'Complaint Ref No', 'Ref No']) || '',
            pnrNo: getColumnValue(row, ['PNR / UTS No', 'PNR / UTS', 'PNR No', 'pnrno', 'PNR', 'UTS No']) || '',
            coachNo: getColumnValue(row, ['Coach No', 'Coach Number', 'coachno']) || '',
            physicalCoachNo: getColumnValue(row, ['Physical Coach No', 'Physical Coach Number']) || '',
            berthNo: getColumnValue(row, ['Berth No', 'Berth Number']) || '',
            commencementDateTime: getColumnValue(row, ['Train Commencement Date Time', 'Train Commencement Date&Time', 'Commencement Date Time']) || '',
            complaintType: getColumnValue(row, ['Complaint Type', 'complainttype', 'Type']) || '',
            complainNature: getColumnValue(row, ['Nature', 'Complaint Nature', 'Complain Nature', 'complainnature']) || '',
            details: getColumnValue(row, ['Complaint Description', 'Complaint Matter', 'Details', 'details', 'Description']) || '',
            actionTaken1: getColumnValue(row, ['Action Taken 1', 'Action 1']) || '',
            actionTaken2: getColumnValue(row, ['Action Taken 2', 'Action 2']) || '',
            actionTaken3: getColumnValue(row, ['Action Taken 3', 'Action 3']) || '',
            actionTaken4: getColumnValue(row, ['Action Taken 4', 'Action 4']) || '',
            actionTaken5: getColumnValue(row, ['Action Taken 5', 'Action 5']) || '',
            remarks: getColumnValue(row, ['Licensee Remarks', 'Remarks', 'remarks']) || 'Imported from Excel'
          };

          if (!complaint.mobileNo || !complaint.referenceNo || !complaint.pnrNo || !complaint.coachNo || !complaint.complainNature || !complaint.details) { skipped++; return; }
          ensureYardExists(complaint.yard);
          if (pushOrOverwriteEntry('complaints', complaint, overwriteState)) imported++;
          else skipped++;
        });

        saveData();
        input.value = '';
        showAlert(`${imported} complaints imported successfully, ${skipped} skipped`, 'success');
        loadComplaintList();
        loadDashboard();

      } catch (error) { showAlert('Import failed: ' + error.message, 'error'); }
    }

    async function importCashExcel(input) {
      if (!ensureEditable('import data')) { input.value = ''; return; }
      const file = input.files[0];
      if (!file) return;

      try {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

        let imported = 0;
        let skipped = 0;
        const overwriteState = { value: null };

        rows.forEach(row => {
          const cashDepositCounter = Math.round(Number(getColumnValue(row, ['Deposited in Cash', 'cashdeposit', 'Cash Deposit', 'DepositedinCash']))) || 0;
          const onlineDeposit = Math.round(Number(getColumnValue(row, ['Deposited through Online', 'onlinedeposit', 'Online Deposit', 'DepositedthroughOnline']))) || 0;
          const date = parseExcelDate(getColumnValue(row, ['Date', 'date']));
          const trainName = getColumnValue(row, ['Train Name', 'trainname', 'Train']) || '';
          const trainNumber = normalizeTrainNo(getColumnValue(row, ['Train Number', 'trainnumber', 'TrainNo']) || '');
          const master = getEffectiveMaster(trainNumber, trainName, date);
          if ((trainName || trainNumber) && !master) { skipped++; return; }
          const salesEntry = master ? findSalesEntryForCash(date, master.id, master.trainNumber, master.trainName, master.rakeManager, master.rakeNumber) : null;
          if (!salesEntry) { skipped++; return; }
          const gpFromSales = Math.round(Number(getColumnValue(row, ['Total Sale', 'totalsale', 'Amount To Be Collected', 'Amount To Collect']))) || Math.round(Number(salesEntry.salesAchievement || salesEntry.totalSale) || 0);
          
          const entry = {
            id: Date.now() + Math.random(),
            date: date,
            yard: master?.yard || getColumnValue(row, ['Yard', 'yard']) || appData.yards[0] || '',
            trainId: master?.id || '',
            trainName: master?.trainName || trainName,
            trainNumber: master ? (normalizeTrainNo(master.trainNumber) || master.trainNumber || '') : trainNumber,
            trainManager: master?.trainManager || '',
            rakeManager: master?.rakeManager || '',
            rakeManagerContact: master?.rakeManagerContact || master?.rakeManagerPhone || '',
            rakeManagerPhone: master?.rakeManagerContact || master?.rakeManagerPhone || '',
            rakeNumber: master?.rakeNumber || '',
            businessHead: master?.businessHead || '',
            vp: master?.vp || '',
            gpFromSales: gpFromSales,
            gpCollected: gpFromSales,
            amountToCollect: gpFromSales,
            cashDepositCounter: cashDepositCounter,
            onlineDeposit: onlineDeposit,
            totalDeposit: cashDepositCounter + onlineDeposit,
            shortageReason: getColumnValue(row, ['Shortage Reason', 'shortagereason', 'Reason']) || '',
            remarks: getColumnValue(row, ['Remarks', 'remarks']) || 'Imported from Excel'
          };

          ensureYardExists(entry.yard);
          if (entry.date && entry.yard && pushOrOverwriteEntry('cash', entry, overwriteState)) imported++;
          else skipped++;
        });

        saveData();
        input.value = '';
        showAlert(`${imported} cash entries imported/updated successfully, ${skipped} skipped`, 'success');
        loadCashList();
        loadCashDashboard();
        loadDashboard();

      } catch (error) { showAlert('Import failed: ' + error.message, 'error'); }
    }

    async function importMasterExcel(input) {
      if (!ensureEditable('import data')) { input.value = ''; return; }
      const file = input.files[0];
      if (!file) return;

      try {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });
        const rows = getRowsFromWorkbookByHeaders(workbook, ['TRAIN NO', 'TRAIN NAME', 'YARD NAME']);

        let imported = 0;
        let skipped = 0;
        let overwriteAll = null;

        rows.forEach(row => {
          const validFrom = parseExcelDate(getColumnValue(row, ['Valid From', 'validfrom', 'Start Date', 'startdate'])) || '';
          let validTo = parseExcelDate(getColumnValue(row, ['Valid To', 'validto', 'End Date', 'enddate'])) || '';
          const validDays = Number(getColumnValue(row, ['Valid Days', 'validdays', 'No of Days', 'days'])) || 0;
          if (!validTo && validFrom && validDays > 0) {
            const d = new Date(validFrom);
            d.setDate(d.getDate() + validDays - 1);
            validTo = d.toISOString().split('T')[0];
          }
          const train = {
            id: Date.now() + Math.random(),
            trainName: getColumnValue(row, ['Train Name', 'trainname', 'Train', 'TRAIN NAME']) || '',
            trainNumber: normalizeTrainNo(getColumnValue(row, ['Train Number', 'trainnumber', 'TrainNo', 'TRAIN NO']) || ''),
            rakeNumber: String(getColumnValue(row, ['Rake Number', 'rakenumber', 'Rake No', 'rakeno', 'No Of Rakes', 'NoOfRakes', 'RACKS']) || '').trim(),
            yard: getColumnValue(row, ['Yard', 'yard', 'YARD NAME']) || appData.yards[0] || '',
            trainType: getColumnValue(row, ['Train Type', 'traintype']) || 'WCB',
            clusterManager: getColumnValue(row, ['Cluster Manager', 'clustermanager', 'Cluster No.']) || '',
            trainManager: getColumnValue(row, ['Train Manager', 'trainmanager', 'TRAIN MANAGER(Yard mgr)', 'TRAIN MANAGER(yard mgr)']) || '',
            rakeManager: getColumnValue(row, ['Rake Manager', 'rakemanager', 'Rake Manager ', 'NAME']) || '',
            businessHead: getColumnValue(row, ['Business Head', 'businesshead']) || '',
            vp: getColumnValue(row, ['VP', 'Vice President', 'vicepresident', 'VP,s']) || '',
            rakeManagerContact: getColumnValue(row, ['CONTACT NO', 'Contact No', 'Rake Manager Contact', 'rakeManagerContact', 'Rake Manager Phone', 'rakeManagerPhone']) || '',
            rakeManagerAadhar: getColumnValue(row, ['Rake Manager ADHAR Number', 'Rake Manager Aadhar', 'ADHAR Number', 'Aadhar Number', 'rakeManagerAadhar']) || '',
            rakeManagerAccount: getColumnValue(row, ['Account Number', 'Rake Manager Account Number', 'Bank Account Number', 'rakeManagerAccount']) || '',
            rakeManagerIfsc: String(getColumnValue(row, ['IFSC Code', 'IFSC', 'Rake Manager IFSC', 'rakeManagerIfsc']) || '').toUpperCase(),
            rakeManagerBank: String(getColumnValue(row, ['Bank Name', 'Rake Manager Bank Name', 'rakeManagerBank']) || '').toUpperCase(),
            trainManagerContact: getColumnValue(row, ['TRAIN MANAGER NUMBER', 'Train Manager Number', 'trainManagerContact']) || '',
            businessHeadContact: getColumnValue(row, ['BUSINESS HEAD MOBILE NUMBER', 'Business Head Mobile Number', 'businessHeadContact']) || '',
            vpContact: getColumnValue(row, ['VP,s MOBILE NUMBER', 'VP Mobile Number', 'vpContact']) || '',
            cashier: getColumnValue(row, ['CASHIER', 'Cashier']) || '',
            cashierContact: getColumnValue(row, ['CASHIER MOBILE NO', 'Cashier Mobile No', 'cashierContact']) || '',
            zone: getColumnValue(row, ['ZONE', 'Zone']) || '',
            railwayZone: getColumnValue(row, ['RLY ZONE', 'Railway Zone']) || '',
            irctcZone: getColumnValue(row, ['IRCTC ZONE', 'IRCTC Zone']) || '',
            registeredFirm: getColumnValue(row, ['REGISTERED FIRM', 'Registered Firm']) || '',
            origin: getColumnValue(row, ['ORIGIN-(Yard) (DEPARTURE STATION)', 'Origin']) || '',
            destination: getColumnValue(row, ['DESTINATION', 'Destination']) || '',
            arrivalDays: getColumnValue(row, ['ARRIVAL DAYS', 'Arrival Days', 'arrivalDays']) || '',
            runningFrequency: getColumnValue(row, ['RUNNING FREQUENCY', 'Running Frequency', 'runningFrequency']) || '',
            salesTarget: Math.round(Number(getColumnValue(row, ['Sales Target', 'salestarget']))) || 0,
            gpTarget: Math.round(Number(getColumnValue(row, ['GP Target', 'gptarget', 'GrossProfitTarget']))) || 0,
            validFrom: validFrom || '',
            validTo: validTo || ''
          };

          if (train.trainName && train.trainNumber && train.rakeNumber) {
            ensureYardExists(train.yard);
            if (train.trainManager && train.clusterManager && !appData.trainManagerHierarchy[train.trainManager]) appData.trainManagerHierarchy[train.trainManager] = train.clusterManager;
            if (train.rakeManager && train.trainManager && !appData.rakeManagerHierarchy[train.rakeManager]) appData.rakeManagerHierarchy[train.rakeManager] = train.trainManager;
            if (train.rakeManager && !appData.rakeManagers.includes(train.rakeManager)) appData.rakeManagers.push(train.rakeManager);

            const existing = findExistingTrainMasterForImport(train);
            if (existing) {
              if (overwriteAll === null) overwriteAll = confirm('Train Manager Master already has matching train, rake, train manager and rake manager rows. Update matching rows from this upload?');
              if (overwriteAll) {
                const index = appData.trainMasters.findIndex(t => t.id == existing.id);
                if (index >= 0) appData.trainMasters[index] = mergeImportedMasterRow(existing, train);
                applyGpTargetToTrain(train.trainNumber, train.trainName, train.gpTarget);
                imported++;
              } else {
                skipped++;
              }
            } else {
              appData.trainMasters.push(train);
              applyGpTargetToTrain(train.trainNumber, train.trainName, train.gpTarget);
              imported++;
            }
          } else {
            skipped++;
          }
        });

        saveData();
        addMasterLog('Import Train Master', {}, `${imported} train master rows imported/updated, ${skipped} skipped`);
        saveData();
        input.value = '';
        showAlert(`${imported} train masters imported/updated successfully, ${skipped} skipped`, 'success');
        loadMasterTable();
        loadMasterAuditLog();
        loadTargetMasterTable();
        updateMasterTargetDisplay();
        document.getElementById('noMasterDataWarning').classList.add('hidden');

      } catch (error) { showAlert('Import failed: ' + error.message, 'error'); }
    }

    async function importSalesGpTargetExcel(input) {
      if (!ensureEditable('import target data')) { input.value = ''; return; }
      const file = input.files[0];
      if (!file) return;

      try {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
        const rows = getRowsFromWorkbookByHeaders(workbook, ['Train Name', 'Train Number', 'Sales Target', 'GP Target']);

        let imported = 0;
        let skipped = 0;
        let overwriteAll = null;
        rows.forEach(row => {
          const trainName = getColumnValue(row, ['Train Name', 'trainname', 'Train']) || '';
          const trainNumber = normalizeTrainNo(getColumnValue(row, ['Train Number', 'trainnumber', 'TrainNo']) || '');
          const validFrom = parseExcelDate(getColumnValue(row, ['Valid From', 'validfrom', 'Start Date'])) || '';
          let validTo = parseExcelDate(getColumnValue(row, ['Valid To', 'validto', 'End Date'])) || '';
          const validDays = Number(getColumnValue(row, ['Valid Days', 'validdays', 'Days'])) || 0;
          if (!validTo && validFrom && validDays > 0) {
            const d = new Date(validFrom);
            d.setDate(d.getDate() + validDays - 1);
            validTo = d.toISOString().split('T')[0];
          }
          const master = findTrainByKey(trainNumber, trainName);
          const salesTarget = Math.round(Number(getColumnValue(row, ['Sales Target', 'salestarget']))) || 0;
          const gpTarget = Math.round(Number(getColumnValue(row, ['GP Target', 'gptarget', 'Gross Profit Target', 'grossprofittarget']))) || 0;
          if (!master || !validFrom || (!salesTarget && !gpTarget)) { skipped++; return; }
          const target = {
            id: Date.now() + Math.random(),
            trainName: master.trainName || trainName,
            trainNumber: normalizeTrainNo(master.trainNumber) || trainNumber,
            validFrom,
            validTo,
            validDays: validDays || (validFrom && validTo ? Math.max(1, Math.round((new Date(validTo) - new Date(validFrom)) / 86400000) + 1) : ''),
            salesTarget,
            gpTarget
          };
          const duplicate = findExistingTargetForImport(target);
          if (duplicate) {
            if (overwriteAll === null) overwriteAll = confirm('Sales and GP Target Master already has data for the same train. Update matching target rows from this upload?');
            if (!overwriteAll) { skipped++; return; }
            const index = appData.targetMasters.findIndex(t => t.id == duplicate.id);
            if (index >= 0) appData.targetMasters[index] = { ...target, id: duplicate.id };
          } else {
            appData.targetMasters.push(target);
          }
          imported++;
        });

        saveData();
        addMasterLog('Import Sales & GP Target', {}, `${imported} target rows imported/updated, ${skipped} skipped`);
        saveData();
        input.value = '';
        showAlert(`Sales and GP target import complete: ${imported} imported/updated, ${skipped} skipped`, 'success');
        loadTargetMasterTable();
        loadMasterAuditLog();
        updateMasterTargetDisplay();
      } catch (error) { showAlert('Import failed: ' + error.message, 'error'); }
    }

    async function importItemRateMasterExcel(input) {
      if (!ensureEditable('import item rate master')) { input.value = ''; return; }
      const file = input.files[0];
      if (!file) return;

      try {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
        const rows = getRowsFromWorkbookByHeaders(workbook, ['ITEMS', 'RATE']);
        let imported = 0;
        let skipped = 0;
        let overwriteAll = null;

        rows.forEach(row => {
          const itemName = String(getColumnValue(row, ['ITEMS', 'Item', 'Item Name', 'itemName']) || '').trim();
          if (!itemName || normalizeText(itemName) === normalizeText('ITEMS')) { skipped++; return; }
          const category = String(getColumnValue(row, ['Items Description', 'Item Description', 'Category', 'category']) || '').trim();
          const explicitTrainType = String(getColumnValue(row, ['Train Type', 'trainType']) || '').trim().toUpperCase();
          const saleRate = Number(getColumnValue(row, ['RATE', 'Sale Rate', 'saleRate'])) || 0;
          const purchaseRate = Number(getColumnValue(row, ['PUR RATE', 'Purchase Rate', 'purchaseRate'])) || 0;
          const eCateringRate = Number(getColumnValue(row, ['Ecatering', 'E-Catering', 'E Catering', 'eCateringRate'])) || 0;
          const activeValue = String(getColumnValue(row, ['Active', 'Status', 'active']) || 'Yes').trim().toLowerCase();
          if (!saleRate && !purchaseRate && !eCateringRate) { skipped++; return; }
          const item = {
            id: Date.now() + Math.random(),
            category,
            itemName,
            trainType: ['WCB', 'TSV', 'ALL'].includes(explicitTrainType) ? explicitTrainType : inferItemTrainType(category, itemName),
            saleRate,
            purchaseRate,
            eCateringRate,
            active: !['no', 'false', 'inactive', '0'].includes(activeValue)
          };
          const existing = findExistingItemRateMaster(item);
          if (existing) {
            if (overwriteAll === null) overwriteAll = confirm('Item Rate Master already has matching item rows. Update matching rates from this upload?');
            if (!overwriteAll) { skipped++; return; }
            const index = appData.itemRateMasters.findIndex(row => String(row.id) === String(existing.id));
            if (index >= 0) appData.itemRateMasters[index] = { ...existing, ...item, id: existing.id };
          } else {
            appData.itemRateMasters.push(item);
          }
          imported++;
        });

        addMasterLog('Import Item Rate Master', {}, `${imported} item rate rows imported/updated, ${skipped} skipped`);
        saveData();
        input.value = '';
        loadItemRateMasterTable();
        showAlert(`${imported} item rates imported/updated successfully, ${skipped} skipped`, 'success');
      } catch (error) {
        showAlert('Item Rate Master import failed: ' + error.message, 'error');
      }
    }

    function normalizeColumnKey(name) {
      return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function getRowsFromWorkbookByHeaders(workbook, requiredHeaders) {
      const required = requiredHeaders.map(normalizeColumnKey);
      let bestRows = null;
      for (const sheetName of workbook.SheetNames || []) {
        const sheet = workbook.Sheets[sheetName];
        const preview = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', blankrows: false });
        const headerIndex = preview.findIndex(row => {
          const keys = (row || []).map(normalizeColumnKey);
          return required.every(req => keys.includes(req));
        });
        if (headerIndex >= 0) {
          const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', range: headerIndex });
          if (rows.length && (!bestRows || rows.length > bestRows.length)) bestRows = rows;
        }
      }
      if (bestRows) return bestRows;
      return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: '' });
    }

    function getColumnValue(row, possibleNames) {
      for (const name of possibleNames) {
        if (row[name] !== undefined && row[name] !== '') return row[name];
        const lowerName = normalizeColumnKey(name);
        for (const key of Object.keys(row)) {
          const cleanKey = normalizeColumnKey(key);
          if (cleanKey === lowerName) return row[key];
        }
      }
      return '';
    }

    function restoreBackup(input) {
      if (!ensureEditable('restore backup')) { input.value = ''; return; }
      const file = input.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = function(e) {
        try {
          const data = JSON.parse(e.target.result);
          if (confirm('This will replace all current data. Continue?')) {
            appData = data;
            saveData();
            showAlert('Backup restored successfully', 'success');
            loadDashboard();
          }
        } catch (error) { showAlert('Invalid backup file', 'error'); }
      };
      reader.readAsText(file);
      input.value = '';
    }

    async function resetAndImportSales(input) {
      if (!ensureEditable('reset and import data')) { input.value = ''; return; }
      if (!confirm('This will DELETE ALL existing sales data and replace with the uploaded file. Continue?')) { input.value = ''; return; }
      appData.sales = [];
      await importSalesExcel(input);
    }

    // ==================== FIREBASE SYNC FUNCTIONS ====================
    async function syncToCloud(silent = false, options = {}) {
      if (!silent && !ensureEditable('sync data to cloud')) return;
      if (!firebaseInitialized) {
        // Try to initialize Firebase
        if (!initFirebase()) {
          if (!silent) showAlert('Firebase not configured. Please update FIREBASE_CONFIG in the code with your actual Firebase credentials.', 'warning');
          return;
        }
      }
      
      try {
        if (!silent) showAlert('Syncing data to cloud...', 'info');
        
        const snapshot = await firebaseDb.ref('rkGroupData').once('value');
        const cloudData = decodeCloudData(snapshot.val() || {});
        const dataToSync = options.forceOverwrite ? buildCloudPayload(appData) : mergeCloudAndLocalData(cloudData, appData);
        const cleanedPdfCount = typeof sanitizeOversizedHisabExcelPdfs === 'function' ? sanitizeOversizedHisabExcelPdfs(dataToSync) : 0;
        dataToSync.lastSync = new Date().toISOString();
        
        await firebaseDb.ref('rkGroupData').set(encodeCloudData(dataToSync));
        appData = dataToSync;
        saveLocalAppData(appData);
        if (cleanedPdfCount) showAlert(`${cleanedPdfCount} oversized Hisab Excel PDF attachment(s) were removed from cloud sync. Please upload PDF files under ${HISAB_EXCEL_PDF_MAX_LABEL}.`, 'warning');
        if (!silent) showAlert('Data synced to cloud successfully!', 'success');
        console.log('Data synced to Firebase at:', dataToSync.lastSync);
      } catch (error) {
        console.error('Sync to cloud error:', error);
        if (!silent) showAlert('Failed to sync to cloud: ' + error.message, 'error');
        else showAlert('Cloud save failed. Data is saved in this browser only until sync succeeds: ' + error.message, 'warning');
      }
    }

    async function syncFromCloud() {
      if (!firebaseInitialized) {
        // Try to initialize Firebase
        if (!initFirebase()) {
          showAlert('Firebase not configured. Please update FIREBASE_CONFIG in the code with your actual Firebase credentials.', 'warning');
          return;
        }
      }
      
      try {
        showAlert('Fetching data from cloud...', 'info');
        
        const snapshot = await firebaseDb.ref('rkGroupData').once('value');
        const cloudData = decodeCloudData(snapshot.val());
        
        if (!cloudData) {
          showAlert('No data found in cloud. Sync to cloud first.', 'warning');
          return;
        }
        
        // Merge cloud data with local data
        if (cloudData.users) appData.users = cloudData.users;
        if (cloudData.yards) appData.yards = cloudData.yards;
        if (cloudData.clusterManagers) appData.clusterManagers = cloudData.clusterManagers;
        if (cloudData.trainManagers) appData.trainManagers = cloudData.trainManagers;
        if (cloudData.trainMasters) appData.trainMasters = cloudData.trainMasters;
        if (cloudData.targetMasters) appData.targetMasters = cloudData.targetMasters;
        if (cloudData.sales) appData.sales = cloudData.sales;
        if (cloudData.complaints) appData.complaints = cloudData.complaints;
        if (cloudData.cash) appData.cash = cloudData.cash;
        if (cloudData.bankDeposits) appData.bankDeposits = cloudData.bankDeposits;
        if (cloudData.masterLogs) appData.masterLogs = cloudData.masterLogs;
        
        saveData();
        
        const lastSync = cloudData.lastSync ? new Date(cloudData.lastSync).toLocaleString() : 'Unknown';
        showAlert(`Data synced from cloud successfully! Last sync: ${lastSync}`, 'success');
        console.log('Data synced from Firebase. Last sync:', lastSync);
        
        // Refresh current page
        const currentPage = document.querySelector('.nav-item.active')?.getAttribute('data-page') || 'dashboard';
        showPage(currentPage);
      } catch (error) {
        console.error('Sync from cloud error:', error);
        showAlert('Failed to sync from cloud: ' + error.message, 'error');
      }
    }

    function markRecordDeleted(collectionName, id) {
      if (!appData.deletedRecords) appData.deletedRecords = {};
      if (!appData.deletedRecords[collectionName]) appData.deletedRecords[collectionName] = {};
      appData.deletedRecords[collectionName][String(id)] = new Date().toISOString();
    }

    // Auto-sync to cloud when data changes (if Firebase is configured)
    function autoSyncToCloud(options = {}) {
      if (firebaseInitialized) {
        // Debounce sync to avoid too many writes
        clearTimeout(window.syncTimeout);
        window.syncTimeout = setTimeout(() => {
          syncToCloud(true, options).catch(err => {
            console.error('Auto-sync error:', err);
            showAlert('Cloud save failed. Please check internet/Firebase and press Sync.', 'warning');
          });
        }, options.forceOverwrite ? 0 : 300);
      } else {
        showAlert('Firebase is not connected. Data is saved in this browser only.', 'warning');
      }
    }

    // Make functions globally available
    window.handleLogin = handleLogin;
    window.useDemoLogin = useDemoLogin;
    window.handleLogout = handleLogout;
    window.filterTrains = filterTrains;
    window.showTrainDropdown = showTrainDropdown;
    window.selectTrain = selectTrain;
    window.onSalesRakeManagerChange = onSalesRakeManagerChange;
    window.calculateSalesPct = calculateSalesPct;
    window.calculateSalesCostsAndGp = calculateSalesCostsAndGp;
    window.calculateGpPct = calculateGpPct;
    window.validateAndSaveSalesEntry = validateAndSaveSalesEntry;
    window.confirmGpApproval = confirmGpApproval;
    window.closeGpWarningModal = closeGpWarningModal;
    window.confirmSalesReopenApproval = confirmSalesReopenApproval;
    window.closeSalesReopenApprovalModal = closeSalesReopenApprovalModal;
    window.clearSalesForm = clearSalesForm;
    window.editSalesEntry = editSalesEntry;
    window.deleteSalesEntry = deleteSalesEntry;
    window.saveComplaint = saveComplaint;
    window.clearComplaintForm = clearComplaintForm;
    window.editComplaint = editComplaint;
    window.deleteComplaint = deleteComplaint;
    window.checkPreviousComplaintsByMobile = checkPreviousComplaintsByMobile;
    window.closePreviousComplaintsModal = closePreviousComplaintsModal;
    window.filterComplaintTrains = filterComplaintTrains;
    window.showComplaintTrainDropdown = showComplaintTrainDropdown;
    window.selectComplaintTrain = selectComplaintTrain;
    window.filterCashTrains = filterCashTrains;
    window.showCashTrainDropdown = showCashTrainDropdown;
    window.selectCashTrain = selectCashTrain;
    window.calculateTotalDeposit = calculateTotalDeposit;
    window.rememberLastCashDate = rememberLastCashDate;
    window.saveCashEntry = saveCashEntry;
    window.clearCashForm = clearCashForm;
    window.editCashEntry = editCashEntry;
    window.deleteCashEntry = deleteCashEntry;
    window.startPendingCashDeposit = startPendingCashDeposit;
    window.saveBankDepositEntry = saveBankDepositEntry;
    window.clearBankDepositForm = clearBankDepositForm;
    window.loadBankDepositList = loadBankDepositList;
    window.deleteBankDepositEntry = deleteBankDepositEntry;
    window.downloadBankDepositEntries = downloadBankDepositEntries;
    window.saveTrainMaster = saveTrainMaster;
    window.saveItemRateMaster = saveItemRateMaster;
    window.clearItemRateMasterForm = clearItemRateMasterForm;
    window.editItemRateMaster = editItemRateMaster;
    window.deleteItemRateMaster = deleteItemRateMaster;
    window.importItemRateMasterExcel = importItemRateMasterExcel;
    window.renderSalesItemPicker = renderSalesItemPicker;
    window.selectSalesItemCategory = selectSalesItemCategory;
    window.addSalesItemFromMaster = addSalesItemFromMaster;
    window.importSalesGpTargetExcel = importSalesGpTargetExcel;
    window.deleteAllSalesData = deleteAllSalesData;
    window.deleteAllComplaintData = deleteAllComplaintData;
    window.deleteAllCashData = deleteAllCashData;
    window.deleteAllTrainMasters = deleteAllTrainMasters;
    window.deleteAllTargetMasters = deleteAllTargetMasters;
    window.clearMasterForm = clearMasterForm;
    window.editMasterRow = editMasterRow;
    window.deleteMasterRow = deleteMasterRow;
    window.clearMasterTableFilters = clearMasterTableFilters;
    window.onMasterClusterChange = onMasterClusterChange;
    window.onMasterTrainManagerChange = onMasterTrainManagerChange;
    window.addYard = addYard;
    window.addClusterManager = addClusterManager;
    window.addTrainManager = addTrainManager;
    window.addRakeManager = addRakeManager;
    window.onRoleChange = onRoleChange;
    window.saveUser = saveUser;
    window.clearUserForm = clearUserForm;
    window.editUser = editUser;
    window.deleteUser = deleteUser;
    window.importSalesExcel = importSalesExcel;
    window.importComplaintExcel = importComplaintExcel;
    window.importCashExcel = importCashExcel;
    window.importMasterExcel = importMasterExcel;
    window.downloadTableExcel = downloadTableExcel;
    window.restoreBackup = restoreBackup;
    window.resetAndImportSales = resetAndImportSales;
    window.syncToCloud = syncToCloud;
    window.syncFromCloud = syncFromCloud;
    window.clearSalesFilters = clearSalesFilters;
    window.clearComplaintFilters = clearComplaintFilters;
    window.clearCashDashFilters = clearCashDashFilters;
    window.setDefaultDateRanges = setDefaultDateRanges;
    window.setDefaultCompDateRanges = setDefaultCompDateRanges;
    window.handleSalesDateModeChange = handleSalesDateModeChange;
    window.handleComplaintDateModeChange = handleComplaintDateModeChange;
    window.filterByBucket = filterByBucket;
    window.applyChartFilter = applyChartFilter;
    window.clearChartFilter = clearChartFilter;
    window.clearCompChartFilter = clearCompChartFilter;
    window.toggleComplaintChartFilter = toggleComplaintChartFilter;
    window.applyComplaintFilter = applyComplaintFilter;
    window.updateCashGPFromSales = updateCashGPFromSales;
    window.checkShortage = checkShortage;
