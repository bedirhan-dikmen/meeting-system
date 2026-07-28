/* ==========================================================================
   MEETING MANAGEMENT & FILTERING MODULE (EXECUTIVE DESIGN)
   ========================================================================== */

const Meetings = {
  allMeetings: [],
  allUsers: [],
  allDepartments: [],
  selectedUserIds: [],

  async init() {
    await this.loadUsersAndDepartments();
    await this.loadMeetings();
    this.bindEvents();
  },

  async loadUsersAndDepartments() {
    try {
      const resUsers = await Auth.fetchWithAuth('/api/v1/users/');
      if (resUsers.ok) {
        this.allUsers = await resUsers.json();
        this.populateUserSelects();
        this.renderUserInvitationList();
      }
    } catch (e) {
      console.warn("Kullanıcılar yüklenemedi (Admin değil ise sınırlı yetki):", e);
    }
  },

  populateUserSelects() {
    const participantSelect = document.getElementById('filterParticipant');
    const hostSelect = document.getElementById('filterHost');

    if (hostSelect) {
      hostSelect.innerHTML = `<option value="">Tüm Yöneticiler</option>` +
        this.allUsers.map(u => `<option value="${u.id}">${u.first_name} ${u.last_name}</option>`).join('');
    }

    if (participantSelect) {
      participantSelect.innerHTML = `<option value="">Tüm Katılımcılar</option>` +
        this.allUsers.map(u => `<option value="${u.id}">${u.first_name} ${u.last_name}</option>`).join('');
    }
  },

  updateCalculatedEndTime() {
    const startInput = document.getElementById('createStart');
    const durationSelect = document.getElementById('createDuration');
    const displayInput = document.getElementById('createCalculatedEndDisplay');

    if (!startInput || !durationSelect || !displayInput) return;

    if (!startInput.value) {
      displayInput.value = '-';
      return;
    }

    const start = this.parseDate(startInput.value);
    const durationMins = parseInt(durationSelect.value || '30', 10);
    const end = new Date(start.getTime() + durationMins * 60 * 1000);

    const day = String(end.getDate()).padStart(2, '0');
    const month = String(end.getMonth() + 1).padStart(2, '0');
    const year = end.getFullYear();
    const hours = String(end.getHours()).padStart(2, '0');
    const mins = String(end.getMinutes()).padStart(2, '0');

    displayInput.value = `${day}.${month}.${year} ${hours}:${mins}`;
  },

  generatePasscode() {
    const passcode = Math.floor(100000 + Math.random() * 900000).toString();
    const passcodeEl = document.getElementById('createPasscode');
    if (passcodeEl) passcodeEl.value = passcode;
  },

  onUserSearchInput(term) {
    this.renderUserInvitationList(term);
  },

  toggleUserSelection(userId) {
    const index = this.selectedUserIds.indexOf(userId);
    if (index > -1) {
      this.selectedUserIds.splice(index, 1);
    } else {
      this.selectedUserIds.push(userId);
    }
    this.updateSelectedUsersBadge();
  },

  updateSelectedUsersBadge() {
    const badge = document.getElementById('selectedUsersBadge');
    if (badge) {
      badge.textContent = `${this.selectedUserIds.length} Seçili`;
    }
  },

  renderUserInvitationList(filterTerm = '') {
    const container = document.getElementById('invitedUsersContainer');
    if (!container) return;

    const currentUserId = (typeof Auth !== 'undefined' && Auth.getCurrentUser) ? Auth.getCurrentUser()?.id : null;
    const term = (filterTerm || '').toLowerCase().trim();

    const filtered = (this.allUsers || []).filter(u => {
      if (u.id === currentUserId) return false;
      if (!term) return true;
      const fullName = `${u.first_name || ''} ${u.last_name || ''}`.toLowerCase();
      const email = (u.email || '').toLowerCase();
      const username = (u.username || '').toLowerCase();
      return fullName.includes(term) || email.includes(term) || username.includes(term);
    });

    if (filtered.length === 0) {
      container.innerHTML = `<div style="color: #94a3b8; font-size: 0.85rem; text-align: center; padding: 0.5rem;">Kullanıcı bulunamadı.</div>`;
      return;
    }

    container.innerHTML = filtered.map(u => {
      const isChecked = this.selectedUserIds.includes(u.id);
      const displayName = `${u.first_name || ''} ${u.last_name || u.username || 'Kullanıcı'}`.trim();
      return `
        <label style="display: flex; align-items: center; justify-content: space-between; padding: 0.4rem 0.6rem; border-radius: 6px; background: ${isChecked ? '#f0fdf4' : '#f8fafc'}; border: 1px solid ${isChecked ? '#bbf7d0' : '#f1f5f9'}; cursor: pointer; transition: all 0.15s ease;">
          <div style="display: flex; align-items: center; gap: 0.6rem;">
            <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="Meetings.toggleUserSelection('${u.id}')" style="width: 16px; height: 16px; accent-color: #10b981; cursor: pointer;">
            <div>
              <span style="font-size: 0.88rem; font-weight: 600; color: #1e293b;">${displayName}</span>
              <span style="font-size: 0.78rem; color: #64748b; margin-left: 0.4rem;">(${u.email || 'e-posta yok'})</span>
            </div>
          </div>
          <span style="font-size: 0.75rem; color: #64748b; background: #e2e8f0; padding: 0.1rem 0.45rem; border-radius: 4px;">${u.role || 'Kullanıcı'}</span>
        </label>
      `;
    }).join('');

    this.updateSelectedUsersBadge();
  },

  async loadMeetings() {
    try {
      const response = await Auth.fetchWithAuth('/api/v1/meetings/');

      if (!response.ok) {
        throw new Error("Toplantılar yüklenemedi.");
      }

      this.allMeetings = await response.json();
      this.applyFilters();
    } catch (err) {
      console.error(err);
      if (Notifications) Notifications.show(err.message, 'danger', 'Hata');
    }
  },


  applyFilters() {
    const searchTitle = document.getElementById('filterSearch')?.value.toLowerCase().trim() || '';
    const filterHost = document.getElementById('filterHost')?.value || '';
    const filterType = document.getElementById('filterType')?.value || '';
    const filterStatus = document.getElementById('filterStatus')?.value || '';
    const dateFrom = document.getElementById('filterDateFrom')?.value || '';
    const dateTo = document.getElementById('filterDateTo')?.value || '';

    const filtered = this.allMeetings.filter(m => {
      if (searchTitle && !m.title.toLowerCase().includes(searchTitle) && !(m.description || '').toLowerCase().includes(searchTitle)) {
        return false;
      }
      if (filterHost && m.created_by !== filterHost) {
        return false;
      }
      if (filterType && m.meeting_type !== filterType) {
        return false;
      }
      if (filterStatus && m.status !== filterStatus) {
        return false;
      }
      if (dateFrom && new Date(m.scheduled_start) < new Date(dateFrom)) {
        return false;
      }
      if (dateTo && new Date(m.scheduled_start) > new Date(dateTo + 'T23:59:59')) {
        return false;
      }

      return true;
    });

    this.renderMeetingsList(filtered);
  },

  renderMeetingsList(meetings) {
    const liveContainer = document.getElementById('liveMeetingsContainer');
    const scheduledContainer = document.getElementById('scheduledMeetingsContainer');
    const completedContainer = document.getElementById('completedMeetingsContainer');
    const liveBadge = document.getElementById('liveCountBadge');
    const scheduledBadge = document.getElementById('scheduledCountBadge');
    const completedBadge = document.getElementById('completedCountBadge');

    if (!liveContainer || !scheduledContainer) return;

    const list = meetings || [];

    const liveMeetings = list.filter(m => {
      const s = (m.status || '').toLowerCase();
      return s === 'canlı' || s === 'başladı' || s === 'active';
    });

    const completedMeetings = list.filter(m => {
      const s = (m.status || '').toLowerCase();
      return s === 'tamamlandı' || s === 'completed' || s === 'iptal edildi';
    });

    const scheduledMeetings = list.filter(m => {
      const s = (m.status || '').toLowerCase();
      return s !== 'canlı' && s !== 'başladı' && s !== 'active' && s !== 'tamamlandı' && s !== 'completed' && s !== 'iptal edildi';
    });

    if (liveBadge) liveBadge.textContent = liveMeetings.length;
    if (scheduledBadge) scheduledBadge.textContent = scheduledMeetings.length;
    if (completedBadge) completedBadge.textContent = completedMeetings.length;

    if (liveMeetings.length === 0) {
      liveContainer.innerHTML = `
        <div style="padding: 1.5rem; background: #ffffff; border: 1px dashed #cbd5e1; border-radius: 12px; color: #64748b; font-size: 0.88rem; text-align: center;">
          <i class="fas fa-broadcast-tower" style="font-size: 1.3rem; margin-bottom: 0.4rem; display: block; color: #94a3b8;"></i>
          Şu an devam eden canlı oturum bulunmuyor.
        </div>
      `;
    } else {
      liveContainer.innerHTML = liveMeetings.map(m => this.createMeetingCardHTML(m, 'live')).join('');
    }

    if (scheduledMeetings.length === 0) {
      scheduledContainer.innerHTML = `
        <div style="padding: 1.5rem; background: #ffffff; border: 1px dashed #cbd5e1; border-radius: 12px; color: #64748b; font-size: 0.88rem; text-align: center;">
          <i class="fas fa-calendar-times" style="font-size: 1.3rem; margin-bottom: 0.4rem; display: block; color: #94a3b8;"></i>
          Yaklaşan planlı kurumsal toplantı bulunmuyor.
        </div>
      `;
    } else {
      scheduledContainer.innerHTML = scheduledMeetings.map(m => this.createMeetingCardHTML(m, 'scheduled')).join('');
    }

    if (completedContainer) {
      if (completedMeetings.length === 0) {
        completedContainer.innerHTML = `
          <div style="padding: 1.5rem; background: #ffffff; border: 1px dashed #cbd5e1; border-radius: 12px; color: #64748b; font-size: 0.88rem; text-align: center;">
            <i class="fas fa-folder-open" style="font-size: 1.3rem; margin-bottom: 0.4rem; display: block; color: #94a3b8;"></i>
            Tamamlanan veya arşivlenen toplantı kaydı bulunmuyor.
          </div>
        `;
      } else {
        completedContainer.innerHTML = completedMeetings.map(m => this.createMeetingCardHTML(m, 'completed')).join('');
      }
    }
  },

  parseDate(dateStr) {
    if (!dateStr) return new Date();
    if (dateStr instanceof Date) return dateStr;
    if (typeof dateStr === 'string') {
      const cleanStr = dateStr.split('.')[0].replace('Z', '').replace(/[\+\-]\d{2}:\d{2}$/, '');
      const parts = cleanStr.split(/[-T :]/).map(Number);
      if (parts.length >= 5) {
        return new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5] || 0);
      }
    }
    return new Date(dateStr);
  },

  createMeetingCardHTML(m, meetingCategory) {
    const currentUser = (typeof Auth !== 'undefined' && Auth.getCurrentUser) ? Auth.getCurrentUser() : null;
    const isOrganizer = (currentUser && (currentUser.id === m.created_by || currentUser.role === 'admin'));

    const startObj = this.parseDate(m.scheduled_start);
    const duration = m.duration_minutes || 30;
    const endObj = m.scheduled_end ? this.parseDate(m.scheduled_end) : new Date(startObj.getTime() + duration * 60 * 1000);

    const startTimeStr = startObj.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    const endTimeStr = endObj.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    const dateStr = startObj.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeRangeStr = `${startTimeStr} - ${endTimeStr} (${duration} dk)`;

    const hostDisplayName = m.creator ? `${m.creator.first_name || ''} ${m.creator.last_name || ''}`.trim() : (m.creator_name || 'Yeb Soft');
    const menuId = `cardPopover_${m.id}`;

    // STATUS BADGE
    let statusBadgeHTML = '';
    const status = (m.status || '').toLowerCase();
    const isLive = meetingCategory === 'live' || status === 'canlı' || status === 'başladı' || status === 'active';
    const isCompleted = meetingCategory === 'completed' || status === 'tamamlandı' || status === 'completed';

    if (isLive) {
      statusBadgeHTML = `<span class="badge-status-live-pill"><span class="live-pulse-dot"></span> Başladı (Canlı)</span>`;
    } else if (isCompleted) {
      statusBadgeHTML = `<span style="background: #d1fae5; border: 1px solid #a7f3d0; color: #065f46; font-size: 0.76rem; font-weight: 800; padding: 0.2rem 0.65rem; border-radius: 9999px;"><i class="fas fa-check-circle"></i> Tamamlandı</span>`;
    } else if (status === 'iptal edildi') {
      statusBadgeHTML = `<span style="background: #ffe4e6; border: 1px solid #fecdd3; color: #be123c; font-size: 0.76rem; font-weight: 800; padding: 0.2rem 0.65rem; border-radius: 9999px;"><i class="fas fa-ban"></i> İptal Edildi</span>`;
    } else if (status === 'taslak') {
      statusBadgeHTML = `<span style="background: #f1f5f9; border: 1px solid #cbd5e1; color: #475569; font-size: 0.76rem; font-weight: 800; padding: 0.2rem 0.65rem; border-radius: 9999px;"><i class="fas fa-file-alt"></i> Taslak</span>`;
    } else {
      statusBadgeHTML = `<span style="background: #e0f2fe; border: 1px solid #bae6fd; color: #0369a1; font-size: 0.76rem; font-weight: 800; padding: 0.2rem 0.65rem; border-radius: 9999px;"><i class="far fa-calendar-alt"></i> Planlandı</span>`;
    }

    const dayNum = startObj.getDate();
    const monthNamesTr = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Ekim', 'Kas', 'Ara'];
    const dayNamesTr = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
    const monthStr = monthNamesTr[startObj.getMonth()];
    const dayNameTr = dayNamesTr[startObj.getDay()];
    const teamsTimeStr = `${startTimeStr} - ${endTimeStr}, ${dayNameTr}`;

    // Helper: Toplantı türüne göre grafiklerle uyumlu dinamik badge üretme
    const getTypeBadgeHTML = (meetingType) => {
      const typeStr = meetingType || 'Genel Toplantı';
      const t = typeStr.toLowerCase();
      let badgeClass = 'badge-type-general';
      
      if (t.includes('planlı') || t.includes('planlanan')) badgeClass = 'badge-type-planned';
      else if (t.includes('proje')) badgeClass = 'badge-type-project';
      else if (t.includes('günlük') || t.includes('daily') || t.includes('standup')) badgeClass = 'badge-type-daily';
      else if (t.includes('acil') || t.includes('özel') || t.includes('yönetim')) badgeClass = 'badge-type-urgent';

      return `<span class="${badgeClass}"><i class="fas fa-tag"></i> ${typeStr}</span>`;
    };

    // 1. CANLI / AKTİF TOPLANTI KARTI (Microsoft Teams Birebir Düzen)
    if (isLive) {
      const activeCount = m.sessions_count || m.active_participants_count || m.current_participants || 1;
      return `
        <div class="meeting-card-teams">
          
          <!-- FAR LEFT: DATE BOX & VERTICAL DIVIDER BAR -->
          <div class="teams-card-left-section">
            <div class="teams-date-box">
              <span class="teams-date-day">${dayNum}</span>
              <span class="teams-date-month">${monthStr}</span>
            </div>
            <div class="teams-vertical-divider teams-divider-live"></div>

            <!-- TITLE & INFO STACK -->
            <div class="teams-card-info-stack">
              <h4 class="teams-card-title teams-card-title-live" title="${m.title}">${m.title}</h4>
              <p class="teams-card-time">${teamsTimeStr}</p>
              <p class="teams-card-host">Yöneticisi: <strong>${hostDisplayName}</strong></p>
            </div>
          </div>

          <!-- MIDDLE BADGES ROW -->
          <div class="teams-card-middle-badges">
            ${getTypeBadgeHTML(m.meeting_type)}
            <span class="badge-status-live-pill"><span class="live-pulse-dot"></span> Başladı (Canlı)</span>
            <span class="participant-instant-badge" title="Anlık Katılımcı Sayısı"><i class="fas fa-users"></i> ${activeCount}</span>
          </div>

          <!-- FAR RIGHT ACTIONS & MENU -->
          <div class="teams-card-actions">
            <a href="/prejoin/${m.meeting_code}" class="btn-teams-primary">
              Katıl
            </a>

            <div style="position: relative; display: flex; align-items: center;">
              <button type="button" onclick="Meetings.toggleCardMenu(event, '${menuId}')" class="card-menu-btn" title="Seçenekler">
                <i class="fas fa-ellipsis-v"></i>
              </button>

              <!-- THREE DOTS DROPDOWN MENU -->
              <div id="${menuId}" class="teams-dropdown-popover card-popover-menu" style="right: 0; top: 100%; width: 200px; z-index: 500;">
                <button type="button" class="teams-popover-item" onclick="Meetings.showMeetingInfo('${m.id}')">
                  <i class="fas fa-info-circle" style="color: #0f6cbd;"></i> Toplantı Bilgileri
                </button>
                <button type="button" class="teams-popover-item" onclick="Meetings.openEditModal('${m.id}')">
                  <i class="fas fa-edit" style="color: #5b5fc7;"></i> Toplantı Düzenleme
                </button>
                <button type="button" class="teams-popover-item" onclick="Meetings.cancelMeeting('${m.id}')" style="color: #c4314b;">
                  <i class="fas fa-trash-alt" style="color: #c4314b;"></i> Toplantıyı İptal Et / Sil
                </button>
              </div>
            </div>
          </div>

        </div>
      `;
    }

    // 2. PLANLANAN / PLANLI TOPLANTI KARTI (Microsoft Teams Birebir Düzen)
    return `
      <div class="meeting-card-teams">
        
        <!-- FAR LEFT: DATE BOX & VERTICAL DIVIDER BAR -->
        <div class="teams-card-left-section">
          <div class="teams-date-box">
            <span class="teams-date-day">${dayNum}</span>
            <span class="teams-date-month">${monthStr}</span>
          </div>
          <div class="teams-vertical-divider teams-divider-planned"></div>

          <!-- TITLE & INFO STACK -->
          <div class="teams-card-info-stack">
            <h4 class="teams-card-title" title="${m.title}">${m.title}</h4>
            <p class="teams-card-time">${teamsTimeStr}</p>
            <p class="teams-card-host">Yöneticisi: <strong>${hostDisplayName}</strong></p>
          </div>
        </div>

        <!-- MIDDLE BADGES ROW -->
        <div class="teams-card-middle-badges">
          ${getTypeBadgeHTML(m.meeting_type)}
          ${isCompleted 
            ? `<span class="badge-status-completed-pill"><i class="fas fa-check-circle"></i> Tamamlandı</span>`
            : `<span class="badge-status-planned-pill"><i class="far fa-calendar"></i> Planlandı</span>`}
        </div>

        <!-- FAR RIGHT ACTIONS & MENU -->
        <div class="teams-card-actions">
          ${isCompleted ? `
            <button type="button" onclick="Meetings.showMeetingInfo('${m.id}')" style="background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; border-radius: 8px; font-weight: 700; font-size: 0.82rem; padding: 0.5rem 0.95rem; cursor: pointer; display: inline-flex; align-items: center; gap: 0.35rem;">
              <i class="fas fa-info-circle"></i> Detaylar
            </button>
          ` : `
            <a href="/prejoin/${m.meeting_code}" class="btn-teams-primary">
              Katıl
            </a>
          `}

          <div style="position: relative; display: flex; align-items: center;">
            <button type="button" onclick="Meetings.toggleCardMenu(event, '${menuId}')" class="card-menu-btn" title="Seçenekler">
              <i class="fas fa-ellipsis-v"></i>
            </button>

            <!-- THREE DOTS DROPDOWN MENU -->
            <div id="${menuId}" class="teams-dropdown-popover card-popover-menu" style="right: 0; top: 100%; width: 200px; z-index: 500;">
              <button type="button" class="teams-popover-item" onclick="Meetings.showMeetingInfo('${m.id}')">
                <i class="fas fa-info-circle" style="color: #0f6cbd;"></i> Toplantı Bilgileri
              </button>
              ${!isCompleted ? `
              <button type="button" class="teams-popover-item" onclick="Meetings.openEditModal('${m.id}')">
                <i class="fas fa-edit" style="color: #5b5fc7;"></i> Toplantı Düzenleme
              </button>
              <button type="button" class="teams-popover-item" onclick="Meetings.cancelMeeting('${m.id}')" style="color: #c4314b;">
                <i class="fas fa-trash-alt" style="color: #c4314b;"></i> Toplantıyı İptal Et / Sil
              </button>
              ` : ''}
            </div>
          </div>
        </div>

      </div>
    `;
  },


  bindEvents() {
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.card-popover-menu') && !e.target.closest('button')) {
        document.querySelectorAll('.teams-dropdown-popover').forEach(p => p.classList.remove('show'));
      }
    });

    const inputs = ['filterSearch', 'filterHost', 'filterType', 'filterStatus', 'filterDateFrom', 'filterDateTo', 'filterParticipant'];
    inputs.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => this.applyFilters());
        el.addEventListener('change', () => this.applyFilters());
      }
    });

    const createStartEl = document.getElementById('createStart');
    const createDurationEl = document.getElementById('createDuration');
    if (createStartEl) {
      createStartEl.addEventListener('change', () => this.updateCalculatedEndTime());
      createStartEl.addEventListener('input', () => this.updateCalculatedEndTime());
    }
    if (createDurationEl) {
      createDurationEl.addEventListener('change', () => this.updateCalculatedEndTime());
    }

    const formCreate = document.getElementById('formCreateMeeting');
    if (formCreate) {
      formCreate.addEventListener('submit', (e) => this.handleCreateMeeting(e));
    }

    const formEdit = document.getElementById('formEditMeeting');
    if (formEdit) {
      formEdit.addEventListener('submit', (e) => this.handleEditMeeting(e));
    }
  },

  openCreateModal() {
    const modal = document.getElementById('createMeetingModal');
    if (modal) modal.classList.add('active');

    this.selectedUserIds = [];

    const startInput = document.getElementById('createStart');
    if (startInput) {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      startInput.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
    }

    this.updateCalculatedEndTime();
    this.renderUserInvitationList('');
  },

  closeCreateModal() {
    const modal = document.getElementById('createMeetingModal');
    if (modal) modal.classList.remove('active');
  },

  toggleCardMenu(e, menuId) {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    const targetPop = document.getElementById(menuId);
    document.querySelectorAll('.teams-dropdown-popover').forEach(p => {
      if (p !== targetPop) p.classList.remove('show');
    });
    if (targetPop) {
      targetPop.classList.toggle('show');
    }
  },

  showMeetingInfo(meetingId) {
    document.querySelectorAll('.teams-dropdown-popover').forEach(p => p.classList.remove('show'));
    const m = (this.allMeetings || []).find(item => item.id === meetingId);
    if (!m) return;

    const hostName = m.creator ? `${m.creator.first_name || ''} ${m.creator.last_name || ''}`.trim() : 'Yeb Soft';
    const startObj = this.parseDate(m.scheduled_start);
    const duration = m.duration_minutes || 30;
    const endObj = m.scheduled_end ? this.parseDate(m.scheduled_end) : new Date(startObj.getTime() + duration * 60000);

    const dateStr = startObj.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const startTimeStr = startObj.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    const endTimeStr = endObj.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

    const titleEl = document.getElementById('infoMeetingTitle');
    const descEl = document.getElementById('infoMeetingDescription');
    const hostEl = document.getElementById('infoMeetingHost');
    const dateEl = document.getElementById('infoMeetingDate');
    const timeRangeEl = document.getElementById('infoMeetingTimeRange');
    const typeEl = document.getElementById('infoMeetingType');
    const codeEl = document.getElementById('infoMeetingCodeBadge');
    const statusEl = document.getElementById('infoMeetingStatusBadge');
    const joinBtn = document.getElementById('infoMeetingJoinBtn');

    if (titleEl) titleEl.textContent = m.title;
    if (descEl) descEl.textContent = m.agenda ? `[GÜNDEM]\n${m.agenda}\n\n[AÇIKLAMA]\n${m.description || 'Yok'}` : (m.description || 'Açıklama veya gündem belirtilmedi.');
    if (hostEl) hostEl.textContent = hostName;
    if (dateEl) dateEl.textContent = dateStr;
    if (timeRangeEl) timeRangeEl.textContent = `${startTimeStr} - ${endTimeStr} (${duration} dk)`;
    if (typeEl) typeEl.textContent = m.meeting_type || 'Genel Toplantı';
    if (codeEl) codeEl.textContent = `ODA KODU: ${m.meeting_code} | ŞİFRE: ${m.passcode || 'Yok'}`;
    if (statusEl) statusEl.textContent = (m.status || 'planlandı').toUpperCase();
    if (joinBtn) joinBtn.href = `/prejoin/${m.meeting_code}`;

    const modal = document.getElementById('meetingDetailsModal');
    if (modal) modal.classList.add('active');
  },

  closeDetailsModal() {
    const modal = document.getElementById('meetingDetailsModal');
    if (modal) modal.classList.remove('active');
  },

  openEditModal(meetingId) {
    document.querySelectorAll('.teams-dropdown-popover').forEach(p => p.classList.remove('show'));
    const meeting = (this.allMeetings || []).find(m => m.id === meetingId);
    if (!meeting) return;

    document.getElementById('editMeetingId').value = meeting.id;
    document.getElementById('editTitle').value = meeting.title || '';
    document.getElementById('editDescription').value = meeting.description || '';
    document.getElementById('editType').value = meeting.meeting_type || 'Genel Toplantı';

    const modal = document.getElementById('editMeetingModal');
    if (modal) modal.classList.add('active');
  },

  closeEditModal() {
    const modal = document.getElementById('editMeetingModal');
    if (modal) modal.classList.remove('active');
  },

  async handleCreateMeeting(e) {
    e.preventDefault();
    const title = document.getElementById('createTitle').value.trim();
    const description = document.getElementById('createDescription').value.trim();
    const scheduledStart = document.getElementById('createStart').value;
    const durationMinutes = parseInt(document.getElementById('createDuration').value || '30', 10);
    const meetingType = document.getElementById('createType').value;
    const agenda = document.getElementById('createAgenda')?.value.trim() || '';
    const passcode = document.getElementById('createPasscode')?.value.trim() || null;
    const lobbyEnabled = document.getElementById('createLobbyEnabled')?.checked || false;
    const isPrivate = document.getElementById('createIsPrivate')?.checked || false;

    if (!title || !scheduledStart) {
      Notifications.show("Lütfen gerekli alanları doldurun.", "warning", "Eksik Bilgi");
      return;
    }

    const pad = (n) => String(n).padStart(2, '0');
    const parts = scheduledStart.split(/[-T :]/).map(Number);
    const startDate = new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], 0);
    const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);

    const startISO = `${startDate.getFullYear()}-${pad(startDate.getMonth() + 1)}-${pad(startDate.getDate())}T${pad(startDate.getHours())}:${pad(startDate.getMinutes())}:00`;
    const endISO = `${endDate.getFullYear()}-${pad(endDate.getMonth() + 1)}-${pad(endDate.getDate())}T${pad(endDate.getHours())}:${pad(endDate.getMinutes())}:00`;

    try {
      const res = await fetch('/api/v1/meetings/', {
        method: 'POST',
        headers: Auth.getAuthHeaders(),
        body: JSON.stringify({
          title,
          description,
          scheduled_start: startISO,
          scheduled_end: endISO,
          duration_minutes: durationMinutes,
          meeting_type: meetingType,
          agenda: agenda || null,
          passcode: passcode || null,
          lobby_enabled: lobbyEnabled,
          is_private: isPrivate,
          invited_user_ids: this.selectedUserIds,
          status: 'planlandı'
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || "Toplantı oluşturulamadı.");
      }

      Notifications.show("Toplantı başarıyla oluşturuldu ve davetler iletildi!", "success", "Başarılı");
      this.closeCreateModal();
      await this.loadMeetings();
    } catch (err) {
      console.error(err);
      Notifications.show(err.message, "danger", "Hata");
    }
  },

  async handleEditMeeting(e) {
    e.preventDefault();
    const meetingId = document.getElementById('editMeetingId').value;
    const title = document.getElementById('editTitle').value.trim();
    const description = document.getElementById('editDescription').value.trim();
    const meetingType = document.getElementById('editType').value;

    try {
      const res = await fetch(`/api/v1/meetings/${meetingId}`, {
        method: 'PUT',
        headers: Auth.getAuthHeaders(),
        body: JSON.stringify({
          title,
          description,
          meeting_type: meetingType
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || "Toplantı güncellenemedi.");
      }

      Notifications.show("Toplantı başarıyla güncellendi!", "success", "Başarılı");
      this.closeEditModal();
      await this.loadMeetings();
    } catch (err) {
      console.error(err);
      Notifications.show(err.message, "danger", "Hata");
    }
  },

  async cancelMeeting(meetingId) {
    document.querySelectorAll('.teams-dropdown-popover').forEach(p => p.classList.remove('show'));
    const meeting = (this.allMeetings || []).find(m => m.id === meetingId);
    const title = meeting ? meeting.title : 'Bu toplantı';

    if (!confirm(`"${title}" toplantısını silmek / iptal etmek istediğinize emin misiniz?`)) return;

    try {
      const res = await fetch(`/api/v1/meetings/${meetingId}`, {
        method: 'PUT',
        headers: Auth.getAuthHeaders(),
        body: JSON.stringify({
          status: 'iptal edildi',
          is_active: false
        })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || "Toplantı silinemedi.");
      }

      Notifications.show("Toplantı başarıyla silindi ve iptal edildi.", "info", "Toplantı Silindi");
      await this.loadMeetings();
    } catch (err) {
      console.error(err);
      Notifications.show(err.message, "danger", "Hata");
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  Meetings.init();
});
